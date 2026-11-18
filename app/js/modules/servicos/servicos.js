import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, papelAtual } from '../../lib/estado.js';
import { moeda, dataBR } from '../../lib/format.js';
import { aviso, abrirJanela, confirmar, mensagemErro } from '../../lib/ui.js';
import { nomeArquivo } from '../comunicados/calculos.js';
import { lerValorReais, validarArquivoNF } from '../compras/retroativa_regras.js';
import { PERIODICIDADE, SITUACAO, situacaoDoMes, ultimoPagamento, totais, telefoneDigitos, telefoneBR, referenciaDoMes, hojeISO } from './calculos.js';

// Serviços contratados (piscineiro, jardineiro…) e seus pagamentos. Equipe vê e registra; síndico desativa, corrige e exclui.
let servicos = [], pagamentos = [], verInativos = false, raiz = null;
const cid = () => estado.condominioId;
const sindico = () => ['sindico', 'superadmin'].includes(papelAtual());
const servico = (id) => servicos.find((s) => s.id === id);
const valorCampo = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
const pill = (st) => { if (!st) return ''; const [r, c] = SITUACAO[st]; return h`<span class="status-pill ${c}" data-situacao="${st}">${r}</span>`; };

async function carregar() {
  const desde = `${new Date().getFullYear() - 1}-01-01`;
  const [s, p] = await Promise.all([
    db.from('servicos_contratados').select('*').eq('condominio_id', cid()).order('servico').order('nome'),
    db.from('servico_pagamentos').select('id,servico_id,data_pagamento,valor,referencia,numero_recibo,observacao,comprovante_path,comprovante_nome,registrado_por')
      .eq('condominio_id', cid()).gte('data_pagamento', desde).order('data_pagamento', { ascending: false }),
  ]);
  if (s.error || p.error) throw new Error((s.error || p.error).message);
  servicos = s.data; pagamentos = p.data;
}
async function atualizar() { await carregar(); desenhar(); }

