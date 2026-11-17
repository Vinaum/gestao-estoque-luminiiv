import assert from 'node:assert/strict';
import * as c from '../app/js/modules/painel/calculos.js';
const it = (nome, status, sug = 0, ped = 0) => ({ nome, status, qtd_sugerida: sug, qtd_em_pedido: ped });
const itens = [it('A', 'normal'), it('B', 'comprar', 16, 0), it('C', 'esgotado', 10, 0), it('D', 'atencao'), it('E', 'sem_estoque_cadastrado'), it('F', 'comprar', 30, 5), it('G', 'comprar', 10, 10)];
assert.deepEqual(c.contarStatus(itens), { total: 7, comprar: 3, esgotado: 1, atencao: 1, normal: 1, semEstoque: 1 });
assert.deepEqual(c.alertasReposicao(itens).map((i) => i.nome), ['C', 'F', 'B', 'G']);   // esgotado, depois maior a comprar (25, 16, 0)
assert.equal(c.aComprar(itens[6]), 0);
assert.deepEqual(c.emAtencao(itens).map((i) => i.nome), ['D']);
// sem estoque cadastrado nunca vira alerta
assert.ok(!c.alertasReposicao(itens).some((i) => i.nome === 'E'));
const lotes = [
  { item_nome: 'X', saldo: 2, vencimento: '2026-12-01', faixa_vencimento: 'curto_prazo' },
  { item_nome: 'Y', saldo: 1, vencimento: '2026-01-01', faixa_vencimento: 'vencido' },
  { item_nome: 'Z', saldo: 0, vencimento: '2026-01-01', faixa_vencimento: 'vencido' },     // sem saldo: ignora
  { item_nome: 'W', saldo: 5, vencimento: '2027-01-20', faixa_vencimento: 'medio_prazo' },
  { item_nome: 'V', saldo: 5, vencimento: '2028-01-20', faixa_vencimento: 'ok' }];
const v = c.vencimentos(lotes);
assert.deepEqual(v.lista.map((l) => l.item_nome), ['Y', 'X', 'W']);
assert.deepEqual(v.cont, { vencido: 1, curto_prazo: 1, medio_prazo: 1 });
const compras = [
  { data_compra: '2026-11-03', valor_total: 100, status: 'recebido' }, { data_compra: '2026-11-30', valor_total: 50.5, status: 'pedido_realizado' },
  { data_compra: '2026-10-31', valor_total: 200, status: 'parcialmente_recebido' }, { data_compra: '2026-11-10', valor_total: 999, status: 'aprovada' },
  { data_compra: '2026-11-11', valor_total: 999, status: 'cancelado' }, { data_compra: '2025-11-11', valor_total: 999, status: 'recebido' }];
const g = c.gastos(compras, 2026, 11);
assert.equal(g.mes, 150.5); assert.equal(g.ano, 350.5); assert.equal(g.porMes[9], 200); assert.equal(g.porMes[0], 0);
assert.equal(c.comprasDoMes(compras, 2026, 11).length, 2);
assert.equal(c.comprasDoMes(compras, 2026, 11)[0].data_compra, '2026-11-30');
assert.deepEqual(c.periodoAtual(new Date(2026, 10, 16)), { ano: 2026, mes: 11, inicioMes: '2026-11-01', inicioAno: '2026-01-01', fimAno: '2026-12-31' });
const top = c.topConsumo([{ item_id: 'a', quantidade: 3 }, { item_id: 'a', quantidade: 2 }, { item_id: 'b', quantidade: 9 }, { item_id: 'c', quantidade: 0 }, { item_id: 'd', quantidade: -1 }], { a: { nome: 'A', unidade: 'un' }, b: { nome: 'B', unidade: 'L' } });
assert.deepEqual(top.map((t) => [t.nome, t.quantidade]), [['B', 9], ['A', 5]]);
console.log('painel.test OK');
