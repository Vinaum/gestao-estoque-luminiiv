import { h, raw, render, on } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, moeda, dataBR } from '../../lib/format.js';
import { aviso, mensagemErro } from '../../lib/ui.js';
import { pillCompra, STATUS_COMPRA, EM_ABERTO } from './comum.js';
import { abrirEditor } from './editor.js';
import { abrirDetalhes } from './detalhes.js';

let aba = 'necessidade';
let incluirAtencao = false;
let filtroStatus = 'abertas';
let itens = [], compras = [], raizPagina = null;
const marcados = new Set();
const cid = () => estado.condominioId;

async function carregar() {
  const [i, c] = await Promise.all([
    db.from('v_estoque_item').select('*').eq('condominio_id', cid()).eq('ativo', true).order('nome'),
    db.from('v_compras').select('*').eq('condominio_id', cid()).order('data_compra', { ascending: false }).order('compra_id').limit(200),
  ]);
  if (i.error || c.error) throw new Error((i.error || c.error).message);
  itens = i.data; compras = c.data;
}

const aComprar = (i) => Math.max(Number(i.qtd_sugerida) - Number(i.qtd_em_pedido), 0);
const necessarios = () => itens.filter((i) => aComprar(i) > 0 && (['comprar', 'esgotado'].includes(i.status) || (incluirAtencao && i.status === 'atencao')));

function painelNecessidade() {
  const lista = necessarios();
  const coberto = itens.filter((i) => ['comprar', 'esgotado'].includes(i.status) && aComprar(i) === 0 && Number(i.qtd_em_pedido) > 0).length;
  return h`<div class="panel"><h3>Necessidade de compra</h3>
    <p class="dica">É uma <b>sugestão</b>: a quantidade que falta para chegar ao estoque ideal, descontando o que já está em pedido. Você ajusta antes de comprar.</p>
    <div class="filtros"><label><input type="checkbox" id="inc-atencao" ${incluirAtencao ? raw('checked') : ''}> Incluir itens em atenção</label></div>
    ${lista.length ? h`<div class="tabela-rolagem"><table><thead><tr><th></th><th>Item</th><th>Estoque</th><th>Mín.</th><th>Ideal</th><th>Já em pedido</th><th>Sugerido comprar</th></tr></thead><tbody>
      ${lista.map((i) => h`<tr class="${i.status === 'atencao' ? 'row-warn' : 'row-crit'}">
        <td><input type="checkbox" data-marca="${i.item_id}" ${marcados.has(i.item_id) ? raw('checked') : ''} aria-label="Selecionar ${i.nome}"></td>
        <td><b>${i.nome}</b><br><span class="tag">${i.categoria}</span></td>
        <td class="num">${num(i.estoque_atual)} ${i.unidade}</td><td class="num">${num(i.estoque_minimo)}</td><td class="num">${num(i.estoque_ideal)}</td>
        <td class="num">${num(i.qtd_em_pedido)}</td><td class="num"><b>${num(aComprar(i))} ${i.unidade}</b></td></tr>`)}</tbody></table></div>
      <div class="toolbar" style="margin-top:12px"><span class="dica">${marcados.size} selecionado(s)</span>
        <button class="btn" data-acao="criar-selecionados" ${marcados.size ? '' : raw('disabled')}>Criar compra com os selecionados</button></div>`
      : h`<div class="empty">Nenhum item precisa de compra agora.${coberto ? ` (${coberto} já coberto(s) por pedidos em andamento.)` : ''}</div>`}</div>`;
}

function painelCompras() {
  const lista = compras.filter((c) => filtroStatus === 'todas' ? true : filtroStatus === 'abertas' ? EM_ABERTO.includes(c.status) : c.status === filtroStatus);
  return h`<div class="panel"><h3>Compras</h3>
    <div class="filtros"><select id="f-status" aria-label="Situação">
      <option value="abertas" ${filtroStatus === 'abertas' ? raw('selected') : ''}>Em andamento</option>
      <option value="todas" ${filtroStatus === 'todas' ? raw('selected') : ''}>Todas</option>
      ${Object.entries(STATUS_COMPRA).map(([k, [r]]) => h`<option value="${k}" ${filtroStatus === k ? raw('selected') : ''}>${r}</option>`)}</select></div>
    ${lista.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Valor</th><th>NF</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((c) => h`<tr><td>${dataBR(c.data_compra)}</td><td>${c.fornecedor || '—'}</td><td class="num">${c.qtd_itens}</td>
        <td class="num">${moeda(c.valor_total)}</td><td>${c.numero_nf || '—'}${c.nf_arquivo_path ? ' 📎' : ''}</td><td>${pillCompra(c.status)}</td>
        <td><button class="btn pequeno ghost" data-acao="abrir" data-id="${c.compra_id}">Abrir</button></td></tr>`)}</tbody></table></div>`
      : h`<div class="empty">Nenhuma compra neste filtro.</div>`}</div>`;
}

function desenhar() {
  const n = necessarios().length;
  render(raizPagina, h`
    <div class="page-head"><div><h2>Central de compras</h2><p>Do aviso de falta ao recebimento do material.</p></div>
      <button class="btn" data-acao="nova">Nova compra</button></div>
    <div class="tabs-mini" role="tablist">
      <button role="tab" data-aba="necessidade" class="${aba === 'necessidade' ? 'active' : ''}">Necessidade de compra${n ? ` (${n})` : ''}</button>
      <button role="tab" data-aba="compras" class="${aba === 'compras' ? 'active' : ''}">Compras</button></div>
    <div id="conteudo">${aba === 'necessidade' ? painelNecessidade() : painelCompras()}</div>`);
}

async function recarregar() { await carregar(); desenhar(); }

export async function abrir(el) {
  raizPagina = el; marcados.clear();
  await carregar();
  if (!necessarios().length && compras.length) aba = 'compras';
  desenhar();
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-marca]')) { t.checked ? marcados.add(t.dataset.marca) : marcados.delete(t.dataset.marca); desenhar(); }
    else if (t.id === 'inc-atencao') { incluirAtencao = t.checked; desenhar(); }
    else if (t.id === 'f-status') { filtroStatus = t.value; desenhar(); }
  });
  on(el, 'click', '[data-aba]', (_, b) => { aba = b.dataset.aba; desenhar(); });
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao;
      if (a === 'nova') await abrirEditor({ aoSalvar: async () => { aba = 'compras'; await recarregar(); } });
      else if (a === 'criar-selecionados') {
        const pre = necessarios().filter((i) => marcados.has(i.item_id)).map((i) => ({ item_id: i.item_id, qtd: aComprar(i) }));
        await abrirEditor({ preItens: pre, aoSalvar: async () => { marcados.clear(); aba = 'compras'; await recarregar(); } });
      } else if (a === 'abrir') await abrirDetalhes(b.dataset.id, recarregar);
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
