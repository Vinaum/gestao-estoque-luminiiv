import { h, render } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, moeda, dataBR, dataHoraBR, lerNumero } from '../../lib/format.js';
import { aviso, abrirJanela, confirmar, janelaForm, mensagemErro } from '../../lib/ui.js';
import { pillCompra, podeAprovar } from './comum.js';
import { abrirEditor } from './editor.js';
import { abrirRetroativa } from './retroativa.js';

const TIPOS_NF = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_NF = 5 * 1024 * 1024;

async function carregarCompleta(id) {
  const [c, ci, rec] = await Promise.all([
    db.from('v_compras').select('*').eq('compra_id', id).maybeSingle(),
    db.from('compra_itens').select('id,item_id,qtd_solicitada,qtd_recebida,custo_unitario,custo_total,vencimento_previsto').eq('compra_id', id),
    db.from('recebimentos').select('id,data,responsavel_id,observacao,criado_em').eq('compra_id', id).order('criado_em'),
  ]);
  const falha = c.error || ci.error || rec.error;
  if (falha) throw new Error(falha.message);
  if (!c.data) throw new Error('Compra não encontrada.');
  const itemIds = ci.data.map((x) => x.item_id), recIds = rec.data.map((x) => x.id);
  const quem = [...new Set([c.data.responsavel_id, c.data.aprovada_por, ...rec.data.map((r) => r.responsavel_id)].filter(Boolean))];
  const [its, ri, pf] = await Promise.all([
    itemIds.length ? db.from('v_estoque_item').select('item_id,nome,unidade').in('item_id', itemIds) : { data: [] },
    recIds.length ? db.from('recebimento_itens').select('recebimento_id,compra_item_id,quantidade,vencimento').in('recebimento_id', recIds) : { data: [] },
    quem.length ? db.from('profiles').select('id,nome').in('id', quem) : { data: [] },
  ]);
  return {
    compra: c.data, linhas: ci.data, recebimentos: rec.data, recItens: ri.data || [],
    itens: Object.fromEntries((its.data || []).map((x) => [x.item_id, x])),
    nomes: Object.fromEntries((pf.data || []).map((x) => [x.id, x.nome])),
  };
}

