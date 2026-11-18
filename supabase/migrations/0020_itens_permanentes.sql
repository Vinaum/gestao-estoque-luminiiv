-- ============================================================
-- 0020_itens_permanentes — ferramentas e patrimônio
--
--   * item "permanente" (martelo, mangueira, serrote…): continua no
--     estoque com quantidade, mas não tem mínimo/ideal, não gera alerta
--     de reposição nem de vencimento, não entra na lista de compras nem
--     na cobertura de consumo
--   * estado de conservação: bom | reparo | inutilizavel
-- Pode ser repetida sem dano. Itens existentes continuam de consumo.
-- ============================================================

alter table public.itens add column if not exists permanente boolean not null default false;
alter table public.itens add column if not exists conservacao text not null default 'bom';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itens_conservacao_check' and conrelid = 'public.itens'::regclass) then
    alter table public.itens add constraint itens_conservacao_check check (conservacao in ('bom', 'reparo', 'inutilizavel'));
  end if;
end $$;

-- Item permanente não tem mínimo nem ideal: o banco zera, venha de onde vier a gravação.
create or replace function app.itens_permanente_sem_parametros()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.permanente then
    new.estoque_minimo := 0;
    new.estoque_ideal := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists itens_permanente on public.itens;
create trigger itens_permanente before insert or update on public.itens
  for each row execute function app.itens_permanente_sem_parametros();

-- Mínimo/ideal: recusa para item permanente (mensagem clara em vez de zerar calado).
create or replace function public.atualizar_parametros_item(
  p_item_id uuid,
  p_minimo numeric,
  p_ideal numeric
)
returns public.itens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.itens%rowtype;
begin
  select * into v_item from public.itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_item.condominio_id, array['gestor', 'sindico']);

  if v_item.permanente then
    raise exception 'Item permanente (ferramenta/patrimônio) não tem mínimo nem ideal.' using errcode = '22023';
  end if;
  if p_minimo is null or p_ideal is null or p_minimo < 0 or p_ideal < 0 then
    raise exception 'Informe valores de zero ou mais.' using errcode = '22023';
  end if;
  if p_ideal < p_minimo then
    raise exception 'O estoque ideal não pode ser menor que o mínimo.' using errcode = '22023';
  end if;

  update public.itens set estoque_minimo = p_minimo, estoque_ideal = p_ideal
   where id = p_item_id returning * into v_item;
  return v_item;
end;
$$;

-- ---------- Leituras ----------
-- Status ganha 'permanente' (antes de qualquer alerta); colunas novas no fim.
create or replace view public.v_estoque_item with (security_invoker = true) as
select
  i.id as item_id,
  i.condominio_id,
  i.nome,
  i.descricao,
  i.categoria_id,
  c.nome as categoria,
  i.unidade_id,
  u.sigla as unidade,
  i.localizacao,
  i.estoque_minimo,
  i.estoque_ideal,
  i.fornecedor_principal_id,
  i.ativo,
  coalesce(l.saldo, 0) as estoque_atual,
  coalesce(l.lotes_com_saldo, 0) as lotes_com_saldo,
  coalesce(l.total_lotes, 0) as total_lotes,
  case
    when i.permanente then 'permanente'
    when coalesce(l.total_lotes, 0) = 0 then 'sem_estoque_cadastrado'
    when coalesce(l.saldo, 0) = 0 then 'esgotado'
    when l.saldo <= i.estoque_minimo then 'comprar'
    when l.saldo <= i.estoque_minimo * (1 + coalesce(cfg.faixa_atencao, 0.25)) then 'atencao'
    else 'normal'
  end as status,
  case
    when i.permanente or coalesce(l.total_lotes, 0) = 0 then 0
    else greatest(i.estoque_ideal - coalesce(l.saldo, 0), 0)
  end as qtd_sugerida,
  coalesce(p.qtd_em_pedido, 0) as qtd_em_pedido,
  i.permanente,
  i.conservacao
from public.itens i
join public.categorias c on c.id = i.categoria_id
join public.unidades_medida u on u.id = i.unidade_id
left join public.condominio_config cfg on cfg.condominio_id = i.condominio_id
left join lateral (
  select sum(lt.saldo) as saldo,
         count(*) filter (where lt.saldo > 0) as lotes_com_saldo,
         count(*) as total_lotes
  from public.lotes lt where lt.item_id = i.id
) l on true
left join lateral (
  select sum(ci.qtd_solicitada - ci.qtd_recebida) as qtd_em_pedido
  from public.compra_itens ci
  join public.compras cp on cp.id = ci.compra_id
  where ci.item_id = i.id
    and cp.status in ('aprovada', 'pedido_realizado', 'parcialmente_recebido')
) p on true;

-- Lote de item permanente nunca entra em alerta de vencimento.
create or replace view public.v_lotes with (security_invoker = true) as
select
  l.id as lote_id,
  l.condominio_id,
  l.item_id,
  i.nome as item_nome,
  u.sigla as unidade,
  l.codigo,
  l.origem,
  l.data_entrada,
  l.qtd_recebida,
  l.saldo,
  l.qtd_recebida - l.saldo as qtd_consumida,
  l.custo_unitario,
  l.saldo * l.custo_unitario as valor_em_estoque,
  l.vencimento,
  case when l.vencimento is null then null else l.vencimento - current_date end as dias_para_vencer,
  case
    when i.permanente or l.vencimento is null then 'sem_vencimento'
    when l.vencimento < current_date then 'vencido'
    when l.vencimento <= current_date + coalesce(cfg.venc_alerta_1, 30) then 'curto_prazo'
    when l.vencimento <= current_date + coalesce(cfg.venc_alerta_2, 90) then 'medio_prazo'
    else 'ok'
  end as faixa_vencimento,
  i.permanente
from public.lotes l
join public.itens i on i.id = l.item_id
join public.unidades_medida u on u.id = i.unidade_id
left join public.condominio_config cfg on cfg.condominio_id = l.condominio_id;

-- Cobertura (dias de estoque) só faz sentido para material de consumo.
create or replace view public.v_cobertura with (security_invoker = true) as
select
  e.item_id,
  e.condominio_id,
  e.nome,
  e.unidade,
  e.estoque_atual,
  coalesce(h.consumo_90d, 0) as consumo_90d,
  h.dias_periodo,
  case when coalesce(h.consumo_90d, 0) > 0 then h.consumo_90d / h.dias_periodo else null end as consumo_medio_diario,
  case
    when e.estoque_atual = 0 then 0
    when coalesce(h.consumo_90d, 0) <= 0 then null
    else e.estoque_atual / (h.consumo_90d / h.dias_periodo)
  end as cobertura_dias,
  case
    when e.estoque_atual = 0 then 'sem_estoque'
    when coalesce(h.consumo_90d, 0) <= 0 then 'sem_historico'
    else 'ok'
  end as situacao
from public.v_estoque_item e
left join lateral (
  select sum(-m.sinal * m.quantidade) filter (
           where m.tipo = 'consumo' and m.data_hora >= now() - interval '90 days') as consumo_90d,
         greatest(1, least(90, current_date - min(m.data_hora)::date)) as dias_periodo
  from public.movimentacoes m where m.item_id = e.item_id
) h on true
where e.ativo and not e.permanente;
