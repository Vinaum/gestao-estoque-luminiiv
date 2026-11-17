-- ============================================================
-- 0008_funcoes — operações de negócio (RPC)
--
-- Toda mudança de estoque passa por aqui, dentro de UMA transação.
-- Regras comuns:
--   * conferem papel e condomínio (app.exigir);
--   * travam a linha do item (FOR UPDATE) antes de mexer nos lotes,
--     o que serializa operações concorrentes sobre o mesmo item;
--   * aceitam uma chave de idempotência: repetir a mesma chave
--     (duplo clique, nova tentativa) devolve o resultado original.
-- ============================================================

-- Próximo código de lote do item (L001, L002...). Chamar com o item travado.
create or replace function app.proximo_codigo_lote(p_item_id uuid)
returns text
language sql
set search_path = public
as $$
  select 'L' || lpad((count(*) + 1)::text, 3, '0') from public.lotes where item_id = p_item_id
$$;

-- ------------------------------------------------------------
-- Saídas: consumo, perda, descarte, doação feita
-- Sem lote informado: FEFO (vence primeiro, sai primeiro) e depois FIFO.
-- ------------------------------------------------------------
create or replace function public.registrar_saida(
  p_item_id uuid,
  p_tipo text,
  p_quantidade numeric,
  p_motivo text,
  p_chave uuid,
  p_observacao text default null,
  p_lote_id uuid default null
)
returns setof public.movimentacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.itens%rowtype;
  v_lote public.lotes%rowtype;
  v_mov public.movimentacoes%rowtype;
  v_restante numeric;
  v_uso numeric;
  v_disp numeric;
begin
  select * into v_item from public.itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_item.condominio_id, array['gestor', 'sindico']);

  if p_tipo not in ('consumo', 'perda', 'descarte', 'doacao') then
    raise exception 'Tipo de saída inválido.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Informe uma quantidade maior que zero.' using errcode = '22023';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Informe o motivo.' using errcode = '22023';
  end if;
  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;
  if not v_item.ativo then
    raise exception 'Este item está inativo.' using errcode = '22023';
  end if;

  -- Repetição da mesma operação: devolve o que já foi registrado.
  if exists (select 1 from public.movimentacoes
             where condominio_id = v_item.condominio_id and chave_idempotencia = p_chave) then
    if exists (select 1 from public.movimentacoes
               where condominio_id = v_item.condominio_id and chave_idempotencia = p_chave
                 and item_id <> p_item_id) then
      raise exception 'Esta chave de operação já foi usada em outro registro.' using errcode = '23505';
    end if;
    return query select * from public.movimentacoes
                 where condominio_id = v_item.condominio_id and chave_idempotencia = p_chave
                 order by criado_em, id;
    return;
  end if;

  if p_lote_id is not null then
    select * into v_lote from public.lotes
     where id = p_lote_id and item_id = p_item_id for update;
    if not found then
      raise exception 'Lote não encontrado para este item.' using errcode = 'P0002';
    end if;
    if v_lote.saldo < p_quantidade then
      raise exception 'Saldo insuficiente no lote %. Disponível: %.', v_lote.codigo, v_lote.saldo
        using errcode = '23514';
    end if;
    update public.lotes set saldo = saldo - p_quantidade where id = v_lote.id;
    insert into public.movimentacoes
      (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, observacao,
       responsavel_id, chave_idempotencia)
    values
      (v_item.condominio_id, p_item_id, v_lote.id, p_tipo, -1, p_quantidade, trim(p_motivo),
       p_observacao, auth.uid(), p_chave)
    returning * into v_mov;
    return next v_mov;
    return;
  end if;

  select coalesce(sum(saldo), 0) into v_disp from public.lotes where item_id = p_item_id;
  if v_disp < p_quantidade then
    raise exception 'Saldo insuficiente. Disponível: %.', v_disp using errcode = '23514';
  end if;

  v_restante := p_quantidade;
  for v_lote in
    select * from public.lotes
     where item_id = p_item_id and saldo > 0
     order by vencimento asc nulls last, data_entrada asc, criado_em asc, id asc
     for update
  loop
    exit when v_restante <= 0;
    v_uso := least(v_lote.saldo, v_restante);
    update public.lotes set saldo = saldo - v_uso where id = v_lote.id;
    insert into public.movimentacoes
      (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, observacao,
       responsavel_id, chave_idempotencia)
    values
      (v_item.condominio_id, p_item_id, v_lote.id, p_tipo, -1, v_uso, trim(p_motivo),
       p_observacao, auth.uid(), p_chave)
    returning * into v_mov;
    return next v_mov;
    v_restante := v_restante - v_uso;
  end loop;
  return;
