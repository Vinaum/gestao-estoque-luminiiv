import assert from 'node:assert/strict';
import { lerValorReais, validarRetroativa, validarArquivoNF, categoriasRetroativas, MAX_VALOR } from '../app/js/modules/compras/retroativa_regras.js';
import { gastosPorCategoria, csvCompras } from '../app/js/modules/relatorios/calculos.js';
let n = 0; const t = (nome, fn) => { fn(); n++; console.log('OK   ' + nome); };

t('lerValorReais: jeitos comuns de digitar', () => {
  assert.equal(lerValorReais('1.234,56'), 1234.56);
  assert.equal(lerValorReais('1234,56'), 1234.56);
  assert.equal(lerValorReais('R$ 80'), 80);
  assert.equal(lerValorReais(' 80.50 '), 80.5);
  assert.equal(lerValorReais('1.500'), 1500, 'ponto de milhar');
  assert.equal(lerValorReais('12.345.678,9'), 12345678.9);
  assert.equal(lerValorReais('10,005'), 10.01, 'arredonda centavos');
});
t('lerValorReais: inválidos viram NaN', () => {
  for (const x of ['', '  ', 'cem', '1,2,3', '-5', '1.2.3', null, undefined, '12a']) assert.ok(Number.isNaN(lerValorReais(x)), String(x));
});
t('validarRetroativa', () => {
  const hoje = '2026-11-18';
  assert.equal(validarRetroativa({ data: '2025-05-10', valor: 10 }, hoje), null);
  assert.equal(validarRetroativa({ data: hoje, valor: 10 }, hoje), null, 'hoje vale');
  assert.match(validarRetroativa({ data: '', valor: 10 }, hoje), /data/);
  assert.match(validarRetroativa({ data: '2026-11-19', valor: 10 }, hoje), /futuro/);
  assert.match(validarRetroativa({ data: '1999-12-31', valor: 10 }, hoje), /inválida/);
  assert.match(validarRetroativa({ data: '2025-01-01', valor: 0 }, hoje), /maior que zero/);
  assert.match(validarRetroativa({ data: '2025-01-01', valor: NaN }, hoje), /maior que zero/);
  assert.match(validarRetroativa({ data: '2025-01-01', valor: MAX_VALOR + 1 }, hoje), /alto demais/);
});
t('validarArquivoNF', () => {
  assert.deepEqual(validarArquivoNF({ type: 'application/pdf', size: 10, name: 'a.pdf' }), { ext: 'pdf' });
  assert.deepEqual(validarArquivoNF({ type: 'image/jpeg', size: 10, name: 'a.jpg' }), { ext: 'jpg' });
  assert.deepEqual(validarArquivoNF({ type: '', size: 10, name: 'NOTA.PDF' }), { ext: 'pdf' });
  assert.match(validarArquivoNF({ type: 'text/plain', size: 10, name: 'a.txt' }).erro, /Formato/);
  assert.match(validarArquivoNF({ type: 'application/pdf', size: 5 * 1024 * 1024 + 1, name: 'a.pdf' }).erro, /5 MB/);
  assert.match(validarArquivoNF({ type: 'application/pdf', size: 0, name: 'a.pdf' }).erro, /vazio/);
});
t('categoriasRetroativas: só as notas antigas, pela categoria da nota', () => {
  const L = [{ retroativa: true, categoria: 'Elétrica', valor_total: 100 }, { retroativa: true, categoria: null, valor_total: 30 },
    { retroativa: false, categoria: 'Elétrica', valor_total: 999 }, { retroativa: true, categoria: 'Elétrica', valor_total: '50.5' }];
  assert.deepEqual(categoriasRetroativas(L), { 'Elétrica': 150.5, 'Sem categoria': 30 });
});
t('gastosPorCategoria soma itens e notas antigas na mesma categoria', () => {
  const linhas = [{ compra_id: 'c1', item_id: 'i1', custo_total: 40 }, { compra_id: 'c2', item_id: 'i2', custo_total: 70 }];
  const r = gastosPorCategoria(linhas, { i1: 'Elétrica', i2: 'Limpeza' }, ['c1', 'c2'], { 'Elétrica': 100, Jardinagem: 5 });
  assert.deepEqual(r, [{ nome: 'Elétrica', valor: 140 }, { nome: 'Limpeza', valor: 70 }, { nome: 'Jardinagem', valor: 5 }]);
  assert.deepEqual(gastosPorCategoria(linhas, { i1: 'A' }, ['c1']), [{ nome: 'A', valor: 40 }], 'sem extras continua igual');
});
t('CSV marca nota antiga na situação', () => {
  const csv = csvCompras([{ data_compra: '2025-05-10', fornecedor: 'X', numero_nf: '1', status: 'recebido', valor_total: 10, retroativa: true },
    { data_compra: '2025-05-11', fornecedor: 'Y', numero_nf: '', status: 'pedido_realizado', valor_total: 5 }]);
  assert.ok(csv.includes('10/05/2025;X;1;nota antiga;10,00') && csv.includes('pedido realizado'));
});
console.log(`RESULTADO: TUDO OK (${n} testes)`);
