-- ============================================================
-- 0022_servicos — serviços contratados pelo condomínio
--
--   * cadastro de prestadores fixos (piscineiro, jardineiro, dedetização…):
--     contato, valor combinado, periodicidade e dia de pagamento
--   * pagamentos: data, valor, referência, recibo/NF e comprovante (PDF/JPG/PNG)
--   * síndico e gestor cadastram serviços e registram pagamentos;
--     só o síndico desativa/reativa serviço e corrige/exclui pagamento
--   * morador não vê nada disso
-- Pode ser repetida sem dano. Não altera dados existentes.
-- ============================================================

-- ---------- Tabelas ----------
create table if not exists public.servicos_contratados (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  nome text not null check (length(trim(nome)) between 1 and 120),
  servico text not null check (length(trim(servico)) between 1 and 60),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  email text check (email is null or length(email) <= 120),
  valor_combinado numeric check (valor_combinado is null or (valor_combinado > 0 and valor_combinado <= 1000000)),
  periodicidade text not null default 'mensal' check (periodicidade in ('mensal', 'quinzenal', 'semanal', 'por_visita', 'avulso')),
  dia_pagamento int check (dia_pagamento is null or dia_pagamento between 1 and 31),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  ativo boolean not null default true,
  criado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id, condominio_id)
);
create unique index if not exists servicos_nome_uk on public.servicos_contratados (condominio_id, lower(nome), lower(servico));

create table if not exists public.servico_pagamentos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null,
  servico_id uuid not null,
  data_pagamento date not null,
  valor numeric not null check (valor > 0 and valor <= 1000000),
  referencia text check (referencia is null or length(referencia) <= 60),
  numero_recibo text check (numero_recibo is null or length(numero_recibo) <= 60),
  observacao text check (observacao is null or length(observacao) <= 1000),
  comprovante_path text,
  comprovante_nome text check (comprovante_nome is null or length(comprovante_nome) <= 120),
  chave uuid not null,
  registrado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (condominio_id, chave),
  foreign key (servico_id, condominio_id) references public.servicos_contratados (id, condominio_id) on delete restrict
);
create index if not exists servico_pag_idx on public.servico_pagamentos (condominio_id, data_pagamento desc);

drop trigger if exists servicos_travar on public.servicos_contratados;
create trigger servicos_travar before update on public.servicos_contratados
  for each row execute function app.travar_colunas('condominio_id', 'criado_por', 'criado_em');
drop trigger if exists servico_pag_travar on public.servico_pagamentos;
create trigger servico_pag_travar before update on public.servico_pagamentos
  for each row execute function app.travar_colunas('condominio_id', 'servico_id', 'registrado_por', 'criado_em', 'chave');

drop trigger if exists servicos_auditar on public.servicos_contratados;
create trigger servicos_auditar after insert or update or delete on public.servicos_contratados
  for each row execute function app.auditar();
drop trigger if exists servico_pag_auditar on public.servico_pagamentos;
create trigger servico_pag_auditar after insert or update or delete on public.servico_pagamentos
  for each row execute function app.auditar();

-- ---------- Acesso: leitura só da equipe; escrita só por função ----------
alter table public.servicos_contratados enable row level security;
alter table public.servico_pagamentos enable row level security;
revoke all on public.servicos_contratados, public.servico_pagamentos from anon, authenticated;
grant select on public.servicos_contratados, public.servico_pagamentos to authenticated;

drop policy if exists servicos_ler on public.servicos_contratados;
create policy servicos_ler on public.servicos_contratados for select to authenticated
  using (app.tem_papel(condominio_id, array['sindico', 'gestor']));
drop policy if exists servico_pag_ler on public.servico_pagamentos;
create policy servico_pag_ler on public.servico_pagamentos for select to authenticated
  using (app.tem_papel(condominio_id, array['sindico', 'gestor']));

-- ---------- Funções ----------
create or replace function app.ler_valor(p_texto text, p_campo text)
returns numeric
language plpgsql
immutable
as $$
declare v numeric;
begin
  if nullif(trim(coalesce(p_texto, '')), '') is null then return null; end if;
  begin
    v := p_texto::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception '% inválido.', p_campo using errcode = '22023';
  end;
  if v <= 0 then raise exception '% precisa ser maior que zero.', p_campo using errcode = '22023'; end if;
  if v > 1000000 then raise exception '% alto demais. Confira o número digitado.', p_campo using errcode = '22023'; end if;
  return round(v, 2);
end;
$$;

