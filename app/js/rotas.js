// Mapa das telas: quem pode ver cada uma e onde está o código.
// `modulo` vazio = ainda não construída (mostra "Em construção").
const EQUIPE = ['gestor', 'sindico', 'superadmin'];
const SINDICO = ['sindico', 'superadmin'];

export const ROTAS = [
  { id: 'painel',         titulo: 'Painel',                papeis: EQUIPE, grupo: '', modulo: './modules/painel/painel.js' },
  { id: 'aprovacoes',     titulo: 'Aprovações',             papeis: SINDICO, grupo: '', modulo: './modules/compras/aprovacoes.js' },
  { id: 'operacao',       titulo: 'Operação diária',        papeis: EQUIPE,  grupo: 'Estoque', modulo: './modules/operacao/operacao.js' },
  { id: 'estoque',        titulo: 'Estoque atual',          papeis: EQUIPE,  grupo: 'Estoque' , modulo: './modules/estoque/estoque.js' },
  { id: 'config-estoque', titulo: 'Configuração de estoque',papeis: EQUIPE,  grupo: 'Estoque' , modulo: './modules/config-estoque/config-estoque.js' },
  { id: 'compras',        titulo: 'Central de compras',     papeis: EQUIPE,  grupo: 'Compras', modulo: './modules/compras/compras.js' },
  { id: 'fornecedores',   titulo: 'Fornecedores',           papeis: EQUIPE,  grupo: 'Compras', modulo: './modules/fornecedores/fornecedores.js' },
  { id: 'consumo',        titulo: 'Consumo',                papeis: EQUIPE,  grupo: 'Análises', modulo: './modules/relatorios/consumo.js' },
  { id: 'gastos',         titulo: 'Relatórios de gastos',   papeis: EQUIPE, grupo: 'Análises', modulo: './modules/relatorios/gastos.js' },
  { id: 'comunicados',     titulo: 'Comunicados',            papeis: ['gestor', 'sindico', 'superadmin', 'morador'], grupo: 'Comunidade', modulo: './modules/comunicados/comunicados.js' },
  { id: 'prestadores',     titulo: 'Prestadores',            papeis: ['gestor', 'sindico', 'superadmin', 'morador'], grupo: 'Comunidade', modulo: './modules/prestadores/prestadores.js' },
  { id: 'usuarios',       titulo: 'Usuários',               papeis: SINDICO, grupo: 'Condomínio', modulo: './modules/usuarios/usuarios.js' },
  { id: 'torres',          titulo: 'Torres e apartamentos',  papeis: SINDICO, grupo: 'Condomínio', modulo: './modules/torres/torres.js' },
  { id: 'admin',          titulo: 'Administração',          papeis: ['superadmin'], grupo: 'Sistema', modulo: './modules/admin/admin.js' },
  { id: 'inicio',         titulo: 'Início',                 papeis: ['morador'], grupo: '', modulo: './modules/boasvindas/boasvindas.js' },
];

export const PADRAO = { superadmin: 'admin', sindico: 'painel', gestor: 'operacao', morador: 'comunicados' };
export const rotasDoPapel = (papel) => ROTAS.filter((r) => r.papeis.includes(papel));
