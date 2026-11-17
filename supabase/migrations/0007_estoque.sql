-- ============================================================
-- 0007_estoque — recebimentos, lotes e movimentações
--
-- Fonte de verdade: o saldo de cada lote.
-- Invariante: saldo do lote = soma (sinal x quantidade) das movimentações do lote.
-- Movimentações são imutáveis (livro-razão). Erros se corrigem por estorno.
-- ============================================================

create table if not exists public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null,
  compra_id uuid not null,
  data date not null default current_date,
  responsavel_id uuid not null default auth.uid() references auth.users(id),
  observacao text,
  chave_idempotencia uuid not null,
  criado_em timestamptz not null default now(),
  unique (id, condominio_id),
  unique (condominio_id, chave_idempotencia),
  foreign key (compra_id, condominio_id) references public.compras (id, condominio_id)
);

create table if not exists public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null,
  condominio_id uuid not null,
  compra_item_id uuid not null,
  quantidade numeric not null check (quantidade > 0),
  vencimento date,
  custo_unitario numeric not null default 0 check (custo_unitario >= 0),
  unique (id, condominio_id),
  foreign key (recebimento_id, condominio_id)
    references public.recebimentos (id, condominio_id),
  foreign key (compra_item_id, condominio_id)
    references public.compra_itens (id, condominio_id)
);

create table if not exists public.lotes (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null,
  item_id uuid not null,
  recebimento_item_id uuid unique,
  codigo text not null,
  data_entrada date not null default current_date,
  qtd_recebida numeric not null check (qtd_recebida > 0),
  saldo numeric not null check (saldo >= 0),
  custo_unitario numeric not null default 0 check (custo_unitario >= 0),
  vencimento date,
  origem text not null check (origem in ('compra', 'entrada_extraordinaria', 'doacao', 'ajuste')),
  responsavel_id uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default clock_timestamp(),
  check (saldo <= qtd_recebida),
  unique (id, condominio_id),
  unique (id, item_id, condominio_id),
  unique (item_id, codigo),
  foreign key (item_id, condominio_id) references public.itens (id, condominio_id),
  foreign key (recebimento_item_id, condominio_id)
    references public.recebimento_itens (id, condominio_id)
);
create index if not exists lotes_item_idx on public.lotes (item_id);

create table if not exists public.movimentacoes (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null,
  item_id uuid not null,
  lote_id uuid not null,
  tipo text not null check (tipo in ('entrada', 'consumo', 'perda', 'ajuste', 'doacao', 'descarte')),
  sinal smallint not null check (sinal in (1, -1)),
  quantidade numeric not null check (quantidade > 0),
  motivo text not null check (length(trim(motivo)) > 0),
  justificativa text,
  observacao text,
  data_hora timestamptz not null default now(),
  responsavel_id uuid not null default auth.uid() references auth.users(id),
  recebimento_item_id uuid,
  estorno_de uuid unique references public.movimentacoes(id),
  chave_idempotencia uuid not null,
  criado_em timestamptz not null default clock_timestamp(),
  -- entrada sempre soma; consumo, perda e descarte sempre subtraem (estorno é o inverso)
  check (
    estorno_de is not null
    or (tipo = 'entrada' and sinal = 1)
    or (tipo in ('consumo', 'perda', 'descarte') and sinal = -1)
    or tipo in ('ajuste', 'doacao')
  ),
  -- ajuste e estorno exigem justificativa
  check (tipo <> 'ajuste' or length(trim(coalesce(justificativa, ''))) >= 5),
  check (estorno_de is null or length(trim(coalesce(justificativa, ''))) >= 5),
  unique (condominio_id, chave_idempotencia, lote_id),
  foreign key (item_id, condominio_id) references public.itens (id, condominio_id),
  foreign key (lote_id, item_id, condominio_id)
    references public.lotes (id, item_id, condominio_id)
);
create index if not exists mov_item_idx on public.movimentacoes (item_id, data_hora desc);
create index if not exists mov_cond_idx on public.movimentacoes (condominio_id, data_hora desc);
create index if not exists mov_chave_idx on public.movimentacoes (condominio_id, chave_idempotencia);

-- ---------- Travas de integridade ----------
drop trigger if exists movimentacoes_imutavel on public.movimentacoes;
create trigger movimentacoes_imutavel
  before update or delete on public.movimentacoes
  for each row execute function app.bloquear_alteracao();

drop trigger if exists movimentacoes_sem_truncate on public.movimentacoes;
create trigger movimentacoes_sem_truncate
  before truncate on public.movimentacoes
  for each statement execute function app.bloquear_alteracao();

drop trigger if exists recebimentos_imutavel on public.recebimentos;
create trigger recebimentos_imutavel
  before update or delete on public.recebimentos
  for each row execute function app.bloquear_alteracao();

drop trigger if exists recebimento_itens_imutavel on public.recebimento_itens;
create trigger recebimento_itens_imutavel
  before update or delete on public.recebimento_itens
  for each row execute function app.bloquear_alteracao();

-- Lote: só o saldo pode mudar, e nunca se apaga.
create or replace function app.proteger_lote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Lotes não podem ser apagados.' using errcode = '55000';
  end if;
  if new.condominio_id is distinct from old.condominio_id
     or new.item_id is distinct from old.item_id
     or new.qtd_recebida is distinct from old.qtd_recebida
     or new.codigo is distinct from old.codigo
     or new.data_entrada is distinct from old.data_entrada
     or new.vencimento is distinct from old.vencimento
     or new.custo_unitario is distinct from old.custo_unitario
     or new.origem is distinct from old.origem
     or new.recebimento_item_id is distinct from old.recebimento_item_id then
    raise exception 'Só o saldo do lote pode mudar.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists lotes_protegido on public.lotes;
create trigger lotes_protegido
  before update or delete on public.lotes
  for each row execute function app.proteger_lote();
