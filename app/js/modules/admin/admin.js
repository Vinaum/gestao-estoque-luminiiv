import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, escolherCondominio, condominioAtual } from '../../lib/estado.js';
import { dataHoraBR, PAPEL_ROTULO, lerNumero, numCampo } from '../../lib/format.js';
import { cnpjValido, formatarCnpj, emailValido, soDigitos } from '../../lib/validacao.js';
import { aviso, janelaForm, mensagemErro } from '../../lib/ui.js';
import { resumo, NOME_TABELA, NOME_ACAO } from '../auditoria.js';

let aba = 'condominios', raizPagina = null, filtroTabela = '';
const ABAS = [['condominios', 'Condomínios'], ['pessoas', 'Pessoas'], ['catalogos', 'Categorias e unidades'], ['auditoria', 'Auditoria'], ['diagnostico', 'Diagnóstico']];
const cid = () => estado.condominioId;
const mudouContexto = () => document.dispatchEvent(new CustomEvent('contexto-mudou'));

/* ---------------- Condomínios ---------------- */
let conds = [], configs = {}, sindicos = {};
async function cCarregar() {
  const [c, cf, m] = await Promise.all([
    db.from('condominios').select('*').order('nome'),
    db.from('condominio_config').select('*'),
    db.from('membros').select('condominio_id,user_id,ativo').eq('papel', 'sindico'),
  ]);
  const falha = c.error || cf.error || m.error; if (falha) throw new Error(falha.message);
  conds = c.data; configs = Object.fromEntries(cf.data.map((x) => [x.condominio_id, x]));
  const ids = [...new Set(m.data.map((x) => x.user_id))];
  const { data: pf } = ids.length ? await db.from('profiles').select('id,nome').in('id', ids) : { data: [] };
  const nm = Object.fromEntries((pf || []).map((p) => [p.id, p.nome]));
  sindicos = {};
  m.data.filter((x) => x.ativo).forEach((x) => { (sindicos[x.condominio_id] ||= []).push(nm[x.user_id] || '(sem nome)'); });
}
function cTela() {
  return h`<div class="toolbar"><span class="dica">Cada condomínio tem estoque, compras e pessoas próprios.</span><button class="btn" data-acao="novo-cond">Novo condomínio</button></div>
    <div class="tabela-rolagem"><table><thead><tr><th>Condomínio</th><th>Síndico</th><th>Parâmetros</th><th></th></tr></thead><tbody>
    ${conds.map((c) => { const cf = configs[c.id]; return h`<tr class="${c.ativo ? '' : 'inativo'}">
      <td><b>${c.nome}</b> ${c.ativo ? '' : h`<span class="tag">inativo</span>`}${c.id === cid() ? h` <span class="tag">selecionado</span>` : ''}<br><span class="num">${c.cnpj ? formatarCnpj(c.cnpj) : ''}</span></td>
      <td>${(sindicos[c.id] || []).join(', ') || h`<span class="dica">sem síndico</span>`}</td>
      <td class="dica">${cf ? `atenção até ${Math.round(cf.faixa_atencao * 100)}% acima do mínimo · vencimento ${cf.venc_alerta_1}/${cf.venc_alerta_2} dias` : '—'}</td>
      <td><div class="linha-acoes">
        ${c.ativo ? h`<button class="icon-btn" data-acao="entrar" data-id="${c.id}">Entrar</button>` : ''}
        <button class="icon-btn" data-acao="editar-cond" data-id="${c.id}">Editar</button>
        <button class="icon-btn" data-acao="param" data-id="${c.id}">Parâmetros</button>
        <button class="icon-btn" data-acao="sindico" data-id="${c.id}">Definir síndico</button></div></td></tr>`; })}</tbody></table></div>`;
}
function validaCnpj(t) { const d = soDigitos(t); if (d && !cnpjValido(d)) throw new Error('CNPJ inválido. Confira os 14 números.'); return d || null; }
function formCond(c) {
  janelaForm({
    titulo: c ? `Editar — ${c.nome}` : 'Novo condomínio', rotulo: 'Salvar',
    corpo: h`<div class="field"><label for="k-nome">Nome</label><input id="k-nome" name="nome" value="${c?.nome ?? ''}" required></div>
      <div class="field"><label for="k-cnpj">CNPJ (opcional)</label><input id="k-cnpj" name="cnpj" value="${c?.cnpj ? formatarCnpj(c.cnpj) : ''}"></div>
      ${c ? h`<div class="field"><label><input type="checkbox" name="ativo" value="1" ${c.ativo ? raw('checked') : ''}> Condomínio ativo</label></div>` : ''}`,
    aoEnviar: async (f) => {
      if (!f.nome.trim()) throw new Error('Informe o nome.');
      const cnpj = validaCnpj(f.cnpj);
      if (c) {
        const { error } = await db.from('condominios').update({ nome: f.nome.trim(), cnpj, ativo: f.ativo === '1' }).eq('id', c.id);
        if (error) throw new Error(error.message);
      } else await rpc('criar_condominio', { p_nome: f.nome.trim(), p_cnpj: cnpj });
      aviso('Condomínio salvo.', 'ok'); await cCarregar(); desenhar(); mudouContexto();
    },
  });
}
function formParam(c) {
  const cf = configs[c.id];
  janelaForm({
    titulo: `Parâmetros — ${c.nome}`, rotulo: 'Salvar',
    corpo: h`<div class="field"><label for="p-f">Faixa de atenção (% acima do mínimo)</label><input id="p-f" name="faixa" inputmode="decimal" value="${numCampo(cf.faixa_atencao * 100)}">
        <span class="dica">Item entre o mínimo e o mínimo + esta faixa aparece como “Atenção”.</span></div>
      <div class="field"><label for="p-1">Alerta de vencimento próximo (dias)</label><input id="p-1" name="a1" inputmode="numeric" value="${cf.venc_alerta_1}"></div>
      <div class="field"><label for="p-2">Alerta de vencimento médio (dias)</label><input id="p-2" name="a2" inputmode="numeric" value="${cf.venc_alerta_2}"></div>`,
    aoEnviar: async (f) => {
      const faixa = lerNumero(f.faixa), a1 = Number(f.a1), a2 = Number(f.a2);
      if (!Number.isFinite(faixa) || faixa < 0) throw new Error('Faixa de atenção inválida.');
      if (!Number.isInteger(a1) || !Number.isInteger(a2) || a1 <= 0 || a2 <= 0) throw new Error('Os prazos de vencimento precisam ser números inteiros maiores que zero.');
      if (a1 >= a2) throw new Error('O primeiro prazo precisa ser menor que o segundo.');
      const { error } = await db.from('condominio_config').update({ faixa_atencao: faixa / 100, venc_alerta_1: a1, venc_alerta_2: a2 }).eq('condominio_id', c.id);
      if (error) throw new Error(error.message);
      aviso('Parâmetros salvos.', 'ok'); await cCarregar(); desenhar();
    },
  });
}
function formSindico(c) {
  janelaForm({
    titulo: `Definir síndico — ${c.nome}`, rotulo: 'Definir',
    intro: 'Se a pessoa já tem conta confirmada, vira síndico na hora. Se não, o convite espera ela criar a conta com este e-mail.',
    corpo: h`<div class="field"><label for="s-email">E-mail</label><input id="s-email" name="email" type="email" required></div>`,
    aoEnviar: async (f) => {
      if (!emailValido(f.email.trim())) throw new Error('Informe um e-mail válido.');
      const r = await rpc('convidar_membro', { p_condominio_id: c.id, p_email: f.email.trim().toLowerCase(), p_papel: 'sindico' });
      aviso(r === 'vinculado' ? 'Síndico definido.' : 'Convite criado para o síndico.', 'ok'); await cCarregar(); desenhar();
    },
  });
}

