-- =====================================================================
-- Drive organizado: buscar, filtrar, ordenar y papelera
--
-- Lo que trae esta migración es lo que la base necesitaba para que el Drive
-- se pueda recorrer de verdad:
--
--  1. Buscar por nombre sin que las tildes estorben. No había ninguna
--     infraestructura de búsqueda: ni pg_trgm, ni unaccent, ni tsvector.
--  2. Los índices que faltaban. `documents` solo tenía índice en
--     `workspace_id`; `owner_id`, `folder_id`, `created_at` y `deleted_at`
--     estaban sin indexar, igual que `folders.parent_id` -- y Postgres no
--     indexa por su cuenta el lado que referencia de una clave foránea. La
--     consulta principal del Drive (dueño + carpeta + sin borrar, ordenado
--     por fecha) no tenía ni un índice que la sostuviera.
--  3. Que lo que está en la papelera deje de verse como si no lo estuviera.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Buscar sin tildes
--
-- `unaccent()` no es inmutable (depende del diccionario que esté cargado),
-- así que no se puede usar ni en una columna generada ni en un índice. La
-- envoltura de abajo fija el diccionario por nombre completo, con lo cual el
-- resultado sí es estable y se puede declarar `immutable`: es el camino
-- documentado para indexar texto sin tildes.
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.f_unaccent(txt text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, txt)
$$;

-- EXECUTE es de PUBLIC por defecto; revocarlo de `anon` a secas no hace
-- nada (lección de 0011).
revoke all on function public.f_unaccent(text) from public;
grant execute on function public.f_unaccent(text) to authenticated, service_role;

-- Nombre normalizado, calculado al guardar. Es lo que compara el buscador:
-- "accion" encuentra "Acción", y "ACTA" encuentra "acta".
alter table documents
  add column if not exists name_norm text
  generated always as (lower(public.f_unaccent(name))) stored;

create index if not exists documents_name_trgm
  on documents using gin (name_norm extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 2. Índices de la navegación
-- ---------------------------------------------------------------------

-- La consulta de la raíz y de cada carpeta: dueño, sin borrar, por fecha.
create index if not exists documents_owner_fecha_idx
  on documents (owner_id, deleted_at, created_at desc);

create index if not exists documents_folder_idx
  on documents (folder_id, deleted_at);

-- La papelera es un puñado de filas en una tabla que crece: parcial.
create index if not exists documents_papelera_idx
  on documents (deleted_at)
  where deleted_at is not null;

-- `parent_id` sin índice también significa que el borrado en cascada del
-- subárbol hace un recorrido completo por nivel.
create index if not exists folders_parent_idx on folders (parent_id);
create index if not exists folders_owner_idx on folders (owner_id);

-- ---------------------------------------------------------------------
-- 3. La papelera no se le enseña a los invitados
--
-- La política de lectura venía de 0001 y no miraba `deleted_at`: lo único
-- que escondía un documento borrado era un filtro del cliente. Quien tuviera
-- el documento compartido lo seguía viendo en "Compartido conmigo" -- y lo
-- seguía pudiendo leer por la API.
--
-- El dueño sí conserva el acceso: es quien tiene que poder entrar a su
-- papelera y restaurar.
-- ---------------------------------------------------------------------
drop policy if exists "documents leer" on documents;
create policy "documents leer" on documents for select
  using (
    owner_id = auth.uid()
    or (has_document_access(id) and deleted_at is null)
  );
