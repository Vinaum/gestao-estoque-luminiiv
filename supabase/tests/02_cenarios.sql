-- ============================================================
-- Testes dos cenários A–H e de segurança.
-- Rodam dentro de uma transação que é DESFEITA no final (nada fica salvo).
-- Uso (banco de teste local com 00_stub, legado e migrations aplicados):
--   psql -v ON_ERROR_STOP=1 -d <banco> -f 02_cenarios.sql
-- ============================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;

create schema tests;
grant usage on schema tests to authenticated, anon;
create table tests.ctx (k text primary key, v text);
grant all on tests.ctx to authenticated, anon;

create function tests.set(p_k text, p_v text) returns void language sql as $$
  insert into tests.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function tests.get(p_k text) returns text language sql as $$
  select v from tests.ctx where k = p_k $$;
create function tests.id(p_k text) returns uuid language sql as $$
  select v::uuid from tests.ctx where k = p_k $$;

create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;
create function tests.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_label; end if;
  raise notice 'OK   %', p_label;
end $$;
create function tests.igual(p_label text, p_obtido numeric, p_esperado numeric) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (esperado %, obtido %)', p_label, p_esperado, p_obtido;
  end if;
  raise notice 'OK   % = %', p_label, p_obtido;
end $$;
create function tests.texto(p_label text, p_obtido text, p_esperado text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (esperado %, obtido %)', p_label, p_esperado, p_obtido;
  end if;
  raise notice 'OK   % = %', p_label, p_obtido;
end $$;
-- Espera que o comando falhe e que a mensagem contenha o trecho.
create function tests.erro(p_label text, p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU (deveria dar erro): %', p_label;
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  if position(lower(p_trecho) in lower(sqlerrm)) = 0 then
    raise exception 'FALHOU (erro diferente do esperado "%": %): %', p_trecho, sqlerrm, p_label;
  end if;
  raise notice 'OK   % [bloqueado: %]', p_label, sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- atalhos para as pessoas
create function tests.super() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
create function tests.sind()  returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a2'::uuid $$;
create function tests.gest()  returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a3'::uuid $$;
create function tests.mor()   returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a4'::uuid $$;
grant execute on all functions in schema tests to authenticated, anon;

-- ============================================================
-- PREPARAÇÃO: migração do modelo antigo e criação do condomínio B
-- ============================================================
do $$
declare
  v_a uuid; v_b uuid; v_txt text;
begin
  raise notice '--- Preparação ---';
  select id into v_a from public.condominios order by criado_em limit 1;
  perform tests.set('condA', v_a::text);
  perform tests.ok('condomínio inicial criado a partir do modelo antigo', v_a is not null);
  perform tests.ok('superadmin antigo virou superadmin global', (select superadmin from profiles where id = tests.super()));
  perform tests.texto('síndico antigo virou membro síndico', (select papel from membros where user_id = tests.sind() and condominio_id = v_a), 'sindico');
  perform tests.texto('gestor antigo virou membro gestor', (select papel from membros where user_id = tests.gest() and condominio_id = v_a), 'gestor');
  perform tests.texto('morador antigo virou membro morador', (select papel from membros where user_id = tests.mor() and condominio_id = v_a), 'morador');
  perform tests.ok('superadmin não precisa de vínculo', not exists (select 1 from membros where user_id = tests.super()));

  -- modelo antigo: morador não lê mais o estoque antigo; equipe continua lendo
  perform tests.login(tests.mor());
  perform tests.igual('morador não lê itens do modelo antigo', (select count(*) from public.items), 0);
  perform tests.logout();
  perform tests.login(tests.gest());
  perform tests.igual('gestor ainda lê itens do modelo antigo', (select count(*) from public.items), 1);
  perform tests.logout();

  -- condomínio B (só o superadmin cria)
  perform tests.login(tests.gest());
  perform tests.erro('gestor não cria condomínio', 'select public.criar_condominio(''X'')', 'Sem permissão');
  perform tests.logout();
  perform tests.login(tests.super());
  v_b := public.criar_condominio('Condomínio B');
  perform tests.logout();
  perform tests.set('condB', v_b::text);
  perform tests.ok('superadmin criou o condomínio B', v_b is not null);
  perform tests.ok('parâmetros do condomínio B criados', exists (select 1 from condominio_config where condominio_id = v_b));

  insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-0000-0000-0000000000b2', 'sindb@teste.com', now()),
    ('00000000-0000-0000-0000-0000000000b3', 'gestb@teste.com', now());
  perform tests.login(tests.super());
  v_txt := public.convidar_membro(v_b, 'sindb@teste.com', 'sindico');
  perform tests.texto('superadmin vincula síndico do B', v_txt, 'vinculado');
  perform tests.logout();
  perform tests.login('00000000-0000-0000-0000-0000000000b2');
  v_txt := public.convidar_membro(v_b, 'gestb@teste.com', 'gestor');
  perform tests.texto('síndico do B vincula gestor do B', v_txt, 'vinculado');
  perform tests.logout();

  -- convite para e-mail ainda sem conta: só vale depois de confirmar o e-mail
  perform tests.login(tests.sind());
  v_txt := public.convidar_membro(v_a, 'novo@teste.com', 'morador');
  perform tests.texto('convite criado para e-mail sem conta', v_txt, 'convite_criado');
  perform tests.logout();
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'novo@teste.com');
  perform tests.ok('conta não confirmada NÃO recebe o convite',
    not exists (select 1 from membros where user_id = '00000000-0000-0000-0000-0000000000c1'));
  update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000c1';
  perform tests.ok('ao confirmar o e-mail, o convite vira vínculo',
    exists (select 1 from membros where user_id = '00000000-0000-0000-0000-0000000000c1' and condominio_id = v_a and papel = 'morador'));
end $$;

-- ============================================================
-- CENÁRIO A — Cadastro de item sem lotes
-- ============================================================
do $$
declare
  v_item uuid; v_cat uuid; v_un uuid; r record;
begin
  raise notice '--- Cenário A: cadastro ---';
  select id into v_cat from categorias where nome = 'Limpeza';
  select id into v_un from unidades_medida where sigla = 'cx';
  perform tests.login(tests.gest());
  insert into public.itens (condominio_id, nome, categoria_id, unidade_id, estoque_minimo, estoque_ideal, localizacao)
  values (tests.id('condA'), 'Papel toalha', v_cat, v_un, 5, 20, 'Depósito 1')
  returning id into v_item;
  perform tests.set('papel', v_item::text);
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.logout();
  perform tests.texto('A: status do item sem lotes', r.status, 'sem_estoque_cadastrado');
  perform tests.igual('A: estoque atual', r.estoque_atual, 0);
  perform tests.igual('A: quantidade sugerida (não é necessidade confirmada)', r.qtd_sugerida, 0);

  perform tests.login(tests.gest());
  perform tests.erro('não existe coluna de estoque editável',
    format('update public.itens set estoque_atual = 50 where id = %L', v_item), 'estoque_atual');
  perform tests.erro('ideal menor que mínimo é recusado',
    format('update public.itens set estoque_ideal = 1 where id = %L', v_item), 'check');
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIO B — Compra, aprovação e recebimento
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); v_forn uuid; v_compra uuid; v_ci uuid; v_rec uuid; v_rec2 uuid;
  v_chave uuid := gen_random_uuid(); r record;