end;
$$;

-- ------------------------------------------------------------
-- Entrada extraordinária (sem compra) e doação recebida
-- ------------------------------------------------------------
create or replace function public.registrar_entrada_extraordinaria(
  p_item_id uuid,
  p_quantidade numeric,
  p_origem text,
  p_motivo text,
  p_chave uuid,
  p_custo_unitario numeric default 0,
  p_vencimento date default null,
  p_observacao text default null
)
returns public.movimentacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.itens%rowtype;
  v_lote_id uuid;
  v_mov public.movimentacoes%rowtype;
begin
  select * into v_item from public.itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_item.condominio_id, array['gestor', 'sindico']);

  if p_origem not in ('entrada_extraordinaria', 'doacao') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Informe uma quantidade maior que zero.' using errcode = '22023';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Informe o motivo da entrada.' using errcode = '22023';
  end if;
  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;
  if not v_item.ativo then
    raise exception 'Este item está inativo.' using errcode = '22023';
  end if;

  select * into v_mov from public.movimentacoes
   where condominio_id = v_item.condominio_id and chave_idempotencia = p_chave limit 1;
  if found then
    return v_mov;
  end if;

  insert into public.lotes
    (condominio_id, item_id, codigo, qtd_recebida, saldo, custo_unitario, vencimento, origem, responsavel_id)
  values
    (v_item.condominio_id, p_item_id, app.proximo_codigo_lote(p_item_id), p_quantidade, p_quantidade,
     coalesce(p_custo_unitario, 0), p_vencimento, p_origem, auth.uid())
  returning id into v_lote_id;

  insert into public.movimentacoes
    (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, observacao,
     responsavel_id, chave_idempotencia)
  values
    (v_item.condominio_id, p_item_id, v_lote_id,
     case p_origem when 'doacao' then 'doacao' else 'entrada' end,
     1, p_quantidade, trim(p_motivo), p_observacao, auth.uid(), p_chave)
  returning * into v_mov;
  return v_mov;
end;
$$;

-- ------------------------------------------------------------
-- Ajuste (conferência física)
-- Com lote: o saldo passa a ser a quantidade física informada.
--   * para menos: baixa o lote;
--   * para mais: cria um lote novo de origem "ajuste" (o lote original não
--     pode ter saldo maior que o recebido).
-- Sem lote (p_lote_id nulo): p_quantidade_fisica é a quantidade encontrada
--   sem lote, e vira um lote novo de origem "ajuste".
-- Justificativa obrigatória. Não exige aprovação; fica na auditoria.
-- ------------------------------------------------------------
create or replace function public.registrar_ajuste(
  p_item_id uuid,
  p_lote_id uuid,
  p_quantidade_fisica numeric,
  p_justificativa text,
  p_chave uuid
)
returns public.movimentacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.itens%rowtype;
  v_lote public.lotes%rowtype;
  v_delta numeric;
  v_novo uuid;
  v_mov public.movimentacoes%rowtype;
