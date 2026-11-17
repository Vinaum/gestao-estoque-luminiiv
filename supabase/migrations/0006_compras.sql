-- ============================================================
-- 0006_compras — compras e seus itens
-- Registrar uma compra NÃO altera o estoque. Só o recebimento (0007/0008).
-- ============================================================

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  data_compra date not null default current_date,
  fornecedor_id uuid,
  numero_nf text,
  nf_arquivo_path text,
  categoria_id uuid references public.categorias(id),
  responsavel_id uuid not null default auth.uid() references auth.users(id),
  observacoes text,
  status text not null default 'planejada' check (status in (
    'planejada', 'aguardando_aprovacao', 'aprovada', 'pedido_realizado',
    'parcialmente_recebido', 'recebido', 'cancelado'
  )),
  aprovada_por uuid references auth.users(id),
  aprovada_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (id, condominio_id),
  foreign key (fornecedor_id, condominio_id)
    references public.fornecedores (id, condominio_id)
);
create index if not exists compras_cond_idx on public.compras (condominio_id, data_compra desc);

create table if not exists public.compra_itens (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null,
  condominio_id uuid not null,
  item_id uuid not null,
  qtd_solicitada numeric not null check (qtd_solicitada > 0),
  qtd_recebida numeric not null default 0 check (qtd_recebida >= 0),
  custo_unitario numeric not null default 0 check (custo_unitario >= 0),
  custo_total numeric generated always as (qtd_solicitada * custo_unitario) stored,
  vencimento_previsto date,
  unique (id, condominio_id),
  unique (compra_id, item_id),
  check (qtd_recebida <= qtd_solicitada),
  foreign key (compra_id, condominio_id)
    references public.compras (id, condominio_id) on delete cascade,
  foreign key (item_id, condominio_id)
    references public.itens (id, condominio_id)
);

drop trigger if exists compras_travar on public.compras;
create trigger compras_travar
  before update on public.compras
  for each row execute function app.travar_colunas('condominio_id', 'responsavel_id', 'criado_em');
