-- ============================================================
-- 0015_torres_apartamentos — estrutura física do condomínio e vínculo dos moradores
--
--   * torres e apartamentos de cada condomínio (nada é apagado, só desativado)
--   * membros e convites passam a ter um apartamento (opcional)
--   * leitura: qualquer pessoa ativa do condomínio; escrita: SÓ por função, do síndico
--   * convidar_membro ganha o parâmetro opcional p_apartamento_id
-- Pode ser repetida sem dano. Não altera dados existentes.
-- ============================================================

-- ---------- Tabelas ----------
create table if not exists public.torres (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  nome text not null check (length(trim(nome)) between 1 and 40),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (id, condominio_id)
);
create unique index if not exists torres_nome_uk on public.torres (condominio_id, lower(nome));

create table if not exists public.apartamentos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  torre_id uuid not null,
  numero text not null check (numero ~ '^[0-9A-Za-z]{1,6}$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (id, condominio_id),
  unique (torre_id, numero),
  foreign key (torre_id, condominio_id) references public.torres (id, condominio_id) on delete restrict
);

-- Apartamento da pessoa e do convite (o par id+condomínio impede apontar para outro condomínio).
alter table public.membros add column if not exists apartamento_id uuid;
alter table public.convites add column if not exists apartamento_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membros_apartamento_fk') then
    alter table public.membros add constraint membros_apartamento_fk
      foreign key (apartamento_id, condominio_id) references public.apartamentos (id, condominio_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'convites_apartamento_fk') then
    alter table public.convites add constraint convites_apartamento_fk
      foreign key (apartamento_id, condominio_id) references public.apartamentos (id, condominio_id) on delete restrict;
  end if;
end $$;
create index if not exists membros_apto_idx on public.membros (apartamento_id) where apartamento_id is not null;

-- ---------- Acesso ----------
alter table public.torres enable row level security;
alter table public.apartamentos enable row level security;
revoke all on public.torres, public.apartamentos from anon, authenticated;
grant select on public.torres, public.apartamentos to authenticated;

drop policy if exists torres_ler on public.torres;
create policy torres_ler on public.torres for select to authenticated using (app.eh_membro(condominio_id));
drop policy if exists apartamentos_ler on public.apartamentos;
create policy apartamentos_ler on public.apartamentos for select to authenticated using (app.eh_membro(condominio_id));

-- Histórico de alterações
do $$
declare
  v_tab text;
begin
  foreach v_tab in array array['torres', 'apartamentos']
  loop
    execute format('drop trigger if exists %I on public.%I', v_tab || '_auditar', v_tab);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.auditar()', v_tab || '_auditar', v_tab);
  end loop;
end $$;

-- ---------- Funções (só o síndico, ou o superadmin) ----------
create or replace function public.criar_torres_lote(p_condominio_id uuid, p_quantidade int, p_prefixo text default 'Torre')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefixo text := trim(coalesce(p_prefixo, ''));
  v_novas int := 0;
  v_i int;
  v_linhas int;
begin
  perform app.exigir(p_condominio_id, array['sindico']);
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 20 then
    raise exception 'Informe de 1 a 20 torres.' using errcode = '22023';
  end if;
  if length(v_prefixo) < 1 or length(v_prefixo) > 30 then
    raise exception 'O nome da torre deve ter de 1 a 30 letras.' using errcode = '22023';
  end if;
  for v_i in 1..p_quantidade loop
    insert into public.torres (condominio_id, nome) values (p_condominio_id, v_prefixo || ' ' || v_i)
    on conflict (condominio_id, lower(nome)) do nothing;
    get diagnostics v_linhas = row_count;
    v_novas := v_novas + v_linhas;
  end loop;
  return v_novas;
end;
$$;

