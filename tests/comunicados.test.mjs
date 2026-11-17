import assert from 'node:assert/strict';
import { paraInicio, ordenar, vencido, contar, filtrarAba, resumo, validarDados, validarArquivo, nomeArquivo, expiraISO, dataParaCampo, TIPOS } from '../app/js/modules/comunicados/calculos.js';
let n = 0; const t = (nome, fn) => { fn(); n++; console.log('OK   ' + nome); };

t('ordenar: fixados primeiro, depois o mais recente', () => {
  const l = [
    { id: 'a', publicado_em: '2026-11-01T10:00:00Z' },
    { id: 'b', publicado_em: '2026-11-10T10:00:00Z' },
    { id: 'c', publicado_em: '2026-10-01T10:00:00Z', fixado: true },
    { id: 'd', publicado_em: '2026-10-20T10:00:00Z', fixado: true },
  ];
  assert.deepEqual(ordenar(l).map((x) => x.id), ['d', 'c', 'b', 'a']);
});
t('ordenar: rascunho sem data usa a criação e não altera a lista original', () => {
  const l = [{ id: 'x', criado_em: '2026-11-01T00:00:00Z' }, { id: 'y', criado_em: '2026-11-05T00:00:00Z' }];
  assert.deepEqual(ordenar(l).map((x) => x.id), ['y', 'x']);
  assert.deepEqual(l.map((x) => x.id), ['x', 'y']);
});
t('vencido: só quando há data e ela já passou', () => {
  const agora = new Date('2026-11-17T12:00:00Z');
  assert.equal(vencido({ expira_em: null }, agora), false);
  assert.equal(vencido({ expira_em: '2026-11-17T12:00:01Z' }, agora), false);
  assert.equal(vencido({ expira_em: '2026-11-17T12:00:00Z' }, agora), true);
  assert.equal(vencido({ expira_em: '2026-11-01T00:00:00Z' }, agora), true);
});
t('contar e filtrarAba por situação', () => {
  const l = [{ id: 1, status: 'publicado' }, { id: 2, status: 'rascunho' }, { id: 3, status: 'publicado' }, { id: 4, status: 'arquivado' }, { id: 5, status: 'estranho' }];
  assert.deepEqual(contar(l), { publicado: 2, rascunho: 1, arquivado: 1 });
  assert.deepEqual(filtrarAba(l, 'publicado').map((x) => x.id).sort(), [1, 3]);
});
t('resumo: uma linha, corta com reticências', () => {
  assert.equal(resumo('  Olá\n\n   mundo  '), 'Olá mundo');
  assert.equal(resumo('a'.repeat(300)).length, 160);
  assert.ok(resumo('a'.repeat(300)).endsWith('…'));
  assert.equal(resumo(null), '');
});
t('resumo não interpreta HTML: devolve o texto como está', () => {
  assert.equal(resumo('<script>alert(1)</script>'), '<script>alert(1)</script>');
});
t('validarDados: título e texto obrigatórios e com limite', () => {
  assert.match(validarDados({ titulo: '  ', corpo: 'x' }), /título/);
  assert.match(validarDados({ titulo: 'a'.repeat(121), corpo: 'x' }), /120/);
  assert.match(validarDados({ titulo: 'ok', corpo: ' ' }), /texto/);
  assert.match(validarDados({ titulo: 'ok', corpo: 'a'.repeat(5001) }), /5000/);
  assert.equal(validarDados({ titulo: 'a'.repeat(120), corpo: 'a'.repeat(5000) }), null);
});
t('validarArquivo: PDF, JPG e PNG até 5 MB', () => {
  assert.deepEqual(validarArquivo({ type: 'application/pdf', size: 10 }), { ext: 'pdf' });
  assert.deepEqual(validarArquivo({ type: 'image/jpeg', size: 10 }), { ext: 'jpg' });
  assert.deepEqual(validarArquivo({ type: 'image/png', size: 5 * 1024 * 1024 }), { ext: 'png' });
  assert.match(validarArquivo({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }).erro, /5 MB/);
  assert.match(validarArquivo({ type: 'text/html', size: 10 }).erro, /Formato/);
  assert.match(validarArquivo({ type: 'application/x-msdownload', size: 10 }).erro, /Formato/);
  assert.match(validarArquivo(undefined).erro, /Formato/);
});
t('nomeArquivo: limita a 120 caracteres mantendo a extensão', () => {
  assert.equal(nomeArquivo('  ata.pdf '), 'ata.pdf');
  const longo = nomeArquivo('a'.repeat(200) + '.pdf');
  assert.equal(longo.length, 120); assert.ok(longo.endsWith('.pdf'));
  assert.equal(nomeArquivo(''), 'anexo');
});
t('expiraISO: vazio, inválida, passada e futura', () => {
  const agora = new Date(2026, 10, 17, 10, 0, 0);
  assert.deepEqual(expiraISO('', agora), { iso: null });
  assert.match(expiraISO('17/11/2026', agora).erro, /inválida/);
  assert.match(expiraISO('2026-02-31', agora).erro, /inválida/);
  assert.match(expiraISO('2026-11-16', agora).erro, /já passou/);
  const hoje = expiraISO('2026-11-17', agora);
  assert.ok(hoje.iso, 'hoje vale até o fim do dia');
  assert.equal(new Date(hoje.iso).getHours(), 23);
  assert.equal(dataParaCampo(hoje.iso), '2026-11-17');
});
t('dataParaCampo: vazio e valor', () => {
  assert.equal(dataParaCampo(null), '');
  assert.equal(dataParaCampo(new Date(2026, 0, 5, 23, 59, 59).toISOString()), '2026-01-05');
});
t('tipos conhecidos', () => assert.deepEqual(Object.keys(TIPOS), ['aviso', 'manutencao', 'assembleia', 'obra', 'outros']));

// Início do morador
{
  const agora = new Date('2026-11-15T12:00:00Z');
  const mk = (id, extra = {}) => ({ id, status: 'publicado', publicado_em: '2026-11-1' + id + 'T12:00:00Z', expira_em: null, fixado: false, ...extra });
  const L = [mk(1), mk(2), mk(3), mk(4), mk(5, { fixado: true }), mk(6, { status: 'rascunho' }), mk(7, { status: 'arquivado' }), mk(8, { expira_em: '2020-01-01T00:00:00Z' })];
  const r = paraInicio(L, new Set([1]), { agora });
  assert.equal(r.total, 5, 'só publicados e vigentes');
  assert.equal(r.novos, 4, 'o lido não conta');
  assert.deepEqual(r.itens.map((x) => x.id), [5, 4, 3], 'fixado primeiro, depois os mais recentes, no máximo 3');
  assert.equal(paraInicio([], new Set(), { agora }).total, 0);
  assert.equal(paraInicio(L, new Set(L.map((x) => x.id)), { agora }).novos, 0);
}
console.log(`RESULTADO: TUDO OK (${n} testes)`);
