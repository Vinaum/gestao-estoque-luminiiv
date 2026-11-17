-- ============================================================
-- 0099 — REMOVE O MODELO ANTIGO (DESTRUTIVO E IRREVERSÍVEL)
--
-- NÃO RODE sem aprovação explícita do Vinicius, depois que o novo
-- front-end estiver em uso e conferido. Faça backup antes
-- (Supabase > Database > Backups, ou exporte as tabelas).
-- Apaga: public.movements, public.items e funções/gatilhos do modelo antigo.
-- Os dados atuais são apenas de teste (decisão registrada no plano).
-- ============================================================
begin;
drop trigger if exists on_movement_insert on public.movements;
drop table if exists public.movements cascade;
drop table if exists public.items cascade;
drop function if exists public.apply_movement() cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.is_sindico() cascade;
commit;
