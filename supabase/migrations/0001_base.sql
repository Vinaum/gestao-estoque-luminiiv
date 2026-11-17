-- ============================================================
-- 0001_base — fundamentos
-- Cria o esquema interno "app" (funções auxiliares que NÃO ficam
-- expostas pela API) e utilitários genéricos de segurança.
-- Não apaga nada. Pode ser rodada mais de uma vez.
-- ============================================================

create extension if not exists pgcrypto;

-- Esquema interno: o Supabase só expõe "public" pela API.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;
revoke all on schema app from anon;

-- Impede que um registro seja alterado ou apagado (livro-razão, auditoria).
create or replace function app.bloquear_alteracao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Este registro não pode ser alterado nem apagado (%).', tg_table_name
    using errcode = '55000';
end;
$$;

-- Impede que colunas específicas mudem depois da criação.
-- Uso: create trigger ... execute function app.travar_colunas('condominio_id','criado_por');
create or replace function app.travar_colunas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
      raise exception 'A coluna % não pode ser alterada.', v_col using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;

-- Converte texto em uuid sem dar erro (devolve nulo se for inválido).
create or replace function app.uuid_ou_nulo(p_texto text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end;
$$;