begin
  select * into v_item from public.itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_item.condominio_id, array['gestor', 'sindico']);

  if p_justificativa is null or length(trim(p_justificativa)) < 5 then
    raise exception 'Informe a justificativa do ajuste (mínimo de 5 caracteres).' using errcode = '22023';
  end if;
  if p_quantidade_fisica is null or p_quantidade_fisica < 0 then
    raise exception 'Informe a quantidade encontrada (zero ou mais).' using errcode = '22023';
  end if;
  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;

  select * into v_mov from public.movimentacoes
   where condominio_id = v_item.condominio_id and chave_idempotencia = p_chave limit 1;
  if found then
    return v_mov;
  end if;

  if p_lote_id is null then
    if p_quantidade_fisica = 0 then
      raise exception 'Não há diferença a ajustar.' using errcode = '22023';
    end if;
    insert into public.lotes
      (condominio_id, item_id, codigo, qtd_recebida, saldo, origem, responsavel_id)
    values
      (v_item.condominio_id, p_item_id, app.proximo_codigo_lote(p_item_id),
       p_quantidade_fisica, p_quantidade_fisica, 'ajuste', auth.uid())
    returning id into v_novo;
    insert into public.movimentacoes
      (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, justificativa,
       responsavel_id, chave_idempotencia)
    values
      (v_item.condominio_id, p_item_id, v_novo, 'ajuste', 1, p_quantidade_fisica,
       'Ajuste de estoque', trim(p_justificativa), auth.uid(), p_chave)
    returning * into v_mov;
  else
    select * into v_lote from public.lotes
     where id = p_lote_id and item_id = p_item_id for update;
    if not found then
      raise exception 'Lote não encontrado para este item.' using errcode = 'P0002';
    end if;
    v_delta := p_quantidade_fisica - v_lote.saldo;
    if v_delta = 0 then
      raise exception 'Não há diferença a ajustar.' using errcode = '22023';
    end if;
    if v_delta < 0 then
      update public.lotes set saldo = p_quantidade_fisica where id = v_lote.id;
      insert into public.movimentacoes
        (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, justificativa,
         responsavel_id, chave_idempotencia)
      values
        (v_item.condominio_id, p_item_id, v_lote.id, 'ajuste', -1, abs(v_delta),
         'Ajuste de estoque', trim(p_justificativa), auth.uid(), p_chave)
      returning * into v_mov;
    else
      insert into public.lotes
        (condominio_id, item_id, codigo, qtd_recebida, saldo, vencimento, custo_unitario, origem, responsavel_id)
      values
        (v_item.condominio_id, p_item_id, app.proximo_codigo_lote(p_item_id),
         v_delta, v_delta, v_lote.vencimento, v_lote.custo_unitario, 'ajuste', auth.uid())
      returning id into v_novo;
      insert into public.movimentacoes
        (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, justificativa,
         responsavel_id, chave_idempotencia)
      values
        (v_item.condominio_id, p_item_id, v_novo, 'ajuste', 1, v_delta,
         'Ajuste de estoque', trim(p_justificativa), auth.uid(), p_chave)
      returning * into v_mov;
    end if;
  end if;

  perform app.registrar_auditoria(v_item.condominio_id, 'movimentacoes', v_mov.id::text,
    'ajuste_estoque', null,
    jsonb_build_object('item_id', p_item_id, 'lote_id', v_mov.lote_id, 'sinal', v_mov.sinal,
                       'quantidade', v_mov.quantidade, 'justificativa', trim(p_justificativa)));
  return v_mov;
end;
$$;

-- ------------------------------------------------------------
-- Estorno: cria a movimentação inversa. Não apaga nada.
-- Recebimentos de compra não podem ser estornados nesta versão.
-- ------------------------------------------------------------
create or replace function public.estornar_movimentacao(
  p_mov_id uuid,
  p_justificativa text,
  p_chave uuid
)
returns public.movimentacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.movimentacoes%rowtype;
  v_lote public.lotes%rowtype;
  v_mov public.movimentacoes%rowtype;
  v_item_id uuid;
