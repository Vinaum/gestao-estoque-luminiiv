import assert from 'node:assert/strict';
import * as c from '../app/js/modules/relatorios/calculos.js';
assert.deepEqual(c.ultimosMeses(3, new Date(2026, 0, 15)), ['2025-11', '2025-12', '2026-01']);
assert.equal(c.rotuloMes('2026-03'), 'mar/26');
const m = c.ultimosMeses(3, new Date(2026, 10, 16)); // set-out-nov? => 2026-09,10,11
assert.deepEqual(m, ['2026-09', '2026-10', '2026-11']);
const saidas = [
  { item_id: 'a', mes: '2026-11-01', tipo: 'consumo', quantidade: 6 }, { item_id: 'a', mes: '2026-10-01', tipo: 'consumo', quantidade: 3 },
  { item_id: 'a', mes: '2026-10-01', tipo: 'perda', quantidade: 1 }, { item_id: 'b', mes: '2026-09-01', tipo: 'consumo', quantidade: 2 },
  { item_id: 'a', mes: '2026-01-01', tipo: 'consumo', quantidade: 100 },                  // fora do período
  { item_id: 'z', mes: '2026-11-01', tipo: 'consumo', quantidade: 0 }];
let r = c.consumoPorItem(saidas, m, ['consumo']);
assert.deepEqual(r.map((x) => [x.item_id, x.total, x.media, x.serie]), [['a', 9, 3, [0, 3, 6]], ['b', 2, 2 / 3, [2, 0, 0]]]);
r = c.consumoPorItem(saidas, m, ['consumo', 'perda']); assert.equal(r[0].total, 10);
assert.deepEqual(c.consumoPorItem([], m, ['consumo']), []);   // sem histórico
const compras = [{ data_compra: '2026-11-03', valor_total: 100, status: 'recebido', fornecedor: 'F1' }, { data_compra: '2026-10-03', valor_total: 50, status: 'pedido_realizado', fornecedor: 'F1' },
  { data_compra: '2026-10-05', valor_total: 30, status: 'recebido', fornecedor: null }, { data_compra: '2026-10-05', valor_total: 999, status: 'cancelado', fornecedor: 'F2' }, { data_compra: '2025-10-05', valor_total: 999, status: 'recebido', fornecedor: 'F2' }];
assert.equal(c.gastosPorMes(compras, 2026)[9], 80); assert.equal(c.gastosPorMes(compras, 2026).reduce((a, b) => a + b), 180);
assert.deepEqual(c.gastosPorFornecedor(compras, 2026), [{ nome: 'F1', valor: 150 }, { nome: 'Sem fornecedor', valor: 30 }]);
assert.deepEqual(c.gastosPorCategoria([{ compra_id: 1, item_id: 'a', custo_total: 10 }, { compra_id: 1, item_id: 'b', custo_total: 5 }, { compra_id: 2, item_id: 'a', custo_total: 7 }, { compra_id: 9, item_id: 'a', custo_total: 99 }], { a: 'Limpeza' }, [1, 2]),
  [{ nome: 'Limpeza', valor: 17 }, { nome: 'Sem categoria', valor: 5 }]);
const csv = c.csvCompras([{ data_compra: '2026-11-03', fornecedor: 'A;B "x"', numero_nf: '=1+1', status: 'pedido_realizado', valor_total: 1234.5 }]);
assert.ok(csv.startsWith('﻿Data;Fornecedor;'));
assert.ok(csv.includes('03/11/2026;"A;B ""x""";\'=1+1;pedido realizado;1234,50'), csv);   // aspas escapadas e fórmula neutralizada
console.log('relatorios.test OK');
