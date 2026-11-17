import assert from 'node:assert/strict';
import { normalizarTelefone, formatarTelefone, linkTel, linkWhats, validarIndicacao, validarComentario,
  sugestoesServico, buscar, filtrarAba, contar, rotuloRecomendacoes, quemIndicou } from '../app/js/modules/prestadores/calculos.js';
let n = 0; const t = (nome, f) => { f(); n++; };

t('telefone: só dígitos, +55 e tamanhos', () => {
  assert.equal(normalizarTelefone('(11) 98888-7777'), '11988887777');
  assert.equal(normalizarTelefone('+55 11 98888 7777'), '11988887777');
  assert.equal(normalizarTelefone('1138887777'), '1138887777');
  for (const ruim of ['', '123', '119888877779', 'abc', null, undefined, '55119']) assert.equal(normalizarTelefone(ruim), '', String(ruim));
});
t('telefone formatado', () => {
  assert.equal(formatarTelefone('11988887777'), '(11) 98888-7777');
  assert.equal(formatarTelefone('1138887777'), '(11) 3888-7777');
  assert.equal(formatarTelefone('lixo'), 'lixo');
});
t('links vêm só dos dígitos (nada digitado vira endereço)', () => {
  assert.equal(linkTel('(11) 98888-7777'), 'tel:+5511988887777');
  assert.equal(linkWhats('(11) 98888-7777'), 'https://wa.me/5511988887777');
  assert.equal(linkWhats('javascript:alert(1)'), '');
  assert.equal(linkTel('http://x.com'), '');
  assert.ok(!linkWhats('11988887777"onmouseover="x').includes('"'));
});
t('validar indicação', () => {
  const ok = { nome: 'Carlos', servico: 'Marceneiro', telefone: '11988887777', observacao: '' };
  assert.equal(validarIndicacao(ok), '');
  assert.match(validarIndicacao({ ...ok, nome: 'A' }), /nome/);
  assert.match(validarIndicacao({ ...ok, servico: ' ' }), /serviço/);
  assert.match(validarIndicacao({ ...ok, telefone: '12' }), /Telefone/);
  assert.match(validarIndicacao({ ...ok, observacao: 'x'.repeat(201) }), /200/);
  assert.equal(validarIndicacao({ ...ok, observacao: 'x'.repeat(200) }), '');
  assert.match(validarIndicacao({ ...ok, nome: 'x'.repeat(81) }), /nome/);
});
t('comentário até 200', () => {
  assert.equal(validarComentario(''), ''); assert.equal(validarComentario('x'.repeat(200)), '');
  assert.match(validarComentario('x'.repeat(201)), /200/);
});
const L = [
  { id: 1, nome: 'Carlos', servico: 'Marceneiro', observacao: 'Pontual', status: 'publicado', meu: false },
  { id: 2, nome: 'Rita', servico: 'diarista', observacao: null, status: 'publicado', meu: false },
  { id: 3, nome: 'José Ação', servico: 'Diarista', observacao: '', status: 'pendente', meu: true },
  { id: 4, nome: 'Paulo', servico: 'Pedreiro', observacao: '', status: 'recusado', meu: true },
  { id: 5, nome: 'Lia', servico: 'Pedreiro', observacao: '', status: 'removido', meu: false },
];
t('sugestões de serviço sem repetir (acento/maiúscula)', () => {
  assert.deepEqual(sugestoesServico(L), ['diarista', 'Marceneiro', 'Pedreiro']);
});
t('busca ignora acento e maiúsculas, e filtra por serviço', () => {
  assert.deepEqual(buscar(L, 'acao').map((p) => p.id), [3]);
  assert.deepEqual(buscar(L, 'PONTUAL').map((p) => p.id), [1]);
  assert.deepEqual(buscar(L, '', 'DIARISTA').map((p) => p.id), [2, 3]);
  assert.deepEqual(buscar(L, 'rita', 'marceneiro'), []);
  assert.equal(buscar(L).length, 5);
});
t('abas e contagem', () => {
  assert.deepEqual(filtrarAba(L, 'publicado').map((p) => p.id), [1, 2]);
  assert.deepEqual(filtrarAba(L, 'pendente').map((p) => p.id), [3]);
  assert.deepEqual(filtrarAba(L, 'encerrados').map((p) => p.id), [4, 5]);
  assert.deepEqual(filtrarAba(L, 'minhas').map((p) => p.id), [3, 4]);
  assert.deepEqual(contar(L), { publicado: 2, pendente: 1, encerrados: 2, minhas: 2 });
});
t('textos', () => {
  assert.equal(rotuloRecomendacoes(0), 'Ainda sem recomendações'); assert.equal(rotuloRecomendacoes(1), 'Recomendado por 1 morador');
  assert.equal(rotuloRecomendacoes(4), 'Recomendado por 4 moradores');
  assert.equal(quemIndicou({ nome: 'Maria', unidade: 'Torre 2 · Apto 31' }), 'Maria — Torre 2 · Apto 31');
  assert.equal(quemIndicou({ nome: 'Maria', unidade: '' }), 'Maria');
});
console.log('RESULTADO: TUDO OK (' + n + ' testes)');