-- Cria (p_id nulo) ou edita um serviço. p_dados: {nome, servico, telefone, email, valor_combinado,
-- periodicidade, dia_pagamento, observacoes}. Ativar/desativar é outra função (só síndico).
create or replace function public.salvar_servico(p_condominio_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := trim(coalesce(p_dados ->> 'nome', ''));
  v_servico text := trim(coalesce(p_dados ->> 'servico', ''));
  v_tel_txt text := nullif(trim(coalesce(p_dados ->> 'telefone', '')), '');
  v_tel text;
  v_email text := nullif(lower(trim(coalesce(p_dados ->> 'email', ''))), '');
  v_valor numeric;
  v_per text := coalesce(nullif(p_dados ->> 'periodicidade', ''), 'mensal');
  v_dia int;
  v_obs text := nullif(trim(coalesce(p_dados ->> 'observacoes', '')), '');
  v_atual public.servicos_contratados%rowtype;
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico', 'gestor']);
  if length(v_nome) < 1 or length(v_nome) > 120 then
    raise exception 'Informe o nome do prestador ou empresa (até 120 caracteres).' using errcode = '22023';
  end if;
  if length(v_servico) < 1 or length(v_servico) > 60 then
    raise exception 'Informe o serviço (até 60 caracteres), por exemplo Piscineiro.' using errcode = '22023';
  end if;
  if v_tel_txt is not null then
    v_tel := app.telefone_normal(v_tel_txt);
    if v_tel is null then
      raise exception 'Telefone inválido: informe o DDD e o número.' using errcode = '22023';
    end if;
  end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;
  v_valor := app.ler_valor(p_dados ->> 'valor_combinado', 'Valor combinado');
  if v_per not in ('mensal', 'quinzenal', 'semanal', 'por_visita', 'avulso') then
    raise exception 'Periodicidade inválida.' using errcode = '22023';
  end if;
  begin
    v_dia := nullif(p_dados ->> 'dia_pagamento', '')::int;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Dia de pagamento inválido.' using errcode = '22023';
  end;
  if v_dia is not null and (v_dia < 1 or v_dia > 31) then
    raise exception 'Dia de pagamento deve ser de 1 a 31.' using errcode = '22023';
  end if;
  if v_obs is not null and length(v_obs) > 1000 then
    raise exception 'Observação com até 1000 caracteres.' using errcode = '22023';
  end if;

  begin
    if p_id is null then
      insert into public.servicos_contratados
        (condominio_id, nome, servico, telefone, email, valor_combinado, periodicidade, dia_pagamento, observacoes)
      values (p_condominio_id, v_nome, v_servico, v_tel, v_email, v_valor, v_per, v_dia, v_obs)
      returning id into v_id;
      return v_id;
    end if;
    select * into v_atual from public.servicos_contratados where id = p_id for update;
    if not found or v_atual.condominio_id <> p_condominio_id then
      raise exception 'Serviço não encontrado.' using errcode = 'P0002';
    end if;
    update public.servicos_contratados
       set nome = v_nome, servico = v_servico, telefone = v_tel, email = v_email, valor_combinado = v_valor,
           periodicidade = v_per, dia_pagamento = v_dia, observacoes = v_obs, atualizado_em = now()
     where id = p_id;
    return p_id;
  exception when unique_violation then
    raise exception 'Já existe este prestador com este serviço.' using errcode = '23505';
  end;
end;
$$;

-- Só o síndico desativa (encerra o contrato) ou reativa. O histórico de pagamentos continua.
create or replace function public.definir_servico_ativo(p_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v public.servicos_contratados%rowtype;
begin
  select * into v from public.servicos_contratados where id = p_id for update;
  if not found then
    raise exception 'Serviço não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v.condominio_id, array['sindico']);
  if p_ativo is null then
    raise exception 'Informe se o serviço fica ativo.' using errcode = '22023';
  end if;
  update public.servicos_contratados set ativo = p_ativo, atualizado_em = now() where id = p_id;
end;
$$;

-- Lê e confere os dados de um pagamento.
create or replace function app.ler_pagamento_servico(p_dados jsonb,
  out data_pagamento date, out valor numeric, out referencia text, out numero_recibo text, out observacao text)
language plpgsql
stable
set search_path = public
as $$
begin
  begin
    data_pagamento := nullif(p_dados ->> 'data_pagamento', '')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Data do pagamento inválida.' using errcode = '22023';
  end;
  if data_pagamento is null then
    raise exception 'Informe a data do pagamento.' using errcode = '22023';
  end if;
  if data_pagamento > current_date then
    raise exception 'A data do pagamento não pode ser no futuro.' using errcode = '22023';
  end if;
  if data_pagamento < date '2000-01-01' then
    raise exception 'Data do pagamento inválida.' using errcode = '22023';
  end if;
  valor := app.ler_valor(p_dados ->> 'valor', 'Valor');
  if valor is null then
    raise exception 'Informe o valor pago.' using errcode = '22023';
  end if;
  referencia := nullif(trim(coalesce(p_dados ->> 'referencia', '')), '');
  numero_recibo := nullif(trim(coalesce(p_dados ->> 'numero_recibo', '')), '');
  observacao := nullif(trim(coalesce(p_dados ->> 'observacao', '')), '');
  if length(coalesce(referencia, '')) > 60 or length(coalesce(numero_recibo, '')) > 60 then
    raise exception 'Referência e número do recibo com até 60 caracteres.' using errcode = '22023';
  end if;
  if length(coalesce(observacao, '')) > 1000 then
    raise exception 'Observação com até 1000 caracteres.' using errcode = '22023';
  end if;
end;
$$;

-- Registra um pagamento (síndico ou gestor). p_chave evita lançar duas vezes no clique duplo.
-- p_dados: {data_pagamento, valor, referencia, numero_recibo, observacao}
create or replace function public.registrar_pagamento_servico(p_servico_id uuid, p_dados jsonb, p_chave uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.servicos_contratados%rowtype;
  d record;
  v_id uuid;
begin
  select * into v_s from public.servicos_contratados where id = p_servico_id;
  if not found then
    raise exception 'Serviço não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_s.condominio_id, array['sindico', 'gestor']);
  if p_chave is null then
    raise exception 'Chave de operação ausente.' using errcode = '22023';
  end if;
  select id into v_id from public.servico_pagamentos where condominio_id = v_s.condominio_id and chave = p_chave;
  if found then
    return v_id;
  end if;
  if not v_s.ativo then
    raise exception 'Este serviço está desativado. Peça ao síndico para reativar antes de registrar pagamento.' using errcode = '22023';
  end if;
  select * into d from app.ler_pagamento_servico(coalesce(p_dados, '{}'::jsonb));
  insert into public.servico_pagamentos
    (condominio_id, servico_id, data_pagamento, valor, referencia, numero_recibo, observacao, chave)
  values (v_s.condominio_id, v_s.id, d.data_pagamento, d.valor, d.referencia, d.numero_recibo, d.observacao, p_chave)
  returning id into v_id;
  return v_id;
end;
$$;

-- Comprovante: o arquivo é enviado antes ao armazenamento; aqui só se registra o caminho.
-- Caminho: {condominio_id}/{pagamento_id}/{arquivo}
create or replace function public.definir_comprovante_pagamento(p_id uuid, p_path text, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.servico_pagamentos%rowtype;
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
begin
  select * into v from public.servico_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v.condominio_id, array['sindico', 'gestor']);
  if p_path is null or split_part(p_path, '/', 1) <> v.condominio_id::text or split_part(p_path, '/', 2) <> v.id::text
     or split_part(p_path, '/', 3) = '' or split_part(p_path, '/', 4) <> '' then
    raise exception 'Arquivo não pertence a este pagamento.' using errcode = '42501';
  end if;
  if v_nome is null or length(v_nome) > 120 then
    raise exception 'Nome do arquivo inválido (até 120 caracteres).' using errcode = '22023';
  end if;
  update public.servico_pagamentos set comprovante_path = p_path, comprovante_nome = v_nome where id = p_id;
end;
$$;

-- Correção de um pagamento: só o síndico.
create or replace function public.corrigir_pagamento_servico(p_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.servico_pagamentos%rowtype;
  d record;
begin
  select * into v from public.servico_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v.condominio_id, array['sindico']);
  select * into d from app.ler_pagamento_servico(coalesce(p_dados, '{}'::jsonb));
  update public.servico_pagamentos
     set data_pagamento = d.data_pagamento, valor = d.valor, referencia = d.referencia,
         numero_recibo = d.numero_recibo, observacao = d.observacao
   where id = p_id;
end;
$$;

-- Exclusão de um pagamento: só o síndico. Devolve o caminho do comprovante para a tela apagar.
create or replace function public.excluir_pagamento_servico(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v public.servico_pagamentos%rowtype;
begin
  select * into v from public.servico_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v.condominio_id, array['sindico']);
  delete from public.servico_pagamentos where id = p_id;
  return v.comprovante_path;
end;
$$;

do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('salvar_servico', 'definir_servico_ativo', 'registrar_pagamento_servico',
                        'definir_comprovante_pagamento', 'corrigir_pagamento_servico', 'excluir_pagamento_servico')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;

-- ---------- Comprovantes ----------
-- Bucket privado. Caminho: {condominio_id}/{pagamento_id}/{arquivo}. PDF, JPG ou PNG até 5 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('servicos', 'servicos', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists servicos_arquivo_ler on storage.objects;
create policy servicos_arquivo_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'servicos'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists servicos_arquivo_enviar on storage.objects;
create policy servicos_arquivo_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'servicos'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists servicos_arquivo_apagar on storage.objects;
create policy servicos_arquivo_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'servicos'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['sindico']));