/* ---------------- Pessoas ---------------- */
let pessoas = [];
async function pCarregar() {
  const [p, m, c] = await Promise.all([
    db.from('profiles').select('id,nome,superadmin').order('nome'),
    db.from('membros').select('condominio_id,user_id,papel,ativo'),
    db.from('condominios').select('id,nome'),
  ]);
  const falha = p.error || m.error || c.error; if (falha) throw new Error(falha.message);
  const nc = Object.fromEntries(c.data.map((x) => [x.id, x.nome]));
  pessoas = p.data.map((x) => ({ ...x, vinculos: m.data.filter((v) => v.user_id === x.id).map((v) => ({ cond: nc[v.condominio_id] ?? '?', papel: v.papel, ativo: v.ativo })) }));
}
const pTela = () => h`<p class="dica">Visão geral de todas as contas. Para convidar ou mudar papéis, use <a href="#/usuarios">Usuários</a> no condomínio escolhido.</p>
  <div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Participa de</th></tr></thead><tbody>
  ${pessoas.map((p) => h`<tr><td><b>${p.nome || '(sem nome)'}</b> ${p.superadmin ? h`<span class="tag">superadmin</span>` : ''}</td>
    <td>${p.vinculos.length ? p.vinculos.map((v) => h`<span class="tag ${v.ativo ? '' : 'inativo'}">${v.cond}: ${PAPEL_ROTULO[v.papel]}${v.ativo ? '' : ' (desativado)'}</span> `) : h`<span class="dica">sem vínculo</span>`}</td></tr>`)}</tbody></table></div>`;