create or replace function public.salvar_torre(p_condominio_id uuid, p_torre_id uuid, p_nome text, p_ativo boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico']);
  if length(v_nome) < 1 or length(v_nome) > 40 then
    raise exception 'O nome da torre deve ter de 1 a 40 letras.' using errcode = '22023';
  end if;
  if p_torre_id is null then
    insert into public.torres (condominio_id, nome) values (p_condominio_id, v_nome) returning id into v_id;
    return v_id;
  end if;
  if not exists (select 1 from public.torres where id = p_torre_id and condominio_id = p_condominio_id) then
    raise exception 'Torre não encontrada neste condomínio.' using errcode = 'P0002';
  end if;
  if p_ativo is false and exists (
       select 1 from public.membros m join public.apartamentos a on a.id = m.apartamento_id
       where a.torre_id = p_torre_id) then
    raise exception 'Há moradores vinculados a apartamentos desta torre. Mude o apartamento deles antes de desativá-la.' using errcode = '23514';
  end if;
  update public.torres set nome = v_nome, ativo = coalesce(p_ativo, true)
   where id = p_torre_id and condominio_id = p_condominio_id;
  return p_torre_id;
exception when unique_violation then
  raise exception 'Já existe uma torre com este nome.' using errcode = '23505';
end;
$$;

create or replace function public.gerar_apartamentos(p_torre_id uuid, p_andar_inicial int, p_andar_final int, p_por_andar int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torre public.torres%rowtype;
  v_novos int := 0;
  v_andar int;
  v_n int;
  v_linhas int;
begin
  select * into v_torre from public.torres where id = p_torre_id;
  if not found then
    raise exception 'Torre não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_torre.condominio_id, array['sindico']);
  if not v_torre.ativo then
    raise exception 'Esta torre está desativada.' using errcode = '23514';
  end if;
  if p_andar_inicial is null or p_andar_final is null or p_andar_inicial < 0 or p_andar_final > 30
     or p_andar_final < p_andar_inicial then
    raise exception 'Andares inválidos: use de 0 a 30, e o final não pode ser menor que o inicial.' using errcode = '22023';
  end if;
  if p_por_andar is null or p_por_andar < 1 or p_por_andar > 9 then
    raise exception 'Informe de 1 a 9 apartamentos por andar.' using errcode = '22023';
  end if;
  if (p_andar_final - p_andar_inicial + 1) * p_por_andar > 200 then
    raise exception 'São no máximo 200 apartamentos por vez.' using errcode = '22023';
  end if;
  -- Numeração: andar × 10 + posição. Térreo: 01, 02…; 1º andar: 11, 12…; 2º: 21, 22…
  for v_andar in p_andar_inicial..p_andar_final loop
    for v_n in 1..p_por_andar loop
      insert into public.apartamentos (condominio_id, torre_id, numero)
      values (v_torre.condominio_id, v_torre.id, lpad((v_andar * 10 + v_n)::text, 2, '0'))
      on conflict (torre_id, numero) do nothing;
      get diagnostics v_linhas = row_count;
      v_novos := v_novos + v_linhas;
    end loop;
  end loop;
  return v_novos;
end;
$$;

create or replace function public.salvar_apartamento(p_torre_id uuid, p_numero text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_torre public.torres%rowtype;
  v_numero text := trim(coalesce(p_numero, ''));
  v_id uuid;
begin
  select * into v_torre from public.torres where id = p_torre_id;
  if not found then
    raise exception 'Torre não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_torre.condominio_id, array['sindico']);
  if not v_torre.ativo then
    raise exception 'Esta torre está desativada.' using errcode = '23514';
  end if;
  if v_numero !~ '^[0-9A-Za-z]{1,6}$' then
    raise exception 'Número inválido: use até 6 letras ou números, sem espaços.' using errcode = '22023';
  end if;
  -- Se já existir (inclusive desativado), reativa e devolve o mesmo.
  insert into public.apartamentos (condominio_id, torre_id, numero) values (v_torre.condominio_id, v_torre.id, v_numero)
  on conflict (torre_id, numero) do update set ativo = true
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mudar_apartamento_ativo(p_apartamento_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ap public.apartamentos%rowtype;
begin
  select * into v_ap from public.apartamentos where id = p_apartamento_id for update;
  if not found then
    raise exception 'Apartamento não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_ap.condominio_id, array['sindico']);
  if p_ativo is false and (
       exists (select 1 from public.membros where apartamento_id = v_ap.id)
       or exists (select 1 from public.convites where apartamento_id = v_ap.id and usado_em is null)) then
    raise exception 'Há moradores ou convites vinculados a este apartamento. Mude o apartamento deles antes de desativá-lo.' using errcode = '23514';
  end if;
  update public.apartamentos set ativo = coalesce(p_ativo, true) where id = v_ap.id;
end;
$$;

create or replace function public.definir_apartamento_membro(p_condominio_id uuid, p_user_id uuid, p_apartamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app.exigir(p_condominio_id, array['sindico']);
  if not exists (select 1 from public.membros where condominio_id = p_condominio_id and user_id = p_user_id) then
    raise exception 'Pessoa não encontrada neste condomínio.' using errcode = 'P0002';
  end if;
  if p_apartamento_id is not null and not exists (
       select 1 from public.apartamentos where id = p_apartamento_id and condominio_id = p_condominio_id and ativo) then
    raise exception 'Apartamento não encontrado neste condomínio.' using errcode = 'P0002';
  end if;
  update public.membros set apartamento_id = p_apartamento_id
   where condominio_id = p_condominio_id and user_id = p_user_id;
end;
$$;

create or replace function public.definir_apartamento_convite(p_convite_id uuid, p_apartamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.convites%rowtype;
begin
  select * into v_c from public.convites where id = p_convite_id for update;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if v_c.papel = 'sindico' then
    if not app.eh_superadmin() then
      raise exception 'Só o superadmin gerencia convites de síndico.' using errcode = '42501';
    end if;
  else
    perform app.exigir(v_c.condominio_id, array['sindico']);
  end if;
  if v_c.usado_em is not null then
    raise exception 'Este convite já foi usado e não pode ser alterado.' using errcode = '23514';
  end if;
  if p_apartamento_id is not null and not exists (
       select 1 from public.apartamentos where id = p_apartamento_id and condominio_id = v_c.condominio_id and ativo) then
    raise exception 'Apartamento não encontrado neste condomínio.' using errcode = 'P0002';
  end if;
  update public.convites set apartamento_id = p_apartamento_id where id = v_c.id;
end;
$$;

-- ---------- convidar_membro com apartamento (parâmetro opcional) ----------
drop function if exists public.convidar_membro(uuid, text, text);
create or replace function public.convidar_membro(
  p_condominio_id uuid,
  p_email text,
  p_papel text,
  p_apartamento_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user auth.users%rowtype;
begin
  if p_papel not in ('sindico', 'gestor', 'morador') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  if p_papel = 'sindico' then
    if not app.eh_superadmin() then
      raise exception 'Só o superadmin define síndicos.' using errcode = '42501';
    end if;
  else
    perform app.exigir(p_condominio_id, array['sindico']);
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Informe um e-mail válido.' using errcode = '22023';
  end if;
  if p_apartamento_id is not null and not exists (
       select 1 from public.apartamentos where id = p_apartamento_id and condominio_id = p_condominio_id and ativo) then
    raise exception 'Apartamento não encontrado neste condomínio.' using errcode = 'P0002';
  end if;

  select * into v_user from auth.users where lower(email) = v_email;
  if found and v_user.email_confirmed_at is not null then
    if exists (select 1 from public.membros where condominio_id = p_condominio_id and user_id = v_user.id) then
      raise exception 'Esta pessoa já participa do condomínio. Use "alterar papel".' using errcode = '23505';
    end if;
    insert into public.membros (condominio_id, user_id, papel, apartamento_id)
    values (p_condominio_id, v_user.id, p_papel, p_apartamento_id);
    return 'vinculado';
  end if;

  insert into public.convites (condominio_id, email, papel, apartamento_id, criado_por)
  values (p_condominio_id, v_email, p_papel, p_apartamento_id, auth.uid())
  on conflict (condominio_id, lower(email)) where usado_em is null
  do update set papel = excluded.papel,
                apartamento_id = coalesce(excluded.apartamento_id, public.convites.apartamento_id);
  return 'convite_criado';
end;
$$;

-- Ao criar a conta, o convite leva o apartamento junto.
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

  insert into public.membros (condominio_id, user_id, papel, apartamento_id)
  select c.condominio_id, new.id, c.papel, c.apartamento_id
  from public.convites c
  where lower(c.email) = lower(new.email) and c.usado_em is null
  on conflict (condominio_id, user_id) do nothing;

  update public.convites
     set usado_em = now(), usado_por = new.id
   where lower(email) = lower(new.email) and usado_em is null;

  return new;
end;
$$;

-- ---------- Permissões de execução ----------
do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('criar_torres_lote', 'salvar_torre', 'gerar_apartamentos', 'salvar_apartamento',
                        'mudar_apartamento_ativo', 'definir_apartamento_membro', 'definir_apartamento_convite',
                        'convidar_membro')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;
