-- Confere que os dados enviados pelo front (formato exato) são aceitos pelas funções reais do banco.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true);  -- gestor
set local role authenticated;
do $$
declare c uuid; it uuid; cat uuid; un uuid; f uuid; compra uuid; ci uuid; rec uuid;
begin
  select id into c from public.condominios limit 1; select id into cat from categorias limit 1; select id into un from unidades_medida limit 1;
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,estoque_minimo,estoque_ideal) values (c,'Payload',cat,un,5,20) returning id into it;
  insert into public.fornecedores (condominio_id,nome,cnpj) values (c,'F','11222333000181') returning id into f;
  insert into public.fornecedor_categorias (fornecedor_id,condominio_id,categoria_id) values (f,c,cat);
  -- exatamente como o editor envia (fornecedor_id vazio, nf vazia, data_compra preenchida)
  compra := public.salvar_compra(c, null,
    '{"fornecedor_id":"","data_compra":"2026-11-16","numero_nf":"","observacoes":""}'::jsonb,
    format('[{"item_id":"%s","qtd_solicitada":16,"custo_unitario":12.5,"vencimento_previsto":null}]', it)::jsonb, true);
  -- edição com fornecedor
  compra := public.salvar_compra(c, compra,
    format('{"fornecedor_id":"%s","data_compra":null,"numero_nf":"NF1","observacoes":"x"}', f)::jsonb,
    format('[{"item_id":"%s","qtd_solicitada":16,"custo_unitario":12.5,"vencimento_previsto":"2027-06-01"}]', it)::jsonb, false);
  execute 'reset role'; perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true); execute 'set local role authenticated';  -- síndico
  perform public.aprovar_compra(compra);
  execute 'reset role'; perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true); execute 'set local role authenticated';  -- gestor
  select id into ci from compra_itens where compra_id = compra;
  rec := public.registrar_recebimento(compra, format('[{"compra_item_id":"%s","quantidade":6,"vencimento":"2027-06-01"}]', ci)::jsonb, '2026-11-16', null, gen_random_uuid());
end $$;
select 'status após recebimento parcial' as teste, status from public.compras order by criado_em desc limit 1;
select 'estoque' as teste, estoque_atual, qtd_em_pedido, status, qtd_sugerida from public.v_estoque_item where nome = 'Payload';
rollback;
