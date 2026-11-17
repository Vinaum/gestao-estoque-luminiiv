-- ============================================================
-- 0013_convites_gerir — cancelar e editar convites pendentes
-- Até aqui o convite só podia ser criado. Agora:
--   cancelar_convite(id)            remove um convite ainda não usado
--   alterar_convite_papel(id, papel) troca o papel de um convite pendente
-- Regras: síndico gerencia convites de gestor/morador do seu condomínio;
-- convites de síndico só o superadmin gerencia. Convite já usado não muda.
-- O cancelamento fica registrado na auditoria. Pode ser repetida sem dano.
-- ============================================================

create or replace function public.cancelar_convite(p_convite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.convites%rowtype;
begin
  select * into v_c from public.convites where id = p_convite_id for update;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if v_c.papel = 'sindico' then
    if not app.eh_superadmin() then
      raise exception 'Só o superadmin gerencia convites de síndico.' using errcode = '42501';
    end if;
  else
    perform app.exigir(v_c.condominio_id, array['sindico']);
  end if;
  if v_c.usado_em is not null then
    raise exception 'Este convite já foi usado e não pode ser cancelado.' using errcode = '23514';
  end if;

  delete from public.convites where id = v_c.id;
  perform app.registrar_auditoria(v_c.condominio_id, 'convites', v_c.id::text, 'cancelar',
    to_jsonb(v_c), null);
end;
$$;

create or replace function public.alterar_convite_papel(p_convite_id uuid, p_papel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.convites%rowtype;
begin
  if p_papel not in ('sindico', 'gestor', 'morador') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.convites where id = p_convite_id for update;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  -- síndico só mexe em convites comuns e só para papéis comuns; síndico é com o superadmin
  if v_c.papel = 'sindico' or p_papel = 'sindico' then
    if not app.eh_superadmin() then
      raise exception 'Só o superadmin define síndicos.' using errcode = '42501';
    end if;
  else
    perform app.exigir(v_c.condominio_id, array['sindico']);
  end if;
  if v_c.usado_em is not null then
    raise exception 'Este convite já foi usado e não pode ser alterado.' using errcode = '23514';
  end if;
  if v_c.papel = p_papel then
    raise exception 'O convite já está com este papel.' using errcode = '22023';
  end if;

  update public.convites set papel = p_papel where id = v_c.id;
  perform app.registrar_auditoria(v_c.condominio_id, 'convites', v_c.id::text, 'alterar_papel',
    jsonb_build_object('email', v_c.email, 'papel', v_c.papel),
    jsonb_build_object('email', v_c.email, 'papel', p_papel));
end;
$$;

do $$
declare
  v_assinatura text;
begin
  for v_assinatura in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cancelar_convite', 'alterar_convite_papel')
  loop
    execute format('revoke all on function %s from public, anon', v_assinatura);
    execute format('grant execute on function %s to authenticated', v_assinatura);
  end loop;
end $$;
