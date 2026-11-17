// Mapa das telas: quem pode ver cada uma e onde está o código.
// `modulo` vazio = ainda não construída (mostra "Em construção").
const EQUIPE = ['gestor', 'sindico', 'superadmin'];
const SINDICO = ['sindico', 'superadmin'];

export const ROTAS = [
  { id: 'painel',         titulo: 'Painel do síndico',      papeis: SINDICO, grupo: '', modulo: './modules/painel/painel.js' },
  { id: 'aprovacoes',     titulo: 'Aprovações',             papeis: SINDICO, grupo: '', modulo: './modules/compras/aprovacoes.js' },
  { id: 'operacao',       titulo: 'Operação diária',        papeis: EQUIPE,  grupo: 'Estoque', modulo: './modules/operacao/operacao.js' },
  { id: 'estoque',        titulo: 'Estoque atual',          papeis: EQUIPE,  grupo: 'Estoque' , modulo: './modules/estoque/estoque.js' },
  { id: 'config-estoque', titulo: 'Configuração de estoque',papeis: EQUIPE,  grupo: 'Estoque' , modulo: './modules/config-estoque/config-estoque.js' },
  { id: 'compras',        titulo: 'Central de compras',     papeis: EQUIPE,  grupo: 'Compras', modulo: './modules/compras/compras.js' },
  { id: 'fornecedores',   titulo: 'Fornecedores',           papeis: EQUIPE,  grupo: 'Compras', modulo: './modules/fornecedores/fornecedores.js' },
  { id: 'consumo',        titulo: 'Consumo',                papeis: EQUIPE,  grupo: 'Análises' },
  { id: 'gastos',         titulo: 'Relatórios de gastos',   papeis: SINDICO, grupo: 'Análises' },
  { id: 'usuarios',       titulo: 'Usuários',               papeis: SINDICO, grupo: 'Condomínio' },
  { id: 'admin',          titulo: 'Administração',          papeis: ['superadmin'], grupo: 'Sistema' },
  { id: 'inicio',         titulo: 'Início',                 papeis: ['morador'], grupo: '', modulo: './modules/boasvindas/boasvindas.js' },
];

export const PADRAO = { superadmin: 'admin', sindico: 'painel', gestor: 'operacao', morador: 'inicio' };
export const rotasDoPapel = (papel) => ROTAS.filter((r) => r.papeis.includes(papel));