/* ---------------- Catálogos ---------------- */
let cats = [], unis = [];
async function kCarregar() {
  const [c, u] = await Promise.all([db.from('categorias').select('*').order('nome'), db.from('unidades_medida').select('*').order('sigla')]);
  if (c.error || u.error) throw new Error((c.error || u.error).message);
  cats = c.data; unis = u.data;
}
const kTela = () => h`<div class="grade2">
  <div><div class="toolbar"><b>Categorias</b><button class="btn pequeno" data-acao="nova-cat">Nova</button></div>
    <table><tbody>${cats.map((c) => h`<tr class="${c.ativo ? '' : 'inativo'}"><td>${c.nome}${c.ativo ? '' : h` <span class="tag">inativa</span>`}</td><td><button class="icon-btn" data-acao="edita-cat" data-id="${c.id}">Editar</button></td></tr>`)}</tbody></table></div>
  <div><div class="toolbar"><b>Unidades de medida</b><button class="btn pequeno" data-acao="nova-uni">Nova</button></div>
    <table><tbody>${unis.map((u) => h`<tr class="${u.ativo ? '' : 'inativo'}"><td><span class="num">${u.sigla}</span> — ${u.nome}${u.ativo ? '' : h` <span class="tag">inativa</span>`}</td><td><button class="icon-btn" data-acao="edita-uni" data-id="${u.id}">Editar</button></td></tr>`)}</tbody></table></div></div>`;
function formCatalogo(tipo, x) {
  const cat = tipo === 'cat';
  janelaForm({
    titulo: `${x ? 'Editar' : 'Nova'} ${cat ? 'categoria' : 'unidade'}`, rotulo: 'Salvar',
    corpo: h`${cat ? h`<div class="field"><label for="k-n">Nome</label><input id="k-n" name="nome" value="${x?.nome ?? ''}" required></div>`
      : h`<div class="field"><label for="k-s">Sigla</label><input id="k-s" name="sigla" value="${x?.sigla ?? ''}" required maxlength="8"></div>
          <div class="field"><label for="k-n">Nome</label><input id="k-n" name="nome" value="${x?.nome ?? ''}" required></div>`}
      ${x ? h`<div class="field"><label><input type="checkbox" name="ativo" value="1" ${x.ativo ? raw('checked') : ''}> Ativa</label><span class="dica">Itens que já usam continuam funcionando.</span></div>` : ''}`,
    aoEnviar: async (f) => {
      if (!f.nome.trim() || (!cat && !f.sigla.trim())) throw new Error('Preencha os campos.');
      const dados = cat ? { nome: f.nome.trim() } : { sigla: f.sigla.trim(), nome: f.nome.trim() };
      if (x) dados.ativo = f.ativo === '1';
      const tabela = cat ? 'categorias' : 'unidades_medida';
      const { error } = x ? await db.from(tabela).update(dados).eq('id', x.id) : await db.from(tabela).insert(dados);
      if (error) throw new Error(error.code === '23505' ? 'Já existe com esse nome/sigla.' : error.message);
      aviso('Salvo.', 'ok'); await kCarregar(); desenhar();
    },
  });
}

