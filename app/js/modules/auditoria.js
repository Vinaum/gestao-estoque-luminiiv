// Transforma um registro de auditoria em texto legível (funções puras).
export const NOME_TABELA = { itens: 'Item', fornecedores: 'Fornecedor', compras: 'Compra', membros: 'Participante', condominio_config: 'Parâmetros', condominios: 'Condomínio', movimentacoes: 'Movimentação' };
export const NOME_ACAO = { insert: 'Criado', update: 'Alterado', delete: 'Removido', ajuste_estoque: 'Ajuste de estoque', estorno: 'Estorno' };
const CAMPOS = { nome: 'nome', estoque_minimo: 'mínimo', estoque_ideal: 'ideal', ativo: 'ativo', papel: 'papel', status: 'situação', localizacao: 'local',
  cnpj: 'CNPJ', faixa_atencao: 'faixa de atenção', venc_alerta_1: 'alerta 1 (dias)', venc_alerta_2: 'alerta 2 (dias)', numero_nf: 'nota fiscal', fornecedor_id: 'fornecedor' };
const IGNORAR = new Set(['criado_em', 'atualizado_em', 'id']);
const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));

export function resumo(reg) {
  const { antes, depois, acao } = reg;
  if (acao === 'update' && antes && depois) {
    const m = Object.keys(depois).filter((k) => !IGNORAR.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
      .map((k) => `${CAMPOS[k] ?? k}: ${fmt(antes[k])} → ${fmt(depois[k])}`);
    return m.length ? m.join('; ') : '(sem mudança visível)';
  }
  if (acao === 'insert' && depois) return depois.nome ? String(depois.nome) : '';
  if (acao === 'delete' && antes) return antes.nome ? String(antes.nome) : '';
  if (depois && depois.justificativa) return `${depois.sinal > 0 ? '+' : '−'}${depois.quantidade} — ${depois.justificativa}`;
  return '';
}
