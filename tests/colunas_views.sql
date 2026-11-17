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
\echo colunas OK
