-- ============================================================
-- ATUALIZAÇÃO: papel "superadmin" + correção de segurança
-- Pode ser rodada em um projeto que já existe (não apaga dados)
-- e também em um projeto novo. Rode no SQL Editor do Supabase.
-- ============================================================

-- 1) Aceitar o novo papel
alter table public.profiles drop constraint if exists profiles_papel_check;
alter table public.profiles
  add constraint profiles_papel_check
  check (papel in ('superadmin','sindico','gestor','morador'));

-- 2) Quem pode alterar o papel de alguém (regra aplicada pelo banco)
--    - Ninguém altera o próprio papel pelo app
--    - Superadmin altera qualquer papel
--    - Síndico só alterna entre gestor e morador
--    - Rodando pelo SQL Editor (sem usuário logado), tudo é permitido
create or replace function public.proteger_papel()
returns trigger as $$
declare meu text;
begin
  if new.papel is distinct from old.papel then
    if auth.uid() is null then
      return new;
    end if;
    if auth.uid() = old.id then
      raise exception 'Você não pode alterar o seu próprio papel.';
    end if;
    meu := public.meu_papel();
    if meu = 'superadmin' then
      return new;
    elsif meu = 'sindico'
          and old.papel in ('gestor','morador')
          and new.papel in ('gestor','morador') then
      return new;
    else
      raise exception 'Você não tem permissão para alterar este papel.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profiles_proteger_papel on public.profiles;
create trigger profiles_proteger_papel
  before update on public.profiles
  for each row execute procedure public.proteger_papel();

-- 3) Políticas de acesso atualizadas (superadmin tem tudo que o síndico tem)
drop policy if exists "profiles_update_role_sindico" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "items_insert_sindico_gestor" on public.items;
create policy "items_insert_sindico_gestor" on public.items
  for insert with check (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "items_update_sindico_gestor" on public.items;
create policy "items_update_sindico_gestor" on public.items
  for update using (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "items_delete_sindico" on public.items;
create policy "items_delete_sindico" on public.items
  for delete using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "movements_insert_sindico_gestor" on public.movements;
create policy "movements_insert_sindico_gestor" on public.movements
  for insert with check (public.meu_papel() in ('superadmin','sindico','gestor'));

drop policy if exists "movements_delete_sindico" on public.movements;
create policy "movements_delete_sindico" on public.movements
  for delete using (public.meu_papel() in ('superadmin','sindico'));

drop policy if exists "settings_update_sindico" on public.settings;
create policy "settings_update_sindico" on public.settings
  for update using (public.meu_papel() in ('superadmin','sindico'));

-- 4) Torne a sua conta superadmin (troque o e-mail e rode UMA vez)
-- update public.profiles set papel = 'superadmin' where id =
--   (select id from auth.users where email = 'seu-email@exemplo.com');