function contato(s) {
  const d = telefoneDigitos(s.telefone);
  return h`${d ? h`<a href="tel:+55${d}">${telefoneBR(d)}</a> · <a href="https://wa.me/55${d}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
    ${s.email ? h`${d ? ' · ' : ''}<a href="mailto:${s.email}">${s.email}</a>` : ''}`;
}

function linha(s) {
  const ult = ultimoPagamento(s.id, pagamentos), st = situacaoDoMes(s, pagamentos);
  return h`<tr class="${s.ativo ? '' : 'inativo'}" data-servico="${s.id}">
    <td><b>${s.nome}</b> ${s.ativo ? '' : h`<span class="tag">desativado</span>`}<br><span class="tag">${s.servico}</span>
      <div class="dica">${contato(s)}</div></td>
    <td>${s.valor_combinado ? moeda(s.valor_combinado) : '—'}<div class="dica">${PERIODICIDADE[s.periodicidade] ?? s.periodicidade}${s.dia_pagamento ? ` · dia ${s.dia_pagamento}` : ''}</div></td>
    <td>${pill(st)}</td>
    <td>${ult ? h`${dataBR(ult.data_pagamento)}<div class="dica">${moeda(ult.valor)}</div>` : '—'}</td>
    <td class="acoes-linha">
      ${s.ativo ? h`<button class="btn pequeno" data-acao="pagar" data-id="${s.id}">Registrar pagamento</button>` : ''}
      <button class="icon-btn" data-acao="historico" data-id="${s.id}">Pagamentos</button>
      <button class="icon-btn" data-acao="editar" data-id="${s.id}">Editar</button>
      ${sindico() ? h`<button class="icon-btn" data-acao="${s.ativo ? 'desativar' : 'reativar'}" data-id="${s.id}">${s.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}
    </td></tr>`;
}

function desenhar() {
  const t = totais(pagamentos), agora = new Date();
  const ativos = servicos.filter((s) => s.ativo);
  const aPagar = ativos.filter((s) => ['pendente', 'atrasado'].includes(situacaoDoMes(s, pagamentos))).length;
  const lista = servicos.filter((s) => verInativos || s.ativo);
  const nomeMes = agora.toLocaleDateString('pt-BR', { month: 'long' });
  render(raiz, h`
    <div class="page-head"><div><h2>Serviços contratados</h2>
      <p>Prestadores fixos do condomínio (piscineiro, jardineiro, dedetização…). Os pagamentos entram nos relatórios de gastos e no painel.</p></div>
      <button class="btn" data-acao="novo">Novo serviço</button></div>
    <div class="cards">
      <div class="card"><div class="k">Serviços ativos</div><div class="v" data-resumo="ativos">${ativos.length}</div></div>
      <div class="card ${aPagar ? 'warn' : ''}"><div class="k">Mensais a pagar em ${nomeMes}</div><div class="v" data-resumo="apagar">${aPagar}</div></div>
      <div class="card"><div class="k">Pago em ${nomeMes}</div><div class="v num" style="font-size:20px" data-resumo="mes">${moeda(t.noMes)}</div></div>
      <div class="card"><div class="k">Pago em ${agora.getFullYear()}</div><div class="v num" style="font-size:20px" data-resumo="ano">${moeda(t.noAno)}</div></div>
    </div>
    <div class="panel">
      <div class="filtros"><label><input type="checkbox" id="sv-inativos" ${verInativos ? raw('checked') : ''}> Mostrar desativados</label></div>
      ${!servicos.length ? h`<div class="empty">Nenhum serviço cadastrado. Use “Novo serviço” para incluir o piscineiro, o jardineiro…</div>`
        : !lista.length ? h`<div class="empty">Nenhum serviço ativo.</div>`
        : h`<div class="tabela-rolagem"><table class="tabela-servicos"><thead><tr><th>Prestador</th><th>Valor combinado</th><th>Mês atual</th><th>Último pagamento</th><th></th></tr></thead>
            <tbody>${lista.map(linha)}</tbody></table></div>`}
    </div>`);
  raiz.querySelector('#sv-inativos').addEventListener('change', (e) => { verInativos = e.target.checked; desenhar(); });
}

// Janela com formulário próprio (para validar antes de enviar e manter a janela aberta no erro).
function formulario(titulo, corpo, rotulo, aoEnviar) {
  const fundo = abrirJanela(h`<h3>${titulo}</h3><form novalidate>${corpo}
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="submit" class="btn" data-salvar>${rotulo}</button></div></form>`, { largo: true });
  const form = fundo.querySelector('form'), caixa = fundo.querySelector('[data-erro]'), botao = fundo.querySelector('[data-salvar]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); caixa.classList.add('hidden'); botao.disabled = true;
    try { await aoEnviar(new FormData(form)); fundo.remove(); }
    catch (e) { caixa.textContent = mensagemErro(e); caixa.classList.remove('hidden'); botao.disabled = false; }
  });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  form.querySelector('input,select,textarea')?.focus();
  return fundo;
}

