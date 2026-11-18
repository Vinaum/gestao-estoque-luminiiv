// Regras puras de ferramentas e patrimônio (itens permanentes).
export const CONSERVACAO = {
  bom: ['Em bom estado', 'status-ok'],
  reparo: ['Precisa de reparo', 'status-warn'],
  inutilizavel: ['Sem uso / quebrado', 'status-crit'],
};

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Só itens permanentes; inativos só se pedidos. Busca em nome, categoria, local e descrição.
export function filtrarPatrimonio(itens, { busca = '', conservacao = '', inativos = false } = {}) {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  return itens
    .filter((i) => i.permanente && (inativos || i.ativo) && (!conservacao || i.conservacao === conservacao))
    .filter((i) => termos.every((t) => semAcento(`${i.nome} ${i.categoria ?? ''} ${i.localizacao ?? ''} ${i.descricao ?? ''}`).includes(t)))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Contagem para os cartões (só ativos): itens, unidades e por estado de conservação.
export function resumoPatrimonio(itens) {
  const ativos = itens.filter((i) => i.permanente && i.ativo);
  const r = { itens: ativos.length, unidades: 0, bom: 0, reparo: 0, inutilizavel: 0 };
  for (const i of ativos) { r.unidades += Number(i.estoque_atual) || 0; if (i.conservacao in CONSERVACAO) r[i.conservacao]++; }
  return r;
}
