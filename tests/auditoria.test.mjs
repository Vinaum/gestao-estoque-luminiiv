import assert from 'node:assert/strict';
import { resumo } from '../app/js/modules/auditoria.js';
assert.equal(resumo({ acao: 'update', antes: { estoque_minimo: 3, estoque_ideal: 20, criado_em: 'a' }, depois: { estoque_minimo: 5, estoque_ideal: 20, criado_em: 'b' } }), 'mínimo: 3 → 5');
assert.equal(resumo({ acao: 'update', antes: { ativo: true }, depois: { ativo: false } }), 'ativo: sim → não');
assert.equal(resumo({ acao: 'update', antes: { x: 1 }, depois: { x: 1 } }), '(sem mudança visível)');
assert.equal(resumo({ acao: 'insert', depois: { nome: 'Papel' } }), 'Papel');
assert.equal(resumo({ acao: 'ajuste_estoque', depois: { sinal: -1, quantidade: 2, justificativa: 'contagem' } }), '−2 — contagem');
console.log('auditoria.test OK');
