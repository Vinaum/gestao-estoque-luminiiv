import assert from 'node:assert/strict';
import { categoriasSemItens, csvCompras, gastosPorCategoria } from '../app/js/modules/relatorios/calculos.js';
import { situacaoDoMes, ultimoPagamento, totais, comoGastos, telefoneDigitos, telefoneBR, referenciaDoMes, hojeISO } from '../app/js/modules/servicos/calculos.js';
let n = 0; const t = (nome, fn) => { fn(); n++; console.log('OK   ' + nome); };
const hoje = new Date(2026, 10, 18);   // 18/11/2026
const S = (id, extra = {}) => ({ id, ativo: true, periodicidade: 'mensal', dia_pagamento: 10, ...extra });
const P = [{ id: 'p1', servico_id: 'a', data_pagamento: '2026-11-05', valor: 900 }, { id: 'p2', servico_id: 'a', data_pagamento: '2026-10-05', valor: '900.50' },
  { id: 'p3', servico_id: 'b', data_pagamento: '2025-12-20', valor: 100 }];
t('situação do mês: pago, atrasado e a pagar', () => {
  assert.equal(situacaoDoMes(S('a'), P, hoje), 'pago');
  assert.equal(situacaoDoMes(S('b'), P, hoje), 'atrasado', 'passou do dia 10');
  assert.equal(situacaoDoMes(S('b', { dia_pagamento: 25 }), P, hoje), 'pendente');
  assert.equal(situacaoDoMes(S('b', { dia_pagamento: null }), P, hoje), 'pendente', 'sem dia combinado nunca atrasa');
  assert.equal(situacaoDoMes(S('b', { dia_pagamento: 18 }), P, hoje), 'pendente', 'no próprio dia ainda não atrasou');
});
t('situação só para mensal e ativo', () => {
  assert.equal(situacaoDoMes(S('b', { periodicidade: 'por_visita' }), P, hoje), null);
  assert.equal(situacaoDoMes(S('b', { ativo: false }), P, hoje), null);
});
t('último pagamento pela data', () => { assert.equal(ultimoPagamento('a', P).id, 'p1'); assert.equal(ultimoPagamento('z', P), null); });
t('totais no mês e no ano', () => assert.deepEqual(totais(P, hoje), { noMes: 900, noAno: 1800.5 }));
t('pagamentos no formato de gastos', () => {
  const g = comoGastos(P.slice(0, 1).concat([{ id: 'p9', servico_id: 'x', data_pagamento: '2026-01-01', valor: 5, numero_recibo: 'R1' }]), [{ id: 'a', nome: 'Azul', servico: 'Piscineiro' }]);
  assert.deepEqual(g[0], { compra_id: 'servico:p1', data_compra: '2026-11-05', fornecedor: 'Azul (Piscineiro)', numero_nf: null, status: 'recebido', valor_total: 900, servico: true, categoria: 'Serviços' });
  assert.equal(g[1].fornecedor, 'Serviço'); assert.equal(g[1].numero_nf, 'R1');
});
t('telefone', () => {
  assert.equal(telefoneDigitos('+55 (11) 98765-4321'), '11987654321');
  assert.equal(telefoneDigitos('1133334444'), '1133334444');
  assert.equal(telefoneDigitos('1234'), '');
  assert.equal(telefoneBR('11987654321'), '(11) 98765-4321');
  assert.equal(telefoneBR('1133334444'), '(11) 3333-4444');
});
t('referência e data de hoje', () => { assert.equal(referenciaDoMes(hoje), 'Novembro/2026'); assert.equal(hojeISO(hoje), '2026-11-18'); });
t('categorias sem itens: serviços e notas antigas', () => {
  const L = [{ servico: true, valor_total: 900 }, { servico: true, valor_total: 100.1 }, { retroativa: true, categoria: 'Elétrica', valor_total: 50 },
    { retroativa: true, categoria: null, valor_total: 5 }, { valor_total: 999 }];
  assert.deepEqual(categoriasSemItens(L), { 'Serviços': 1000.1, 'Elétrica': 50, 'Sem categoria': 5 });
  const r = gastosPorCategoria([{ compra_id: 'c', item_id: 'i', custo_total: 10 }], { i: 'Limpeza' }, ['c'], categoriasSemItens(L));
  assert.equal(r[0].nome, 'Serviços');
});
t('CSV marca serviço', () => assert.ok(csvCompras([{ data_compra: '2026-11-05', fornecedor: 'Azul (Piscineiro)', numero_nf: 'R1', status: 'servico', servico: true, valor_total: 900 }]).includes('05/11/2026;Azul (Piscineiro);R1;serviço;900,00')));
console.log(`RESULTADO: TUDO OK (${n} testes)`);
