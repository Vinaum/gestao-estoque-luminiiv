-- ============================================================
-- 0016_comunicados — avisos do condomínio para os moradores
--
--   * comunicados: rascunho → publicado → arquivado (nada é apagado)
--   * destino: todo o condomínio ou uma torre
--   * síndico e gestor escrevem (por função); todos os membros leem o que é para eles
--   * leitura registrada por pessoa; síndico e gestor veem quem ainda não leu
--   * anexo opcional (PDF/JPG/PNG até 5 MB) em bucket privado
-- Pode ser repetida sem dano. Não altera dados existentes.
-- ============================================================

-- ---------- Tabelas ----------
create table if not exists public.comunicados (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  corpo text not null check (length(trim(corpo)) between 1 and 5000),
  tipo text not null default 'aviso' check (tipo in ('aviso', 'manutencao', 'assembleia', 'obra', 'outros')),
  torre_id uuid,
  fixado boolean not null default false,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'arquivado')),
  publicado_em timestamptz,
  expira_em timestamptz,
  editado_em timestamptz,
  anexo_path text,
  anexo_nome text check (anexo_nome is null or length(anexo_nome) <= 120),
  criado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id, condominio_id),
  foreign key (torre_id, condominio_id) references public.torres (id, condominio_id) on delete restrict,
  check (status <> 'publicado' or publicado_em is not null)
);
create index if not exists comunicados_cond_idx on public.comunicados (condominio_id, status, publicado_em desc);

create table if not exists public.comunicado_leituras (
  comunicado_id uuid not null,
  condominio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (comunicado_id, user_id),
  foreign key (comunicado_id, condominio_id) references public.comunicados (id, condominio_id) on delete restrict
);

-- Datas de criação e do autor não mudam depois de gravadas.
drop trigger if exists comunicados_travar on public.comunicados;
create trigger comunicados_travar before update on public.comunicados
  for each row execute function app.travar_colunas('condominio_id', 'criado_por', 'criado_em');

