-- ============================================================
-- 0012_storage — notas fiscais anexadas
-- Bucket privado. Caminho: {condominio_id}/{compra_id}/{arquivo}
-- Só gestor e síndico do condomínio acessam. Máx. 5 MB; PDF, JPG ou PNG.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-fiscais', 'notas-fiscais', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists nf_ler on storage.objects;
create policy nf_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'notas-fiscais'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists nf_enviar on storage.objects;
create policy nf_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notas-fiscais'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists nf_substituir on storage.objects;
create policy nf_substituir on storage.objects
  for update to authenticated
  using (bucket_id = 'notas-fiscais'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']))
  with check (bucket_id = 'notas-fiscais'
              and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['gestor', 'sindico']));

drop policy if exists nf_apagar on storage.objects;
create policy nf_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'notas-fiscais'
         and app.tem_papel(app.uuid_ou_nulo((storage.foldername(name))[1]), array['sindico']));
