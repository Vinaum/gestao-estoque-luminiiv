-- ============================================================
-- 0011_rls — regras de acesso (quem vê e quem altera o quê)
--
--   * Morador: não lê estoque, compras, fornecedores nem perfis alheios.
--   * Gestor e síndico: leem tudo do próprio condomínio.
--   * Estoque, lotes, movimentações, compras e recebimentos: SÓ por função (RPC).
--   * Itens e fornecedores: escrita direta, com checagem de condomínio.
--   * Superadmin passa em todas as verificações (app.tem_papel).
-- ============================================================

alter table public.condominios enable row level security;
alter table public.condominio_config enable row level security;
alter table public.profiles enable row level security;
alter table public.membros enable row level security;
alter table public.convites enable row level security;
alter table public.categorias enable row level security;
alter table public.unidades_medida enable row level security;
alter table public.fornecedores enable row level security;
alter table public.fornecedor_categorias enable row level security;
alter table public.itens enable row level security;
alter table public.compras enable row level security;
alter table public.compra_itens enable row level security;
alter table public.recebimentos enable row level security;
alter table public.recebimento_itens enable row level security;
alter table public.lotes enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.auditoria enable row level security;

-- ---------- Permissões de tabela (a RLS filtra linhas; isto limita operações) ----------
revoke all on public.condominios, public.condominio_config, public.membros, public.convites,
  public.categorias, public.unidades_medida, public.fornecedores, public.fornecedor_categorias,
  public.itens, public.compras, public.compra_itens, public.recebimentos, public.recebimento_itens,
  public.lotes, public.movimentacoes, public.auditoria
  from anon, authenticated;

grant select on public.condominios, public.condominio_config, public.membros, public.convites,
  public.categorias, public.unidades_medida, public.fornecedores, public.fornecedor_categorias,
  public.itens, public.compras, public.compra_itens, public.recebimentos, public.recebimento_itens,
  public.lotes, public.movimentacoes, public.auditoria
  to authenticated;

-- escrita direta permitida só nestas (as demais só por função)
grant update on public.condominios, public.condominio_config to authenticated;
grant insert, update on public.fornecedores, public.itens to authenticated;
grant insert, delete on public.fornecedor_categorias to authenticated;
grant insert, update, delete on public.categorias, public.unidades_medida to authenticated;

revoke all on public.v_estoque_item, public.v_lotes, public.v_saidas_mensal, public.v_compras,
  public.v_gastos, public.v_cobertura, public.v_historico_parametros from anon;
grant select on public.v_estoque_item, public.v_lotes, public.v_saidas_mensal, public.v_compras,
  public.v_gastos, public.v_cobertura, public.v_historico_parametros to authenticated;

-- ---------- Políticas ----------
-- condomínios
drop policy if exists condominios_ler on public.condominios;
create policy condominios_ler on public.condominios
  for select to authenticated using (app.eh_membro(id));
drop policy if exists condominios_editar on public.condominios;
create policy condominios_editar on public.condominios
  for update to authenticated using (app.eh_superadmin()) with check (app.eh_superadmin());

-- parâmetros do condomínio
drop policy if exists config_ler on public.condominio_config;
create policy config_ler on public.condominio_config
  for select to authenticated using (app.tem_papel(condominio_id, array['gestor', 'sindico']));
drop policy if exists config_editar on public.condominio_config;
create policy config_editar on public.condominio_config
  for update to authenticated
  using (app.tem_papel(condominio_id, array['sindico']))
  with check (app.tem_papel(condominio_id, array['sindico']));

-- perfis: cada um vê o próprio; gestor/síndico veem quem é do seu condomínio
drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_ler on public.profiles;
create policy profiles_ler on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or app.eh_superadmin()
    or exists (
      select 1
      from public.membros alvo
      join public.membros eu on eu.condominio_id = alvo.condominio_id
      where alvo.user_id = profiles.id
        and eu.user_id = (select auth.uid()) and eu.ativo
        and eu.papel in ('gestor', 'sindico')
    )
  );
drop policy if exists profiles_atualizar_proprio on public.profiles;
create policy profiles_atualizar_proprio on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- vínculos e convites
drop policy if exists membros_ler on public.membros;
create policy membros_ler on public.membros
  for select to authenticated
  using (user_id = (select auth.uid()) or app.tem_papel(condominio_id, array['gestor', 'sindico']));

drop policy if exists convites_ler on public.convites;
create policy convites_ler on public.convites
  for select to authenticated using (app.tem_papel(condominio_id, array['sindico']));

