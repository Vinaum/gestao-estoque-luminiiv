// Torres e apartamentos: carregamento, rótulos e lista de opções para seletores.
import { h, raw } from './html.js';
import { db } from './supabase.js';

const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });

export async function carregarEstrutura(condominioId) {
  const [t, a] = await Promise.all([
    db.from('torres').select('id,nome,ativo').eq('condominio_id', condominioId),
    db.from('apartamentos').select('id,torre_id,numero,ativo').eq('condominio_id', condominioId),
  ]);
  const falha = t.error || a.error;
  if (falha) throw new Error(falha.message);
  return {
    torres: [...t.data].sort((x, y) => natural(x.nome, y.nome)),
    aptos: [...a.data].sort((x, y) => natural(x.numero, y.numero)),
  };
}

// "Torre 2 · Apto 31", ou '' se não houver apartamento.
export function rotuloApto(apartamentoId, est) {
  if (!apartamentoId || !est) return '';
  const ap = est.aptos.find((a) => a.id === apartamentoId);
  if (!ap) return '';
  const t = est.torres.find((x) => x.id === ap.torre_id);
  return `${t ? t.nome : 'Torre ?'} · Apto ${ap.numero}`;
}

// <option>s agrupadas por torre. Mostra só apartamentos ativos (e o já escolhido, mesmo inativo).
export function opcoesApto(est, escolhido = '', textoVazio = 'Sem apartamento') {
  const grupos = est.torres.map((t) => {
    const itens = est.aptos.filter((a) => a.torre_id === t.id && (a.ativo || a.id === escolhido));
    return itens.length
      ? h`<optgroup label="${t.nome}">${itens.map((a) => h`<option value="${a.id}" ${a.id === escolhido ? raw('selected') : ''}>${t.nome} · Apto ${a.numero}</option>`)}</optgroup>`
      : '';
  });
  return h`<option value="">${textoVazio}</option>${grupos}`;
}
