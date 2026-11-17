-- Monta um cenário no banco, exporta o que as views devolvem e as somas "de referência" feitas em SQL.
-- Uso (pelo painel_vs_banco.sh): psql -v saida=/caminho/dados.json -f painel_vs_banco.sql
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true);  -- gestor
set local role authenticated;
do $$
declare c uuid; cat uuid; un uuid; f uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; cp1 uuid; cp2 uuid; cp3 uuid; ci uuid;
begin
  select id into c from public.condominios limit 1; select id into cat from categorias limit 1; select id into un from unidades_medida limit 1;
  insert into public.fornecedores (condominio_id,nome) values (c,'Forn') returning id into f;
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,estoque_minimo,estoque_ideal) values (c,'Comprar',cat,un,10,40) returning id into i1;
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,estoque_minimo,estoque_ideal) values (c,'Esgotado',cat,un,5,20) returning id into i2;
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,estoque_minimo,estoque_ideal) values (c,'Atencao',cat,un,10,30) returning id into i3;
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,estoque_minimo,estoque_ideal) values (c,'SemEstoque',cat,un,1,5) returning id into i4;
  perform public.registrar_entrada_extraordinaria(i1, 8, 'entrada_extraordinaria', 't', gen_random_uuid(), 2, current_date - 5);        -- vencido
  perform public.registrar_entrada_extraordinaria(i1, 4, 'entrada_extraordinaria', 't', gen_random_uuid(), 2, current_date + 10);       -- 30 dias
  perform public.registrar_entrada_extraordinaria(i2, 6, 'entrada_extraordinaria', 't', gen_random_uuid(), 1, current_date + 60);       -- 90 dias
  perform public.registrar_saida(i2, 'consumo', 6, 'x', gen_random_uuid());                                                             -- esgota
  perform public.registrar_entrada_extraordinaria(i3, 14, 'entrada_extraordinaria', 't', gen_random_uuid(), 1.5);
  perform public.registrar_saida(i3, 'consumo', 1, 'x', gen_random_uuid());                                                             -- 13
  perform public.registrar_saida(i1, 'consumo', 2, 'x', gen_random_uuid());
  perform public.registrar_ajuste(i3, (select id from lotes where item_id=i3 limit 1), 11, 'contagem física', gen_random_uuid());  -- 13 -> 11 (atenção: acima do mínimo 10, até 12,5)
  perform public.registrar_saida(i1, 'consumo', 1, 'x', gen_random_uuid());
  -- compras: mês atual (efetivada 100,50 e rascunho que não conta), 1º de janeiro (efetivada 200)
  cp1 := public.salvar_compra(c,null,jsonb_build_object('fornecedor_id',f,'data_compra',current_date),
    jsonb_build_array(jsonb_build_object('item_id',i1,'qtd_solicitada',4,'custo_unitario',25.125)), true);
  cp2 := public.salvar_compra(c,null,jsonb_build_object('fornecedor_id',f,'data_compra',date_trunc('year',current_date)::date),
    jsonb_build_array(jsonb_build_object('item_id',i3,'qtd_solicitada',10,'custo_unitario',20)), true);
  cp3 := public.salvar_compra(c,null,jsonb_build_object('data_compra',current_date),
    jsonb_build_array(jsonb_build_object('item_id',i3,'qtd_solicitada',1,'custo_unitario',999)), false);
  execute 'reset role'; perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true); execute 'set local role authenticated';
  perform public.aprovar_compra(cp1); perform public.aprovar_compra(cp2);
  perform public.mudar_status_compra(cp1,'pedido_realizado'); perform public.mudar_status_compra(cp2,'pedido_realizado');
end $$;
-- exporta o que as views entregam (como o front recebe) + referências calculadas direto nas tabelas
reset role;
\pset tuples_only on
\pset format unaligned
\o :saida
select json_build_object(
  'itens',   (select json_agg(t) from v_estoque_item t where ativo),
  'lotes',   (select json_agg(t) from v_lotes t where saldo > 0 and faixa_vencimento in ('vencido','curto_prazo','medio_prazo')),
  'compras', (select json_agg(t) from v_compras t where status in ('pedido_realizado','parcialmente_recebido','recebido')),
  'movs',    (select json_agg(t) from movimentacoes t),
  'saidas',  (select json_agg(t) from v_saidas_mensal t where tipo='consumo' and mes = date_trunc('month', current_date)::date),
  'ref', json_build_object(
     'gasto_mes', (select coalesce(sum(ci.qtd_solicitada*ci.custo_unitario),0) from compras c join compra_itens ci on ci.compra_id=c.id
                    where c.status in ('pedido_realizado','parcialmente_recebido','recebido') and date_trunc('month',c.data_compra)=date_trunc('month',current_date)),
     'gasto_ano', (select coalesce(sum(ci.qtd_solicitada*ci.custo_unitario),0) from compras c join compra_itens ci on ci.compra_id=c.id
                    where c.status in ('pedido_realizado','parcialmente_recebido','recebido') and date_trunc('year',c.data_compra)=date_trunc('year',current_date)),
     'consumo_i1', (select coalesce(sum(quantidade*-sinal),0) from movimentacoes m join itens i on i.id=m.item_id where i.nome='Comprar' and m.tipo='consumo'),
     'saldo_i1', (select coalesce(sum(saldo),0) from lotes l join itens i on i.id=l.item_id where i.nome='Comprar')
  ))::text;
\o
rollback;