/* ---------------- Auditoria ---------------- */
let audit = [], auditNomes = {};
async function aCarregar() {
  let q = db.from('auditoria').select('id,tabela,registro_id,acao,antes,depois,usuario_id,em').eq('condominio_id', cid()).order('em', { ascending: false }).limit(100);
  if (filtroTabela) q = q.eq('tabela', filtroTabela);
  const { data, error } = await q; if (error) throw new Error(error.message);
  audit = data;
  const ids = [...new Set(data.map((x) => x.usuario_id).filter(Boolean))];
  const { data: pf } = ids.length ? await db.from('profiles').select('id,nome').in('id', ids) : { data: [] };
  auditNomes = Object.fromEntries((pf || []).map((p) => [p.id, p.nome]));
}
const aTela = () => h`<div class="filtros"><select id="f-tab" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>
    ${Object.entries(NOME_TABELA).map(([k, v]) => h`<option value="${k}" ${filtroTabela === k ? raw('selected') : ''}>${v}</option>`)}</select>
    <span class="dica">Condomínio: ${condominioAtual()?.nome ?? ''} · últimos 100 registros</span></div>
  ${audit.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>
    ${audit.map((r) => h`<tr><td>${dataHoraBR(r.em)}</td><td>${auditNomes[r.usuario_id] || '—'}</td><td>${NOME_ACAO[r.acao] ?? r.acao} · ${NOME_TABELA[r.tabela] ?? r.tabela}</td><td>${resumo(r)}</td></tr>`)}</tbody></table></div>`
    : h`<div class="empty">Nenhum registro.</div>`}`;

/* ---------------- Diagnóstico ---------------- */
let diag = null;
const dTela = () => h`<p class="dica">Confere se o saldo de cada lote é igual à soma das suas movimentações. Não altera nada.</p>
  <button class="btn" data-acao="diagnosticar">Verificar ${condominioAtual()?.nome ?? ''}</button>
  ${diag === null ? '' : diag.length === 0 ? h`<div class="auth-ok" style="margin-top:12px">Nenhuma divergência encontrada.</div>`
    : h`<div class="auth-error" style="margin-top:12px">${diag.length} divergência(s) encontrada(s):</div>
        <table><thead><tr><th>Problema</th><th>Esperado</th><th>Encontrado</th></tr></thead><tbody>${diag.map((d) => h`<tr><td>${d.problema}</td><td class="num">${d.esperado ?? ''}</td><td class="num">${d.encontrado ?? ''}</td></tr>`)}</tbody></table>`}`;

/* ---------------- Casca ---------------- */
function desenhar() {
  const conteudo = { condominios: cTela, pessoas: pTela, catalogos: kTela, auditoria: aTela, diagnostico: dTela }[aba]();
  render(raizPagina, h`<div class="page-head"><div><h2>Administração</h2><p>Configurações do sistema inteiro. Visível só para o superadmin.</p></div></div>
    <div class="tabs-mini" role="tablist">${ABAS.map(([k, r]) => h`<button role="tab" data-aba="${k}" class="${k === aba ? 'active' : ''}">${r}</button>`)}</div>
    <div class="panel">${conteudo}</div>`);
  raizPagina.querySelector('#f-tab')?.addEventListener('change', async (e) => {
    filtroTabela = e.target.value;
    try { await aCarregar(); desenhar(); } catch (err) { aviso(mensagemErro(err), 'erro'); }
  });
}
async function abrirAba(k) {
  aba = k;
  await ({ condominios: cCarregar, pessoas: pCarregar, catalogos: kCarregar, auditoria: aCarregar, diagnostico: async () => { diag = null; } }[k])();
  desenhar();
}

export async function abrir(el) {
  raizPagina = el;
  await abrirAba(aba);
  on(el, 'click', '[data-aba]', async (_, b) => { try { await abrirAba(b.dataset.aba); } catch (e) { aviso(mensagemErro(e), 'erro'); } });
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao, id = b.dataset.id, c = conds.find((x) => x.id === id);
      if (a === 'novo-cond') formCond(null);
      else if (a === 'editar-cond') formCond(c);
      else if (a === 'param') formParam(c);
      else if (a === 'sindico') formSindico(c);
      else if (a === 'entrar') { escolherCondominio(id); location.hash = '#/painel'; mudouContexto(); }
      else if (a === 'nova-cat') formCatalogo('cat', null);
      else if (a === 'edita-cat') formCatalogo('cat', cats.find((x) => x.id === id));
      else if (a === 'nova-uni') formCatalogo('uni', null);
      else if (a === 'edita-uni') formCatalogo('uni', unis.find((x) => x.id === id));
      else if (a === 'diagnosticar') { diag = await rpc('verificar_consistencia', { p_condominio_id: cid() }); desenhar(); }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
