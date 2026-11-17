-- ============================================================
-- 0005_itens — cadastro de itens
-- IMPORTANTE: não existe coluna de "estoque atual". O estoque é a soma
-- dos saldos dos lotes (view v_estoque_item, migration 0009).
-- ============================================================

create table if not exists public.itens (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  nome text not null check (length(trim(nome)) > 0),
  categoria_id uuid not null references public.categorias(id),
  descricao text,
  unidade_id uuid not null references public.unidades_medida(id),
  estoque_minimo numeric not null default 0 check (estoque_minimo >= 0),
  estoque_ideal numeric not null default 0 check (estoque_ideal >= 0),
  localizacao text,
  fornecedor_principal_id uuid,
  ativo boolean not null default true,
  criado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (id, condominio_id),
  check (estoque_ideal >= estoque_minimo),
  foreign key (fornecedor_principal_id, condominio_id)
    references public.fornecedores (id, condominio_id)
);
create unique index if not exists itens_nome_uk on public.itens (condominio_id, lower(nome));
create index if not exists itens_cond_idx on public.itens (condominio_id);

drop trigger if exists itens_travar on public.itens;
create trigger itens_travar
  before update on public.itens
  for each row execute function app.travar_colunas('condominio_id', 'criado_por', 'criado_em');
