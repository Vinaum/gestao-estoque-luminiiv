-- ============================================================
-- 0019_atas — atas das assembleias
--
--   * cada ata: data da assembleia, tipo (ordinária/extraordinária),
--     título, resumo opcional e o PDF (até 10 MB) em bucket privado
--   * síndico e gestor cadastram e editam (por função); só o síndico exclui
--   * todos os membros do condomínio (inclusive moradores) leem as atas
--     que já têm o PDF anexado
-- Pode ser repetida sem dano. Não altera dados existentes.
-- ============================================================

-- ---------- Tabela ----------
create table if not exists public.atas (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  data_assembleia date not null,
  tipo text not null default 'ordinaria' check (tipo in ('ordinaria', 'extraordinaria')),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  resumo text check (resumo is null or length(resumo) <= 2000),
  arquivo_path text,
  arquivo_nome text check (arquivo_nome is null or length(arquivo_nome) <= 120),
  criado_por uuid not null default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id, condominio_id),
  check (data_assembleia >= date '1950-01-01')
);
create index if not exists atas_cond_idx on public.atas (condominio_id, data_assembleia desc);

drop trigger if exists atas_travar on public.atas;
create trigger atas_travar before update on public.atas
  for each row execute function app.travar_colunas('condominio_id', 'criado_por', 'criado_em');

drop trigger if exists atas_auditar on public.atas;
create trigger atas_auditar after insert or update or delete on public.atas
  for each row execute function app.auditar();

-- ---------- Acesso ----------
alter table public.atas enable row level security;
revoke all on public.atas from anon, authenticated;
grant select on public.atas to authenticated;

-- Equipe vê tudo (inclusive ata ainda sem PDF); os demais membros, só as que têm PDF.
drop policy if exists atas_ler on public.atas;
create policy atas_ler on public.atas for select to authenticated using (
  app.tem_papel(condominio_id, array['sindico', 'gestor'])
  or (app.eh_membro(condominio_id) and arquivo_path is not null)
);

-- ---------- Funções ----------
-- Cria (p_id nulo) ou edita uma ata. p_dados: {titulo, data_assembleia, tipo, resumo}
create or replace function public.salvar_ata(p_condominio_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo text := trim(coalesce(p_dados ->> 'titulo', ''));
  v_resumo text := nullif(trim(coalesce(p_dados ->> 'resumo', '')), '');
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'ordinaria');
  v_data date;
  v_atual public.atas%rowtype;
  v_id uuid;
begin
  perform app.exigir(p_condominio_id, array['sindico', 'gestor']);
  begin
    v_data := nullif(p_dados ->> 'data_assembleia', '')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Data da assembleia inválida.' using errcode = '22023';
  end;
  if v_data is null then
    raise exception 'Informe a data da assembleia.' using errcode = '22023';
  end if;
  if v_data > current_date then
    raise exception 'A data da assembleia não pode ser no futuro.' using errcode = '22023';
  end if;
  if v_data < date '1950-01-01' then
    raise exception 'Data da assembleia inválida.' using errcode = '22023';
  end if;
  if length(v_titulo) < 1 or length(v_titulo) > 120 then
    raise exception 'Informe o título (até 120 caracteres).' using errcode = '22023';
  end if;
  if v_resumo is not null and length(v_resumo) > 2000 then
    raise exception 'O resumo pode ter até 2000 caracteres.' using errcode = '22023';
  end if;
  if v_tipo not in ('ordinaria', 'extraordinaria') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.atas (condominio_id, data_assembleia, tipo, titulo, resumo)
    values (p_condominio_id, v_data, v_tipo, v_titulo, v_resumo)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_atual from public.atas where id = p_id for update;
  if not found or v_atual.condominio_id <> p_condominio_id then
    raise exception 'Ata não encontrada.' using errcode = 'P0002';
  end if;
  update public.atas
     set data_assembleia = v_data, tipo = v_tipo, titulo = v_titulo, resumo = v_resumo, atualizado_em = now()
   where id = p_id;
  return p_id;
end;
$$;

-- O PDF é enviado primeiro ao armazenamento; aqui só se registra o caminho.
-- Caminho obrigatório: {condominio_id}/{ata_id}/{arquivo}.pdf
create or replace function public.definir_arquivo_ata(p_id uuid, p_path text, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.atas%rowtype;
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
begin
  select * into v_a from public.atas where id = p_id for update;
  if not found then
    raise exception 'Ata não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_a.condominio_id, array['sindico', 'gestor']);
  if p_path is null or split_part(p_path, '/', 1) <> v_a.condominio_id::text or split_part(p_path, '/', 2) <> v_a.id::text
     or split_part(p_path, '/', 3) = '' or split_part(p_path, '/', 4) <> '' then
    raise exception 'Arquivo não pertence a esta ata.' using errcode = '42501';
  end if;
  if lower(right(p_path, 4)) <> '.pdf' then
    raise exception 'A ata precisa ser um arquivo PDF.' using errcode = '22023';
  end if;
  if v_nome is null or length(v_nome) > 120 then
    raise exception 'Nome do arquivo inválido (até 120 caracteres).' using errcode = '22023';
  end if;
  update public.atas set arquivo_path = p_path, arquivo_nome = v_nome, atualizado_em = now() where id = p_id;
end;
$$;

-- Só o síndico exclui. Devolve o caminho do PDF para a tela apagar o arquivo.
create or replace function public.excluir_ata(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.atas%rowtype;
begin
  select * into v_a from public.atas where id = p_id for update;
  if not found then
    raise exception 'Ata não encontrada.' using errcode = 'P0002';
  end if;
  perform app.exigir(v_a.condominio_id, array['sindico']);
  delete from public.atas where id = p_id;
  return v_a.arquivo_path;
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
    where n.nspname = 'public' and p.proname in ('salvar_ata', 'definir_arquivo_ata', 'excluir_ata')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;

-- ---------- Arquivos ----------
-- Bucket privado, só PDF, até 10 MB. Caminho: {condominio_id}/{ata_id}/{arquivo}.pdf
-- Lê quem pode ver a ata; envia, troca e apaga síndico e gestor do condomínio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atas', 'atas', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists atas_arquivo_ler on storage.objects;
create policy atas_arquivo_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'atas'
         and exists (select 1 from public.atas a
                     where a.id = app.uuid_ou_nulo((storage.foldername(name))[2])
                       and a.condominio_id = app.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists atas_arquivo_enviar on storage.objects;
create policy atas_arquivo_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'atas'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists atas_arquivo_trocar on storage.objects;
create policy atas_arquivo_trocar on storage.objects
  for update to authenticated
  using (bucket_id = 'atas'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']))
  with check (bucket_id = 'atas'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists atas_arquivo_apagar on storage.objects;
create policy atas_arquivo_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'atas'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));