// Abre os detalhes de uma compra com as ações possíveis para o status atual.
export async function abrirDetalhes(id, aoMudar) {
  const d = await carregarCompleta(id);
  const { compra, linhas, recebimentos, recItens, itens, nomes } = d;
  if (compra.retroativa) return detalhesRetroativa(compra, nomes, aoMudar);
  const st = compra.status;
  const pendente = linhas.some((l) => Number(l.qtd_solicitada) > Number(l.qtd_recebida));
  const editavel = ['planejada', 'aguardando_aprovacao'].includes(st);
  const acoes = [];
  if (editavel) acoes.push(['editar', 'Editar', 'ghost']);
  if (st === 'planejada') acoes.push(['enviar', 'Enviar para aprovação', 'ghost']);
  if (st === 'aguardando_aprovacao') acoes.push(['devolver', 'Devolver para rascunho', 'ghost']);
  if (editavel && podeAprovar()) acoes.push(['aprovar', 'Aprovar', '']);
  if (st === 'aprovada') acoes.push(['pedido', 'Marcar pedido realizado', '']);
  if (['aprovada', 'pedido_realizado', 'parcialmente_recebido'].includes(st) && pendente) acoes.push(['receber', 'Registrar recebimento', st === 'aprovada' ? 'ghost' : '']);
  if (['planejada', 'aguardando_aprovacao', 'aprovada', 'pedido_realizado'].includes(st)) acoes.push(['cancelar', 'Cancelar compra', 'danger']);
  const podeNF = st !== 'cancelado';

  const fundo = abrirJanela(h`
    <h3>Compra de ${dataBR(compra.data_compra)} ${pillCompra(st)}</h3>
    <p>${compra.fornecedor || 'Fornecedor não definido'} · Solicitada por ${nomes[compra.responsavel_id] || '—'}
      ${compra.aprovada_por ? h` · Aprovada por ${nomes[compra.aprovada_por] || '—'} em ${dataHoraBR(compra.aprovada_em)}` : ''}</p>
    <div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Pedido</th><th>Recebido</th><th>Custo unit.</th><th>Total</th></tr></thead><tbody>
      ${linhas.map((l) => h`<tr><td>${itens[l.item_id]?.nome ?? '—'}</td>
        <td class="num">${num(l.qtd_solicitada)} ${itens[l.item_id]?.unidade ?? ''}</td><td class="num">${num(l.qtd_recebida)}</td>
        <td class="num">${moeda(l.custo_unitario)}</td><td class="num">${moeda(l.custo_total)}</td></tr>`)}
      <tr><td colspan="4"><b>Total</b></td><td class="num"><b>${moeda(compra.valor_total)}</b></td></tr></tbody></table></div>
    ${compra.observacoes ? h`<p class="dica">${compra.observacoes}</p>` : ''}
    <div class="panel" style="margin:12px 0"><b>Nota fiscal:</b> ${compra.numero_nf || 'não informada'}
      ${compra.nf_arquivo_path ? h` · <button class="icon-btn" data-nf-ver>Abrir anexo</button>` : ''}
      ${podeNF ? h` · <button class="icon-btn" data-nf-editar>${compra.nf_arquivo_path ? 'Trocar' : 'Informar / anexar'}</button>` : ''}</div>
    ${recebimentos.length ? h`<b>Recebimentos</b><div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Itens</th><th>Quem</th><th>Obs.</th></tr></thead><tbody>
      ${recebimentos.map((r) => h`<tr><td>${dataBR(r.data)}</td>
        <td>${recItens.filter((x) => x.recebimento_id === r.id).map((x) => { const l = linhas.find((y) => y.id === x.compra_item_id); return h`${itens[l?.item_id]?.nome ?? '—'}: ${num(x.quantidade)}${x.vencimento ? ' (val. ' + dataBR(x.vencimento) + ')' : ''}<br>`; })}</td>
        <td>${nomes[r.responsavel_id] || '—'}</td><td>${r.observacao || ''}</td></tr>`)}</tbody></table></div>` : ''}
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes"><button class="btn ghost" data-fechar>Fechar</button>
      ${acoes.map(([k, r, c]) => h`<button class="btn ${c}" data-a="${k}">${r}</button>`)}</div>`, { largo: true });

  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  const erro = (e) => { const c = fundo.querySelector('[data-erro]'); c.textContent = mensagemErro(e); c.classList.remove('hidden'); };
  const concluir = async (msg) => { fundo.remove(); aviso(msg, 'ok'); await aoMudar?.(); };

  fundo.querySelector('[data-nf-ver]')?.addEventListener('click', async () => {
    const { data, error } = await db.storage.from('notas-fiscais').createSignedUrl(compra.nf_arquivo_path, 60);
    if (error) return erro(error);
    window.open(data.signedUrl, '_blank', 'noopener');
  });
  fundo.querySelector('[data-nf-editar]')?.addEventListener('click', () => { fundo.remove(); editarNF(compra, aoMudar); });

  fundo.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === 'editar') { fundo.remove(); await abrirEditor({ compraId: id, aoSalvar: aoMudar }); }
      else if (a === 'enviar') { await rpc('mudar_status_compra', { p_compra_id: id, p_status: 'aguardando_aprovacao' }); await concluir('Compra enviada para aprovação.'); }
      else if (a === 'devolver') { await rpc('mudar_status_compra', { p_compra_id: id, p_status: 'planejada' }); await concluir('Compra devolvida para rascunho.'); }
      else if (a === 'aprovar') {
        if (!(await confirmar('Aprovar compra?', `Valor total: ${moeda(compra.valor_total)}. Depois de aprovada, a compra não pode mais ser editada.`, { rotulo: 'Aprovar' }))) return;
        await rpc('aprovar_compra', { p_compra_id: id }); await concluir('Compra aprovada.');
      } else if (a === 'pedido') { await rpc('mudar_status_compra', { p_compra_id: id, p_status: 'pedido_realizado' }); await concluir('Pedido marcado como realizado.'); }
      else if (a === 'cancelar') {
        if (!(await confirmar('Cancelar compra?', 'A compra será encerrada. Isto não pode ser desfeito.', { rotulo: 'Cancelar compra', perigo: true }))) return;
        await rpc('mudar_status_compra', { p_compra_id: id, p_status: 'cancelado' }); await concluir('Compra cancelada.');
      } else if (a === 'receber') { fundo.remove(); abrirRecebimento(d, aoMudar); }
    } catch (e) { erro(e); }
  });
}

