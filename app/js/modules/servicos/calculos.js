// Regras puras de serviços contratados (sem banco nem tela).
export const PERIODICIDADE = { mensal: 'Mensal', quinzenal: 'Quinzenal', semanal: 'Semanal', por_visita: 'Por visita', avulso: 'Avulso' };
export const SITUACAO = { pago: ['Pago no mês', 'status-ok'], pendente: ['A pagar no mês', 'status-warn'], atrasado: ['Atrasado', 'status-crit'] };
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const p2 = (n) => String(n).padStart(2, '0');
export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const referenciaDoMes = (d = new Date()) => `${NOMES_MES[d.getMonth()]}/${d.getFullYear()}`;

// Só para serviço mensal e ativo: pago no mês corrente? Se não, atrasado depois do dia combinado.
export function situacaoDoMes(servico, pagamentos, hoje = new Date()) {
  if (!servico.ativo || servico.periodicidade !== 'mensal') return null;
  const mes = hojeISO(hoje).slice(0, 7);
  if (pagamentos.some((p) => p.servico_id === servico.id && String(p.data_pagamento).startsWith(mes))) return 'pago';
  return servico.dia_pagamento && hoje.getDate() > servico.dia_pagamento ? 'atrasado' : 'pendente';
}

// Último pagamento do serviço (mais recente pela data).
export function ultimoPagamento(servicoId, pagamentos) {
  return pagamentos.filter((p) => p.servico_id === servicoId)
    .sort((a, b) => String(b.data_pagamento).localeCompare(String(a.data_pagamento)))[0] ?? null;
}

// Totais pagos no mês e no ano corrente (todos os serviços).
export function totais(pagamentos, hoje = new Date()) {
  const iso = hojeISO(hoje), mes = iso.slice(0, 7), ano = iso.slice(0, 4);
  let noMes = 0, noAno = 0;
  for (const p of pagamentos) {
    const d = String(p.data_pagamento), v = Number(p.valor) || 0;
    if (d.startsWith(ano + '-')) noAno += v;
    if (d.startsWith(mes)) noMes += v;
  }
  return { noMes: Math.round(noMes * 100) / 100, noAno: Math.round(noAno * 100) / 100 };
}

// Pagamentos no formato das linhas de compra usadas no painel e nos relatórios de gastos
// (status 'recebido' para contar como gasto efetivado; a marca 'servico' diferencia na tela).
export function comoGastos(pagamentos, servicos) {
  const porId = Object.fromEntries(servicos.map((s) => [s.id, s]));
  return pagamentos.map((p) => {
    const s = porId[p.servico_id];
    return { compra_id: 'servico:' + p.id, data_compra: p.data_pagamento, fornecedor: s ? `${s.nome} (${s.servico})` : 'Serviço',
      numero_nf: p.numero_recibo || null, status: 'recebido', valor_total: Number(p.valor), servico: true, categoria: 'Serviços' };
  });
}

// Telefone em dígitos (10 ou 11) para links; aceita +55 e máscara.
export function telefoneDigitos(t) {
  let d = String(t ?? '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
  return /^\d{10,11}$/.test(d) ? d : '';
}
export const telefoneBR = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d);
