// Regras puras da área de atas (sem acesso a banco ou tela).
export const TIPOS_ATA = { ordinaria: 'Ordinária', extraordinaria: 'Extraordinária' };
export const MAX_TITULO = 120, MAX_RESUMO = 2000, MAX_PDF = 10 * 1024 * 1024;

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Mais recente primeiro; empate pela criação (mais nova antes).
export function ordenarAtas(lista) {
  return [...lista].sort((a, b) => String(b.data_assembleia).localeCompare(String(a.data_assembleia))
    || String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')));
}

// Anos que têm ata, do mais recente ao mais antigo.
export function anosDasAtas(lista) {
  return [...new Set(lista.map((a) => Number(String(a.data_assembleia).slice(0, 4))))].sort((x, y) => y - x);
}

// Busca no título e no resumo (sem diferenciar acento/maiúscula) e filtro de ano ('' = todos).
export function filtrarAtas(lista, { busca = '', ano = '' } = {}) {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  return ordenarAtas(lista).filter((a) => (!ano || String(a.data_assembleia).startsWith(String(ano) + '-'))
    && termos.every((t) => semAcento(`${a.titulo} ${a.resumo ?? ''} ${TIPOS_ATA[a.tipo] ?? ''}`).includes(t)));
}

// Validação do formulário. hoje = 'AAAA-MM-DD' local. Devolve a mensagem de erro ou null.
export function validarAta({ titulo, data, resumo }, hoje) {
  const t = String(titulo ?? '').trim();
  if (!t) return 'Informe o título.';
  if (t.length > MAX_TITULO) return `O título pode ter até ${MAX_TITULO} caracteres.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? ''))) return 'Informe a data da assembleia.';
  if (data > hoje) return 'A data da assembleia não pode ser no futuro.';
  if (data < '1950-01-01') return 'Data da assembleia inválida.';
  if (String(resumo ?? '').trim().length > MAX_RESUMO) return `O resumo pode ter até ${MAX_RESUMO} caracteres.`;
  return null;
}

// Só PDF, até 10 MB. Aceita também arquivo com tipo vazio mas extensão .pdf (alguns celulares).
export function validarPdf(arq) {
  if (!arq) return 'Selecione o PDF da ata.';
  const ehPdf = arq.type === 'application/pdf' || (!arq.type && /\.pdf$/i.test(arq.name ?? ''));
  if (!ehPdf) return 'A ata precisa ser um arquivo PDF.';
  if (arq.size > MAX_PDF) return 'Arquivo maior que 10 MB.';
  if (arq.size === 0) return 'O arquivo está vazio.';
  return null;
}

// Data local de hoje em 'AAAA-MM-DD'.
export function hojeLocal(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}
