-- ============================================================
-- 0002_tenancy — condomínios, vínculos e convites
-- Preserva o que já existe: não remove profiles.papel (isso é a 0099).
-- Copia os usuários atuais para o primeiro condomínio.
-- ============================================================

create table if not exists public.condominios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  cnpj text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Perfil de cada pessoa (um por conta de login).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists superadmin boolean not null default false;

-- Quem participa de qual condomínio, e com qual papel.
create table if not exists public.membros (
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('sindico', 'gestor', 'morador')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  primary key (condominio_id, user_id)
);
create index if not exists membros_user_idx on public.membros (user_id);

-- Convites pendentes (e-mails ainda sem conta confirmada).
create table if not exists public.convites (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  email text not null,
  papel text not null check (papel in ('sindico', 'gestor', 'morador')),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  usado_por uuid references auth.users(id) on delete set null
);
create unique index if not exists convites_pendente_uk
  on public.convites (condominio_id, lower(email)) where usado_em is null;

-- Parâmetros de cada condomínio.
create table if not exists public.condominio_config (
  condominio_id uuid primary key references public.condominios(id) on delete cascade,
  faixa_atencao numeric not null default 0.25 check (faixa_atencao >= 0),
  venc_alerta_1 int not null default 30 check (venc_alerta_1 > 0),
  venc_alerta_2 int not null default 90 check (venc_alerta_2 > 0)
);

create or replace function app.criar_config_condominio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.condominio_config (condominio_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists condominios_config on public.condominios;
create trigger condominios_config
  after insert on public.condominios
  for each row execute function app.criar_config_condominio();

-- ---------- Funções de permissão (usadas pelas regras de acesso) ----------
create or replace function app.eh_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.superadmin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app.papel_no(p_cond uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.papel from public.membros m
  where m.condominio_id = p_cond and m.user_id = auth.uid() and m.ativo
$$;

create or replace function app.eh_membro(p_cond uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.eh_superadmin() or exists (
    select 1 from public.membros m
    where m.condominio_id = p_cond and m.user_id = auth.uid() and m.ativo
  )
$$;

-- Superadmin passa em qualquer verificação; os demais precisam ter um dos papéis.
create or replace function app.tem_papel(p_cond uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.eh_superadmin() or coalesce(app.papel_no(p_cond) = any (p_papeis), false)
$$;

create or replace function app.exigir(p_cond uuid, p_papeis text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_cond is null or not app.tem_papel(p_cond, p_papeis) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
end;
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------- Perfil e convites no cadastro ----------
-- Substitui a função antiga (o gatilho on_auth_user_created continua o mesmo).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Convites só valem depois que o e-mail é CONFIRMADO (evita que alguém
-- cadastre um e-mail alheio para herdar o convite).
create or replace function app.consumir_convites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;

  insert into public.membros (condominio_id, user_id, papel)
  select c.condominio_id, new.id, c.papel
  from public.convites c
  where lower(c.email) = lower(new.email) and c.usado_em is null
  on conflict (condominio_id, user_id) do nothing;

  update public.convites
     set usado_em = now(), usado_por = new.id
   where lower(email) = lower(new.email) and usado_em is null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function app.consumir_convites();

-- Ninguém promove a si mesmo a superadmin (nem troca o id).
create or replace function app.proteger_perfil()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'O identificador do perfil não pode ser alterado.' using errcode = '55000';
  end if;
  if new.superadmin is distinct from old.superadmin then
    -- sem usuário logado = SQL Editor / chave de serviço (operação administrativa)
    if auth.uid() is null then
      return new;
    end if;
    if app.eh_superadmin() and auth.uid() <> old.id then
      return new;
    end if;
    raise exception 'Sem permissão para alterar este campo.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_proteger on public.profiles;
create trigger profiles_proteger
  before update on public.profiles
  for each row execute function app.proteger_perfil();

-- ---------- Migração dos dados atuais (só se existir o modelo antigo) ----------
do $$
declare
  v_cond uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'papel'
  ) then
    select id into v_cond from public.condominios order by criado_em limit 1;
    if v_cond is null then
      insert into public.condominios (nome) values ('Meu condomínio') returning id into v_cond;
    end if;

    execute 'update public.profiles set superadmin = true where papel = ''superadmin''';

    execute format($f$
      insert into public.membros (condominio_id, user_id, papel)
      select %L::uuid, id,
             case papel when 'sindico' then 'sindico' when 'gestor' then 'gestor' else 'morador' end
      from public.profiles
      where papel <> 'superadmin'
      on conflict (condominio_id, user_id) do nothing
    $f$, v_cond);
  end if;
end $$;
