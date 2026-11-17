import { h, render, on } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { moeda, dataBR, dataHoraBR } from '../../lib/format.js';
import { aviso, mensagemErro } from '../../lib/ui.js';
import { pillCompra } from './comum.js';
import { abrirDetalhes } from './detalhes.js';

let raizPagina = null;

async function carregar() {
  const { data, error } = await db.from('v_compras').select('*').eq('condominio_id', estado.condominioId)
    .in('status', ['aguardando_aprovacao', 'aprovada']).order('data_compra', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const ids = [...new Set(data.flatMap((c) => [c.responsavel_id, c.aprovada_por]).filter(Boolean))];
  const { data: pf } = ids.length ? await db.from('profiles').select('id,nome').in('id', ids) : { data: [] };
  return { compras: data, nomes: Object.fromEntries((pf || []).map((p) => [p.id, p.nome])) };
}

async function desenhar() {
  const { compras, nomes } = await carregar();
  const aguardando = compras.filter((c) => c.status === 'aguardando_aprovacao');
  const aprovadas = compras.filter((c) => c.status === 'aprovada');
  const linha = (c, rotulo) => h`<tr><td>${dataBR(c.data_compra)}</td><td>${c.fornecedor || '—'}</td><td>${nomes[c.responsavel_id] || '—'}</td>
    <td class="num">${c.qtd_itens}</td><td class="num"><b>${moeda(c.valor_total)}</b></td>
    <td>${c.status === 'aprovada' ? h`${nomes[c.aprovada_por] || '—'}<br><span class="dica">${dataHoraBR(c.aprovada_em)}</span>` : pillCompra(c.status)}</td>
    <td><button class="btn pequeno ${c.status === 'aprovada' ? 'ghost' : ''}" data-acao="abrir" data-id="${c.compra_id}">${rotulo}</button></td></tr>`;
  const cab = (ult) => h`<thead><tr><th>Data</th><th>Fornecedor</th><th>Solicitante</th><th>Itens</th><th>Valor</th><th>${ult}</th><th></th></tr></thead>`;
  render(raizPagina, h`
    <div class="page-head"><div><h2>Aprovações</h2><p>Compras que aguardam a decisão do síndico.</p></div></div>
    <div class="panel"><h3>Aguardando aprovação (${aguardando.length})</h3>
      ${aguardando.length ? h`<div class="tabela-rolagem"><table>${cab('Situação')}<tbody>${aguardando.map((c) => linha(c, 'Analisar'))}</tbody></table></div>`
        : h`<div class="empty">Nenhuma compra aguardando aprovação.</div>`}</div>
    <div class="panel"><h3>Aprovadas e ainda sem pedido ou recebimento</h3>
      ${aprovadas.length ? h`<div class="tabela-rolagem"><table>${cab('Aprovada por')}<tbody>${aprovadas.map((c) => linha(c, 'Abrir'))}</tbody></table></div>`
        : h`<div class="empty">Nenhuma.</div>`}</div>`);
}

export async function abrir(el) {
  raizPagina = el;
  await desenhar();
  on(el, 'click', '[data-acao=abrir]', async (_, b) => {
    try { await abrirDetalhes(b.dataset.id, desenhar); } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
