// Estado global mínimo: quem está logado e em qual condomínio.
const guardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

export const estado = {
  sessao: null,
  perfil: null,        // { id, nome, superadmin }
  condominios: [],     // [{ id, nome, ativo }] — os que a pessoa enxerga
  vinculos: {},        // { condominio_id: papel }
  condominioId: null,
};

export const ehSuperadmin = () => !!estado.perfil?.superadmin;
export const condominioAtual = () => estado.condominios.find((c) => c.id === estado.condominioId) || null;

// Papel efetivo no condomínio escolhido: superadmin | sindico | gestor | morador | null
export function papelAtual() {
  if (ehSuperadmin()) return 'superadmin';
  return estado.vinculos[estado.condominioId] || null;
}

export function escolherCondominio(id) {
  estado.condominioId = id;
  guardar('condominio_id', id);
}

export function definirContexto({ perfil, condominios, vinculos }) {
  estado.perfil = perfil;
  estado.condominios = condominios;
  estado.vinculos = vinculos;
  const lembrado = guardado('condominio_id');
  const valido = (id) => condominios.some((c) => c.id === id);
  estado.condominioId = valido(lembrado) ? lembrado : (condominios[0]?.id ?? null);
}

export function limparContexto() {
  estado.sessao = null; estado.perfil = null; estado.condominios = []; estado.vinculos = {}; estado.condominioId = null;
}
