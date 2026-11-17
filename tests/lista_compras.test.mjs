import assert from 'node:assert/strict';
import { agruparPorCategoria, contarLista, textoLista, csvLista } from '../app/js/modules/compras/lista.js';
let n = 0; const t = (nome, f) => { f(); n++; };
const I = [
  { nome: 'Saco de lixo 100L', categoria: 'Limpeza', unidade: 'pct', qtd: 12, estoque: 2, minimo: 5 },
  { nome: 'Lâmpada LED 9W', categoria: 'Elétrica', unidade: 'un', qtd: 30, estoque: 0, minimo: 10 },
  { nome: 'Cloro', categoria: 'Limpeza', unidade: 'L', qtd: 2.5, estoque: 1, minimo: 3 },
  { nome: 'Abraçadeira', categoria: '', unidade: 'un', qtd: 4, estoque: 0, minimo: 2 },
  { nome: 'Disjuntor', categoria: 'Elétrica', unidade: 'un', qtd: 0, estoque: 5, minimo: 2 },
  { nome: 'Verniz', categoria: 'Tintas', unidade: 'L', qtd: 1, estoque: 0, minimo: 1 },
  { nome: 'Água sanitária', categoria: 'limpeza ', unidade: 'L', qtd: 3, estoque: 0, minimo: 1 },
];
t('agrupa por categoria, em ordem, "Sem categoria" por último, e ignora quantidade zero', () => {
  const g = agruparPorCategoria(I);
  assert.deepEqual(g.map((x) => x.categoria), ['Elétrica', 'Limpeza', 'limpeza', 'Tintas', 'Sem categoria']);
  assert.deepEqual(g[0].itens.map((i) => i.nome), ['Lâmpada LED 9W']);
  assert.deepEqual(g[1].itens.map((i) => i.nome), ['Cloro', 'Saco de lixo 100L']);
  assert.equal(g.flatMap((x) => x.itens).some((i) => i.nome === 'Disjuntor'), false);
});
t('contagem', () => assert.deepEqual(contarLista(agruparPorCategoria(I)), { categorias: 5, itens: 6 }));
t('lista vazia', () => { assert.deepEqual(agruparPorCategoria([]), []); assert.deepEqual(contarLista([]), { categorias: 0, itens: 0 }); });
t('texto para WhatsApp', () => {
  const tx = textoLista(agruparPorCategoria(I.slice(0, 3)), { condominio: 'Luminiiv', data: '17/11/2026' });
  assert.equal(tx, 'Lista de compras — Luminiiv — 17/11/2026\n\n*Elétrica*\n- Lâmpada LED 9W: 30 un\n\n*Limpeza*\n- Cloro: 2,5 L\n- Saco de lixo 100L: 12 pct');
  assert.equal(textoLista([], {}), 'Lista de compras');
});
t('planilha CSV: BOM, separador ; e vírgula decimal', () => {
  const c = csvLista(agruparPorCategoria(I.slice(0, 3)));
  assert.ok(c.startsWith('﻿Categoria;Item;Quantidade a comprar;Unidade;Estoque atual;Mínimo\r\n'));
  assert.ok(c.includes('Limpeza;Cloro;2,5;L;1;3'));
  assert.equal(c.split('\r\n').length, 4);
});
t('planilha: neutraliza fórmulas e protege aspas', () => {
  const c = csvLista([{ categoria: '=1+1', itens: [{ nome: 'a"b;c', unidade: 'un', qtd: 1, estoque: 0, minimo: 0 }] }]);
  assert.ok(c.includes("'=1+1;"));
  assert.ok(c.includes('"a""b;c"'));
});
console.log('RESULTADO: TUDO OK (' + n + ' testes)');
