import { h, render } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, moeda, dataBR, dataHoraBR } from '../../lib/format.js';
import { EFETIVADAS, MESES, periodoAtual, contarStatus, aComprar, alertasReposicao, emAtencao, vencimentos, gastos, comprasDoMes, topConsumo } from './calculos.js';

const FAIXA = { vencido: ['Vencido', 'status-crit'], curto_prazo: ['Até 30 dias', 'status-warn'], medio_prazo: ['Até 90 dias', 'status-neutro'] };

export async function abrir(el) {
  const cid = estado.condominioId;
  const p = periodoAtual();
  const q = (t) => db.from(t).select('*').eq('condominio_id', cid);
  const [it, lt, cp, ag, cons, aj, sai] = await Promise.all([
    q('v_estoque_item').eq('ativo', true).order('nome'),
    q('v_lotes').gt('saldo', 0).in('faixa_vencimento', ['vencido', 'curto_prazo', 'medio_prazo']),
    q('v_compras').in('status', EFETIVADAS).gte('data_compra', p.inicioAno).lte('data_compra', p.fimAno).order('data_compra', { ascending: false }),
    db.from('v_compras').select('compra_id').eq('condominio_id', cid).eq('status', 'aguardando_aprovacao'),
    q('movimentacoes').eq('tipo', 'consumo').order('data_hora', { ascending: false }).limit(10),
    q('movimentacoes').eq('tipo', 'ajuste').order('data_hora', { ascending: false }).limit(10),
    q('v_saidas_mensal').eq('mes', p.inicioMes).eq('tipo', 'consumo'),
  ]);
  const falha = [it, lt, cp, ag, cons, aj, sai].find((r) => r.error);
  if (falha) throw new Error(falha.error.message);

  const itens = it.data, porId = Object.fromEntries(itens.map((i) => [i.item_id, i]));
  const resp = [...new Set([...cons.data, ...aj.data].map((m) => m.responsavel_id))];
  const { data: pf } = resp.length ? await db.from('profiles').select('id,nome').in('id', resp) : { data: [] };
  const nomes = Object.fromEntries((pf || []).map((x) => [x.id, x.nome]));

  const c = contarStatus(itens), alertas = alertasReposicao(itens), atencao = emAtencao(itens);
  const v = vencimentos(lt.data), g = gastos(cp.data, p.ano, p.mes), doMes = comprasDoMes(cp.data, p.ano, p.mes);
  const top = topConsumo(sai.data, porId), maxMes = Math.max(...g.porMes, 1);
  const nomeMes = new Date(p.ano, p.mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  const venc30 = v.cont.vencido + v.cont.curto_prazo;
  const nomeItem = (id) => porId[id]?.nome ?? '(item inativo)';

  render(el, h`
    <div class="page-head"><div><h2>Painel do síndico</h2><p>Visão geral para decidir o que comprar, o que vence e quanto se gasta.</p></div>
      <div class="atalhos"><a class="btn ghost" href="#/config-estoque">Configurar estoque</a><a class="btn" href="#/operacao">Cadastrar item</a></div></div>

    <div class="cards oito">
      <div class="card"><div class="k">Itens cadastrados</div><div class="v">${c.total}</div></div>
      <div class="card crit"><div class="k">Para comprar</div><div class="v">${c.comprar}</div></div>
      <div class="card crit"><div class="k">Esgotados</div><div class="v">${c.esgotado}</div></div>
      <div class="card warn"><div class="k">Em atenção</div><div class="v">${c.atencao}</div></div>
      <div class="card ${venc30 ? 'crit' : ''}"><div class="k">Vencidos ou a vencer em 30 dias</div><div class="v">${venc30}</div></div>
      <div class="card"><div class="k">Gasto em ${nomeMes}</div><div class="v num" style="font-size:20px">${moeda(g.mes)}</div></div>
      <div class="card"><div class="k">Gasto em ${p.ano}</div><div class="v num" style="font-size:20px">${moeda(g.ano)}</div></div>
      <div class="card ${ag.data.length ? 'warn' : ''}"><a href="#/aprovacoes"><div class="k">Compras aguardando aprovação</div><div class="v">${ag.data.length}</div></a></div>
    </div>
    ${c.semEstoque ? h`<p class="dica" style="margin:-14px 0 20px">${c.semEstoque} item(ns) ainda sem estoque cadastrado — não entram nos alertas até receberem a primeira quantidade.</p>` : ''}

    <div class="panel"><h3>Alertas de reposição</h3>
      ${alertas.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Estoque</th><th>Mínimo</th><th>Ideal</th><th>Sugerido comprar</th><th>Já em pedido</th></tr></thead><tbody>
        ${alertas.map((i) => h`<tr class="row-crit"><td><b>${i.nome}</b> ${i.status === 'esgotado' ? h`<span class="status-pill status-crit">Esgotado</span>` : ''}</td>
          <td class="num">${num(i.estoque_atual)} ${i.unidade}</td><td class="num">${num(i.estoque_minimo)}</td><td class="num">${num(i.estoque_ideal)}</td>
          <td class="num"><b>${num(i.qtd_sugerida)}</b></td><td class="num">${num(i.qtd_em_pedido)}${aComprar(i) === 0 ? ' (coberto)' : ''}</td></tr>`)}</tbody></table></div>
        <p class="dica" style="margin-top:10px"><a href="#/compras">Ir para a Central de compras →</a></p>`
        : h`<div class="empty">Nenhum item precisa de reposição agora.</div>`}</div>

    <div class="grade2">
      <div class="panel"><h3>Estoque em atenção</h3>
        ${atencao.length ? h`<table><thead><tr><th>Item</th><th>Estoque</th><th>Mínimo</th></tr></thead><tbody>
          ${atencao.map((i) => h`<tr class="row-warn"><td>${i.nome}</td><td class="num">${num(i.estoque_atual)} ${i.unidade}</td><td class="num">${num(i.estoque_minimo)}</td></tr>`)}</tbody></table>`
          : h`<div class="empty">Nenhum item perto do mínimo.</div>`}</div>
      <div class="panel"><h3>Próximos vencimentos</h3>
        ${v.lista.length ? h`<table><thead><tr><th>Item</th><th>Lote</th><th>Saldo</th><th>Validade</th><th></th></tr></thead><tbody>
          ${v.lista.slice(0, 15).map((l) => h`<tr><td>${l.item_nome}</td><td class="num">${l.codigo}</td><td class="num">${num(l.saldo)} ${l.unidade}</td>
            <td>${dataBR(l.vencimento)}</td><td><span class="status-pill ${FAIXA[l.faixa_vencimento][1]}">${FAIXA[l.faixa_vencimento][0]}</span></td></tr>`)}</tbody></table>
          ${v.lista.length > 15 ? h`<p class="dica">+ ${v.lista.length - 15} lote(s). Veja todos em <a href="#/estoque">Estoque atual</a>.</p>` : ''}`
          : h`<div class="empty">Nenhum lote vencido ou perto de vencer.</div>`}</div>
    </div>

    <div class="panel"><h3>Compras de ${nomeMes}</h3>
      ${doMes.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Categoria</th><th>Nota fiscal</th><th>Situação</th><th>Valor</th></tr></thead><tbody>
        ${doMes.map((x) => h`<tr><td>${dataBR(x.data_compra)}</td><td>${x.fornecedor || '—'}</td><td>${x.categoria || '—'}</td><td>${x.numero_nf || '—'}${x.nf_arquivo_path ? ' 📎' : ''}</td>
          <td>${x.status.replaceAll('_', ' ')}</td><td class="num">${moeda(x.valor_total)}</td></tr>`)}
        <tr><td colspan="5"><b>Total do mês</b></td><td class="num"><b>${moeda(g.mes)}</b></td></tr></tbody></table></div>`
        : h`<div class="empty">Nenhuma compra efetivada neste mês.</div>`}</div>

    <div class="panel"><h3>Gastos em ${p.ano} — total ${moeda(g.ano)}</h3>
      <div class="barras" role="img" aria-label="Gastos por mês em ${p.ano}">
        ${g.porMes.map((val, i) => h`<div class="barra ${i + 1 === p.mes ? 'atual' : ''}" title="${MESES[i]}: ${moeda(val)}">
          <div class="val">${val ? num(val, 0) : ''}</div><div class="col" style="height:${Math.round((val / maxMes) * 100)}%"></div><div class="rot">${MESES[i]}</div></div>`)}</div></div>

    <div class="grade2">
      <div class="panel"><h3>Consumo recente</h3>
        ${cons.data.length ? h`<table><thead><tr><th>Quando</th><th>Item</th><th>Qtd.</th><th>Quem</th></tr></thead><tbody>
          ${cons.data.map((m) => h`<tr><td>${dataHoraBR(m.data_hora)}</td><td>${nomeItem(m.item_id)}</td>
            <td class="num ${m.sinal > 0 ? 'qtd-mais' : 'qtd-menos'}">${m.sinal > 0 ? '+' : '−'}${num(m.quantidade)}</td><td>${nomes[m.responsavel_id] || '—'}</td></tr>`)}</tbody></table>`
          : h`<div class="empty">Nenhum consumo registrado.</div>`}
        ${top.length ? h`<p class="dica" style="margin-top:12px"><b>Mais consumidos em ${nomeMes}:</b> ${top.map((t) => `${t.nome} (${num(t.quantidade)} ${t.unidade})`).join(' · ')}</p>` : ''}</div>
      <div class="panel"><h3>Ajustes recentes</h3>
        ${aj.data.length ? h`<table><thead><tr><th>Quando</th><th>Item</th><th>Ajuste</th><th>Justificativa</th><th>Quem</th></tr></thead><tbody>
          ${aj.data.map((m) => h`<tr><td>${dataHoraBR(m.data_hora)}</td><td>${nomeItem(m.item_id)}</td>
            <td class="num ${m.sinal > 0 ? 'qtd-mais' : 'qtd-menos'}">${m.sinal > 0 ? '+' : '−'}${num(m.quantidade)}</td><td>${m.justificativa || ''}</td><td>${nomes[m.responsavel_id] || '—'}</td></tr>`)}</tbody></table>`
          : h`<div class="empty">Nenhum ajuste de estoque.</div>`}</div>
    </div>`);
}
