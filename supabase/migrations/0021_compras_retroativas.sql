-- ============================================================
-- 0021_compras_retroativas — lançar notas fiscais antigas
--
--   * só o síndico lança: data, valor total, fornecedor, número da nota,
--     categoria e observação (sem itens); o PDF vai pelo anexo de NF de sempre
--   * a compra já nasce "recebida" e aprovada por quem lançou, entra nos gastos
--     e no painel, mas NÃO mexe no estoque (não há itens nem recebimento)
--   * o síndico pode corrigir ou excluir um lançamento retroativo
-- Pode ser repetida sem dano. Compras existentes não mudam.
-- ============================================================

alter table public.compras add column if not exists retroativa boolean not null default false;
alter table public.compras add column if not exists valor_informado numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compras_retroativa_check' and conrelid = 'public.compras'::regclass) then
    alter table public.compras add constraint compras_retroativa_check check (
      (retroativa and status = 'recebido' and valor_informado > 0)
      or (not retroativa and valor_informado is null)
    );
  end if;
end $$;

-- Compra retroativa não recebe itens (o valor é o informado).
create or replace function app.compra_itens_sem_retroativa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.compras where id = new.compra_id and retroativa) then
    raise exception 'Lançamento retroativo não tem itens.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists compra_itens_sem_retroativa on public.compra_itens;
create trigger compra_itens_sem_retroativa before insert or update on public.compra_itens
  for each row execute function app.compra_itens_sem_retroativa();

-- Lê e confere os dados do lançamento. Devolve um registro pronto para gravar.
create or replace function app.ler_compra_retroativa(p_condominio_id uuid, p_dados jsonb,
  out data_compra date, out valor numeric, out fornecedor_id uuid, out categoria_id uuid,
  out numero_nf text, out observacoes text)
language plpgsql
stable
set search_path = public
as $$
begin
  begin
    data_compra := nullif(p_dados ->> 'data_compra', '')::date;
    valor := nullif(p_dados ->> 'valor', '')::numeric;
    fornecedor_id := nullif(p_dados ->> 'fornecedor_id', '')::uuid;
    categoria_id := nullif(p_dados ->> 'categoria_id', '')::uuid;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end;
  numero_nf := nullif(trim(coalesce(p_dados ->> 'numero_nf', '')), '');
  observacoes := nullif(trim(coalesce(p_dados ->> 'observacoes', '')), '');

  if data_compra is null then
    raise exception 'Informe a data da nota.' using errcode = '22023';
  end if;
  if data_compra > current_date then
    raise exception 'A data da nota não pode ser no futuro.' using errcode = '22023';
  end if;
  if data_compra < date '2000-01-01' then
    raise exception 'Data da nota inválida.' using errcode = '22023';
  end if;
  if valor is null or valor <= 0 then
    raise exception 'Informe o valor da nota (maior que zero).' using errcode = '22023';
  end if;
  if valor > 10000000 then
    raise exception 'Valor alto demais. Confira o número digitado.' using errcode = '22023';
  end if;
  valor := round(valor, 2);
  if numero_nf is not null and length(numero_nf) > 60 then
    raise exception 'Número da nota com até 60 caracteres.' using errcode = '22023';
  end if;
  if observacoes is not null and length(observacoes) > 1000 then
    raise exception 'Observação com até 1000 caracteres.' using errcode = '22023';
  end if;
  if fornecedor_id is not null and not exists (
       select 1 from public.fornecedores where id = fornecedor_id and condominio_id = p_condominio_id) then
    raise exception 'Fornecedor não encontrado neste condomínio.' using errcode = 'P0002';
  end if;
  if categoria_id is not null and not exists (select 1 from public.categorias where id = categoria_id) then
    raise exception 'Categoria não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- Cria (p_id nulo) ou corrige um lançamento retroativo. Só o síndico.
-- p_dados: {data_compra, valor, fornecedor_id, categoria_id, numero_nf, observacoes}
create or replace function public.salvar_compra_retroativa(p_condominio_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  v_atual public.compras%rowtype;
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico']);
  select * into d from app.ler_compra_retroativa(p_condominio_id, coalesce(p_dados, '{}'::jsonb));

  if p_id is null then
    insert into public.compras
      (condominio_id, data_compra, fornecedor_id, numero_nf, categoria_id, observacoes, status,
       responsavel_id, aprovada_por, aprovada_em, retroativa, valor_informado)
    values
      (p_condominio_id, d.data_compra, d.fornecedor_id, d.numero_nf, d.categoria_id, d.observacoes, 'recebido',
       auth.uid(), auth.uid(), now(), true, d.valor)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_atual from public.compras where id = p_id for update;
  if not found or v_atual.condominio_id <> p_condominio_id then
    raise exception 'Lançamento não encontrado.' using errcode = 'P0002';
  end if;
  if not v_atual.retroativa then
    raise exception 'Só lançamentos retroativos podem ser corrigidos aqui.' using errcode = '22023';
  end if;
  update public.compras
     set data_compra = d.data_compra, fornecedor_id = d.fornecedor_id, numero_nf = d.numero_nf,
         categoria_id = d.categoria_id, observacoes = d.observacoes, valor_informado = d.valor
   where id = p_id;
  return p_id;
end;
$$;

-- Exclui um lançamento retroativo (só o síndico). Devolve o caminho do PDF para a tela apagar.
create or replace function public.excluir_compra_retroativa(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.compras%rowtype;
begin
  select * into v from public.compras where id = p_id for update;
  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v.condominio_id, array['sindico']);
  if not v.retroativa then
    raise exception 'Só lançamentos retroativos podem ser excluídos. Compras normais são canceladas.' using errcode = '22023';
  end if;
  delete from public.compras where id = p_id;
  return v.nf_arquivo_path;
end;
$$;

do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('salvar_compra_retroativa', 'excluir_compra_retroativa')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;
revoke all on function app.ler_compra_retroativa(uuid, jsonb) from public, anon;

-- ---------- Leitura ----------
-- O valor da compra retroativa é o informado; colunas novas no fim.
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
  case when c.retroativa then c.valor_informado else coalesce(t.valor_total, 0) end as valor_total,
  coalesce(t.qtd_itens, 0) as qtd_itens,
  c.retroativa
from public.compras c
left join public.fornecedores f on f.id = c.fornecedor_id
left join public.categorias cat on cat.id = c.categoria_id
left join lateral (
  select sum(ci.custo_total) as valor_total, count(*) as qtd_itens
  from public.compra_itens ci where ci.compra_id = c.id
) t on true;
