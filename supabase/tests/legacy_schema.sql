-- ============================================================
-- Estoque de Manutenção do Condomínio — Schema Supabase
-- Rode este script inteiro no SQL Editor do seu projeto Supabase.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Perfis de usuário (papel de cada pessoa) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'morador' check (papel in ('sindico','gestor','morador')),
  created_at timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém se cadastra (papel padrão: morador)
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), 'morador');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Função auxiliar: retorna o papel do usuário logado, ignorando RLS (evita recursão)
create function public.meu_papel()
returns text as $$
  select papel from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- ---------- Configurações gerais (linha única) ----------
create table public.settings (
  id int primary key default 1,
  dias_atencao int not null default 20,
  dias_critico int not null default 7,
  meses_media int not null default 6,
  constraint single_row check (id = 1)
);
insert into public.settings (id) values (1);

-- ---------- Itens de estoque ----------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'Outros',
  unidade text not null default 'un',
  estoque_atual numeric not null default 0,
  estoque_minimo numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Movimentações (entradas e saídas) ----------
create table public.movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items(id) on delete set null,
  tipo text not null check (tipo in ('entrada','saida')),
  quantidade numeric not null check (quantidade > 0),
  data date not null default current_date,
  responsavel text default '',
  fornecedor text default '',
  nota_fiscal text default '',
  valor numeric,
  observacao text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — a permissão de verdade mora aqui,
-- não no HTML/JS do front-end.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.movements enable row level security;
alter table public.settings enable row level security;

-- profiles: qualquer autenticado pode ler (a UI precisa saber quem é quem)
create policy "profiles_select_all" on public.profiles
  for select using (auth.role() = 'authenticated');

-- profiles: cada um pode atualizar seu próprio nome
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- profiles: síndico pode alterar o papel de qualquer pessoa
create policy "profiles_update_role_sindico" on public.profiles
  for update using (public.meu_papel() = 'sindico');

-- items: leitura liberada para todo autenticado (inclusive morador)
create policy "items_select_all" on public.items
  for select using (auth.role() = 'authenticated');

-- items: criar/editar — síndico e gestor (zelador)
create policy "items_insert_sindico_gestor" on public.items
  for insert with check (public.meu_papel() in ('sindico','gestor'));
create policy "items_update_sindico_gestor" on public.items
  for update using (public.meu_papel() in ('sindico','gestor'));

-- items: excluir — só síndico
create policy "items_delete_sindico" on public.items
  for delete using (public.meu_papel() = 'sindico');

-- movements: leitura liberada para todo autenticado
create policy "movements_select_all" on public.movements
  for select using (auth.role() = 'authenticated');

-- movements: registrar — síndico e gestor
create policy "movements_insert_sindico_gestor" on public.movements
  for insert with check (public.meu_papel() in ('sindico','gestor'));

-- movements: excluir — só síndico
create policy "movements_delete_sindico" on public.movements
  for delete using (public.meu_papel() = 'sindico');

-- settings: leitura liberada para todo autenticado
create policy "settings_select_all" on public.settings
  for select using (auth.role() = 'authenticated');

-- settings: alterar — só síndico
create policy "settings_update_sindico" on public.settings
  for update using (public.meu_papel() = 'sindico');

-- ============================================================
-- Depois de rodar este script:
-- 1. Cadastre-se normalmente pelo app (você vira "morador" por padrão).
-- 2. Promova-se a síndico rodando manualmente, uma única vez:
--    update public.profiles set papel = 'sindico' where id =
--      (select id from auth.users where email = 'SEU_EMAIL_AQUI');
-- ============================================================


-- ============================================================
-- ATUALIZAÇÃO: estoque atualizado automaticamente pelo banco
-- (rode só este bloco se você já executou o schema acima antes)
-- ============================================================
create or replace function public.aplicar_movimento()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if new.item_id is not null then
      update public.items
         set estoque_atual = greatest(0, estoque_atual +
               case when new.tipo = 'entrada' then new.quantidade else -new.quantidade end)
       where id = new.item_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.item_id is not null then
      update public.items
         set estoque_atual = greatest(0, estoque_atual +
               case when old.tipo = 'entrada' then -old.quantidade else old.quantidade end)
       where id = old.item_id;
    end if;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger movements_atualiza_estoque
  after insert or delete on public.movements
  for each row execute procedure public.aplicar_movimento();

-- Atualização em tempo real entre telas (Realtime)
alter publication supabase_realtime add table public.items, public.movements, public.settings;


-- ============================================================
-- ATUALIZAÇÃO: papel "superadmin" + correção de segurança
-- Pode ser rodada em um projeto que já existe (não apaga dados)
-- e também em um projeto novo. Rode no SQL Editor do Supabase.
-- ============================================================

-- 1) Aceitar o novo papel
alter table public.profiles drop constraint if exists profiles_papel_check;
alter table public.profiles
  add constraint profiles_papel_check
  check (papel in ('superadmin','sindico','gestor','morador'));

-- 2) Quem pode alterar o papel de alguém (regra aplicada pelo banco)
--    - Ninguém altera o próprio papel pelo app
--    - Superadmin altera qualquer papel
--    - Síndico só alterna entre gestor e morador
--    - Rodando pelo SQL Editor (sem usuário logado), tudo é permitido
create or replace function public.proteger_papel()
returns trigger as $$
declare meu text;
begin
  if new.papel is distinct from old.papel then
    if auth.uid() is null then
      return new;
    end if;
    if auth.uid() = old.id then
      raise exception 'Você não pode alterar o seu próprio papel.';
    end if;
    meu := public.meu_papel();
    if meu = 'superadmin' then
      return new;
    elsif meu = 'sindico'
          and old.papel in ('gestor','morador')
          and new.papel in ('gestor','morador') then
      return new;
    else
      raise exception 'Você não tem permissão para alterar este papel.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profiles_proteger_papel on public.profiles;
create trigger profiles_proteger_papel
  before update on public.profiles
  for each row execute procedure public.proteger_papel();

-- 3) Políticas de acesso atualizadas (superadmin tem tudo que o síndico tem)
drop policy if exists "profiles_update_role_sindico" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "items_insert_sindico_gestor" on public.items;
create policy "items_insert_sindico_gestor" on public.items
  for insert with check (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "items_update_sindico_gestor" on public.items;
create policy "items_update_sindico_gestor" on public.items
  for update using (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "items_delete_sindico" on public.items;
create policy "items_delete_sindico" on public.items
  for delete using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "movements_insert_sindico_gestor" on public.movements;
create policy "movements_insert_sindico_gestor" on public.movements
  for insert with check (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "movements_delete_sindico" on public.movements;
create policy "movements_delete_sindico" on public.movements
  for delete using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "settings_update_sindico" on public.settings;
create policy "settings_update_sindico" on public.settings
  for update using (public.meu_papel() in ('superadmin','sindico'));

-- 4) Torne a sua conta superadmin (troque o e-mail e rode UMA vez)
-- update public.profiles set papel = 'superadmin' where id =
--   (select id from auth.users where email = 'seu-email@exemplo.com');
