-- Dados do MODELO ANTIGO (usados só para testar a migração/convivência).
-- Executado depois do schema.sql antigo e antes das migrations novas.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@teste.com', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'sindico@teste.com', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'gestor@teste.com', now()),
  ('00000000-0000-0000-0000-0000000000a4', 'morador@teste.com', now());
update public.profiles set papel = 'superadmin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set papel = 'sindico'    where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set papel = 'gestor'     where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.items (nome, categoria, unidade, estoque_atual, estoque_minimo) values ('Lâmpada antiga', 'Elétrica', 'un', 5, 2);
