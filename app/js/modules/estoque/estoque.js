import { h, render } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, moeda, dataBR } from '../../lib/format.js';

const STATUS = {
  sem_estoque_cadastrado: ['Sem estoque cadastrado', 'status-neutro'], esgotado: ['Esgotado', 'status-crit'],
  comprar: ['Comprar', 'status-crit'], atencao: ['Atenção', 'status-warn'], normal: ['Normal', 'status-ok'],
  permanente: ['Permanente', 'status-neutro'],
};
const VENC = {
  vencido: ['Vencido', 'status-crit'], curto_prazo: ['Vence em breve', 'status-warn'], medio_prazo: ['Vence em até 90 dias', 'status-warn'],
  ok: ['Dentro da validade', 'status-ok'], sem_vencimento: ['Sem validade', 'status-neutro'],
};
const pill = (mapa, k) => { const [r, c] = mapa[k] || [k, 'status-neutro']; return h`<span class="status-pill ${c}">${r}</span>`; };

export async function abrir(el) {
  const cid = estado.condominioId;
  const [it, lt] = await Promise.all([
    db.from('v_estoque_item').select('*').eq('condominio_id', cid).eq('ativo', true).order('nome'),
    db.from('v_lotes').select('*').eq('condominio_id', cid).gt('saldo', 0),
  ]);
  if (it.error || lt.error) throw new Error((it.error || lt.error).message);
  // vence primeiro no topo; sem validade por último
  const lotes = [...lt.data].sort((a, b) => (a.vencimento ?? '9999-12-31').localeCompare(b.vencimento ?? '9999-12-31') || a.item_nome.localeCompare(b.item_nome));
  const total = lotes.reduce((s, l) => s + Number(l.valor_em_estoque || 0), 0);

  render(el, h`
    <div class="page-head"><div><h2>Estoque atual</h2><p>Quanto há de cada item e quando vence.</p></div></div>
    <div class="panel"><h3>Por item</h3>
      ${it.data.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Estoque</th><th>Mínimo</th><th>Ideal</th><th>Situação</th><th>Sugerido repor</th><th>Já em pedido</th></tr></thead><tbody>
        ${it.data.map((i) => h`<tr class="${i.status === 'esgotado' || i.status === 'comprar' ? 'row-crit' : i.status === 'atencao' ? 'row-warn' : ''}">
          <td><b>${i.nome}</b><br><span class="tag">${i.categoria}</span></td>
          <td class="num">${num(i.estoque_atual)} ${i.unidade}</td><td class="num">${num(i.estoque_minimo)}</td><td class="num">${num(i.estoque_ideal)}</td>
          <td>${pill(STATUS, i.status)}</td><td class="num">${num(i.qtd_sugerida)}</td><td class="num">${num(i.qtd_em_pedido)}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty">Nenhum item ativo.</div>`}</div>
    <div class="panel"><h3>Lotes e validade</h3>
      ${lotes.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Lote</th><th>Saldo</th><th>Validade</th><th>Situação</th><th>Valor em estoque</th></tr></thead><tbody>
        ${lotes.map((l) => h`<tr class="${l.faixa_vencimento === 'vencido' ? 'row-crit' : l.faixa_vencimento === 'curto_prazo' ? 'row-warn' : ''}">
          <td>${l.item_nome}</td><td class="num">${l.codigo}</td><td class="num">${num(l.saldo)} ${l.unidade}</td>
          <td>${dataBR(l.vencimento)}</td><td>${pill(VENC, l.faixa_vencimento)}</td><td class="num">${moeda(l.valor_em_estoque)}</td></tr>`)}</tbody></table></div>
        <p class="dica" style="margin-top:10px">Valor total em estoque: <b class="num">${moeda(total)}</b></p>`
        : h`<div class="empty">Nenhum lote com saldo.</div>`}</div>`);
}
