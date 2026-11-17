-- ============================================================
-- 0004_fornecedores
-- ============================================================

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  nome text not null check (length(trim(nome)) > 0),
  razao_social text,
  cnpj text,
  contato text,
  telefone text,
  email text,
  endereco text,
  observacoes text,
  ativo boolean not null default true,
  criado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (id, condominio_id)
);
create unique index if not exists fornecedores_cnpj_uk
  on public.fornecedores (condominio_id, cnpj) where cnpj is not null and cnpj <> '';

-- Categorias atendidas por cada fornecedor.
create table if not exists public.fornecedor_categorias (
  fornecedor_id uuid not null,
  condominio_id uuid not null,
  categoria_id uuid not null references public.categorias(id),
  primary key (fornecedor_id, categoria_id),
  foreign key (fornecedor_id, condominio_id)
    references public.fornecedores (id, condominio_id) on delete cascade
);

drop trigger if exists fornecedores_travar on public.fornecedores;
create trigger fornecedores_travar
  before update on public.fornecedores
  for each row execute function app.travar_colunas('condominio_id', 'criado_por', 'criado_em');
