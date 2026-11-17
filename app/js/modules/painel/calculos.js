// Cálculos do painel do síndico. Funções puras: recebem linhas das views e devolvem números.
export const EFETIVADAS = ['pedido_realizado', 'parcialmente_recebido', 'recebido'];
export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function periodoAtual(d = new Date()) {
  const ano = d.getFullYear(), mes = d.getMonth() + 1;
  return { ano, mes, inicioMes: `${ano}-${String(mes).padStart(2, '0')}-01`, inicioAno: `${ano}-01-01`, fimAno: `${ano}-12-31` };
}

export function contarStatus(itens) {
  const c = { total: itens.length, comprar: 0, esgotado: 0, atencao: 0, normal: 0, semEstoque: 0 };
  itens.forEach((i) => {
    if (i.status === 'sem_estoque_cadastrado') c.semEstoque++;
    else if (i.status in c) c[i.status]++;
  });
  return c;
}

export const aComprar = (i) => Math.max(Number(i.qtd_sugerida) - Number(i.qtd_em_pedido), 0);

// Itens que precisam de reposição: esgotado primeiro, depois os de maior quantidade a comprar.
export function alertasReposicao(itens) {
  return itens
    .filter((i) => i.status === 'comprar' || i.status === 'esgotado')
    .sort((a, b) => (b.status === 'esgotado') - (a.status === 'esgotado') || aComprar(b) - aComprar(a) || a.nome.localeCompare(b.nome));
}
export const emAtencao = (itens) => itens.filter((i) => i.status === 'atencao').sort((a, b) => a.nome.localeCompare(b.nome));

export function vencimentos(lotes) {
  const faixas = ['vencido', 'curto_prazo', 'medio_prazo'];
  const lista = lotes.filter((l) => Number(l.saldo) > 0 && faixas.includes(l.faixa_vencimento))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.item_nome.localeCompare(b.item_nome));
  const cont = { vencido: 0, curto_prazo: 0, medio_prazo: 0 };
  lista.forEach((l) => cont[l.faixa_vencimento]++);
  return { lista, cont };
}

// Gastos: só compras efetivadas (pedido feito, parcial ou recebida). Devolve total por mês do ano informado.
export function gastos(compras, ano, mes) {
  const porMes = Array(12).fill(0);
  compras.forEach((c) => {
    if (!EFETIVADAS.includes(c.status) || !c.data_compra.startsWith(String(ano))) return;
    porMes[Number(c.data_compra.slice(5, 7)) - 1] += Number(c.valor_total);
  });
  return { porMes, mes: porMes[mes - 1], ano: porMes.reduce((a, b) => a + b, 0) };
}

export function comprasDoMes(compras, ano, mes) {
  const pref = `${ano}-${String(mes).padStart(2, '0')}`;
  return compras.filter((c) => EFETIVADAS.includes(c.status) && c.data_compra.startsWith(pref))
    .sort((a, b) => b.data_compra.localeCompare(a.data_compra));
}

// Itens mais consumidos no mês (já com estornos descontados pela view).
export function topConsumo(saidas, itensPorId, n = 5) {
  const soma = {};
  saidas.forEach((s) => { soma[s.item_id] = (soma[s.item_id] || 0) + Number(s.quantidade); });
  return Object.entries(soma).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([id, q]) => ({ item_id: id, nome: itensPorId[id]?.nome ?? '(item inativo)', unidade: itensPorId[id]?.unidade ?? '', quantidade: q }));
}
