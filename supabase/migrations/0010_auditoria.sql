-- ============================================================
-- 0010_auditoria — registro de alterações importantes
-- (Vem antes das regras de acesso, que mencionam esta tabela.)
-- ============================================================

create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  condominio_id uuid,
  tabela text not null,
  registro_id text,
  acao text not null,
  antes jsonb,
  depois jsonb,
  usuario_id uuid,
  em timestamptz not null default now()
);
create index if not exists auditoria_cond_idx on public.auditoria (condominio_id, em desc);
create index if not exists auditoria_reg_idx on public.auditoria (tabela, registro_id);

drop trigger if exists auditoria_imutavel on public.auditoria;
create trigger auditoria_imutavel
  before update or delete on public.auditoria
  for each row execute function app.bloquear_alteracao();

create or replace function app.registrar_auditoria(
  p_cond uuid, p_tabela text, p_registro text, p_acao text, p_antes jsonb, p_depois jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.auditoria (condominio_id, tabela, registro_id, acao, antes, depois, usuario_id)
  values (p_cond, p_tabela, p_registro, p_acao, p_antes, p_depois, auth.uid())
$$;

-- Gatilho genérico: grava antes/depois de cada alteração.
create or replace function app.auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref jsonb;
  v_cond uuid;
  v_reg text;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;
  v_ref := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_cond := coalesce((v_ref ->> 'condominio_id')::uuid,
                     case when tg_table_name = 'condominios' then (v_ref ->> 'id')::uuid end);
  v_reg := coalesce(v_ref ->> 'id', v_ref ->> 'user_id');

  insert into public.auditoria (condominio_id, tabela, registro_id, acao, antes, depois, usuario_id)
  values (
    v_cond, tg_table_name, v_reg, lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return null;
end;
$$;

do $$
declare
  v_tab text;
begin
  foreach v_tab in array array['itens', 'fornecedores', 'compras', 'membros', 'condominio_config', 'condominios']
  loop
    execute format('drop trigger if exists %I on public.%I', v_tab || '_auditar', v_tab);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.auditar()', v_tab || '_auditar', v_tab);
  end loop;
end $$;

-- Histórico dos níveis mínimo e ideal de cada item.
-- Visível a gestor e síndico do condomínio (a view filtra por papel).
create or replace view public.v_historico_parametros as
select
  a.id,
  a.condominio_id,
  a.registro_id::uuid as item_id,
  (a.antes ->> 'estoque_minimo')::numeric as minimo_anterior,
  (a.depois ->> 'estoque_minimo')::numeric as minimo_novo,
  (a.antes ->> 'estoque_ideal')::numeric as ideal_anterior,
  (a.depois ->> 'estoque_ideal')::numeric as ideal_novo,
  a.usuario_id,
  p.nome as usuario_nome,
  a.em
from public.auditoria a
left join public.profiles p on p.id = a.usuario_id
where a.tabela = 'itens'
  and a.acao = 'update'
  and ((a.antes ->> 'estoque_minimo') is distinct from (a.depois ->> 'estoque_minimo')
    or (a.antes ->> 'estoque_ideal') is distinct from (a.depois ->> 'estoque_ideal'))
  and app.tem_papel(a.condominio_id, array['gestor', 'sindico']);