begin
  select item_id into v_item_id from public.movimentacoes where id = p_mov_id;
  if v_item_id is null then
    raise exception 'Movimentação não encontrada.' using errcode = 'P0002';
  end if;
  perform 1 from public.itens where id = v_item_id for update;

  select * into v_orig from public.movimentacoes where id = p_mov_id;
  perform app.exigir(v_orig.condominio_id, array['gestor', 'sindico']);

  if p_justificativa is null or length(trim(p_justificativa)) < 5 then
    raise exception 'Informe a justificativa do estorno (mínimo de 5 caracteres).' using errcode = '22023';
  end if;
  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;

  select * into v_mov from public.movimentacoes
   where condominio_id = v_orig.condominio_id and chave_idempotencia = p_chave limit 1;
  if found then
    return v_mov;
  end if;

  if v_orig.estorno_de is not null then
    raise exception 'Um estorno não pode ser estornado.' using errcode = '22023';
  end if;
  if exists (select 1 from public.movimentacoes where estorno_de = v_orig.id) then
    raise exception 'Esta movimentação já foi estornada.' using errcode = '23505';
  end if;
  if v_orig.recebimento_item_id is not null then
    raise exception 'Recebimentos de compra não podem ser estornados aqui. Use um ajuste com justificativa.'
      using errcode = '22023';
  end if;

  select * into v_lote from public.lotes where id = v_orig.lote_id for update;

  if v_orig.sinal = -1 then
    update public.lotes set saldo = saldo + v_orig.quantidade where id = v_lote.id;
  else
    if v_lote.saldo < v_orig.quantidade then
      raise exception 'Parte desse material já foi usada. Estorne antes as saídas do lote %.', v_lote.codigo
        using errcode = '23514';
    end if;
    update public.lotes set saldo = saldo - v_orig.quantidade where id = v_lote.id;
  end if;

  insert into public.movimentacoes
    (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, justificativa,
     responsavel_id, estorno_de, chave_idempotencia)
  values
    (v_orig.condominio_id, v_orig.item_id, v_orig.lote_id, v_orig.tipo, -v_orig.sinal,
     v_orig.quantidade, 'Estorno', trim(p_justificativa), auth.uid(), v_orig.id, p_chave)
  returning * into v_mov;

  perform app.registrar_auditoria(v_orig.condominio_id, 'movimentacoes', v_mov.id::text,
    'estorno', jsonb_build_object('movimentacao', v_orig.id),
    jsonb_build_object('justificativa', trim(p_justificativa)));
  return v_mov;
end;
$$;