begin
  raise notice '--- Cenário B: compra e recebimento ---';
  perform tests.login(tests.gest());
  insert into public.fornecedores (condominio_id, nome, cnpj) values (tests.id('condA'), 'Higiene Total', '11.222.333/0001-44')
  returning id into v_forn;
  v_compra := public.salvar_compra(tests.id('condA'), null,
    jsonb_build_object('fornecedor_id', v_forn, 'numero_nf', 'NF 100'),
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 12, 'custo_unitario', 25, 'vencimento_previsto', '2027-06-01')),
    true);
  perform tests.set('compraB', v_compra::text);
  select status into r from public.compras where id = v_compra;
  perform tests.texto('B: gestor envia a compra para aprovação', r.status, 'aguardando_aprovacao');
  select status, estoque_atual into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('B: compra registrada NÃO altera o estoque', r.estoque_atual, 0);

  perform tests.erro('B: gestor não aprova a compra', format('select public.aprovar_compra(%L)', v_compra), 'Sem permissão');
  perform tests.erro('B: não recebe compra não aprovada',
    format('select public.registrar_recebimento(%L, ''[]''::jsonb, current_date, null, gen_random_uuid())', v_compra), 'não pode receber');
  perform tests.logout();

  perform tests.login(tests.sind());
  select status into r from public.aprovar_compra(v_compra);
  perform tests.texto('B: síndico aprova', r.status, 'aprovada');
  perform tests.logout();

  perform tests.login(tests.gest());
  select id into v_ci from public.compra_itens where compra_id = v_compra;
  v_rec := public.registrar_recebimento(v_compra,
    jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 12)), current_date, 'Entrega completa', v_chave);
  v_rec2 := public.registrar_recebimento(v_compra,
    jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 12)), current_date, 'Entrega completa', v_chave);
  perform tests.ok('B: repetir a mesma operação devolve o mesmo recebimento (sem duplicar)', v_rec = v_rec2);
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('B: estoque atual após recebimento', r.estoque_atual, 12);
  perform tests.texto('B: status normal', r.status, 'normal');
  perform tests.igual('B: um lote criado', r.total_lotes, 1);
  select status into r from public.compras where id = v_compra;
  perform tests.texto('B: compra marcada como recebida', r.status, 'recebido');
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIOS C e D — Consumo e necessidade de compra
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); r record; v_chave uuid := gen_random_uuid(); n int;
begin
  raise notice '--- Cenários C e D: consumo ---';
  perform tests.login(tests.gest());
  select count(*) into n from public.registrar_saida(v_item, 'consumo', 4, 'Uso diário', v_chave);
  select count(*) into n from public.registrar_saida(v_item, 'consumo', 4, 'Uso diário', v_chave);
  perform tests.igual('C: repetir a chave não duplica a saída', (select count(*) from movimentacoes where chave_idempotencia = v_chave), 1);
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('C: estoque atual', r.estoque_atual, 8);
  perform tests.igual('C: saldo do lote', (select saldo from lotes where item_id = v_item), 8);

  perform public.registrar_saida(v_item, 'consumo', 4, 'Uso diário', gen_random_uuid());
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('D: estoque atual', r.estoque_atual, 4);
  perform tests.texto('D: status Comprar', r.status, 'comprar');
  perform tests.igual('D: quantidade sugerida (ideal 20 - atual 4)', r.qtd_sugerida, 16);
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIO E — Compra de 16 e recebimento
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); v_compra uuid; v_ci uuid; r record;
begin
  raise notice '--- Cenário E: compra de reposição ---';
  perform tests.login(tests.gest());
  v_compra := public.salvar_compra(tests.id('condA'), null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 16, 'custo_unitario', 28, 'vencimento_previsto', '2027-03-01')),
    true);
  perform tests.logout();
  perform tests.login(tests.sind());
  perform public.aprovar_compra(v_compra);
  perform tests.logout();
  perform tests.login(tests.gest());
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('E: antes do recebimento o estoque continua em 4', r.estoque_atual, 4);
  perform tests.igual('E: quantidade já em pedido', r.qtd_em_pedido, 16);

  select id into v_ci from public.compra_itens where compra_id = v_compra;
  perform public.registrar_recebimento(v_compra,
    jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 16)), current_date, null, gen_random_uuid());
  select * into r from public.v_estoque_item where item_id = v_item;
  perform tests.igual('E: depois do recebimento o estoque é 20', r.estoque_atual, 20);
  perform tests.texto('E: status Normal', r.status, 'normal');
  perform tests.igual('E: nada mais em pedido', r.qtd_em_pedido, 0);
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIO F — Recebimento parcial, vários lotes e FEFO
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); v_compra uuid; v_ci uuid; r record; n int;
  v_total numeric;