function abrirRecebimento(d, aoMudar) {
  const { compra, linhas, itens } = d;
  const chave = crypto.randomUUID();
  const pend = linhas.map((l) => ({ ...l, falta: Number(l.qtd_solicitada) - Number(l.qtd_recebida) })).filter((l) => l.falta > 0);
  janelaForm({
    titulo: 'Registrar recebimento', rotulo: 'Registrar recebimento', largo: true,
    intro: 'Informe o que chegou agora. Pode ser só uma parte; o restante continua pendente. Cada recebimento cria um lote no estoque.',
    corpo: h`
      <div class="field"><label for="r-data">Data do recebimento</label><input id="r-data" name="data" type="date" value="${new Date().toLocaleDateString('sv-SE')}"></div>
      <div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Falta receber</th><th>Chegou agora</th><th>Validade</th></tr></thead><tbody>
        ${pend.map((l) => h`<tr><td>${itens[l.item_id]?.nome ?? '—'}</td><td class="num">${num(l.falta)} ${itens[l.item_id]?.unidade ?? ''}</td>
          <td><input class="inp-num" name="q_${l.id}" inputmode="decimal" value="${String(l.falta).replace('.', ',')}" aria-label="Quantidade recebida de ${itens[l.item_id]?.nome ?? ''}"></td>
          <td><input name="v_${l.id}" type="date" value="${l.vencimento_previsto || ''}" aria-label="Validade"></td></tr>`)}</tbody></table></div>
      <div class="field" style="margin-top:12px"><label for="r-obs">Observação (opcional)</label><textarea id="r-obs" name="obs" rows="2"></textarea></div>`,
    aoEnviar: async (f) => {
      const env = [];
      for (const l of pend) {
        const txt = (f['q_' + l.id] || '').trim();
        if (txt === '' || lerNumero(txt) === 0) continue;
        const q = lerNumero(txt);
        if (!Number.isFinite(q) || q < 0) throw new Error('Quantidade inválida.');
        if (q > l.falta + 1e-9) throw new Error(`${itens[l.item_id]?.nome}: não pode receber mais do que falta (${num(l.falta)}).`);
        env.push({ compra_item_id: l.id, quantidade: q, vencimento: f['v_' + l.id] || null });
      }
      if (!env.length) throw new Error('Informe a quantidade recebida de pelo menos um item.');
      await rpc('registrar_recebimento', { p_compra_id: compra.compra_id, p_itens: env, p_data: f.data || null, p_observacao: f.obs.trim() || null, p_chave: chave });
      aviso('Recebimento registrado. O estoque foi atualizado.', 'ok');
      await aoMudar?.();
    },
  });
}

