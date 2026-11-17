import { h, raw, render, on } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { moeda, dataBR } from '../../lib/format.js';
import { aviso, mensagemErro } from '../../lib/ui.js';
import { desenharGrafico, CORES } from '../../lib/grafico.js';
import { EFETIVADAS, gastosPorMes, gastosPorFornecedor, gastosPorCategoria, csvCompras, rotuloMes } from './calculos.js';

const anoAtual = new Date().getFullYear();
let ano = anoAtual, forn = '', compras = [], porCat = [], raizPagina = null;

async function carregar() {
  const cid = estado.condominioId;
  const c = await db.from('v_compras').select('*').eq('condominio_id', cid).in('status', EFETIVADAS)
    .gte('data_compra', `${ano}-01-01`).lte('data_compra', `${ano}-12-31`).order('data_compra', { ascending: false });
  if (c.error) throw new Error(c.error.message);
  compras = c.data;
  const ids = compras.map((x) => x.compra_id); let linhas = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await db.from('compra_itens').select('compra_id,item_id,custo_total').in('compra_id', ids.slice(i, i + 100));
    if (r.error) throw new Error(r.error.message);
    linhas = linhas.concat(r.data);
  }
  const it = await db.from('v_estoque_item').select('item_id,categoria').eq('condominio_id', cid);
  if (it.error) throw new Error(it.error.message);
  const catDe = Object.fromEntries(it.data.map((x) => [x.item_id, x.categoria]));
  porCat = gastosPorCategoria(linhas, catDe, ids);
}
const filtradas = () => (forn ? compras.filter((c) => (c.fornecedor || 'Sem fornecedor') === forn) : compras);

async function desenhar() {
  const lista = filtradas(), total = lista.reduce((s, c) => s + Number(c.valor_total), 0);
  const fornecedores = gastosPorFornecedor(compras, ano);
  render(raizPagina, h`
    <div class="page-head"><div><h2>Relatórios de gastos</h2><p>Só entram compras já efetivadas (pedido feito, parcial ou recebida).</p></div>
      <button class="btn ghost" data-acao="csv" ${lista.length ? '' : raw('disabled')}>Baixar planilha (CSV)</button></div>
    <div class="panel"><div class="filtros">
      <select id="f-ano" aria-label="Ano">${[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => h`<option value="${a}" ${a === ano ? raw('selected') : ''}>${a}</option>`)}</select>
      <select id="f-forn" aria-label="Fornecedor"><option value="">Todos os fornecedores</option>${fornecedores.map((f) => h`<option value="${f.nome}" ${f.nome === forn ? raw('selected') : ''}>${f.nome}</option>`)}</select></div>
      ${compras.length ? h`
        <h3>Total em ${ano}${forn ? ' — ' + forn : ''}: <span class="num">${moeda(total)}</span></h3>
        <div style="height:220px"><canvas id="g-mes" role="img" aria-label="Gastos por mês"></canvas></div>
        <div class="grade2" style="margin-top:22px">
          <div><h3>Por fornecedor</h3><div style="height:${Math.max(120, Math.min(fornecedores.length, 8) * 34)}px"><canvas id="g-forn" role="img" aria-label="Gastos por fornecedor"></canvas></div></div>
          <div><h3>Por categoria</h3><div style="height:${Math.max(120, Math.min(porCat.length, 8) * 34)}px"><canvas id="g-cat" role="img" aria-label="Gastos por categoria"></canvas></div>
            <p class="dica">A categoria vem dos itens de cada compra (sempre do ano inteiro, sem o filtro de fornecedor).</p></div></div>
        <h3 style="margin-top:22px">Compras</h3>
        <div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Nota fiscal</th><th>Situação</th><th>Valor</th></tr></thead><tbody>
          ${lista.map((c) => h`<tr><td>${dataBR(c.data_compra)}</td><td>${c.fornecedor || '—'}</td><td>${c.numero_nf || '—'}</td><td>${c.status.replaceAll('_', ' ')}</td><td class="num">${moeda(c.valor_total)}</td></tr>`)}
          <tr><td colspan="4"><b>Total</b></td><td class="num"><b>${moeda(total)}</b></td></tr></tbody></table></div>`
        : h`<div class="empty">Nenhuma compra efetivada em ${ano}.</div>`}</div>`);
  raizPagina.querySelector('#f-ano').addEventListener('change', async (e) => { ano = Number(e.target.value); forn = ''; try { await carregar(); await desenhar(); } catch (err) { aviso(mensagemErro(err), 'erro'); } });
  raizPagina.querySelector('#f-forn').addEventListener('change', async (e) => { forn = e.target.value; await desenhar(); });
  if (!compras.length) return;
  const meses = gastosPorMes(lista, ano);
  await desenharGrafico(raizPagina.querySelector('#g-mes'), { type: 'bar', data: { labels: meses.map((_, i) => rotuloMes(`${ano}-${String(i + 1).padStart(2, '0')}`)), datasets: [{ data: meses, backgroundColor: CORES[0] }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  const f8 = fornecedores.slice(0, 8);
  await desenharGrafico(raizPagina.querySelector('#g-forn'), { type: 'bar', data: { labels: f8.map((f) => f.nome), datasets: [{ data: f8.map((f) => f.valor), backgroundColor: CORES[1] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
  const c8 = porCat.slice(0, 8);
  await desenharGrafico(raizPagina.querySelector('#g-cat'), { type: 'bar', data: { labels: c8.map((f) => f.nome), datasets: [{ data: c8.map((f) => f.valor), backgroundColor: CORES[2] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
}

export async function abrir(el) {
  raizPagina = el; await carregar(); await desenhar();
  on(el, 'click', '[data-acao=csv]', () => {
    const blob = new Blob([csvCompras(filtradas())], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gastos-${ano}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}