begin
  raise notice '--- Cenário F: parcial, vários lotes, FEFO ---';
  perform tests.login(tests.gest());
  v_compra := public.salvar_compra(tests.id('condA'), null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 20, 'custo_unitario', 30)), true);
  perform tests.logout();
  perform tests.login(tests.sind());
  perform public.aprovar_compra(v_compra);
  perform tests.logout();
  perform tests.login(tests.gest());
  select id into v_ci from public.compra_itens where compra_id = v_compra;

  perform public.registrar_recebimento(v_compra,
    jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 12, 'vencimento', '2027-09-01')),
    current_date, 'Primeira entrega', gen_random_uuid());
  select status into r from public.compras where id = v_compra;
  perform tests.texto('F: após 12 de 20 a compra fica parcialmente recebida', r.status, 'parcialmente_recebido');
  perform tests.erro('F: não aceita receber mais do que falta (9 de 8)',
    format('select public.registrar_recebimento(%L, %L::jsonb, current_date, null, gen_random_uuid())',
      v_compra, jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 9))::text), 'acima do pedido');
  perform public.registrar_recebimento(v_compra,
    jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 8, 'vencimento', '2027-12-01')),
    current_date, 'Segunda entrega', gen_random_uuid());
  select status into r from public.compras where id = v_compra;
  perform tests.texto('F: após 20 de 20 a compra fica recebida', r.status, 'recebido');
  perform tests.igual('F: dois recebimentos registrados', (select count(*) from recebimentos where compra_id = v_compra), 2);

  select sum(saldo) into v_total from lotes where item_id = v_item;
  perform tests.igual('F: estoque total (4 + 16 + 12 + 8)', v_total, 40);
  perform tests.igual('F: lote L001 (compra B)', (select saldo from lotes where item_id = v_item and codigo = 'L001'), 4);
  perform tests.igual('F: lote L002 (vence 01/03/2027)', (select saldo from lotes where item_id = v_item and codigo = 'L002'), 16);
  perform tests.igual('F: lote L003', (select saldo from lotes where item_id = v_item and codigo = 'L003'), 12);
  perform tests.igual('F: lote L004', (select saldo from lotes where item_id = v_item and codigo = 'L004'), 8);
  perform tests.igual('F: custo do lote L002 é diferente do L001',
    (select custo_unitario from lotes where item_id = v_item and codigo = 'L002') - (select custo_unitario from lotes where item_id = v_item and codigo = 'L001'), 3);

  -- FEFO: sai primeiro o lote que vence antes (L002, 01/03/2027)
  perform public.registrar_saida(v_item, 'consumo', 5, 'Uso diário', gen_random_uuid());
  perform tests.igual('F/FEFO: 5 saíram do lote que vence primeiro (L002)', (select saldo from lotes where item_id = v_item and codigo = 'L002'), 11);
  perform tests.igual('F/FEFO: L001 intacto', (select saldo from lotes where item_id = v_item and codigo = 'L001'), 4);
  select count(*) into n from public.registrar_saida(v_item, 'consumo', 12, 'Uso diário', gen_random_uuid());
  perform tests.igual('F/FEFO: saída de 12 dividida em 2 lotes', n, 2);
  perform tests.igual('F/FEFO: L002 zerado', (select saldo from lotes where item_id = v_item and codigo = 'L002'), 0);
  perform tests.igual('F/FEFO: o restante saiu do próximo a vencer (L001)', (select saldo from lotes where item_id = v_item and codigo = 'L001'), 3);
  perform tests.igual('F: estoque total depois (40 - 5 - 12)', (select sum(saldo) from lotes where item_id = v_item), 23);

  -- FIFO para itens sem vencimento
  declare v_it2 uuid; v_cat uuid; v_un uuid;
  begin
    select id into v_cat from categorias where nome = 'Higiene';
    select id into v_un from unidades_medida where sigla = 'pct';
    insert into public.itens (condominio_id, nome, categoria_id, unidade_id, estoque_minimo, estoque_ideal)
    values (tests.id('condA'), 'Sacos de lixo', v_cat, v_un, 2, 30) returning id into v_it2;
    perform public.registrar_entrada_extraordinaria(v_it2, 10, 'entrada_extraordinaria', 'Sobra de obra', gen_random_uuid());
    perform public.registrar_entrada_extraordinaria(v_it2, 5, 'doacao', 'Doação de morador', gen_random_uuid());
    perform public.registrar_saida(v_it2, 'consumo', 12, 'Uso diário', gen_random_uuid());
    perform tests.igual('F/FIFO: lote mais antigo esvaziado primeiro', (select saldo from lotes where item_id = v_it2 and codigo = 'L001'), 0);
    perform tests.igual('F/FIFO: o restante saiu do segundo lote', (select saldo from lotes where item_id = v_it2 and codigo = 'L002'), 3);
    perform tests.texto('F: doação recebida registrada como doação', (select tipo from movimentacoes where item_id = v_it2 and lote_id = (select id from lotes where item_id = v_it2 and codigo = 'L002') and sinal = 1), 'doacao');
    perform tests.set('sacos', v_it2::text);
  end;
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIO G — Perda, descarte, ajuste e estorno
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); v_mov uuid; r record; v_est uuid; v_l4 uuid; n int;
begin
  raise notice '--- Cenário G: perda, descarte, ajuste, estorno ---';
  perform tests.login(tests.gest());
  perform public.registrar_saida(v_item, 'perda', 1, 'Embalagem molhada', gen_random_uuid());
  perform public.registrar_saida(v_item, 'descarte', 2, 'Material danificado', gen_random_uuid());
  perform tests.igual('G: perda e descarte reduzem o saldo (23 - 1 - 2)', (select sum(saldo) from lotes where item_id = v_item), 20);
  perform tests.erro('G: saída acima do saldo é recusada', format('select public.registrar_saida(%L, ''consumo'', 999, ''x'', gen_random_uuid())', v_item), 'Saldo insuficiente');
  perform tests.erro('G: quantidade zero é recusada', format('select public.registrar_saida(%L, ''consumo'', 0, ''x'', gen_random_uuid())', v_item), 'maior que zero');
  perform tests.erro('G: tipo inválido é recusado', format('select public.registrar_saida(%L, ''entrada'', 1, ''x'', gen_random_uuid())', v_item), 'Tipo de saída inválido');
  perform tests.igual('G: saldo nunca ficou negativo', (select count(*) from lotes where saldo < 0), 0);

  -- ajuste
  select id into v_l4 from lotes where item_id = v_item and codigo = 'L003';
  perform tests.erro('G: ajuste exige justificativa', format('select public.registrar_ajuste(%L, %L, 10, ''x'', gen_random_uuid())', v_item, v_l4), 'justificativa');
  perform public.registrar_ajuste(v_item, v_l4, 10, 'Contagem física encontrou 10', gen_random_uuid());
  perform tests.igual('G: ajuste para menos reduz o lote (12 -> 10)', (select saldo from lotes where id = v_l4), 10);
  select id into v_l4 from lotes where item_id = v_item and codigo = 'L004';
  perform public.registrar_ajuste(v_item, v_l4, 11, 'Contagem física encontrou 11', gen_random_uuid());
  perform tests.igual('G: ajuste para mais cria lote de origem "ajuste"', (select count(*) from lotes where item_id = v_item and origem = 'ajuste'), 1);
  perform tests.igual('G: lote original não passa do recebido', (select saldo from lotes where id = v_l4), 8);
  perform tests.igual('G: estoque total após ajustes (20 - 2 + 3)', (select sum(saldo) from lotes where item_id = v_item), 21);
  perform tests.erro('G: ajuste sem diferença é recusado', format('select public.registrar_ajuste(%L, %L, 8, ''igual ao sistema'', gen_random_uuid())', v_item, v_l4), 'diferença');

  -- estorno
  select m.id into v_mov from movimentacoes m where m.item_id = v_item and m.tipo = 'consumo' and m.quantidade = 5 and m.estorno_de is null limit 1;
  perform public.estornar_movimentacao(v_mov, 'Lançado em duplicidade', gen_random_uuid());
  perform tests.igual('G: estorno devolve o saldo (21 + 5)', (select sum(saldo) from lotes where item_id = v_item), 26);
  perform tests.erro('G: não estorna duas vezes', format('select public.estornar_movimentacao(%L, ''de novo, por engano'', gen_random_uuid())', v_mov), 'já foi estornada');
  perform tests.erro('G: estorno exige justificativa', format('select public.estornar_movimentacao(%L, ''x'', gen_random_uuid())', v_mov), 'justificativa');
  select m.id into v_mov from movimentacoes m where m.item_id = v_item and m.recebimento_item_id is not null limit 1;
  perform tests.erro('G: recebimento de compra não é estornado aqui', format('select public.estornar_movimentacao(%L, ''recebi errado'', gen_random_uuid())', v_mov), 'Recebimentos de compra');

  -- estorno de entrada já consumida
  select m.id into v_mov from movimentacoes m where m.item_id = tests.id('sacos')::uuid and m.sinal = 1 and m.tipo = 'entrada' limit 1;
  perform tests.erro('G: não estorna entrada cujo material já foi usado', format('select public.estornar_movimentacao(%L, ''lançamento errado'', gen_random_uuid())', v_mov), 'já foi usada');
  perform tests.logout();

  -- diagnóstico
  perform tests.login(tests.sind());
  perform tests.igual('G: verificação de consistência sem divergências', (select count(*) from public.verificar_consistencia(tests.id('condA'))), 0);
  perform tests.logout();
  perform tests.login(tests.gest());
  perform tests.erro('G: gestor não roda o diagnóstico', format('select * from public.verificar_consistencia(%L)', tests.id('condA')), 'Sem permissão');
  perform tests.logout();
