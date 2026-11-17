import { h, raw, render } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num } from '../../lib/format.js';
import { aviso, mensagemErro } from '../../lib/ui.js';
import { desenharGrafico, CORES } from '../../lib/grafico.js';
import { ultimosMeses, rotuloMes, consumoPorItem } from './calculos.js';

let periodo = 6, tipoSel = 'consumo', itemSel = '', itens = {}, cobertura = {}, saidas = [], raizPagina = null;
const TIPOS = { consumo: ['consumo'], saidas: ['consumo', 'perda', 'descarte', 'doacao'], perda: ['perda', 'descarte'] };
const ROT_TIPO = { consumo: 'Somente consumo', saidas: 'Todas as saídas (consumo, perda, descarte, doação)', perda: 'Perdas e descartes' };

async function carregar() {
  const cid = estado.condominioId, meses = ultimosMeses(periodo);
  const [s, i, c] = await Promise.all([
    db.from('v_saidas_mensal').select('*').eq('condominio_id', cid).gte('mes', meses[0] + '-01'),
    db.from('v_estoque_item').select('item_id,nome,unidade,estoque_atual').eq('condominio_id', cid),
    db.from('v_cobertura').select('item_id,cobertura_dias,situacao').eq('condominio_id', cid),
  ]);
  const falha = s.error || i.error || c.error; if (falha) throw new Error(falha.message);
  saidas = s.data; itens = Object.fromEntries(i.data.map((x) => [x.item_id, x])); cobertura = Object.fromEntries(c.data.map((x) => [x.item_id, x]));
}
const textoCobertura = (id) => { const c = cobertura[id]; if (!c) return '—'; return c.situacao === 'sem_estoque' ? 'Sem estoque' : c.situacao === 'sem_historico' ? 'Sem histórico de consumo' : `cerca de ${num(c.cobertura_dias, 0)} dias`; };

async function desenhar() {
  const meses = ultimosMeses(periodo), lista = consumoPorItem(saidas, meses, TIPOS[tipoSel]);
  if (!lista.find((x) => x.item_id === itemSel)) itemSel = lista[0]?.item_id ?? '';
  const sel = lista.find((x) => x.item_id === itemSel);
  render(raizPagina, h`
    <div class="page-head"><div><h2>Consumo</h2><p>Quanto sai do estoque, mês a mês, e quanto tempo o estoque atual dura.</p></div></div>
    <div class="panel"><div class="filtros">
      <select id="f-per" aria-label="Período">${[3, 6, 12].map((n) => h`<option value="${n}" ${n === periodo ? raw('selected') : ''}>Últimos ${n} meses</option>`)}</select>
      <select id="f-tipo" aria-label="Tipo de saída">${Object.entries(ROT_TIPO).map(([k, r]) => h`<option value="${k}" ${k === tipoSel ? raw('selected') : ''}>${r}</option>`)}</select>
      ${lista.length ? h`<select id="f-item" aria-label="Item do gráfico">${lista.map((x) => h`<option value="${x.item_id}" ${x.item_id === itemSel ? raw('selected') : ''}>${itens[x.item_id]?.nome ?? '(item inativo)'}</option>`)}</select>` : ''}</div>
      ${lista.length ? h`
        <h3>${itens[itemSel]?.nome ?? ''} — por mês (${itens[itemSel]?.unidade ?? ''})</h3>
        <div style="height:240px"><canvas id="g-item" role="img" aria-label="Consumo mensal de ${itens[itemSel]?.nome ?? ''}"></canvas></div>
        <h3 style="margin-top:22px">Itens mais consumidos no período</h3>
        <div style="height:${Math.max(120, Math.min(lista.length, 8) * 34)}px"><canvas id="g-top" role="img" aria-label="Itens mais consumidos"></canvas></div>
        <p class="dica">Cada barra está na unidade do próprio item.</p>
        <h3 style="margin-top:22px">Resumo por item</h3>
        <div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Total</th><th>Média por mês</th><th>Estoque atual</th><th>Dura (pelos últimos 90 dias)</th></tr></thead><tbody>
          ${lista.map((x) => h`<tr><td>${itens[x.item_id]?.nome ?? '(item inativo)'}</td><td class="num">${num(x.total)} ${itens[x.item_id]?.unidade ?? ''}</td>
            <td class="num">${num(x.media)}</td><td class="num">${num(itens[x.item_id]?.estoque_atual)}</td><td>${textoCobertura(x.item_id)}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty">Ainda não há saídas registradas neste período.</div>`}</div>`);
  raizPagina.querySelector('#f-per').addEventListener('change', async (e) => { periodo = Number(e.target.value); await recarregar(); });
  raizPagina.querySelector('#f-tipo').addEventListener('change', async (e) => { tipoSel = e.target.value; await desenhar(); });
  raizPagina.querySelector('#f-item')?.addEventListener('change', async (e) => { itemSel = e.target.value; await desenhar(); });
  if (!lista.length) return;
  const rot = meses.map(rotuloMes);
  await desenharGrafico(raizPagina.querySelector('#g-item'), { type: 'bar', data: { labels: rot, datasets: [{ label: itens[itemSel]?.unidade ?? '', data: sel.serie, backgroundColor: CORES[0] }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  const top = lista.slice(0, 8);
  await desenharGrafico(raizPagina.querySelector('#g-top'), { type: 'bar', data: { labels: top.map((x) => `${itens[x.item_id]?.nome ?? '?'} (${itens[x.item_id]?.unidade ?? ''})`), datasets: [{ data: top.map((x) => x.total), backgroundColor: CORES[1] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
}
async function recarregar() { try { await carregar(); await desenhar(); } catch (e) { aviso(mensagemErro(e), 'erro'); } }

export async function abrir(el) { raizPagina = el; await carregar(); await desenhar(); }
