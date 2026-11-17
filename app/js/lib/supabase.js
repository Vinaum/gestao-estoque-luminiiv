import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export let db = null;

export function iniciarCliente() {
  if (!window.supabase) throw new Error('A biblioteca do Supabase não carregou. Verifique a internet ou bloqueadores de scripts.');
  try { new URL(SUPABASE_URL); } catch { throw new Error('SUPABASE_URL inválida em js/config.js.'); }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return db;
}

// Chama uma função do banco e lança erro legível se falhar.
export async function rpc(nome, args) {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data;
}

export function comTempo(promessa, ms, rotulo) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado ao ' + rotulo + '. Verifique a internet e se o projeto do Supabase está ativo (não pausado).')), ms)),
  ]);
}
