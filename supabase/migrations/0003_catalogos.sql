-- ============================================================
-- 0003_catalogos — categorias e unidades de medida (globais)
-- Geridas pelo superadmin; todos os usuários logados podem ler.
-- ============================================================

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(trim(nome)) > 0),
  ativo boolean not null default true
);

create table if not exists public.unidades_medida (
  id uuid primary key default gen_random_uuid(),
  sigla text not null unique check (length(trim(sigla)) > 0),
  nome text not null,
  ativo boolean not null default true
);

insert into public.categorias (nome) values
  ('Limpeza'), ('Higiene'), ('Elétrica'), ('Hidráulica'), ('Jardinagem'),
  ('Manutenção'), ('Escritório'), ('Segurança'), ('Outros')
on conflict (nome) do nothing;

insert into public.unidades_medida (sigla, nome) values
  ('un', 'Unidade'), ('cx', 'Caixa'), ('pct', 'Pacote'), ('kg', 'Quilograma'),
  ('L', 'Litro'), ('m', 'Metro'), ('rolo', 'Rolo'), ('galão', 'Galão')
on conflict (sigla) do nothing;
