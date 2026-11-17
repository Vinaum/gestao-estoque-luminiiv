import fs from 'node:fs'; import assert from 'node:assert/strict';
import * as c from '../app/js/modules/painel/calculos.js';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const p = c.periodoAtual();
const cont = c.contarStatus(d.itens);
assert.deepEqual(cont, { total: 4, comprar: 1, esgotado: 1, atencao: 1, normal: 0, semEstoque: 1 });
assert.deepEqual(c.alertasReposicao(d.itens).map((i) => i.nome), ['Esgotado', 'Comprar']);
const g = c.gastos(d.compras, p.ano, p.mes);
assert.ok(Math.abs(g.mes - d.ref.gasto_mes) < 1e-6, `gasto mês ${g.mes} != ${d.ref.gasto_mes}`);
assert.ok(Math.abs(g.ano - d.ref.gasto_ano) < 1e-6, `gasto ano ${g.ano} != ${d.ref.gasto_ano}`);
assert.ok(d.ref.gasto_ano >= 100.5 + 200 - 1e-6 || p.mes === 1);
const v = c.vencimentos(d.lotes);
assert.deepEqual(v.cont, { vencido: 1, curto_prazo: 1, medio_prazo: 0 }, JSON.stringify(v.cont)); // lote de 60 dias do item esgotado já está zerado
const porId = Object.fromEntries(d.itens.map((i) => [i.item_id, i]));
const top = c.topConsumo(d.saidas, porId);
const tc = top.find((t) => t.nome === 'Comprar');
assert.equal(tc.quantidade, d.ref.consumo_i1);
const i1 = d.itens.find((i) => i.nome === 'Comprar');
assert.equal(Number(i1.estoque_atual), d.ref.saldo_i1);
console.log('painel_vs_banco OK — gasto mês', g.mes, '| ano', g.ano, '| alertas', c.alertasReposicao(d.itens).length, '| vencimentos', JSON.stringify(v.cont));
