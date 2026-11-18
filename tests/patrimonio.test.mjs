import assert from 'node:assert/strict';
import { CONSERVACAO, filtrarPatrimonio, resumoPatrimonio } from '../app/js/modules/patrimonio/calculos.js';
let n = 0; const t = (nome, fn) => { fn(); n++; console.log('OK   ' + nome); };
const it = (nome, extra = {}) => ({ nome, permanente: true, ativo: true, conservacao: 'bom', categoria: 'Ferramentas', localizacao: null, descricao: null, estoque_atual: 1, ...extra });
const L = [
  it('Serrote', { estoque_atual: 2, localizacao: 'Depósito subsolo' }),
  it('Mangueira 30 m', { conservacao: 'reparo', categoria: 'Jardinagem' }),
  it('Escada', { ativo: false, conservacao: 'inutilizavel' }),
  it('Água sanitária', { permanente: false, estoque_atual: 40 }),
  it('Martelo', { descricao: 'Cabo de madeira, patrimônio nº 12', estoque_atual: 3 }),
];
t('só permanentes ativos, em ordem alfabética', () => assert.deepEqual(filtrarPatrimonio(L).map((i) => i.nome), ['Mangueira 30 m', 'Martelo', 'Serrote']));
t('inativos só quando pedidos', () => assert.deepEqual(filtrarPatrimonio(L, { inativos: true }).map((i) => i.nome), ['Escada', 'Mangueira 30 m', 'Martelo', 'Serrote']));
t('filtro de conservação', () => {
  assert.deepEqual(filtrarPatrimonio(L, { conservacao: 'reparo' }).map((i) => i.nome), ['Mangueira 30 m']);
  assert.deepEqual(filtrarPatrimonio(L, { conservacao: 'inutilizavel' }).map((i) => i.nome), [], 'inativo fica de fora');
});
t('busca sem acento em nome, categoria, local e descrição', () => {
  assert.deepEqual(filtrarPatrimonio(L, { busca: 'deposito' }).map((i) => i.nome), ['Serrote']);
  assert.deepEqual(filtrarPatrimonio(L, { busca: 'jardinagem' }).map((i) => i.nome), ['Mangueira 30 m']);
  assert.deepEqual(filtrarPatrimonio(L, { busca: 'PATRIMONIO 12' }).map((i) => i.nome), ['Martelo']);
  assert.deepEqual(filtrarPatrimonio(L, { busca: 'agua' }).map((i) => i.nome), [], 'item de consumo nunca aparece');
});
t('resumo: só ativos permanentes', () => assert.deepEqual(resumoPatrimonio(L), { itens: 3, unidades: 6, bom: 2, reparo: 1, inutilizavel: 0 }));
t('resumo vazio', () => assert.deepEqual(resumoPatrimonio([]), { itens: 0, unidades: 0, bom: 0, reparo: 0, inutilizavel: 0 }));
t('estados de conservação', () => assert.deepEqual(Object.keys(CONSERVACAO), ['bom', 'reparo', 'inutilizavel']));
console.log(`RESULTADO: TUDO OK (${n} testes)`);