-- ------------------------------------------------------------
-- Compras
-- ------------------------------------------------------------
-- p_dados: {data_compra, fornecedor_id, numero_nf, categoria_id, observacoes}
-- p_itens: [{item_id, qtd_solicitada, custo_unitario, vencimento_previsto}]
create or replace function public.salvar_compra(
  p_condominio_id uuid,
  p_compra_id uuid,
  p_dados jsonb,
  p_itens jsonb,
  p_enviar boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_compra public.compras%rowtype;
  v_qtd_itens int;
  v_invalidos int;
begin
  perform app.exigir(p_condominio_id, array['gestor', 'sindico']);

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Informe os itens da compra.' using errcode = '22023';
  end if;
  select count(*) into v_qtd_itens from jsonb_array_elements(p_itens);
  if p_enviar and v_qtd_itens = 0 then
    raise exception 'Inclua ao menos um item para enviar a compra.' using errcode = '22023';
  end if;

  if p_compra_id is null then
    insert into public.compras
      (condominio_id, data_compra, fornecedor_id, numero_nf, categoria_id, observacoes, status, responsavel_id)
    values
      (p_condominio_id,
       coalesce((p_dados ->> 'data_compra')::date, current_date),
       nullif(p_dados ->> 'fornecedor_id', '')::uuid,
       nullif(p_dados ->> 'numero_nf', ''),
       nullif(p_dados ->> 'categoria_id', '')::uuid,
       nullif(p_dados ->> 'observacoes', ''),
       case when p_enviar then 'aguardando_aprovacao' else 'planejada' end,
       auth.uid())
    returning id into v_id;
  else
    select * into v_compra from public.compras
     where id = p_compra_id and condominio_id = p_condominio_id for update;
    if not found then
      raise exception 'Compra não encontrada.' using errcode = 'P0002';
    end if;
    if v_compra.status not in ('planejada', 'aguardando_aprovacao') then
      raise exception 'Esta compra não pode mais ser editada (status: %).', v_compra.status
        using errcode = '22023';
    end if;
    update public.compras set
      data_compra = coalesce((p_dados ->> 'data_compra')::date, data_compra),
      fornecedor_id = nullif(p_dados ->> 'fornecedor_id', '')::uuid,
      numero_nf = nullif(p_dados ->> 'numero_nf', ''),
      categoria_id = nullif(p_dados ->> 'categoria_id', '')::uuid,
      observacoes = nullif(p_dados ->> 'observacoes', ''),
      status = case when p_enviar then 'aguardando_aprovacao' else status end
    where id = p_compra_id;
    delete from public.compra_itens where compra_id = p_compra_id;
    v_id := p_compra_id;
  end if;

  select count(*) into v_invalidos
  from jsonb_to_recordset(p_itens) as x(item_id uuid, qtd_solicitada numeric, custo_unitario numeric, vencimento_previsto date)
  where x.item_id is null or x.qtd_solicitada is null or x.qtd_solicitada <= 0
     or coalesce(x.custo_unitario, 0) < 0;
  if v_invalidos > 0 then
    raise exception 'Há itens com quantidade ou custo inválido.' using errcode = '22023';
  end if;

  insert into public.compra_itens
    (compra_id, condominio_id, item_id, qtd_solicitada, custo_unitario, vencimento_previsto)
  select v_id, p_condominio_id, x.item_id, x.qtd_solicitada, coalesce(x.custo_unitario, 0), x.vencimento_previsto
  from jsonb_to_recordset(p_itens) as x(item_id uuid, qtd_solicitada numeric, custo_unitario numeric, vencimento_previsto date);

  return v_id;
end;
$$;

-- Só o síndico (ou superadmin) aprova.
create or replace function public.aprovar_compra(p_compra_id uuid)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras%rowtype;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_compra.condominio_id, array['sindico']);

  if v_compra.status not in ('planejada', 'aguardando_aprovacao') then
    raise exception 'Esta compra não está aguardando aprovação (status: %).', v_compra.status
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.compra_itens where compra_id = p_compra_id) then
    raise exception 'A compra não tem itens.' using errcode = '22023';
  end if;

  update public.compras
     set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now()
   where id = p_compra_id
  returning * into v_compra;
  return v_compra;
end;
$$;

-- Mudanças de status feitas à mão. Aprovação e recebimento têm funções próprias.
create or replace function public.mudar_status_compra(p_compra_id uuid, p_status text)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras%rowtype;
  v_recebido numeric;
  v_ok boolean;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_compra.condominio_id, array['gestor', 'sindico']);

  select coalesce(sum(qtd_recebida), 0) into v_recebido
    from public.compra_itens where compra_id = p_compra_id;

  v_ok := case
    when v_compra.status = 'planejada' and p_status in ('aguardando_aprovacao', 'cancelado') then true
    when v_compra.status = 'aguardando_aprovacao' and p_status in ('planejada', 'cancelado') then true
    when v_compra.status = 'aprovada' and p_status in ('pedido_realizado', 'cancelado') then true
    when v_compra.status = 'pedido_realizado' and p_status = 'cancelado' then true
    else false
  end;
  if not v_ok then
    raise exception 'Mudança de status não permitida: % para %.', v_compra.status, p_status
      using errcode = '22023';
  end if;
  if p_status = 'cancelado' and v_recebido > 0 then
    raise exception 'Não é possível cancelar uma compra que já teve recebimento.' using errcode = '22023';
  end if;
  if p_status = 'aguardando_aprovacao' and not exists (
       select 1 from public.compra_itens where compra_id = p_compra_id) then
    raise exception 'Inclua ao menos um item antes de enviar para aprovação.' using errcode = '22023';
  end if;

  update public.compras set status = p_status where id = p_compra_id returning * into v_compra;
  return v_compra;
