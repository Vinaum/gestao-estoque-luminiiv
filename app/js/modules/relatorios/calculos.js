// Cálculos dos relatórios (funções puras).
import { EFETIVADAS } from '../painel/calculos.js';
export { EFETIVADAS };

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const rotuloMes = (chave) => `${NOMES_MES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`;

// Últimos n meses (inclui o atual), do mais antigo ao mais novo, como 'AAAA-MM'.
export function ultimosMeses(n, hoje = new Date()) {
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (n - 1 - k), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

// saidas: linhas de v_saidas_mensal. tipos: quais tipos contar. Devolve, por item, total/média/série mensal.
export function consumoPorItem(saidas, meses, tipos) {
  const por = {};
  saidas.forEach((s) => {
    const m = String(s.mes).slice(0, 7), i = meses.indexOf(m);
    if (i < 0 || !tipos.includes(s.tipo)) return;
    const x = (por[s.item_id] ||= { item_id: s.item_id, serie: Array(meses.length).fill(0), total: 0 });
    x.serie[i] += Number(s.quantidade); x.total += Number(s.quantidade);
  });
  return Object.values(por).filter((x) => x.total > 0).map((x) => ({ ...x, media: x.total / meses.length }))
    .sort((a, b) => b.total - a.total);
}

export function gastosPorMes(compras, ano) {
  const v = Array(12).fill(0);
  compras.forEach((c) => { if (EFETIVADAS.includes(c.status) && c.data_compra.startsWith(String(ano))) v[Number(c.data_compra.slice(5, 7)) - 1] += Number(c.valor_total); });
  return v;
}
export function gastosPorFornecedor(compras, ano) {
  const por = {};
  compras.forEach((c) => { if (EFETIVADAS.includes(c.status) && c.data_compra.startsWith(String(ano))) { const n = c.fornecedor || 'Sem fornecedor'; por[n] = (por[n] || 0) + Number(c.valor_total); } });
  return Object.entries(por).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
}
// linhas: compra_itens {compra_id,item_id,custo_total}; categoriaDoItem: {item_id: 'Limpeza'}; idsValidos: compras efetivadas do ano
export function gastosPorCategoria(linhas, categoriaDoItem, idsValidos) {
  const ok = new Set(idsValidos), por = {};
  linhas.forEach((l) => { if (!ok.has(l.compra_id)) return; const n = categoriaDoItem[l.item_id] || 'Sem categoria'; por[n] = (por[n] || 0) + Number(l.custo_total); });
  return Object.entries(por).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
}

// CSV compatível com Excel em português (separador ';', vírgula decimal, BOM).
export function csvCompras(compras) {
  const cel = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t; };
  const dec = (n) => Number(n).toFixed(2).replace('.', ',');
  const linhas = [['Data', 'Fornecedor', 'Nota fiscal', 'Situação', 'Valor']].concat(
    compras.map((c) => [c.data_compra.split('-').reverse().join('/'), c.fornecedor || '', c.numero_nf || '', c.status.replaceAll('_', ' '), dec(c.valor_total)]));
  return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
}

// Filtra compras por mês ('01'..'12', '' = todos) e por fornecedor ('' = todos).
export function filtrarCompras(compras, { mes = '', forn = '' } = {}) {
  return compras.filter((c) => (!mes || String(c.data_compra).slice(5, 7) === mes)
    && (!forn || (c.fornecedor || 'Sem fornecedor') === forn));
}

// Mantém as (n-1) maiores fatias e soma o resto em "Demais" (para o gráfico de pizza).
export function fatiasPizza(lista, n = 8) {
  if (lista.length <= n) return lista;
  const topo = lista.slice(0, n - 1), resto = lista.slice(n - 1).reduce((s, x) => s + x.valor, 0);
  return [...topo, { nome: 'Demais', valor: resto }];
}
