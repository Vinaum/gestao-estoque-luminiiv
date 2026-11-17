-- ============================================================
-- 0018 — Excluir item da configuração de estoque
-- Só apaga item SEM histórico (nunca entrou em compra, lote ou
-- movimentação). Com histórico, o caminho é inativar.
-- Idempotente. Escrita só por função.
-- ============================================================
create or replace function public.excluir_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.itens%rowtype;
begin
  select * into v_item from public.itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_item.condominio_id, array['gestor', 'sindico']);

  if exists (select 1 from public.compra_itens where item_id = p_item_id)
     or exists (select 1 from public.lotes where item_id = p_item_id)
     or exists (select 1 from public.movimentacoes where item_id = p_item_id) then
    raise exception 'Este item já tem histórico (compras ou movimentações) e não pode ser excluído. Inative o item.'
      using errcode = '23503';
  end if;

  delete from public.itens where id = p_item_id;
exception when foreign_key_violation then
  raise exception 'Este item já tem histórico e não pode ser excluído. Inative o item.' using errcode = '23503';
end;
$$;

revoke all on function public.excluir_item(uuid) from public, anon;
grant execute on function public.excluir_item(uuid) to authenticated;
