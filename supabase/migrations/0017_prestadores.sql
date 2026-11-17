-- ============================================================
-- 0017_prestadores — prestadores de serviço indicados pelos moradores
--
--   * morador indica (fica pendente); o síndico aprova, recusa ou remove
--   * quem é do condomínio recomenda um prestador publicado ("recomendo", sem nota)
--   * as tabelas NÃO têm leitura direta: tudo passa por listar_prestadores,
--     que decide o que cada pessoa vê (telefone só para membros; pendentes só para
--     quem indicou e para o síndico)
--   * separado de Fornecedores (que vendem ao condomínio)
-- Pode ser repetida sem dano. Não altera dados existentes.
-- ============================================================

create table if not exists public.prestadores (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  nome text not null check (length(trim(nome)) between 2 and 80),
  servico text not null check (length(trim(servico)) between 2 and 40),
  telefone text not null check (telefone ~ '^[0-9]{10,11}$'),
  observacao text check (observacao is null or length(observacao) <= 200),
  status text not null default 'pendente' check (status in ('pendente', 'publicado', 'recusado', 'removido')),
  motivo text check (motivo is null or length(motivo) <= 200),
  indicado_por uuid not null default auth.uid() references auth.users(id),
  decidido_por uuid references auth.users(id),
  decidido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id, condominio_id)
);
create index if not exists prestadores_cond_idx on public.prestadores (condominio_id, status);
create index if not exists prestadores_tel_idx on public.prestadores (condominio_id, telefone);

create table if not exists public.prestador_recomendacoes (
  prestador_id uuid not null,
  condominio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  comentario text check (comentario is null or length(comentario) <= 200),
  criado_em timestamptz not null default now(),
  primary key (prestador_id, user_id),
  foreign key (prestador_id, condominio_id) references public.prestadores (id, condominio_id) on delete restrict
);

drop trigger if exists prestadores_travar on public.prestadores;
create trigger prestadores_travar before update on public.prestadores
  for each row execute function app.travar_colunas('condominio_id', 'indicado_por', 'criado_em');

drop trigger if exists prestadores_auditar on public.prestadores;
create trigger prestadores_auditar after insert or update or delete on public.prestadores
  for each row execute function app.auditar();
drop trigger if exists prestador_recomendacoes_auditar on public.prestador_recomendacoes;
create trigger prestador_recomendacoes_auditar after insert or update or delete on public.prestador_recomendacoes
  for each row execute function app.auditar();

-- Sem política de leitura e sem permissão direta: só as funções abaixo enxergam as tabelas.
alter table public.prestadores enable row level security;
alter table public.prestador_recomendacoes enable row level security;
revoke all on public.prestadores, public.prestador_recomendacoes from anon, authenticated;