function editarNF(compra, aoMudar) {
  janelaForm({
    titulo: 'Nota fiscal', rotulo: 'Salvar',
    intro: 'Informe o número e, se quiser, anexe o arquivo (PDF, JPG ou PNG, até 5 MB).',
    corpo: h`
      <div class="field"><label for="n-num">Número da nota</label><input id="n-num" name="numero" value="${compra.numero_nf || ''}"></div>
      <div class="field"><label for="n-arq">Arquivo ${compra.nf_arquivo_path ? '(deixe vazio para manter o atual)' : ''}</label><input id="n-arq" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png"></div>`,
    aoEnviar: async (f) => {
      let caminho = null;
      const arq = f.arquivo;
      if (arq && arq.size > 0) {
        const ext = TIPOS_NF[arq.type];
        if (!ext) throw new Error('Formato não aceito. Use PDF, JPG ou PNG.');
        if (arq.size > MAX_NF) throw new Error('Arquivo maior que 5 MB.');
        caminho = `${estado.condominioId}/${compra.compra_id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await db.storage.from('notas-fiscais').upload(caminho, arq, { contentType: arq.type, upsert: false });
        if (error) throw new Error('Não foi possível enviar o arquivo: ' + error.message);
      }
      await rpc('atualizar_nf_compra', { p_compra_id: compra.compra_id, p_numero_nf: f.numero.trim() || null, p_arquivo_path: caminho });
      aviso('Nota fiscal salva.', 'ok'); await aoMudar?.();
    },
  });
}

// Nota antiga: sem itens nem recebimento. Síndico corrige ou exclui.
function detalhesRetroativa(compra, nomes, aoMudar) {
  const sindico = podeAprovar();
  const fundo = abrirJanela(h`
    <h3>Nota antiga de ${dataBR(compra.data_compra)} <span class="tag" data-retro>Nota antiga</span></h3>
    <p>${compra.fornecedor || 'Fornecedor não informado'} · Lançada por ${nomes[compra.responsavel_id] || '—'}${compra.aprovada_em ? ` em ${dataHoraBR(compra.aprovada_em)}` : ''}</p>
    <div class="cards"><div class="card"><div class="k">Valor</div><div class="v">${moeda(compra.valor_total)}</div></div>
      <div class="card"><div class="k">Categoria</div><div class="v" style="font-size:16px">${compra.categoria || 'Sem categoria'}</div></div></div>
    ${compra.observacoes ? h`<p class="dica">${compra.observacoes}</p>` : ''}
    <p class="dica">Lançamento retroativo: entra nos gastos, mas não alterou o estoque.</p>
    <div class="panel" style="margin:12px 0"><b>Nota fiscal:</b> ${compra.numero_nf || 'não informada'}
      ${compra.nf_arquivo_path ? h` · <button class="icon-btn" data-nf-ver>Abrir arquivo</button>` : ' · sem arquivo'}</div>
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes"><button class="btn ghost" data-fechar>Fechar</button>
      ${sindico ? h`<button class="btn danger" data-a="excluir">Excluir</button><button class="btn" data-a="corrigir">Corrigir</button>` : ''}</div>`, { largo: true });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  const erro = (e) => { const c = fundo.querySelector('[data-erro]'); c.textContent = mensagemErro(e); c.classList.remove('hidden'); };
  fundo.querySelector('[data-nf-ver]')?.addEventListener('click', async () => {
    const aba = window.open('', '_blank');   // aberta no clique, para o navegador não bloquear
    const { data, error } = await db.storage.from('notas-fiscais').createSignedUrl(compra.nf_arquivo_path, 120);
    if (error) { aba?.close(); return erro(error); }
    if (aba) { aba.opener = null; aba.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
  });
  fundo.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    try {
      if (b.dataset.a === 'corrigir') { fundo.remove(); await abrirRetroativa({ compra, aoSalvar: aoMudar }); }
      else if (b.dataset.a === 'excluir') {
        if (!(await confirmar('Excluir nota antiga?', `O lançamento de ${moeda(compra.valor_total)} sai dos gastos. A exclusão fica registrada na auditoria.`, { rotulo: 'Excluir', perigo: true }))) return;
        const caminho = await rpc('excluir_compra_retroativa', { p_id: compra.compra_id });
        if (caminho) { try { await db.storage.from('notas-fiscais').remove([caminho]); } catch { /* sem prejuízo */ } }
        fundo.remove(); aviso('Nota antiga excluída.', 'ok'); await aoMudar?.();
      }
    } catch (e) { erro(e); }
  });
}
