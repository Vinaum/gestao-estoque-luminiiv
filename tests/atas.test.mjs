import assert from 'node:assert/strict';
import { TIPOS_ATA, ordenarAtas, anosDasAtas, filtrarAtas, validarAta, validarPdf, hojeLocal } from '../app/js/modules/atas/calculos.js';
let n = 0; const t = (nome, fn) => { fn(); n++; console.log('OK   ' + nome); };

const L = [
  { id: 1, data_assembleia: '2025-03-10', tipo: 'ordinaria', titulo: 'AGO 2025', resumo: 'Aprovação das contas e eleição do síndico', criado_em: '2025-03-11' },
  { id: 2, data_assembleia: '2026-06-01', tipo: 'extraordinaria', titulo: 'AGE da obra da fachada', resumo: null, criado_em: '2026-06-02' },
  { id: 3, data_assembleia: '2026-03-12', tipo: 'ordinaria', titulo: 'AGO 2026', resumo: 'Previsão orçamentária', criado_em: '2026-03-13' },
  { id: 4, data_assembleia: '2026-03-12', tipo: 'extraordinaria', titulo: 'AGE piscina', resumo: 'Reforma da PISCINA', criado_em: '2026-03-14' },
];
t('ordenar: mais recente primeiro; empate pela criação', () => assert.deepEqual(ordenarAtas(L).map((a) => a.id), [2, 4, 3, 1]));
t('ordenar não altera a lista original', () => { ordenarAtas(L); assert.equal(L[0].id, 1); });
t('anos com ata, do mais recente', () => assert.deepEqual(anosDasAtas(L), [2026, 2025]));
t('filtro por ano', () => assert.deepEqual(filtrarAtas(L, { ano: '2025' }).map((a) => a.id), [1]));
t('busca sem acento e sem maiúscula, no título e no resumo', () => {
  assert.deepEqual(filtrarAtas(L, { busca: 'eleicao SINDICO' }).map((a) => a.id), [1]);
  assert.deepEqual(filtrarAtas(L, { busca: 'piscina' }).map((a) => a.id), [4]);
  assert.deepEqual(filtrarAtas(L, { busca: 'extraordinária' }).map((a) => a.id), [2, 4]);
});
t('busca + ano combinados; vazio devolve tudo ordenado', () => {
  assert.deepEqual(filtrarAtas(L, { busca: 'ago', ano: '2026' }).map((a) => a.id), [3]);
  assert.equal(filtrarAtas(L).length, 4);
  assert.equal(filtrarAtas(L, { busca: 'inexistente' }).length, 0);
});
t('validarAta', () => {
  const ok = { titulo: 'AGO', data: '2026-03-10', resumo: '' };
  assert.equal(validarAta(ok, '2026-11-17'), null);
  assert.match(validarAta({ ...ok, titulo: '  ' }, '2026-11-17'), /título/);
  assert.match(validarAta({ ...ok, titulo: 'x'.repeat(121) }, '2026-11-17'), /120/);
  assert.match(validarAta({ ...ok, data: '' }, '2026-11-17'), /data/);
  assert.match(validarAta({ ...ok, data: '2026-11-18' }, '2026-11-17'), /futuro/);
  assert.equal(validarAta({ ...ok, data: '2026-11-17' }, '2026-11-17'), null, 'hoje é aceito');
  assert.match(validarAta({ ...ok, data: '1949-12-31' }, '2026-11-17'), /inválida/);
  assert.match(validarAta({ ...ok, resumo: 'a'.repeat(2001) }, '2026-11-17'), /2000/);
});
t('validarPdf: só PDF, até 10 MB, não vazio', () => {
  assert.match(validarPdf(null), /Selecione/);
  assert.equal(validarPdf({ type: 'application/pdf', size: 1000, name: 'a.pdf' }), null);
  assert.equal(validarPdf({ type: '', size: 1000, name: 'ATA.PDF' }), null, 'tipo vazio com extensão .pdf');
  assert.match(validarPdf({ type: 'image/jpeg', size: 1000, name: 'a.jpg' }), /PDF/);
  assert.match(validarPdf({ type: '', size: 1000, name: 'a.docx' }), /PDF/);
  assert.match(validarPdf({ type: 'application/pdf', size: 10 * 1024 * 1024 + 1, name: 'a.pdf' }), /10 MB/);
  assert.equal(validarPdf({ type: 'application/pdf', size: 10 * 1024 * 1024, name: 'a.pdf' }), null, '10 MB exatos');
  assert.match(validarPdf({ type: 'application/pdf', size: 0, name: 'a.pdf' }), /vazio/);
});
t('hojeLocal no formato AAAA-MM-DD', () => assert.equal(hojeLocal(new Date(2026, 0, 5, 23, 59)), '2026-01-05'));
t('tipos', () => assert.deepEqual(Object.keys(TIPOS_ATA), ['ordinaria', 'extraordinaria']));
console.log(`RESULTADO: TUDO OK (${n} testes)`);