end $$;

-- ============================================================
-- Parâmetros, histórico, vencimentos, cobertura e gastos
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); r record; v_it uuid; v_cat uuid; v_un uuid;
begin
  raise notice '--- Parâmetros, vencimentos, cobertura, gastos ---';
  perform tests.login(tests.gest());
  perform public.atualizar_parametros_item(v_item, 6, 25);
  select * into r from public.v_historico_parametros where item_id = v_item order by id desc limit 1;
  perform tests.igual('histórico: mínimo anterior', r.minimo_anterior, 5);
  perform tests.igual('histórico: mínimo novo', r.minimo_novo, 6);
  perform tests.igual('histórico: ideal novo', r.ideal_novo, 25);
  perform tests.erro('ideal menor que o mínimo é recusado pela função', format('select public.atualizar_parametros_item(%L, 10, 5)', v_item), 'não pode ser menor');
  perform public.atualizar_parametros_item(v_item, 5, 20);
  perform tests.logout();

  perform tests.login(tests.gest());
  select id into v_cat from categorias where nome = 'Outros';
  select id into v_un from unidades_medida where sigla = 'un';
  insert into public.itens (condominio_id, nome, categoria_id, unidade_id) values (tests.id('condA'), 'Item de vencimento', v_cat, v_un) returning id into v_it;
  perform public.registrar_entrada_extraordinaria(v_it, 1, 'entrada_extraordinaria', 'Teste', gen_random_uuid(), 0, current_date - 1);
  perform public.registrar_entrada_extraordinaria(v_it, 1, 'entrada_extraordinaria', 'Teste', gen_random_uuid(), 0, current_date + 10);
  perform public.registrar_entrada_extraordinaria(v_it, 1, 'entrada_extraordinaria', 'Teste', gen_random_uuid(), 0, current_date + 60);
  perform public.registrar_entrada_extraordinaria(v_it, 1, 'entrada_extraordinaria', 'Teste', gen_random_uuid(), 0, current_date + 200);
  perform public.registrar_entrada_extraordinaria(v_it, 1, 'entrada_extraordinaria', 'Teste', gen_random_uuid());
  perform tests.texto('vencimento: lote vencido', (select faixa_vencimento from public.v_lotes where item_id = v_it and codigo = 'L001'), 'vencido');
  perform tests.texto('vencimento: até 30 dias', (select faixa_vencimento from public.v_lotes where item_id = v_it and codigo = 'L002'), 'curto_prazo');
  perform tests.texto('vencimento: até 90 dias', (select faixa_vencimento from public.v_lotes where item_id = v_it and codigo = 'L003'), 'medio_prazo');
  perform tests.texto('vencimento: fora das faixas', (select faixa_vencimento from public.v_lotes where item_id = v_it and codigo = 'L004'), 'ok');
  perform tests.texto('vencimento: sem vencimento', (select faixa_vencimento from public.v_lotes where item_id = v_it and codigo = 'L005'), 'sem_vencimento');

  -- cobertura
  select * into r from public.v_cobertura where item_id = v_item;
  perform tests.ok('cobertura calculada para item com consumo', r.cobertura_dias is not null and r.cobertura_dias > 0 and r.situacao = 'ok');
  select * into r from public.v_cobertura where item_id = v_it;
  perform tests.texto('cobertura: item com estoque e sem consumo', r.situacao, 'sem_historico');
  perform tests.ok('cobertura: sem divisão por zero (nulo)', r.cobertura_dias is null);

  -- gastos: compras B (300) + E (448) + F (600)
  perform tests.igual('gastos: soma das compras efetivadas', (select sum(valor_total) from public.v_gastos where condominio_id = tests.id('condA')), 1348);
  perform tests.logout();

  -- consumo mensal líquido (estorno descontado): consumos = 4+4+5+12 - 5 estornado = 20
  perform tests.login(tests.gest());
  perform tests.igual('consumo mensal líquido do item (4+4+5+12-5)', (select sum(quantidade) from public.v_saidas_mensal where item_id = v_item and tipo = 'consumo'), 20);
  perform tests.logout();
end $$;

-- ============================================================
-- Compras: edição, status e nota fiscal
-- ============================================================
do $$
declare
  v_item uuid := tests.id('papel'); v_compra uuid; r record; v_forn uuid;