function editarServico(s = null) {
  formulario(s ? `Editar — ${s.nome}` : 'Novo serviço', h`
    <div class="linha-campos">
      <div class="field"><label for="sv-nome">Prestador ou empresa</label><input id="sv-nome" name="nome" maxlength="120" value="${s?.nome ?? ''}" placeholder="Ex.: Piscinas Azul" autocomplete="off"></div>
      <div class="field"><label for="sv-servico">Serviço</label><input id="sv-servico" name="servico" maxlength="60" value="${s?.servico ?? ''}" placeholder="Ex.: Piscineiro" list="sv-sugestoes" autocomplete="off">
        <datalist id="sv-sugestoes">${['Piscineiro', 'Jardineiro', 'Dedetização', 'Limpeza de caixa d’água', 'Manutenção de elevador', 'Portaria', 'Limpeza', 'Contabilidade', 'Segurança'].map((x) => h`<option value="${x}">`)}</datalist></div>
    </div>
    <div class="linha-campos">
      <div class="field"><label for="sv-tel">Telefone / WhatsApp (opcional)</label><input id="sv-tel" name="telefone" inputmode="tel" value="${s?.telefone ? telefoneBR(s.telefone) : ''}" placeholder="(11) 98765-4321"></div>
      <div class="field"><label for="sv-email">E-mail (opcional)</label><input id="sv-email" name="email" type="email" value="${s?.email ?? ''}"></div>
    </div>
    <div class="linha-campos">
      <div class="field"><label for="sv-valor">Valor combinado (opcional)</label><input id="sv-valor" name="valor" inputmode="decimal" value="${valorCampo(s?.valor_combinado)}" placeholder="Ex.: 850,00"></div>
      <div class="field"><label for="sv-per">Periodicidade</label><select id="sv-per" name="periodicidade">
        ${Object.entries(PERIODICIDADE).map(([k, r]) => h`<option value="${k}" ${k === (s?.periodicidade ?? 'mensal') ? raw('selected') : ''}>${r}</option>`)}</select></div>
    </div>
    <div class="field"><label for="sv-dia">Dia do pagamento (opcional, para mensais)</label><input id="sv-dia" name="dia" inputmode="numeric" value="${s?.dia_pagamento ?? ''}" placeholder="Ex.: 10" style="max-width:120px">
      <span class="dica">Depois desse dia, um serviço mensal sem pagamento no mês aparece como “Atrasado”.</span></div>
    <div class="field"><label for="sv-obs">Observações (opcional)</label><textarea id="sv-obs" name="obs" rows="2" maxlength="1000" placeholder="Ex.: vem às terças e sextas; contrato até dez/2027">${s?.observacoes ?? ''}</textarea></div>`,
  s ? 'Salvar' : 'Cadastrar', async (f) => {
    const nome = String(f.get('nome') ?? '').trim(), serv = String(f.get('servico') ?? '').trim();
    if (!nome) throw new Error('Informe o nome do prestador ou empresa.');
    if (!serv) throw new Error('Informe o serviço, por exemplo Piscineiro.');
    const tel = String(f.get('telefone') ?? '').trim();
    if (tel && !telefoneDigitos(tel)) throw new Error('Telefone inválido: informe o DDD e o número.');
    const vtxt = String(f.get('valor') ?? '').trim(), valor = vtxt ? lerValorReais(vtxt) : null;
    if (vtxt && !(valor > 0)) throw new Error('Valor combinado inválido. Use, por exemplo, 850,00.');
    const dia = String(f.get('dia') ?? '').trim();
    if (dia && !(/^\d{1,2}$/.test(dia) && Number(dia) >= 1 && Number(dia) <= 31)) throw new Error('Dia do pagamento deve ser de 1 a 31.');
    await rpc('salvar_servico', { p_condominio_id: cid(), p_id: s?.id ?? null, p_dados: {
      nome, servico: serv, telefone: tel || null, email: String(f.get('email') ?? '').trim() || null, valor_combinado: valor == null ? null : String(valor),
      periodicidade: f.get('periodicidade'), dia_pagamento: dia || null, observacoes: String(f.get('obs') ?? '').trim() || null } });
    aviso(s ? 'Serviço atualizado.' : 'Serviço cadastrado.', 'ok'); await atualizar();
  });
}

