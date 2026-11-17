export const num = (n, casas = 2) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });
export const moeda = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
export const dataHoraBR = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const PAPEL_ROTULO = { superadmin: 'Superadmin', sindico: 'Síndico', gestor: 'Gestor', morador: 'Morador' };
