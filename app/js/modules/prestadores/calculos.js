// Regras puras da área de prestadores (sem tela, sem banco).
export const MAX_NOME = 80, MAX_SERVICO = 40, MAX_OBS = 200, MAX_COMENTARIO = 200, MAX_PENDENTES = 5;

// Só dígitos; aceita +55. Devolve '' se não tiver 10 ou 11 dígitos (mesma regra do banco).
export function normalizarTelefone(txt) {
  const d = String(txt ?? '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) return d.slice(2);
  return /^\d{10,11}$/.test(d) ? d : '';
}

// (11) 98888-7777  ou  (11) 3888-7777
export function formatarTelefone(txt) {
  const d = normalizarTelefone(txt);
  if (!d) return String(txt ?? '');
  const ddd = d.slice(0, 2), resto = d.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

// Links montados só a partir dos dígitos (nada digitado pela pessoa vira endereço).
export const linkTel = (txt) => { const d = normalizarTelefone(txt); return d ? `tel:+55${d}` : ''; };
export const linkWhats = (txt) => { const d = normalizarTelefone(txt); return d ? `https://wa.me/55${d}` : ''; };

export function validarIndicacao({ nome, servico, telefone, observacao }) {
  const n = String(nome ?? '').trim(), s = String(servico ?? '').trim(), o = String(observacao ?? '').trim();
  if (n.length < 2 || n.length > MAX_NOME) return `Informe o nome (de 2 a ${MAX_NOME} caracteres).`;
  if (s.length < 2 || s.length > MAX_SERVICO) return `Informe o tipo de serviço (de 2 a ${MAX_SERVICO} caracteres).`;
  if (!normalizarTelefone(telefone)) return 'Telefone inválido: informe o DDD e o número.';
  if (o.length > MAX_OBS) return `A observação pode ter até ${MAX_OBS} caracteres.`;
  return '';
}

export const validarComentario = (txt) =>
  String(txt ?? '').trim().length > MAX_COMENTARIO ? `O comentário pode ter até ${MAX_COMENTARIO} caracteres.` : '';

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Tipos de serviço já usados (sem repetir, ignorando maiúsculas e acentos), em ordem alfabética.
export function sugestoesServico(lista) {
  const vistos = new Map();
  for (const p of lista) { const k = semAcento(p.servico.trim()); if (k && !vistos.has(k)) vistos.set(k, p.servico.trim()); }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Busca por nome, serviço ou observação; filtro opcional por serviço exato.
export function buscar(lista, texto = '', servico = '') {
  const q = semAcento(texto).trim(), sv = semAcento(servico);
  return lista.filter((p) => (!sv || semAcento(p.servico) === sv)
    && (!q || semAcento([p.nome, p.servico, p.observacao].join(' ')).includes(q)));
}

// Abas do síndico: publicados / aguardando / recusados e removidos. Os demais só veem "publicados" e "minhas".
export function filtrarAba(lista, aba) {
  if (aba === 'pendente') return lista.filter((p) => p.status === 'pendente');
  if (aba === 'encerrados') return lista.filter((p) => p.status === 'recusado' || p.status === 'removido');
  if (aba === 'minhas') return lista.filter((p) => p.meu && p.status !== 'publicado');
  return lista.filter((p) => p.status === 'publicado');
}
export const contar = (lista) => ({
  publicado: filtrarAba(lista, 'publicado').length, pendente: filtrarAba(lista, 'pendente').length,
  encerrados: filtrarAba(lista, 'encerrados').length, minhas: filtrarAba(lista, 'minhas').length,
});

export const rotuloRecomendacoes = (n) => (n === 0 ? 'Ainda sem recomendações' : n === 1 ? 'Recomendado por 1 morador' : `Recomendado por ${n} moradores`);
export const quemIndicou = (ind) => (ind?.unidade ? `${ind.nome} — ${ind.unidade}` : (ind?.nome ?? ''));
