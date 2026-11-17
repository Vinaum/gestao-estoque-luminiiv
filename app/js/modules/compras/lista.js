// Lista de compras: itens a comprar agrupados por categoria (Elétrica, Limpeza…). Sem tela, sem banco.
const SEM = 'Sem categoria';
const ordem = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
const numero = (n) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// itens: [{nome, categoria, unidade, qtd, estoque, minimo}] -> [{categoria, itens:[…]}]
// Categorias em ordem alfabética, "Sem categoria" por último; itens em ordem alfabética.
export function agruparPorCategoria(itens) {
  const por = new Map();
  for (const i of itens) {
    if (!(Number(i.qtd) > 0)) continue;
    const cat = String(i.categoria ?? '').trim() || SEM;
    if (!por.has(cat)) por.set(cat, []);
    por.get(cat).push(i);
  }
  return [...por.entries()]
    .sort(([a], [b]) => (a === SEM) - (b === SEM) || ordem(a, b))
    .map(([categoria, lista]) => ({ categoria, itens: lista.sort((x, y) => ordem(x.nome, y.nome)) }));
}

export const contarLista = (grupos) => ({ categorias: grupos.length, itens: grupos.reduce((s, g) => s + g.itens.length, 0) });

// Texto simples para colar no WhatsApp ou e-mail. *negrito* é o realce do WhatsApp.
export function textoLista(grupos, { condominio = '', data = '' } = {}) {
  const cab = ['Lista de compras' + (condominio ? ' — ' + condominio : '') + (data ? ' — ' + data : '')];
  const corpo = grupos.map((g) => [`*${g.categoria}*`, ...g.itens.map((i) => `- ${i.nome}: ${numero(i.qtd)} ${i.unidade ?? ''}`.trimEnd())].join('\n'));
  return [cab.join(''), ...corpo].join('\n\n');
}

// CSV compatível com Excel em português (separador ';', vírgula decimal, BOM).
export function csvLista(grupos) {
  const cel = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t; };
  const linhas = [['Categoria', 'Item', 'Quantidade a comprar', 'Unidade', 'Estoque atual', 'Mínimo']];
  for (const g of grupos) for (const i of g.itens) linhas.push([g.categoria, i.nome, numero(i.qtd), i.unidade ?? '', numero(i.estoque), numero(i.minimo)]);
  return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
}