-- catálogos
drop policy if exists categorias_ler on public.categorias;
create policy categorias_ler on public.categorias for select to authenticated using (true);
drop policy if exists categorias_gerir on public.categorias;
create policy categorias_gerir on public.categorias for all to authenticated
  using (app.eh_superadmin()) with check (app.eh_superadmin());

drop policy if exists unidades_ler on public.unidades_medida;
create policy unidades_ler on public.unidades_medida for select to authenticated using (true);
drop policy if exists unidades_gerir on public.unidades_medida;
create policy unidades_gerir on public.unidades_medida for all to authenticated
  using (app.eh_superadmin()) with check (app.eh_superadmin());

-- fornecedores
drop policy if exists fornecedores_ler on public.fornecedores;
create policy fornecedores_ler on public.fornecedores
  for select to authenticated using (app.tem_papel(condominio_id, array['gestor', 'sindico']));
drop policy if exists fornecedores_criar on public.fornecedores;
create policy fornecedores_criar on public.fornecedores
  for insert to authenticated
  with check (app.tem_papel(condominio_id, array['gestor', 'sindico']) and criado_por = (select auth.uid()));
drop policy if exists fornecedores_editar on public.fornecedores;
create policy fornecedores_editar on public.fornecedores
  for update to authenticated
  using (app.tem_papel(condominio_id, array['gestor', 'sindico']))
  with check (app.tem_papel(condominio_id, array['gestor', 'sindico']));

drop policy if exists forn_cat_ler on public.fornecedor_categorias;
create policy forn_cat_ler on public.fornecedor_categorias
  for select to authenticated using (app.tem_papel(condominio_id, array['gestor', 'sindico']));
drop policy if exists forn_cat_criar on public.fornecedor_categorias;
create policy forn_cat_criar on public.fornecedor_categorias
  for insert to authenticated with check (app.tem_papel(condominio_id, array['gestor', 'sindico']));
drop policy if exists forn_cat_apagar on public.fornecedor_categorias;
create policy forn_cat_apagar on public.fornecedor_categorias
  for delete to authenticated using (app.tem_papel(condominio_id, array['gestor', 'sindico']));

-- itens (não existe coluna de estoque: nada de estoque é editável aqui)
drop policy if exists itens_ler on public.itens;
create policy itens_ler on public.itens
  for select to authenticated using (app.tem_papel(condominio_id, array['gestor', 'sindico']));
drop policy if exists itens_criar on public.itens;
create policy itens_criar on public.itens
  for insert to authenticated
  with check (app.tem_papel(condominio_id, array['gestor', 'sindico']) and criado_por = (select auth.uid()));
drop policy if exists itens_editar on public.itens;
create policy itens_editar on public.itens
  for update to authenticated
  using (app.tem_papel(condominio_id, array['gestor', 'sindico']))
  with check (app.tem_papel(condominio_id, array['gestor', 'sindico']));

-- tabelas só de leitura direta (escrita por função)
do $$
declare
  v_tab text;
begin
  foreach v_tab in array array['compras', 'compra_itens', 'recebimentos', 'recebimento_itens', 'lotes', 'movimentacoes']
  loop
    execute format('drop policy if exists %I on public.%I', v_tab || '_ler', v_tab);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (app.tem_papel(condominio_id, array[''gestor'', ''sindico'']))',
      v_tab || '_ler', v_tab);
  end loop;
end $$;

drop policy if exists auditoria_ler on public.auditoria;
create policy auditoria_ler on public.auditoria
  for select to authenticated using (app.tem_papel(condominio_id, array['sindico']));

-- ---------- Fecha o acesso do modelo antigo (se ainda existir) ----------
-- No modelo antigo, qualquer usuário logado (inclusive morador) lia o estoque.
do $$
begin
  if to_regclass('public.items') is not null then
    drop policy if exists items_select_all on public.items;
    drop policy if exists items_select_equipe on public.items;
    create policy items_select_equipe on public.items
      for select to authenticated
      using (
        app.eh_superadmin() or exists (
          select 1 from public.membros m
          where m.user_id = (select auth.uid()) and m.ativo and m.papel in ('gestor', 'sindico'))
      );
  end if;
  if to_regclass('public.movements') is not null then
    drop policy if exists movements_select_all on public.movements;
    drop policy if exists movements_select_equipe on public.movements;
    create policy movements_select_equipe on public.movements
      for select to authenticated
      using (
        app.eh_superadmin() or exists (
          select 1 from public.membros m
          where m.user_id = (select auth.uid()) and m.ativo and m.papel in ('gestor', 'sindico'))
      );
  end if;
end $$;
