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
-- torres, apartamentos e convites com apartamento: exatamente como a tela envia (parâmetros nomeados)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true);  -- síndico
do $$
declare c uuid; t uuid; ap uuid; ap51 uuid; n int; cv uuid;
begin
  select id into c from public.condominios limit 1;
  n := public.criar_torres_lote(p_condominio_id => c, p_quantidade => 5, p_prefixo => 'Torre');
  select id into t from public.torres where condominio_id = c and nome = 'Torre 1';
  n := public.gerar_apartamentos(p_torre_id => t, p_andar_inicial => 0, p_andar_final => 4, p_por_andar => 4);
  perform public.salvar_torre(p_condominio_id => c, p_torre_id => t, p_nome => 'Torre 1', p_ativo => true);
  perform public.salvar_torre(p_condominio_id => c, p_torre_id => null, p_nome => 'Torre extra', p_ativo => true);
  select id into ap from public.apartamentos where torre_id = t and numero = '11';
  ap51 := public.salvar_apartamento(p_torre_id => t, p_numero => '51');
  perform public.convidar_membro(p_condominio_id => c, p_email => 'payload@x.com', p_papel => 'morador', p_apartamento_id => ap);
  perform public.convidar_membro(p_condominio_id => c, p_email => 'payload2@x.com', p_papel => 'gestor', p_apartamento_id => null);
  select id into cv from public.convites where email = 'payload@x.com';
  perform public.definir_apartamento_convite(p_convite_id => cv, p_apartamento_id => null);
  perform public.definir_apartamento_convite(p_convite_id => cv, p_apartamento_id => ap);
  perform public.definir_apartamento_membro(p_condominio_id => c, p_user_id => '00000000-0000-0000-0000-0000000000a4', p_apartamento_id => ap);
  perform public.definir_apartamento_membro(p_condominio_id => c, p_user_id => '00000000-0000-0000-0000-0000000000a4', p_apartamento_id => null);
  perform public.mudar_apartamento_ativo(p_apartamento_id => ap51, p_ativo => false);
  perform public.mudar_apartamento_ativo(p_apartamento_id => ap51, p_ativo => true);
  perform public.cancelar_convite(p_convite_id => cv);
  raise notice 'payloads de torres/apartamentos aceitos';
end $$;
-- comunicados: exatamente como a tela envia (gestor publica; morador lê e marca)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true);  -- gestor
do $$
declare c uuid; t uuid; id1 uuid; r jsonb;
begin
  select id into c from public.condominios limit 1;
  select id into t from public.torres where condominio_id = c and nome = 'Torre 1';
  id1 := public.salvar_comunicado(p_condominio_id => c, p_id => null,
    p_dados => format('{"titulo":"Corte de água","corpo":"Dia 20\nàs 10h","tipo":"manutencao","torre_id":"%s","fixado":true,"expira_em":"2099-12-31T02:59:59.000Z"}', t)::jsonb);
  perform public.salvar_comunicado(p_condominio_id => c, p_id => id1,
    p_dados => '{"titulo":"Corte de água (10h)","corpo":"Dia 20","tipo":"aviso","torre_id":null,"fixado":false,"expira_em":null}'::jsonb);
  perform public.definir_anexo_comunicado(p_id => id1, p_path => c::text || '/' || id1::text || '/x.pdf', p_nome => 'Ata 1.pdf');
  perform public.definir_anexo_comunicado(p_id => id1, p_path => null, p_nome => null);
  perform public.publicar_comunicado(p_id => id1);
  r := public.leituras_comunicado(p_id => id1);
  execute 'reset role'; perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',true); execute 'set local role authenticated';  -- morador
  perform public.marcar_comunicado_lido(p_id => id1);
  execute 'reset role'; perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true); execute 'set local role authenticated';  -- gestor
  perform public.arquivar_comunicado(p_id => id1);
  perform public.publicar_comunicado(p_id => id1);
  raise notice 'payloads de comunicados aceitos';
end $$;
select 'torres e apartamentos' as teste, (select count(*) from public.torres) as torres, (select count(*) from public.apartamentos) as apartamentos;
select 'status após recebimento parcial' as teste, status from public.compras order by criado_em desc limit 1;
select 'estoque' as teste, estoque_atual, qtd_em_pedido, status, qtd_sugerida from public.v_estoque_item where nome = 'Payload';
rollback;
