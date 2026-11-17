-- Confere que toda coluna usada pelo front existe nas views/tabelas (consulta vazia basta).
\set ON_ERROR_STOP on
select item_id,condominio_id,nome,categoria,unidade,estoque_atual,estoque_minimo,estoque_ideal,qtd_sugerida,qtd_em_pedido,status,ativo,total_lotes,categoria_id,unidade_id,localizacao,descricao,fornecedor_principal_id from public.v_estoque_item limit 0;
select lote_id,condominio_id,item_id,item_nome,unidade,codigo,saldo,vencimento,faixa_vencimento,valor_em_estoque,data_entrada,origem from public.v_lotes limit 0;
select compra_id,condominio_id,data_compra,mes,fornecedor_id,fornecedor,categoria,numero_nf,nf_arquivo_path,status,responsavel_id,aprovada_por,aprovada_em,observacoes,valor_total,qtd_itens from public.v_compras limit 0;
select condominio_id,item_id,mes,tipo,quantidade from public.v_saidas_mensal limit 0;
select id,item_id,minimo_anterior,minimo_novo,ideal_anterior,ideal_novo,usuario_nome,em from public.v_historico_parametros limit 0;
select id,item_id,lote_id,tipo,sinal,quantidade,motivo,justificativa,data_hora,responsavel_id,recebimento_item_id,estorno_de from public.movimentacoes limit 0;
select id,compra_id,item_id,qtd_solicitada,qtd_recebida,custo_unitario,custo_total,vencimento_previsto from public.compra_itens limit 0;
select id,data,responsavel_id,observacao,criado_em from public.recebimentos limit 0;
select recebimento_id,compra_item_id,quantidade,vencimento from public.recebimento_itens limit 0;
select id,nome,razao_social,cnpj,contato,telefone,email,endereco,observacoes,ativo from public.fornecedores limit 0;
select id,nome,superadmin from public.profiles limit 0;
select id,tabela,registro_id,acao,antes,depois,usuario_id,em,condominio_id from public.auditoria limit 0;
select id,nome,cnpj,ativo from public.condominios limit 0;
select condominio_id,faixa_atencao,venc_alerta_1,venc_alerta_2 from public.condominio_config limit 0;
select condominio_id,user_id,papel,ativo,criado_em from public.membros limit 0;
select id,condominio_id,email,papel,criado_em,usado_em from public.convites limit 0;
select id,nome,ativo from public.categorias limit 0;
select id,sigla,nome,ativo from public.unidades_medida limit 0;
select item_id,condominio_id,cobertura_dias,situacao from public.v_cobertura limit 0;
select problema,referencia,esperado,encontrado from public.verificar_consistencia('00000000-0000-0000-0000-000000000000') limit 0;
\echo colunas OK
