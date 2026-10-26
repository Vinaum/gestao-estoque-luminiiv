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