-- Torre do apartamento da pessoa logada (null se não tiver apartamento).
create or replace function app.minha_torre(p_cond uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.torre_id
  from public.membros m
  join public.apartamentos a on a.id = m.apartamento_id
  where m.condominio_id = p_cond and m.user_id = auth.uid() and m.ativo
$$;

-- ---------- Acesso ----------
alter table public.comunicados enable row level security;
alter table public.comunicado_leituras enable row level security;
revoke all on public.comunicados, public.comunicado_leituras from anon, authenticated;
grant select on public.comunicados, public.comunicado_leituras to authenticated;

-- Equipe (síndico/gestor) vê tudo do condomínio. Os demais, só o que está publicado,
-- dentro da validade e destinado a todos ou à própria torre.
drop policy if exists comunicados_ler on public.comunicados;
create policy comunicados_ler on public.comunicados for select to authenticated using (
  app.tem_papel(condominio_id, array['sindico', 'gestor'])
  or (
    app.eh_membro(condominio_id)
    and status = 'publicado'
    and publicado_em <= now()
    and (expira_em is null or expira_em > now())
    and (torre_id is null or torre_id = app.minha_torre(condominio_id))
  )
);

drop policy if exists leituras_ler on public.comunicado_leituras;
create policy leituras_ler on public.comunicado_leituras for select to authenticated using (
  user_id = auth.uid() or app.tem_papel(condominio_id, array['sindico', 'gestor'])
);

drop trigger if exists comunicados_auditar on public.comunicados;
create trigger comunicados_auditar after insert or update or delete on public.comunicados
  for each row execute function app.auditar();

-- ---------- Funções ----------
create or replace function public.salvar_comunicado(p_condominio_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo text := trim(coalesce(p_dados ->> 'titulo', ''));
  v_corpo text := trim(coalesce(p_dados ->> 'corpo', ''));
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'aviso');
  v_torre uuid;
  v_fixado boolean := coalesce((p_dados ->> 'fixado')::boolean, false);
  v_expira timestamptz;
  v_atual public.comunicados%rowtype;
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico', 'gestor']);
  begin
    v_torre := nullif(p_dados ->> 'torre_id', '')::uuid;
    v_expira := nullif(p_dados ->> 'expira_em', '')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end;
  if length(v_titulo) < 1 or length(v_titulo) > 120 then
    raise exception 'Informe o título (até 120 caracteres).' using errcode = '22023';
  end if;
  if length(v_corpo) < 1 or length(v_corpo) > 5000 then
    raise exception 'Informe o texto (até 5000 caracteres).' using errcode = '22023';
  end if;
  if v_tipo not in ('aviso', 'manutencao', 'assembleia', 'obra', 'outros') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if v_torre is not null and not exists (
       select 1 from public.torres where id = v_torre and condominio_id = p_condominio_id and ativo) then
    raise exception 'Torre não encontrada neste condomínio.' using errcode = 'P0002';
  end if;
  if v_expira is not null and v_expira <= now() then
    raise exception 'A data para deixar de aparecer já passou.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.comunicados (condominio_id, titulo, corpo, tipo, torre_id, fixado, expira_em)
    values (p_condominio_id, v_titulo, v_corpo, v_tipo, v_torre, v_fixado, v_expira)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_atual from public.comunicados where id = p_id and condominio_id = p_condominio_id for update;
  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;
  if v_atual.status = 'arquivado' then
    raise exception 'Comunicado arquivado: publique-o de novo para poder editar.' using errcode = '23514';
  end if;
  update public.comunicados
     set titulo = v_titulo, corpo = v_corpo, tipo = v_tipo, torre_id = v_torre, fixado = v_fixado,
         expira_em = v_expira, atualizado_em = now(),
         editado_em = case when status = 'publicado' and (titulo, corpo) is distinct from (v_titulo, v_corpo)
                           then now() else editado_em end
   where id = p_id;
  return p_id;
end;
$$;

create or replace function public.publicar_comunicado(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.comunicados%rowtype;
begin
  select * into v_c from public.comunicados where id = p_id for update;
  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_c.condominio_id, array['sindico', 'gestor']);
  if v_c.status = 'publicado' then
    raise exception 'Este comunicado já está publicado.' using errcode = '23514';
  end if;
  if v_c.expira_em is not null and v_c.expira_em <= now() then
    raise exception 'A data para deixar de aparecer já passou. Edite a data antes de publicar.' using errcode = '22023';
  end if;
  update public.comunicados
     set status = 'publicado', publicado_em = coalesce(publicado_em, now()), atualizado_em = now()
   where id = p_id;
end;
$$;

create or replace function public.arquivar_comunicado(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.comunicados%rowtype;
begin
  select * into v_c from public.comunicados where id = p_id for update;
  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_c.condominio_id, array['sindico', 'gestor']);
  if v_c.status = 'arquivado' then
    raise exception 'Este comunicado já está arquivado.' using errcode = '23514';
  end if;
  update public.comunicados set status = 'arquivado', atualizado_em = now() where id = p_id;
end;
$$;

-- Anexo: o arquivo é enviado primeiro ao armazenamento; aqui só se registra o caminho.
create or replace function public.definir_anexo_comunicado(p_id uuid, p_path text, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.comunicados%rowtype;
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
begin
  select * into v_c from public.comunicados where id = p_id for update;
  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_c.condominio_id, array['sindico', 'gestor']);
  if p_path is null then
    update public.comunicados set anexo_path = null, anexo_nome = null, atualizado_em = now() where id = p_id;
    return;
  end if;
  if split_part(p_path, '/', 1) <> v_c.condominio_id::text or split_part(p_path, '/', 2) <> v_c.id::text
     or split_part(p_path, '/', 3) = '' then
    raise exception 'Arquivo não pertence a este comunicado.' using errcode = '42501';
  end if;
  if v_nome is null or length(v_nome) > 120 then
    raise exception 'Nome do arquivo inválido (até 120 caracteres).' using errcode = '22023';
  end if;
  update public.comunicados set anexo_path = p_path, anexo_nome = v_nome, atualizado_em = now() where id = p_id;
end;
$$;

-- Registra que a pessoa abriu o comunicado. Só vale para o que ela pode ver
-- (publicado, na validade e para ela). Devolve se registrou.
create or replace function public.marcar_comunicado_lido(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.comunicados%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sem permissão para esta ação.' using errcode = '42501';
  end if;
  select * into v_c from public.comunicados where id = p_id;
  if not found
     or not app.eh_membro(v_c.condominio_id)
     or v_c.status <> 'publicado'
     or v_c.publicado_em > now()
     or (v_c.expira_em is not null and v_c.expira_em <= now())
     or (v_c.torre_id is not null and v_c.torre_id is distinct from app.minha_torre(v_c.condominio_id)) then
    return false;
  end if;
  insert into public.comunicado_leituras (comunicado_id, condominio_id, user_id)
  values (v_c.id, v_c.condominio_id, auth.uid())
  on conflict (comunicado_id, user_id) do nothing;
  return true;
end;
$$;

-- Quem leu e quem falta (só síndico e gestor). Público-alvo: pessoas ativas do condomínio
-- (da torre, se o comunicado for de uma torre).
create or replace function public.leituras_comunicado(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.comunicados%rowtype;
  v_total int;
  v_lidos int;
  v_pendentes jsonb;
begin
  select * into v_c from public.comunicados where id = p_id;
  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_c.condominio_id, array['sindico', 'gestor']);

  with alvo as (
    select m.user_id, m.apartamento_id
    from public.membros m
    left join public.apartamentos a on a.id = m.apartamento_id
    where m.condominio_id = v_c.condominio_id and m.ativo
      and (v_c.torre_id is null or a.torre_id = v_c.torre_id)
  )
  select count(*), count(l.user_id) into v_total, v_lidos
  from alvo left join public.comunicado_leituras l on l.comunicado_id = v_c.id and l.user_id = alvo.user_id;

  select coalesce(jsonb_agg(x order by x ->> 'nome'), '[]'::jsonb) into v_pendentes
  from (
    select jsonb_build_object('user_id', m.user_id,
                              'nome', coalesce(nullif(p.nome, ''), 'Sem nome'),
                              'apartamento_id', m.apartamento_id) as x
    from public.membros m
    left join public.apartamentos a on a.id = m.apartamento_id
    left join public.profiles p on p.id = m.user_id
    where m.condominio_id = v_c.condominio_id and m.ativo
      and (v_c.torre_id is null or a.torre_id = v_c.torre_id)
      and not exists (select 1 from public.comunicado_leituras l where l.comunicado_id = v_c.id and l.user_id = m.user_id)
    limit 300
  ) q;

  return jsonb_build_object('total', v_total, 'lidos', v_lidos, 'pendentes', v_pendentes);
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
      and p.proname in ('salvar_comunicado', 'publicar_comunicado', 'arquivar_comunicado',
                        'definir_anexo_comunicado', 'marcar_comunicado_lido', 'leituras_comunicado')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;

-- ---------- Anexos ----------
-- Bucket privado. Caminho: {condominio_id}/{comunicado_id}/{arquivo}
-- Lê quem pode ver o comunicado (a regra de acesso da tabela vale aqui também);
-- envia, troca e apaga síndico e gestor do condomínio. Máx. 5 MB; PDF, JPG ou PNG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comunicados', 'comunicados', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists comunicados_anexo_ler on storage.objects;
create policy comunicados_anexo_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'comunicados'
         and exists (select 1 from public.comunicados c
                     where c.id = app.uuid_ou_nulo((storage.foldername(name))[2])
                       and c.condominio_id = app.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists comunicados_anexo_enviar on storage.objects;
create policy comunicados_anexo_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comunicados'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists comunicados_anexo_trocar on storage.objects;
create policy comunicados_anexo_trocar on storage.objects
  for update to authenticated
  using (bucket_id = 'comunicados'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']))
  with check (bucket_id = 'comunicados'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists comunicados_anexo_apagar on storage.objects;
create policy comunicados_anexo_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'comunicados'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));
