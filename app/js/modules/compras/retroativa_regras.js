// Regras puras do lançamento de nota fiscal antiga (sem banco nem tela).
export const MAX_VALOR = 10000000;
export const TIPOS_NF = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const MAX_NF = 5 * 1024 * 1024;

// Lê valor em reais como as pessoas digitam: "1.234,56", "1234,56", "R$ 80", "80.50", "1.500".
// Devolve NaN se não for um número.
export function lerValorReais(txt) {
  let t = String(txt ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100) / 100;
}

// hoje = 'AAAA-MM-DD' local. Devolve a mensagem de erro ou null.
export function validarRetroativa({ data, valor }, hoje) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? ''))) return 'Informe a data da nota.';
  if (data > hoje) return 'A data da nota não pode ser no futuro.';
  if (data < '2000-01-01') return 'Data da nota inválida.';
  if (!Number.isFinite(valor) || valor <= 0) return 'Informe o valor da nota (maior que zero), como 1.234,56.';
  if (valor > MAX_VALOR) return 'Valor alto demais. Confira o número digitado.';
  return null;
}

// Arquivo da nota: PDF, JPG ou PNG até 5 MB. Devolve { ext } ou { erro }.
export function validarArquivoNF(arq) {
  const ext = TIPOS_NF[arq?.type] || (!arq?.type && /\.pdf$/i.test(arq?.name ?? '') ? 'pdf' : null);
  if (!ext) return { erro: 'Formato não aceito. Use PDF, JPG ou PNG.' };
  if (arq.size > MAX_NF) return { erro: 'Arquivo maior que 5 MB.' };
  if (!arq.size) return { erro: 'O arquivo está vazio.' };
  return { ext };
}

// Soma por categoria das compras retroativas (que não têm itens): usa a categoria da própria nota.
export function categoriasRetroativas(compras) {
  const por = {};
  compras.filter((c) => c.retroativa).forEach((c) => { const n = c.categoria || 'Sem categoria'; por[n] = (por[n] || 0) + Number(c.valor_total); });
  return por;
}
