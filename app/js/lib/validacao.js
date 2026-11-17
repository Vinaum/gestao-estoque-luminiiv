// Validações simples usadas nos formulários.
export const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

export function cnpjValido(txt) {
  const c = soDigitos(txt);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0, peso = base.length - 7;
    for (const d of base) { soma += Number(d) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11; return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}
export const formatarCnpj = (txt) => { const c = soDigitos(txt); return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : txt; };
export const emailValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
