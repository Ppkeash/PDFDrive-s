-- =====================================================================
-- Deshacer firma: si una rúbrica se estampó mal, hay que poder retirarla
-- y volver a firmar sin arrastrar el trazo equivocado.
--
-- El PDF firmado es acumulativo (cada rúbrica se dibuja sobre el resultado
-- anterior), así que "quitar" una firma exige reconstruir el documento desde
-- el original y reestampar las rúbricas que sí siguen en pie. Para eso hace
-- falta guardar el PNG de cada rúbrica por separado -- hasta ahora se
-- quemaba en el PDF y se perdía.
-- =====================================================================

alter table signatures add column if not exists rubric_path text;

insert into storage.buckets (id, name, public) values
  ('rubrics', 'rubrics', false)
on conflict (id) do nothing;

-- Mismo patrón que 'originals'/'signed': carpeta por owner_id, gestiona el
-- dueño. Solo lo toca el backend (service role, que salta RLS); esta
-- política es higiene, no una vía de acceso que use el cliente.
create policy "rubrics dueño" on storage.objects for all
  using (bucket_id = 'rubrics' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rubrics' and (storage.foldername(name))[1] = auth.uid()::text);
