// Regras puras dos comunicados (sem navegador nem banco), para ficarem testáveis.

export const TIPOS = { aviso: 'Aviso', manutencao: 'Manutenção', assembleia: 'Assembleia', obra: 'Obra', outros: 'Outros' };
export const TIPOS_ARQ = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const MAX_ARQ = 5 * 1024 * 1024;
export const MAX_TITULO = 120;
export const MAX_TEXTO = 5000;

const quando = (c) => new Date(c.publicado_em || c.criado_em || 0).getTime();

// Fixados primeiro; dentro de cada grupo, o mais recente primeiro.
export function ordenar(lista) {
  return [...lista].sort((a, b) => (Number(!!b.fixado) - Number(!!a.fixado)) || (quando(b) - quando(a)));
}

export const vencido = (c, agora = new Date()) => !!c.expira_em && new Date(c.expira_em).getTime() <= agora.getTime();

export function contar(lista) {
  const n = { publicado: 0, rascunho: 0, arquivado: 0 };
  for (const c of lista) if (c.status in n) n[c.status] += 1;
  return n;
}
export const filtrarAba = (lista, aba) => ordenar(lista.filter((c) => c.status === aba));

// Primeiras palavras do texto, em uma linha só.
export function resumo(texto, max = 160) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

export function validarDados({ titulo, corpo }) {
  const t = String(titulo ?? '').trim(), c = String(corpo ?? '').trim();
  if (!t) return 'Informe o título.';
  if (t.length > MAX_TITULO) return `O título pode ter até ${MAX_TITULO} caracteres.`;
  if (!c) return 'Escreva o texto do comunicado.';
  if (c.length > MAX_TEXTO) return `O texto pode ter até ${MAX_TEXTO} caracteres.`;
  return null;
}

// { ext } se o arquivo serve; { erro } se não.
export function validarArquivo(arq) {
  const ext = TIPOS_ARQ[arq?.type];
  if (!ext) return { erro: 'Formato não aceito. Use PDF, JPG ou PNG.' };
  if (arq.size > MAX_ARQ) return { erro: 'Arquivo maior que 5 MB.' };
  return { ext };
}

// Nome de exibição do anexo: sem espaços nas pontas e até 120 caracteres, preservando a extensão.
export function nomeArquivo(nome) {
  const n = String(nome ?? '').trim() || 'anexo';
  if (n.length <= 120) return n;
  const ponto = n.lastIndexOf('.');
  const ext = ponto > 0 && n.length - ponto <= 10 ? n.slice(ponto) : '';
  return n.slice(0, 120 - ext.length) + ext;
}

// 'AAAA-MM-DD' (campo de data) → fim desse dia no horário local, em ISO. Vazio = sem validade.
export function expiraISO(texto, agora = new Date()) {
  const t = String(texto ?? '').trim();
  if (!t) return { iso: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return { erro: 'Data inválida.' };
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(a, mes - 1, d, 23, 59, 59);
  if (dt.getFullYear() !== a || dt.getMonth() !== mes - 1 || dt.getDate() !== d) return { erro: 'Data inválida.' };
  if (dt.getTime() <= agora.getTime()) return { erro: 'A data para deixar de aparecer já passou.' };
  return { iso: dt.toISOString() };
}

// ISO → 'AAAA-MM-DD' no horário local, para preencher o campo de data.
export function dataParaCampo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Para o Início do morador: comunicados publicados e dentro da validade (fixados primeiro),
// quantos ainda não foram abertos e os `max` primeiros para mostrar.
export function paraInicio(lista, lidos, { agora = new Date(), max = 3 } = {}) {
  const vigentes = ordenar(lista.filter((c) => c.status === 'publicado' && !vencido(c, agora)));
  const novos = vigentes.filter((c) => !lidos.has(c.id));
  return { itens: vigentes.slice(0, max), novos: novos.length, total: vigentes.length, ehNovo: (c) => !lidos.has(c.id) };
}