// Registrar (novo) ou corrigir (síndico) um pagamento.
function formPagamento(s, pag = null, aoSalvar = atualizar) {
  const hoje = hojeISO(), chave = crypto.randomUUID();
  let idSalvo = pag?.id ?? null;   // se o comprovante falhar, tentar de novo não lança outro pagamento (mesma chave)
  formulario(pag ? 'Corrigir pagamento' : `Registrar pagamento — ${s.nome}`, h`
    <p class="dica">${s.servico}${s.valor_combinado ? ` · combinado ${moeda(s.valor_combinado)} (${(PERIODICIDADE[s.periodicidade] ?? '').toLowerCase()})` : ''}</p>
    <div class="linha-campos">
      <div class="field"><label for="pg-data">Data do pagamento</label><input id="pg-data" name="data" type="date" max="${hoje}" value="${pag?.data_pagamento ?? hoje}"></div>
      <div class="field"><label for="pg-valor">Valor pago (R$)</label><input id="pg-valor" name="valor" inputmode="decimal" value="${valorCampo(pag ? pag.valor : s.valor_combinado)}" placeholder="Ex.: 850,00" autocomplete="off"></div>
    </div>
    <div class="linha-campos">
      <div class="field"><label for="pg-ref">Referência (opcional)</label><input id="pg-ref" name="ref" maxlength="60" value="${pag ? (pag.referencia ?? '') : (s.periodicidade === 'mensal' ? referenciaDoMes() : '')}" placeholder="Ex.: Novembro/2026, visita de 12/11"></div>
      <div class="field"><label for="pg-rec">Recibo ou nota (opcional)</label><input id="pg-rec" name="recibo" maxlength="60" value="${pag?.numero_recibo ?? ''}" placeholder="Número"></div>
    </div>
    <div class="field"><label for="pg-obs">Observação (opcional)</label><textarea id="pg-obs" name="obs" rows="2" maxlength="1000">${pag?.observacao ?? ''}</textarea></div>
    ${pag ? '' : h`<div class="field"><label for="pg-arq">Comprovante (opcional: PDF, JPG ou PNG, até 5 MB)</label><input id="pg-arq" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,.pdf"></div>`}`,
  pag ? 'Salvar correção' : 'Registrar pagamento', async (f) => {
    const data = String(f.get('data') ?? ''), valor = lerValorReais(f.get('valor'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Informe a data do pagamento.');
    if (data > hoje) throw new Error('A data do pagamento não pode ser no futuro.');
    if (!(valor > 0)) throw new Error('Informe o valor pago, como 850,00.');
    if (valor > 1000000) throw new Error('Valor alto demais. Confira o número digitado.');
    const arq = f.get('arquivo'); const temArq = arq && arq.size > 0;
    const v = temArq ? validarArquivoNF(arq) : null; if (v?.erro) throw new Error(v.erro);
    const dados = { data_pagamento: data, valor: String(valor), referencia: String(f.get('ref') ?? '').trim() || null,
      numero_recibo: String(f.get('recibo') ?? '').trim() || null, observacao: String(f.get('obs') ?? '').trim() || null };
    if (pag) await rpc('corrigir_pagamento_servico', { p_id: pag.id, p_dados: dados });
    else idSalvo = await rpc('registrar_pagamento_servico', { p_servico_id: s.id, p_dados: dados, p_chave: chave });
    if (temArq) {
      const caminho = `${cid()}/${idSalvo}/${crypto.randomUUID()}.${v.ext}`;
      const { error } = await db.storage.from('servicos').upload(caminho, arq, { contentType: arq.type || 'application/pdf', upsert: false });
      if (error) { await aoSalvar(); throw new Error('O pagamento foi registrado, mas o comprovante não foi enviado: ' + error.message + '. Tente de novo.'); }
      await rpc('definir_comprovante_pagamento', { p_id: idSalvo, p_path: caminho, p_nome: nomeArquivo(arq.name) });
    }
    aviso(pag ? 'Pagamento corrigido.' : `Pagamento de ${moeda(valor)} registrado.`, 'ok'); await aoSalvar();
  });
}

async function abrirComprovante(p) {
  const aba = window.open('', '_blank');   // aberta no clique, para o navegador não bloquear
  const { data, error } = await db.storage.from('servicos').createSignedUrl(p.comprovante_path, 120);
  if (error) { aba?.close(); throw new Error(error.message); }
  if (aba) { aba.opener = null; aba.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
}

async function historico(s) {
  const { data, error } = await db.from('servico_pagamentos')
    .select('id,servico_id,data_pagamento,valor,referencia,numero_recibo,observacao,comprovante_path,comprovante_nome,registrado_por')
    .eq('servico_id', s.id).order('data_pagamento', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  const quem = [...new Set(data.map((p) => p.registrado_por))];
  const pf = quem.length ? await db.from('profiles').select('id,nome').in('id', quem) : { data: [] };
  const nomes = Object.fromEntries((pf.data || []).map((x) => [x.id, x.nome]));
  const ano = String(new Date().getFullYear()), noAno = data.filter((p) => String(p.data_pagamento).startsWith(ano + '-')).reduce((t, p) => t + Number(p.valor), 0);
  const fundo = abrirJanela(h`
    <h3>Pagamentos — ${s.nome}</h3>
    <p class="dica">${s.servico} · ${data.length} ${data.length === 1 ? 'pagamento' : 'pagamentos'} · ${moeda(noAno)} em ${ano}</p>
    ${data.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Referência</th><th>Valor</th><th>Recibo</th><th>Quem registrou</th><th></th></tr></thead><tbody>
      ${data.map((p) => h`<tr data-pag="${p.id}"><td>${dataBR(p.data_pagamento)}</td><td>${p.referencia || '—'}${p.observacao ? h`<div class="dica">${p.observacao}</div>` : ''}</td>
        <td class="num">${moeda(p.valor)}</td><td>${p.numero_recibo || '—'}</td><td>${nomes[p.registrado_por] || '—'}</td>
        <td class="acoes-linha">${p.comprovante_path ? h`<button class="icon-btn" data-h="ver" data-id="${p.id}">Comprovante</button>` : ''}
          ${sindico() ? h`<button class="icon-btn" data-h="corrigir" data-id="${p.id}">Corrigir</button><button class="icon-btn" data-h="excluir" data-id="${p.id}">Excluir</button>` : ''}</td></tr>`)}
    </tbody></table></div>` : h`<div class="empty">Nenhum pagamento registrado.</div>`}
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes"><button class="btn ghost" data-fechar>Fechar</button></div>`, { largo: true });
  const erro = (e) => { const c = fundo.querySelector('[data-erro]'); c.textContent = mensagemErro(e); c.classList.remove('hidden'); };
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  on(fundo, 'click', '[data-h]', async (_, b) => {
    const p = data.find((x) => x.id === b.dataset.id); if (!p) return;
    try {
      if (b.dataset.h === 'ver') await abrirComprovante(p);
      else if (b.dataset.h === 'corrigir') { fundo.remove(); formPagamento(s, p, async () => { await atualizar(); await historico(s); }); }
      else if (b.dataset.h === 'excluir') {
        if (!(await confirmar('Excluir pagamento?', `O pagamento de ${moeda(p.valor)} em ${dataBR(p.data_pagamento)} sai dos gastos. A exclusão fica registrada na auditoria.`, { rotulo: 'Excluir', perigo: true }))) return;
        const caminho = await rpc('excluir_pagamento_servico', { p_id: p.id });
        if (caminho) { try { await db.storage.from('servicos').remove([caminho]); } catch { /* sem prejuízo */ } }
        fundo.remove(); aviso('Pagamento excluído.', 'ok'); await atualizar(); await historico(s);
      }
    } catch (e) { erro(e); }
  });
}

export async function abrir(el) {
  raiz = el; verInativos = false;
  await atualizar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    const a = b.dataset.acao, s = servico(b.dataset.id);
    try {
      if (a === 'novo') editarServico();
      else if (a === 'editar' && s) editarServico(s);
      else if (a === 'pagar' && s) formPagamento(s);
      else if (a === 'historico' && s) await historico(s);
      else if ((a === 'desativar' || a === 'reativar') && s) {
        const ativo = a === 'reativar';
        if (!ativo && !(await confirmar(`Desativar “${s.nome}”?`, 'O serviço sai da lista e não recebe novos pagamentos. O histórico continua nos gastos. Dá para reativar depois.', { rotulo: 'Desativar', perigo: true }))) return;
        await rpc('definir_servico_ativo', { p_id: s.id, p_ativo: ativo });
        aviso(ativo ? 'Serviço reativado.' : 'Serviço desativado.', 'ok'); await atualizar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