end;
$$;

-- Número e anexo da nota fiscal podem ser preenchidos depois da compra.
create or replace function public.atualizar_nf_compra(
  p_compra_id uuid,
  p_numero_nf text,
  p_arquivo_path text default null
)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras%rowtype;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_compra.condominio_id, array['gestor', 'sindico']);
  if v_compra.status = 'cancelado' then
    raise exception 'Compra cancelada.' using errcode = '22023';
  end if;
  if p_arquivo_path is not null
     and split_part(p_arquivo_path, '/', 1) <> v_compra.condominio_id::text then
    raise exception 'Arquivo de outro condomínio.' using errcode = '42501';
  end if;

  update public.compras
     set numero_nf = nullif(trim(coalesce(p_numero_nf, '')), ''),
         nf_arquivo_path = coalesce(p_arquivo_path, nf_arquivo_path)
   where id = p_compra_id
  returning * into v_compra;
  return v_compra;
end;
$$;

-- ------------------------------------------------------------
-- Recebimento: o ÚNICO caminho que transforma compra em estoque.
-- p_itens: [{compra_item_id, quantidade, vencimento, custo_unitario}]
-- Permite recebimento parcial. Cada linha vira um lote.
-- ------------------------------------------------------------
create or replace function public.registrar_recebimento(
  p_compra_id uuid,
  p_itens jsonb,
  p_data date,
  p_observacao text,
  p_chave uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras%rowtype;
  v_rec_id uuid;
  v_linha record;
  v_ci public.compra_itens%rowtype;
  v_item public.itens%rowtype;
  v_ri_id uuid;
  v_lote_id uuid;
  v_n int;
  v_distintos int;
  v_pendentes int;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_compra.condominio_id, array['gestor', 'sindico']);

  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;

  select id into v_rec_id from public.recebimentos
   where condominio_id = v_compra.condominio_id and chave_idempotencia = p_chave;
  if found then
    return v_rec_id;
  end if;

  if v_compra.status not in ('aprovada', 'pedido_realizado', 'parcialmente_recebido') then
    raise exception 'Esta compra não pode receber materiais (status: %).', v_compra.status
      using errcode = '22023';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Informe os itens recebidos.' using errcode = '22023';
  end if;

  select count(*), count(distinct x.compra_item_id) into v_n, v_distintos
  from jsonb_to_recordset(p_itens) as x(compra_item_id uuid, quantidade numeric, vencimento date, custo_unitario numeric);
  if v_n = 0 then
    raise exception 'Informe ao menos um item recebido.' using errcode = '22023';
  end if;
  if v_n <> v_distintos then
    raise exception 'Há itens repetidos no recebimento.' using errcode = '22023';
  end if;

  -- trava os itens sempre na mesma ordem (evita impasse entre operações simultâneas)
  perform 1 from public.itens
   where id in (select ci.item_id from public.compra_itens ci
                where ci.compra_id = p_compra_id
                  and ci.id in (select x.compra_item_id
                                from jsonb_to_recordset(p_itens) as x(compra_item_id uuid, quantidade numeric, vencimento date, custo_unitario numeric)))
   order by id for update;

  insert into public.recebimentos (condominio_id, compra_id, data, responsavel_id, observacao, chave_idempotencia)
  values (v_compra.condominio_id, p_compra_id, coalesce(p_data, current_date), auth.uid(),
          nullif(trim(coalesce(p_observacao, '')), ''), p_chave)
  returning id into v_rec_id;

  for v_linha in
    select * from jsonb_to_recordset(p_itens)
      as x(compra_item_id uuid, quantidade numeric, vencimento date, custo_unitario numeric)
  loop
    if v_linha.quantidade is null or v_linha.quantidade <= 0 then
      raise exception 'Informe quantidades maiores que zero.' using errcode = '22023';
    end if;

    select * into v_ci from public.compra_itens
     where id = v_linha.compra_item_id and compra_id = p_compra_id for update;
    if not found then
      raise exception 'Item não pertence a esta compra.' using errcode = 'P0002';
    end if;
    if v_ci.qtd_recebida + v_linha.quantidade > v_ci.qtd_solicitada then
      raise exception 'Quantidade acima do pedido. Falta receber: %.', v_ci.qtd_solicitada - v_ci.qtd_recebida
        using errcode = '23514';
    end if;

    select * into v_item from public.itens where id = v_ci.item_id;
    if not v_item.ativo then
      raise exception 'O item "%" está inativo.', v_item.nome using errcode = '22023';
    end if;

    insert into public.recebimento_itens
      (recebimento_id, condominio_id, compra_item_id, quantidade, vencimento, custo_unitario)
    values
      (v_rec_id, v_compra.condominio_id, v_ci.id, v_linha.quantidade,
       coalesce(v_linha.vencimento, v_ci.vencimento_previsto),
       coalesce(v_linha.custo_unitario, v_ci.custo_unitario))
    returning id into v_ri_id;

    insert into public.lotes
      (condominio_id, item_id, recebimento_item_id, codigo, data_entrada, qtd_recebida, saldo,
       custo_unitario, vencimento, origem, responsavel_id)
    values
      (v_compra.condominio_id, v_ci.item_id, v_ri_id, app.proximo_codigo_lote(v_ci.item_id),
       coalesce(p_data, current_date), v_linha.quantidade, v_linha.quantidade,
       coalesce(v_linha.custo_unitario, v_ci.custo_unitario),
       coalesce(v_linha.vencimento, v_ci.vencimento_previsto), 'compra', auth.uid())
    returning id into v_lote_id;

    insert into public.movimentacoes
      (condominio_id, item_id, lote_id, tipo, sinal, quantidade, motivo, responsavel_id,
       recebimento_item_id, chave_idempotencia)
    values
      (v_compra.condominio_id, v_ci.item_id, v_lote_id, 'entrada', 1, v_linha.quantidade,
       'Recebimento de compra', auth.uid(), v_ri_id, p_chave);

    update public.compra_itens
       set qtd_recebida = qtd_recebida + v_linha.quantidade
     where id = v_ci.id;
  end loop;

  select count(*) into v_pendentes from public.compra_itens
   where compra_id = p_compra_id and qtd_recebida < qtd_solicitada;
  update public.compras
     set status = case when v_pendentes = 0 then 'recebido' else 'parcialmente_recebido' end
   where id = p_compra_id;

  return v_rec_id;
