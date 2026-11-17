-- ============================================================
-- 0014_fornecedor_ativo — só o síndico (ou superadmin) ativa/desativa fornecedor
-- O gestor continua cadastrando e editando fornecedores, mas não muda a situação
-- (ativo/inativo), nem cria um fornecedor já inativo. Operações do SQL Editor
-- (sem usuário logado) continuam permitidas. Pode ser repetida sem dano.
-- ============================================================

create or replace function app.travar_ativo_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.ativo is distinct from true)
     or (tg_op = 'UPDATE' and new.ativo is distinct from old.ativo) then
    if not app.tem_papel(new.condominio_id, array['sindico']) then
      raise exception 'Só o síndico ativa ou desativa fornecedores.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists fornecedores_ativo on public.fornecedores;
create trigger fornecedores_ativo
  before insert or update on public.fornecedores
  for each row execute function app.travar_ativo_fornecedor();
