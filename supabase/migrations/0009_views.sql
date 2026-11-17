-- ============================================================
-- 0009_views — leituras prontas para o painel e os relatórios
-- Todas respeitam as regras de acesso de quem consulta (security_invoker).
-- ============================================================

-- Estoque e status de cada item.
-- Status: sem_estoque_cadastrado | esgotado | comprar | atencao | normal
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
    when coalesce(l.total_lotes, 0) = 0 then 'sem_estoque_cadastrado'
    when coalesce(l.saldo, 0) = 0 then 'esgotado'
    when l.saldo <= i.estoque_minimo then 'comprar'
    when l.saldo <= i.estoque_minimo * (1 + coalesce(cfg.faixa_atencao, 0.25)) then 'atencao'
    else 'normal'
  end as status,
  case
    when coalesce(l.total_lotes, 0) = 0 then 0
    else greatest(i.estoque_ideal - coalesce(l.saldo, 0), 0)
  end as qtd_sugerida,
  coalesce(p.qtd_em_pedido, 0) as qtd_em_pedido
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

-- Lotes com a faixa de vencimento.
-- Faixa: vencido | curto_prazo | medio_prazo | ok | sem_vencimento
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
    when l.vencimento is null then 'sem_vencimento'
    when l.vencimento < current_date then 'vencido'
    when l.vencimento <= current_date + coalesce(cfg.venc_alerta_1, 30) then 'curto_prazo'
    when l.vencimento <= current_date + coalesce(cfg.venc_alerta_2, 90) then 'medio_prazo'
    else 'ok'
  end as faixa_vencimento
from public.lotes l
join public.itens i on i.id = l.item_id
join public.unidades_medida u on u.id = i.unidade_id
left join public.condominio_config cfg on cfg.condominio_id = l.condominio_id;

-- Saídas líquidas por mês, tipo e item (estornos já descontados).
create or replace view public.v_saidas_mensal with (security_invoker = true) as
select
  m.condominio_id,
  m.item_id,
  (date_trunc('month', m.data_hora at time zone 'America/Sao_Paulo'))::date as mes,
  m.tipo,
  sum(-m.sinal * m.quantidade) as quantidade
from public.movimentacoes m
where m.tipo in ('consumo', 'perda', 'descarte', 'doacao')
group by m.condominio_id, m.item_id, 3, m.tipo;

-- Compras com fornecedor, categoria e valor total.
create or replace view public.v_compras with (security_invoker = true) as
select
  c.id as compra_id,
  c.condominio_id,
  c.data_compra,
  (date_trunc('month', c.data_compra))::date as mes,
  c.fornecedor_id,
  f.nome as fornecedor,
  c.categoria_id,
  cat.nome as categoria,
  c.numero_nf,
  c.nf_arquivo_path,
  c.status,
  c.responsavel_id,
  c.aprovada_por,
  c.aprovada_em,
  c.observacoes,
  coalesce(t.valor_total, 0) as valor_total,
  coalesce(t.qtd_itens, 0) as qtd_itens
from public.compras c
left join public.fornecedores f on f.id = c.fornecedor_id
left join public.categorias cat on cat.id = c.categoria_id
left join lateral (
  select sum(ci.custo_total) as valor_total, count(*) as qtd_itens
  from public.compra_itens ci where ci.compra_id = c.id
) t on true;

-- Gastos: compras já efetivadas (pedido feito, parcial ou recebida).
create or replace view public.v_gastos with (security_invoker = true) as
select
  compra_id, condominio_id, data_compra, mes,
  extract(year from data_compra)::int as ano,
  fornecedor_id, fornecedor, categoria_id, categoria, valor_total, status
from public.v_compras
where status in ('pedido_realizado', 'parcialmente_recebido', 'recebido');

-- Cobertura de estoque (em dias), pelo consumo dos últimos 90 dias.
-- situacao: sem_estoque | sem_historico | ok
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
where e.ativo;