end;
$$;

-- ------------------------------------------------------------
-- Parâmetros do item (mínimo e ideal). O histórico vai para a auditoria.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Usuários do condomínio
-- ------------------------------------------------------------
create or replace function public.criar_condominio(p_nome text, p_cnpj text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not app.eh_superadmin() then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  insert into public.condominios (nome, cnpj)
  values (trim(p_nome), nullif(trim(coalesce(p_cnpj, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.convidar_membro(
  p_condominio_id uuid,
  p_email text,
  p_papel text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user auth.users%rowtype;
begin
  if p_papel not in ('sindico', 'gestor', 'morador') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  if p_papel = 'sindico' then
    if not app.eh_superadmin() then
      raise exception 'Só o superadmin define síndicos.' using errcode = '42501';
    end if;
  else
    perform app.exigir(p_condominio_id, array['sindico']);
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Informe um e-mail válido.' using errcode = '22023';
  end if;

  select * into v_user from auth.users where lower(email) = v_email;
  if found and v_user.email_confirmed_at is not null then
    if exists (select 1 from public.membros where condominio_id = p_condominio_id and user_id = v_user.id) then
      raise exception 'Esta pessoa já participa do condomínio. Use "alterar papel".' using errcode = '23505';
    end if;
    insert into public.membros (condominio_id, user_id, papel) values (p_condominio_id, v_user.id, p_papel);
    return 'vinculado';
  end if;

  insert into public.convites (condominio_id, email, papel, criado_por)
  values (p_condominio_id, v_email, p_papel, auth.uid())
  on conflict (condominio_id, lower(email)) where usado_em is null
  do update set papel = excluded.papel;
  return 'convite_criado';
end;
$$;

create or replace function app.checar_gestao_membro(p_cond uuid, p_user uuid, p_novo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual text;
begin
  if p_user = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio papel.' using errcode = '42501';
  end if;
  select papel into v_atual from public.membros where condominio_id = p_cond and user_id = p_user;
  if v_atual is null then
    raise exception 'Pessoa não encontrada neste condomínio.' using errcode = 'P0002';
  end if;
  if app.eh_superadmin() then
    return;
  end if;
  perform app.exigir(p_cond, array['sindico']);
  if v_atual not in ('gestor', 'morador') or (p_novo is not null and p_novo not in ('gestor', 'morador')) then
    raise exception 'Só o superadmin altera síndicos.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.alterar_papel_membro(p_condominio_id uuid, p_user_id uuid, p_papel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_papel not in ('sindico', 'gestor', 'morador') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  perform app.checar_gestao_membro(p_condominio_id, p_user_id, p_papel);
  update public.membros set papel = p_papel
   where condominio_id = p_condominio_id and user_id = p_user_id;
end;
$$;

create or replace function public.desativar_membro(p_condominio_id uuid, p_user_id uuid, p_ativo boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app.checar_gestao_membro(p_condominio_id, p_user_id, null);
  update public.membros set ativo = coalesce(p_ativo, false)
   where condominio_id = p_condominio_id and user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- Diagnóstico: lista qualquer divergência entre saldos e movimentações.
-- Resultado vazio = tudo consistente.
-- ------------------------------------------------------------
create or replace function public.verificar_consistencia(p_condominio_id uuid)
returns table (problema text, referencia uuid, esperado numeric, encontrado numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform app.exigir(p_condominio_id, array['sindico']);

  return query
  select 'saldo do lote difere das movimentações'::text, l.id, coalesce(m.total, 0), l.saldo
  from public.lotes l
  left join lateral (
    select sum(sinal * quantidade) as total from public.movimentacoes where lote_id = l.id
  ) m on true
  where l.condominio_id = p_condominio_id and l.saldo <> coalesce(m.total, 0);

  return query
  select 'quantidade recebida da compra difere dos recebimentos'::text, ci.id,
         coalesce(r.total, 0), ci.qtd_recebida
  from public.compra_itens ci
  left join lateral (
    select sum(quantidade) as total from public.recebimento_itens where compra_item_id = ci.id
  ) r on true
  where ci.condominio_id = p_condominio_id and ci.qtd_recebida <> coalesce(r.total, 0);

  return query
  select 'lote com saldo acima do recebido'::text, l.id, l.qtd_recebida, l.saldo
  from public.lotes l
  where l.condominio_id = p_condominio_id and l.saldo > l.qtd_recebida;
end;
$$;

-- ------------------------------------------------------------
-- Permissões de execução: só usuários logados chamam as funções.
-- ------------------------------------------------------------
do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'registrar_saida', 'registrar_entrada_extraordinaria', 'registrar_ajuste',
        'estornar_movimentacao', 'salvar_compra', 'aprovar_compra', 'mudar_status_compra',
        'atualizar_nf_compra', 'registrar_recebimento', 'atualizar_parametros_item',
        'criar_condominio', 'convidar_membro', 'alterar_papel_membro', 'desativar_membro',
        'verificar_consistencia')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;