-- ---------- Apoio ----------
-- Só dígitos; aceita +55 na frente. Devolve nulo se não tiver 10 ou 11 dígitos.
create or replace function app.telefone_normal(p_texto text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^55[0-9]{10,11}$' then substr(d, 3)
    when d ~ '^[0-9]{10,11}$' then d
    else null
  end
  from (select regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') as d) x
$$;

-- "Torre 2 · Apto 31"; sem apartamento, o papel ("Síndico"); sem vínculo, vazio.
create or replace function app.rotulo_unidade(p_cond uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.nome || ' · Apto ' || a.numero
       from public.apartamentos a join public.torres t on t.id = a.torre_id
      where a.id = m.apartamento_id),
    case m.papel when 'sindico' then 'Síndico' when 'gestor' then 'Gestor' else '' end)
  from public.membros m
  where m.condominio_id = p_cond and m.user_id = p_user
  limit 1
$$;
grant execute on function app.telefone_normal(text), app.rotulo_unidade(uuid, uuid) to authenticated, service_role;

-- Quem não é síndico precisa de apartamento ativo para indicar ou recomendar.
create or replace function app.exigir_apartamento(p_cond uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if app.tem_papel(p_cond, array['sindico']) then return; end if;
  if not exists (select 1 from public.membros m join public.apartamentos a on a.id = m.apartamento_id
                  where m.condominio_id = p_cond and m.user_id = auth.uid() and m.ativo and a.ativo) then
    raise exception 'Peça ao síndico para informar o seu apartamento antes de indicar ou recomendar.' using errcode = '42501';
  end if;
end;
$$;
grant execute on function app.exigir_apartamento(uuid) to authenticated, service_role;

-- ---------- Funções ----------
-- Valida e normaliza os campos. Devolve (nome, servico, telefone, observacao).
create or replace function app.ler_dados_prestador(p_dados jsonb, out v_nome text, out v_servico text, out v_tel text, out v_obs text)
language plpgsql
immutable
as $$
begin
  v_nome := trim(coalesce(p_dados ->> 'nome', ''));
  v_servico := trim(coalesce(p_dados ->> 'servico', ''));
  v_tel := app.telefone_normal(p_dados ->> 'telefone');
  v_obs := nullif(trim(coalesce(p_dados ->> 'observacao', '')), '');
  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'Informe o nome (de 2 a 80 caracteres).' using errcode = '22023';
  end if;
  if length(v_servico) < 2 or length(v_servico) > 40 then
    raise exception 'Informe o tipo de serviço (de 2 a 40 caracteres).' using errcode = '22023';
  end if;
  if v_tel is null then
    raise exception 'Telefone inválido: informe o DDD e o número.' using errcode = '22023';
  end if;
  if v_obs is not null and length(v_obs) > 200 then
    raise exception 'A observação pode ter até 200 caracteres.' using errcode = '22023';
  end if;
end;
$$;

-- Indica um prestador. Devolve {id, duplicado}: se o telefone já está publicado,
-- nada é criado e "duplicado" traz o id do existente (para recomendar em vez de repetir).
-- Indicação do síndico já entra publicada; as demais ficam pendentes (máx. 5 por pessoa).
create or replace function public.indicar_prestador(p_condominio_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text; v_servico text; v_tel text; v_obs text;
  v_sind boolean;
  v_dup uuid;
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico', 'gestor', 'morador']);
  perform app.exigir_apartamento(p_condominio_id);
  select l.v_nome, l.v_servico, l.v_tel, l.v_obs into v_nome, v_servico, v_tel, v_obs
    from app.ler_dados_prestador(p_dados) l;
  v_sind := app.tem_papel(p_condominio_id, array['sindico']);

  select id into v_dup from public.prestadores
   where condominio_id = p_condominio_id and telefone = v_tel and status = 'publicado' limit 1;
  if v_dup is not null then
    return jsonb_build_object('id', null, 'duplicado', v_dup);
  end if;
  if exists (select 1 from public.prestadores
              where condominio_id = p_condominio_id and telefone = v_tel and status = 'pendente') then
    raise exception 'Este telefone já foi indicado e aguarda aprovação do síndico.' using errcode = '23505';
  end if;
  if not v_sind and (select count(*) from public.prestadores
                      where condominio_id = p_condominio_id and indicado_por = auth.uid() and status = 'pendente') >= 5 then
    raise exception 'Você já tem 5 indicações aguardando aprovação. Espere o síndico avaliar.' using errcode = '53400';
  end if;

  insert into public.prestadores (condominio_id, nome, servico, telefone, observacao, status, decidido_por, decidido_em)
  values (p_condominio_id, v_nome, v_servico, v_tel, v_obs,
          case when v_sind then 'publicado' else 'pendente' end,
          case when v_sind then auth.uid() end, case when v_sind then now() end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicado', null);
end;
$$;

-- Edita. Quem indicou edita enquanto pendente ou recusado (recusado volta para pendente);
-- depois de publicado, só o síndico.
create or replace function public.editar_prestador(p_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prestadores%rowtype;
  v_nome text; v_servico text; v_tel text; v_obs text;
  v_sind boolean;
begin
  select * into v_p from public.prestadores where id = p_id for update;
  if not found then
    raise exception 'Prestador não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_p.condominio_id, array['sindico', 'gestor', 'morador']);
  v_sind := app.tem_papel(v_p.condominio_id, array['sindico']);
  if not v_sind and (v_p.indicado_por <> auth.uid() or v_p.status not in ('pendente', 'recusado')) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  if v_p.status = 'removido' then
    raise exception 'Prestador removido não pode ser editado.' using errcode = '23514';
  end if;
  select l.v_nome, l.v_servico, l.v_tel, l.v_obs into v_nome, v_servico, v_tel, v_obs
    from app.ler_dados_prestador(p_dados) l;
  if exists (select 1 from public.prestadores
              where condominio_id = v_p.condominio_id and telefone = v_tel and id <> p_id and status in ('publicado', 'pendente')) then
    raise exception 'Este telefone já está em outra indicação.' using errcode = '23505';
  end if;
  if not v_sind and v_p.status = 'recusado' and (select count(*) from public.prestadores
        where condominio_id = v_p.condominio_id and indicado_por = auth.uid() and status = 'pendente') >= 5 then
    raise exception 'Você já tem 5 indicações aguardando aprovação. Espere o síndico avaliar.' using errcode = '53400';
  end if;
  update public.prestadores
     set nome = v_nome, servico = v_servico, telefone = v_tel, observacao = v_obs, atualizado_em = now(),
         status = case when not v_sind and status = 'recusado' then 'pendente' else status end,
         motivo = case when not v_sind and status = 'recusado' then null else motivo end,
         decidido_por = case when not v_sind and status = 'recusado' then null else decidido_por end,
         decidido_em = case when not v_sind and status = 'recusado' then null else decidido_em end
   where id = p_id;
end;
$$;

-- Só o síndico: aprovar (pendente/recusado), recusar (pendente, com motivo) ou remover (publicado).
create or replace function public.decidir_prestador(p_id uuid, p_acao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prestadores%rowtype;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into v_p from public.prestadores where id = p_id for update;
  if not found then
    raise exception 'Prestador não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_p.condominio_id, array['sindico']);
  if v_motivo is not null and length(v_motivo) > 200 then
    raise exception 'O motivo pode ter até 200 caracteres.' using errcode = '22023';
  end if;
  if p_acao = 'aprovar' then
    if v_p.status not in ('pendente', 'recusado') then
      raise exception 'Só é possível aprovar uma indicação pendente.' using errcode = '23514';
    end if;
    if exists (select 1 from public.prestadores where condominio_id = v_p.condominio_id
                and telefone = v_p.telefone and status = 'publicado' and id <> p_id) then
      raise exception 'Já existe um prestador publicado com este telefone.' using errcode = '23505';
    end if;
    update public.prestadores set status = 'publicado', motivo = null, decidido_por = auth.uid(), decidido_em = now(), atualizado_em = now() where id = p_id;
  elsif p_acao = 'recusar' then
    if v_p.status <> 'pendente' then
      raise exception 'Só é possível recusar uma indicação pendente.' using errcode = '23514';
    end if;
    if v_motivo is null then
      raise exception 'Informe o motivo da recusa.' using errcode = '22023';
    end if;
    update public.prestadores set status = 'recusado', motivo = v_motivo, decidido_por = auth.uid(), decidido_em = now(), atualizado_em = now() where id = p_id;
  elsif p_acao = 'remover' then
    if v_p.status <> 'publicado' then
      raise exception 'Só é possível remover um prestador publicado.' using errcode = '23514';
    end if;
    update public.prestadores set status = 'removido', motivo = v_motivo, decidido_por = auth.uid(), decidido_em = now(), atualizado_em = now() where id = p_id;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
end;
$$;

-- Recomenda (ou atualiza o comentário). Só prestador publicado; não vale para a própria indicação.
create or replace function public.recomendar_prestador(p_id uuid, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prestadores%rowtype;
  v_com text := nullif(trim(coalesce(p_comentario, '')), '');
begin
  select * into v_p from public.prestadores where id = p_id;
  if not found then
    raise exception 'Prestador não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_p.condominio_id, array['sindico', 'gestor', 'morador']);
  perform app.exigir_apartamento(v_p.condominio_id);
  if v_p.status <> 'publicado' then
    raise exception 'Só é possível recomendar um prestador publicado.' using errcode = '23514';
  end if;
  if v_p.indicado_por = auth.uid() then
    raise exception 'Você já indicou este prestador.' using errcode = '23514';
  end if;
  if v_com is not null and length(v_com) > 200 then
    raise exception 'O comentário pode ter até 200 caracteres.' using errcode = '22023';
  end if;
  insert into public.prestador_recomendacoes (prestador_id, condominio_id, user_id, comentario)
  values (v_p.id, v_p.condominio_id, auth.uid(), v_com)
  on conflict (prestador_id, user_id) do update set comentario = excluded.comentario;
end;
$$;

create or replace function public.retirar_recomendacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prestadores%rowtype;
begin
  select * into v_p from public.prestadores where id = p_id;
  if not found then
    raise exception 'Prestador não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_p.condominio_id, array['sindico', 'gestor', 'morador']);
  delete from public.prestador_recomendacoes where prestador_id = p_id and user_id = auth.uid();
end;
$$;

-- Só o síndico remove o comentário de outra pessoa (a recomendação continua, sem o texto).
create or replace function public.limpar_comentario_prestador(p_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prestadores%rowtype;
begin
  select * into v_p from public.prestadores where id = p_id;
  if not found then
    raise exception 'Prestador não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_p.condominio_id, array['sindico']);
  update public.prestador_recomendacoes set comentario = null where prestador_id = p_id and user_id = p_user_id;
end;
$$;

-- Lista o que a pessoa pode ver. Publicados: todos do condomínio. Pendentes e recusados:
-- quem indicou e o síndico. Removidos: só o síndico.
create or replace function public.listar_prestadores(p_condominio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sind boolean;
  v_res jsonb;
begin
  if auth.uid() is null or not app.eh_membro(p_condominio_id) then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  v_sind := app.tem_papel(p_condominio_id, array['sindico']);
  select coalesce(jsonb_agg(x order by (x ->> 'servico'), (x ->> 'nome')), '[]'::jsonb) into v_res
  from (
    select jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'servico', p.servico, 'telefone', p.telefone, 'observacao', p.observacao,
      'status', p.status, 'motivo', p.motivo, 'indicado_em', p.criado_em,
      'meu', p.indicado_por = auth.uid(),
      'indicador', jsonb_build_object('nome', coalesce(nullif(ip.nome, ''), 'Sem nome'),
                                      'unidade', coalesce(app.rotulo_unidade(p.condominio_id, p.indicado_por), '')),
      'minha_recomendacao', exists (select 1 from public.prestador_recomendacoes r where r.prestador_id = p.id and r.user_id = auth.uid()),
      'recomendacoes', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'nome', coalesce(nullif(rp.nome, ''), 'Sem nome'),
                                            'unidade', coalesce(app.rotulo_unidade(p.condominio_id, r.user_id), ''),
                                            'comentario', r.comentario) order by r.criado_em)
          from public.prestador_recomendacoes r left join public.profiles rp on rp.id = r.user_id
         where r.prestador_id = p.id), '[]'::jsonb)
    ) as x
    from public.prestadores p
    left join public.profiles ip on ip.id = p.indicado_por
    where p.condominio_id = p_condominio_id
      and (p.status = 'publicado'
           or v_sind
           or (p.status in ('pendente', 'recusado') and p.indicado_por = auth.uid()))
  ) q;
  return v_res;
end;
$$;

-- ---------- Permissões de execução ----------
do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('indicar_prestador', 'editar_prestador', 'decidir_prestador', 'recomendar_prestador',
                        'retirar_recomendacao', 'limpar_comentario_prestador', 'listar_prestadores')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;