begin
  raise notice '--- Compras: edição e status ---';
  perform tests.login(tests.gest());
  v_compra := public.salvar_compra(tests.id('condA'), null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 3, 'custo_unitario', 10)), false);
  select status into r from public.compras where id = v_compra;
  perform tests.texto('compra nova começa planejada', r.status, 'planejada');
  perform tests.erro('não é possível aprovar pelo mudar_status', format('select public.mudar_status_compra(%L, ''aprovada'')', v_compra), 'não permitida');
  perform public.mudar_status_compra(v_compra, 'aguardando_aprovacao');
  perform public.mudar_status_compra(v_compra, 'cancelado');
  select status into r from public.compras where id = v_compra;
  perform tests.texto('gestor cancela a própria compra', r.status, 'cancelado');
  perform tests.erro('compra cancelada não é editada', format('select public.salvar_compra(%L, %L, ''{}''::jsonb, ''[]''::jsonb, false)', tests.id('condA'), v_compra), 'não pode mais ser editada');
  perform tests.erro('compra cancelada não recebe', format('select public.registrar_recebimento(%L, ''[]''::jsonb, current_date, null, gen_random_uuid())', v_compra), 'não pode receber');
  perform tests.erro('compra recebida não pode ser cancelada', format('select public.mudar_status_compra(%L, ''cancelado'')', tests.id('compraB')), 'não permitida');
  perform tests.erro('compra sem itens não é enviada', format('select public.salvar_compra(%L, null, ''{}''::jsonb, ''[]''::jsonb, true)', tests.id('condA')), 'ao menos um item');
  perform tests.erro('item de outro condomínio na compra', format('select public.salvar_compra(%L, null, ''{}''::jsonb, %L::jsonb, false)', tests.id('condB'),
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 1))::text), 'Sem permissão');

  -- nota fiscal
  select * into r from public.atualizar_nf_compra(tests.id('compraB'), 'NF 100-A', tests.get('condA') || '/' || tests.get('compraB') || '/nf.pdf');
  perform tests.texto('número da NF atualizado', r.numero_nf, 'NF 100-A');
  perform tests.erro('anexo de outro condomínio é recusado',
    format('select public.atualizar_nf_compra(%L, ''NF'', %L)', tests.id('compraB'), tests.get('condB') || '/x/nf.pdf'), 'outro condomínio');
  perform tests.logout();

  -- síndico cria e aprova a própria compra
  perform tests.login(tests.sind());
  v_compra := public.salvar_compra(tests.id('condA'), null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qtd_solicitada', 2, 'custo_unitario', 5)), false);
  select status into r from public.aprovar_compra(v_compra);
  perform tests.texto('síndico aprova compra própria (planejada -> aprovada)', r.status, 'aprovada');
  perform tests.erro('compra aprovada não é mais editada', format('select public.salvar_compra(%L, %L, ''{}''::jsonb, ''[]''::jsonb, false)', tests.id('condA'), v_compra), 'não pode mais ser editada');
  perform tests.logout();
end $$;

-- ============================================================
-- CENÁRIO H — Segurança
-- ============================================================
do $$
declare
  v_a uuid := tests.id('condA'); v_b uuid := tests.id('condB'); v_itemB uuid; v_cat uuid; v_un uuid;
  v_item uuid := tests.id('papel'); v_lote uuid; v_mov uuid;
begin
  raise notice '--- Cenário H: segurança ---';
  select id into v_cat from categorias where nome = 'Outros';
  select id into v_un from unidades_medida where sigla = 'un';
  select id into v_lote from lotes where item_id = v_item limit 1;
  select id into v_mov from movimentacoes where item_id = v_item limit 1;

  -- item do condomínio B (criado pelo gestor do B)
  perform tests.login('00000000-0000-0000-0000-0000000000b3');
  insert into public.itens (condominio_id, nome, categoria_id, unidade_id) values (v_b, 'Item do B', v_cat, v_un) returning id into v_itemB;
  perform public.registrar_entrada_extraordinaria(v_itemB, 10, 'entrada_extraordinaria', 'Teste B', gen_random_uuid());
  perform tests.logout();

  -- ----- gestor do A -----
  perform tests.login(tests.gest());
  perform tests.erro('H gestor: não altera papéis', format('select public.alterar_papel_membro(%L, %L, ''gestor'')', v_a, tests.mor()), 'Sem permissão');
  perform tests.erro('H gestor: não convida', format('select public.convidar_membro(%L, ''a@b.com'', ''morador'')', v_a), 'Sem permissão');
  perform tests.erro('H gestor: não insere lote direto', format('insert into public.lotes (condominio_id, item_id, codigo, qtd_recebida, saldo, origem) values (%L, %L, ''X'', 5, 5, ''compra'')', v_a, v_item), 'permission denied');
  perform tests.erro('H gestor: não insere movimentação direta', format('insert into public.movimentacoes (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, chave_idempotencia) values (%L, %L, %L, ''entrada'', 1, 5, ''x'', gen_random_uuid())', v_a, v_item, v_lote), 'permission denied');
  perform tests.erro('H gestor: não altera saldo direto', format('update public.lotes set saldo = 999 where id = %L', v_lote), 'permission denied');
  perform tests.erro('H gestor: não apaga movimentação', format('delete from public.movimentacoes where id = %L', v_mov), 'permission denied');
  perform tests.erro('H gestor: não muda status de compra direto', format('update public.compras set status = ''aprovada'' where id = %L', tests.id('compraB')), 'permission denied');
  perform tests.erro('H gestor: não cria compra direto', format('insert into public.compras (condominio_id) values (%L)', v_a), 'permission denied');
  perform tests.erro('H gestor: não troca o condomínio de um item', format('update public.itens set condominio_id = %L where id = %L', v_b, v_item), 'não pode ser alterada');
  perform tests.erro('H gestor: não cria item no condomínio B', format('insert into public.itens (condominio_id, nome, categoria_id, unidade_id) values (%L, ''Invasor'', %L, %L)', v_b, v_cat, v_un), 'row-level security');
  perform tests.erro('H gestor: não finge ser outra pessoa ao criar item', format('insert into public.itens (condominio_id, nome, categoria_id, unidade_id, criado_por) values (%L, ''Falso'', %L, %L, %L)', v_a, v_cat, v_un, tests.sind()), 'row-level security');
  perform tests.igual('H gestor: não enxerga itens do B', (select count(*) from public.itens where condominio_id = v_b), 0);
  perform tests.erro('H gestor: não mexe em item do B por função', format('select public.registrar_saida(%L, ''consumo'', 1, ''x'', gen_random_uuid())', v_itemB), 'Sem permissão');
  perform tests.igual('H gestor: não lê a auditoria', (select count(*) from public.auditoria), 0);
  perform tests.ok('H gestor: vê os membros do próprio condomínio', (select count(*) from public.membros where condominio_id = v_a) >= 3);
  perform tests.igual('H gestor: não vê perfis do condomínio B', (select count(*) from public.profiles where id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3')), 0);
  perform tests.erro('H gestor: não se promove a superadmin', format('update public.profiles set superadmin = true where id = %L', tests.gest()), 'Sem permissão');
  perform tests.logout();

  -- ----- morador -----
  perform tests.login(tests.mor());
  perform tests.igual('H morador: não lê itens', (select count(*) from public.itens), 0);
  perform tests.igual('H morador: não lê estoque (view)', (select count(*) from public.v_estoque_item), 0);
  perform tests.igual('H morador: não lê lotes', (select count(*) from public.lotes), 0);
  perform tests.igual('H morador: não lê movimentações', (select count(*) from public.movimentacoes), 0);
  perform tests.igual('H morador: não lê compras', (select count(*) from public.compras), 0);
  perform tests.igual('H morador: não lê gastos', (select count(*) from public.v_gastos), 0);
  perform tests.igual('H morador: não lê fornecedores', (select count(*) from public.fornecedores), 0);
  perform tests.igual('H morador: não lê a auditoria', (select count(*) from public.auditoria), 0);
  perform tests.igual('H morador: vê só o próprio vínculo', (select count(*) from public.membros), 1);
  perform tests.igual('H morador: vê só o próprio perfil', (select count(*) from public.profiles), 1);
  perform tests.igual('H morador: vê só o próprio condomínio', (select count(*) from public.condominios), 1);
  perform tests.ok('H morador: lê os catálogos', (select count(*) from public.categorias) > 0);
  perform tests.erro('H morador: não registra saída', format('select public.registrar_saida(%L, ''consumo'', 1, ''x'', gen_random_uuid())', v_item), 'Sem permissão');
  perform tests.erro('H morador: não cria compra', format('select public.salvar_compra(%L, null, ''{}''::jsonb, ''[]''::jsonb, false)', v_a), 'Sem permissão');
  perform tests.erro('H morador: não cria item', format('insert into public.itens (condominio_id, nome, categoria_id, unidade_id) values (%L, ''X'', %L, %L)', v_a, v_cat, v_un), 'row-level security');
  perform tests.erro('H morador: não se promove a superadmin', format('update public.profiles set superadmin = true where id = %L', tests.mor()), 'Sem permissão');
  perform tests.logout();

  -- ----- síndico do A -----
  perform tests.login(tests.sind());
  perform tests.igual('H síndico A: não enxerga itens do B', (select count(*) from public.itens where condominio_id = v_b), 0);
  perform tests.erro('H síndico A: não mexe no B por função', format('select public.registrar_saida(%L, ''consumo'', 1, ''x'', gen_random_uuid())', v_itemB), 'Sem permissão');
  perform tests.erro('H síndico A: não convida para o B', format('select public.convidar_membro(%L, ''x@teste.com'', ''gestor'')', v_b), 'Sem permissão');
  perform tests.erro('H síndico A: não define síndico', format('select public.convidar_membro(%L, ''x@teste.com'', ''sindico'')', v_a), 'Só o superadmin');
  perform public.alterar_papel_membro(v_a, tests.gest(), 'morador');
  perform tests.texto('H síndico A: rebaixa gestor a morador', (select papel from membros where user_id = tests.gest() and condominio_id = v_a), 'morador');
  perform public.alterar_papel_membro(v_a, tests.gest(), 'gestor');
  perform tests.texto('H síndico A: devolve o papel de gestor', (select papel from membros where user_id = tests.gest() and condominio_id = v_a), 'gestor');
  perform tests.erro('H síndico A: não promove ninguém a síndico', format('select public.alterar_papel_membro(%L, %L, ''sindico'')', v_a, tests.gest()), 'Só o superadmin');
  perform tests.erro('H síndico A: não altera o próprio papel', format('select public.alterar_papel_membro(%L, %L, ''gestor'')', v_a, tests.sind()), 'próprio papel');
  perform tests.ok('H síndico A: lê a auditoria do próprio condomínio', (select count(*) from public.auditoria) > 0);
  perform tests.igual('H síndico A: auditoria não mostra o B', (select count(*) from public.auditoria where condominio_id = v_b), 0);
  perform tests.erro('H síndico A: não se promove a superadmin', format('update public.profiles set superadmin = true where id = %L', tests.sind()), 'Sem permissão');
  perform tests.logout();

  -- ----- superadmin -----
  perform tests.login(tests.super());
  perform tests.ok('H superadmin: vê itens dos dois condomínios',
    (select count(distinct condominio_id) from public.itens) = 2);
  perform public.alterar_papel_membro(v_a, tests.gest(), 'sindico');
  perform tests.texto('H superadmin: define síndico', (select papel from membros where user_id = tests.gest() and condominio_id = v_a), 'sindico');
  perform public.alterar_papel_membro(v_a, tests.gest(), 'gestor');
  perform tests.erro('H superadmin: também não altera o próprio papel', format('select public.alterar_papel_membro(%L, %L, ''gestor'')', v_a, tests.super()), 'próprio papel');
  perform tests.logout();

  -- ----- anônimo (sem login) -----
  execute 'set local role anon';
  perform tests.erro('H anônimo: não lê itens', 'select count(*) from public.itens', 'permission denied');
  perform tests.erro('H anônimo: não chama funções', format('select public.registrar_saida(%L, ''consumo'', 1, ''x'', gen_random_uuid())', v_item), 'permission denied');
  execute 'reset role';

  -- ----- imutabilidade (vale até para o administrador do banco) -----
  perform tests.erro('H imutável: movimentação não muda', format('update public.movimentacoes set quantidade = 1 where id = %L', v_mov), 'não pode ser alterado');
  perform tests.erro('H imutável: movimentação não é apagada', format('delete from public.movimentacoes where id = %L', v_mov), 'não pode ser alterado');
  perform tests.erro('H imutável: movimentações não são esvaziadas', 'truncate public.movimentacoes', 'não pode ser alterado');
  perform tests.erro('H imutável: lote não é apagado', format('delete from public.lotes where id = %L', v_lote), 'não podem ser apagados');
  perform tests.erro('H imutável: quantidade recebida do lote não muda', format('update public.lotes set qtd_recebida = 100 where id = %L', v_lote), 'Só o saldo');
  perform tests.erro('H imutável: auditoria não muda', 'update public.auditoria set acao = ''x''', 'não pode ser alterado');
  perform tests.erro('H integridade: lote não pode ter saldo acima do recebido', format('update public.lotes set saldo = qtd_recebida + 1 where id = %L', v_lote), 'check');
  perform tests.erro('H integridade: saldo negativo é impossível', format('update public.lotes set saldo = -1 where id = %L', v_lote), 'check');
  perform tests.erro('H integridade: compra do A não aceita linha do condomínio B',
    format('insert into public.compra_itens (compra_id, condominio_id, item_id, qtd_solicitada) values (%L, %L, %L, 1)', tests.id('compraB'), v_b, v_itemB), 'foreign key');
  perform tests.erro('H integridade: movimentação não aponta lote de outro item',
    format('insert into public.movimentacoes (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, responsavel_id, chave_idempotencia) values (%L, %L, %L, ''entrada'', 1, 1, ''x'', %L, gen_random_uuid())', v_a, v_itemB, v_lote, tests.gest()), 'foreign key');
  -- superadmin definido por operação administrativa (SQL Editor): permitido
  update public.profiles set superadmin = true where id = tests.sind();
  perform tests.ok('H admin do banco pode definir superadmin pelo SQL Editor', (select superadmin from profiles where id = tests.sind()));
  update public.profiles set superadmin = false where id = tests.sind();
end $$;

-- ============================================================
-- Armazenamento das notas fiscais
-- ============================================================
do $$
declare
  v_a text := tests.get('condA'); v_b text := tests.get('condB'); v_compra text := tests.get('compraB');
begin
  raise notice '--- Notas fiscais (Storage) ---';
  perform tests.login(tests.gest());
  insert into storage.objects (bucket_id, name) values ('notas-fiscais', v_a || '/' || v_compra || '/nf.pdf');
  perform tests.ok('gestor anexa NF no próprio condomínio', true);
  perform tests.ok('gestor lê a NF do próprio condomínio', (select count(*) from storage.objects where bucket_id = 'notas-fiscais') = 1);
  perform tests.erro('gestor não anexa NF em outro condomínio', format('insert into storage.objects (bucket_id, name) values (''notas-fiscais'', %L)', v_b || '/x/nf.pdf'), 'row-level security');
  perform tests.logout();
end $$;
-- (o delete por RLS não dá erro: apenas não apaga. Conferimos o efeito:)
do $$
begin
  perform tests.logout();
  perform tests.login(tests.gest());
  delete from storage.objects where bucket_id = 'notas-fiscais';
  perform tests.logout();
  perform tests.ok('gestor não conseguiu apagar a NF', (select count(*) from storage.objects where bucket_id = 'notas-fiscais') = 1);
  perform tests.login(tests.mor());
  perform tests.igual('morador não lê NF', (select count(*) from storage.objects where bucket_id = 'notas-fiscais'), 0);
  perform tests.erro('morador não anexa NF', format('insert into storage.objects (bucket_id, name) values (''notas-fiscais'', %L)', tests.get('condA') || '/x/y.pdf'), 'row-level security');
  perform tests.logout();
  perform tests.login(tests.sind());
  delete from storage.objects where bucket_id = 'notas-fiscais';
  perform tests.logout();
  perform tests.ok('síndico apaga a NF', (select count(*) from storage.objects where bucket_id = 'notas-fiscais') = 0);
end $$;

-- ============================================================
-- Convites pendentes: cancelar e alterar
-- ============================================================
do $$
declare
  v_a uuid := tests.id('condA'); v_b uuid := tests.id('condB'); v_id uuid; v_id2 uuid; v_sind uuid;
begin
  raise notice '--- Convites pendentes ---';
  -- síndico convida por engano
  perform tests.login(tests.sind());
  perform public.convidar_membro(v_a, 'engano@teste.com', 'morador');
  perform public.convidar_membro(v_a, 'outro@teste.com', 'gestor');
  select id into v_id from public.convites where condominio_id = v_a and email = 'engano@teste.com';
  select id into v_id2 from public.convites where condominio_id = v_a and email = 'outro@teste.com';
  perform tests.ok('I síndico vê o convite pendente', v_id is not null);

  perform public.alterar_convite_papel(v_id2, 'morador');
  perform tests.texto('I síndico altera o papel do convite', (select papel from public.convites where id = v_id2), 'morador');
  perform tests.erro('I mesmo papel é recusado', format('select public.alterar_convite_papel(%L, ''morador'')', v_id2), 'já está');
  perform tests.erro('I síndico não promove convite a síndico', format('select public.alterar_convite_papel(%L, ''sindico'')', v_id2), 'superadmin');
  perform tests.erro('I papel inválido é recusado', format('select public.alterar_convite_papel(%L, ''zelador'')', v_id2), 'Papel inválido');

  perform public.cancelar_convite(v_id);
  perform tests.igual('I síndico cancela o convite (some da lista)', (select count(*) from public.convites where id = v_id), 0);
  perform tests.erro('I cancelar de novo dá erro claro', format('select public.cancelar_convite(%L)', v_id), 'não encontrado');
  perform tests.logout();

  -- o e-mail cancelado pode ser convidado de novo e a pessoa não herda o convite antigo
  perform tests.login(tests.sind());
  perform public.convidar_membro(v_a, 'engano@teste.com', 'gestor');
  perform tests.texto('I e-mail cancelado pode ser convidado de novo', (select papel from public.convites where condominio_id = v_a and email = 'engano@teste.com'), 'gestor');
  perform public.cancelar_convite((select id from public.convites where condominio_id = v_a and email = 'engano@teste.com'));
  perform tests.logout();
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e1', 'engano@teste.com', now());
  perform tests.ok('I quem teve o convite cancelado não entra no condomínio ao criar conta',
    not exists (select 1 from public.membros where user_id = '00000000-0000-0000-0000-0000000000e1'));

  -- segurança
  perform tests.login(tests.gest());
  perform tests.erro('I gestor não cancela convite', format('select public.cancelar_convite(%L)', v_id2), 'Sem permissão');
  perform tests.erro('I gestor não altera convite', format('select public.alterar_convite_papel(%L, ''gestor'')', v_id2), 'Sem permissão');
  perform tests.logout();
  perform tests.login(tests.mor());
  perform tests.erro('I morador não cancela convite', format('select public.cancelar_convite(%L)', v_id2), 'Sem permissão');
  perform tests.logout();
  perform tests.login('00000000-0000-0000-0000-0000000000b2');
  perform tests.erro('I síndico do B não mexe em convite do A', format('select public.cancelar_convite(%L)', v_id2), 'Sem permissão');
  perform tests.logout();
  perform tests.login(tests.sind());
  perform tests.erro('I ninguém apaga convite direto na tabela', format('delete from public.convites where id = %L', v_id2), 'permission denied');
  perform tests.logout();

  -- convite de síndico: só o superadmin
  perform tests.login(tests.super());
  perform public.convidar_membro(v_a, 'novo.sindico@teste.com', 'sindico');
  select id into v_sind from public.convites where condominio_id = v_a and email = 'novo.sindico@teste.com';
  perform tests.logout();
  perform tests.login(tests.sind());
  perform tests.erro('I síndico não cancela convite de síndico', format('select public.cancelar_convite(%L)', v_sind), 'superadmin');
  perform tests.erro('I síndico não rebaixa convite de síndico', format('select public.alterar_convite_papel(%L, ''gestor'')', v_sind), 'superadmin');
  perform tests.logout();
  perform tests.login(tests.super());
  perform public.cancelar_convite(v_sind);
  perform tests.igual('I superadmin cancela convite de síndico', (select count(*) from public.convites where id = v_sind), 0);
  perform tests.logout();

  -- convite já usado não muda
  perform tests.login(tests.sind());
  perform public.convidar_membro(v_a, 'usado@teste.com', 'morador');
  perform tests.logout();
  update public.convites set usado_em = now() where condominio_id = v_a and email = 'usado@teste.com';
  perform tests.login(tests.sind());
  perform tests.erro('I convite já usado não é cancelado', format('select public.cancelar_convite(%L)', (select id from public.convites where email = 'usado@teste.com' and condominio_id = v_a)), 'já foi usado');
  perform tests.erro('I convite já usado não é alterado', format('select public.alterar_convite_papel(%L, ''gestor'')', (select id from public.convites where email = 'usado@teste.com' and condominio_id = v_a)), 'já foi usado');
  perform tests.logout();

  -- auditoria
  perform tests.login(tests.sind());
  perform tests.ok('I cancelamento e alteração ficam na auditoria',
    (select count(*) from public.auditoria where tabela = 'convites' and acao = 'cancelar' and condominio_id = v_a) >= 2
    and (select count(*) from public.auditoria where tabela = 'convites' and acao = 'alterar_papel' and condominio_id = v_a) >= 1);
  perform tests.logout();
end $$;

-- ============================================================
-- Permissões do gestor: fornecedores (sem ativar/desativar) e leitura de gastos
-- ============================================================
do $$
declare
  v_a uuid := tests.id('condA'); v_f uuid; v_n_sind bigint; v_n_gest bigint; v_g_sind bigint; v_g_gest bigint; v_i_sind numeric; v_i_gest numeric;
begin
  raise notice '--- Permissões do gestor ---';
  perform tests.login(tests.gest());
  insert into public.fornecedores (condominio_id, nome) values (v_a, 'Forn do gestor') returning id into v_f;
  perform tests.ok('P gestor cadastra fornecedor', v_f is not null);
  update public.fornecedores set nome = 'Forn do gestor (editado)', telefone = '11999990000' where id = v_f;
  perform tests.texto('P gestor edita dados do fornecedor', (select nome from public.fornecedores where id = v_f), 'Forn do gestor (editado)');
  perform tests.erro('P gestor não desativa fornecedor', format('update public.fornecedores set ativo = false where id = %L', v_f), 'Só o síndico');
  perform tests.erro('P gestor não cria fornecedor já inativo', format('insert into public.fornecedores (condominio_id, nome, ativo) values (%L, ''Nasce inativo'', false)', v_a), 'Só o síndico');
  perform tests.ok('P fornecedor segue ativo depois da tentativa', (select ativo from public.fornecedores where id = v_f));
  perform tests.erro('P gestor não apaga fornecedor', format('delete from public.fornecedores where id = %L', v_f), 'permission denied');
  perform tests.logout();

  perform tests.login(tests.sind());
  update public.fornecedores set ativo = false where id = v_f;
  perform tests.ok('P síndico desativa fornecedor', not (select ativo from public.fornecedores where id = v_f));
  perform tests.logout();
  perform tests.login(tests.gest());
  perform tests.erro('P gestor não reativa fornecedor', format('update public.fornecedores set ativo = true where id = %L', v_f), 'Só o síndico');
  update public.fornecedores set observacoes = 'editado inativo' where id = v_f;
  perform tests.ok('P gestor ainda edita outros campos de fornecedor inativo', (select observacoes from public.fornecedores where id = v_f) = 'editado inativo');
  perform tests.logout();
  perform tests.login(tests.sind());
  update public.fornecedores set ativo = true where id = v_f;
  perform tests.ok('P síndico reativa fornecedor', (select ativo from public.fornecedores where id = v_f));
  select count(*) into v_n_sind from public.v_compras where condominio_id = v_a;
  select count(*) into v_g_sind from public.v_gastos where condominio_id = v_a;
  select coalesce(sum(custo_total), 0) into v_i_sind from public.compra_itens ci join public.compras c on c.id = ci.compra_id where c.condominio_id = v_a;
  perform tests.logout();

  -- o gestor enxerga os mesmos números usados no painel e no relatório de gastos
  perform tests.login(tests.gest());
  select count(*) into v_n_gest from public.v_compras where condominio_id = v_a;
  select count(*) into v_g_gest from public.v_gastos where condominio_id = v_a;
  select coalesce(sum(custo_total), 0) into v_i_gest from public.compra_itens ci join public.compras c on c.id = ci.compra_id where c.condominio_id = v_a;
  perform tests.ok('P há compras para comparar', v_n_sind > 0);
  perform tests.igual('P gestor vê as mesmas compras que o síndico (v_compras)', v_n_gest, v_n_sind);
  perform tests.igual('P gestor vê o mesmo gasto que o síndico (v_gastos)', v_g_gest, v_g_sind);
  perform tests.igual('P gestor vê os mesmos custos dos itens de compra', v_i_gest, v_i_sind);
  perform tests.erro('P gestor continua sem aprovar compra', format('select public.aprovar_compra(%L)', tests.id('compraB')), 'Sem permissão');
  perform tests.logout();

  perform tests.login(tests.mor());
  perform tests.igual('P morador não vê compras', (select count(*) from public.v_compras where condominio_id = v_a), 0);
  perform tests.igual('P morador não vê gastos', (select count(*) from public.v_gastos where condominio_id = v_a), 0);
  perform tests.igual('P morador não vê fornecedores', (select count(*) from public.fornecedores where condominio_id = v_a), 0);
  perform tests.logout();
end $$;

-- ============================================================
-- Conferência final de consistência (todos os condomínios)
-- ============================================================
do $$
begin
  raise notice '--- Conferência final ---';
  perform tests.login(tests.super());
  perform tests.igual('consistência final do condomínio A', (select count(*) from public.verificar_consistencia(tests.id('condA'))), 0);
  perform tests.igual('consistência final do condomínio B', (select count(*) from public.verificar_consistencia(tests.id('condB'))), 0);
  perform tests.logout();
  raise notice '=== TODOS OS TESTES PASSARAM ===';
end $$;

rollback;
