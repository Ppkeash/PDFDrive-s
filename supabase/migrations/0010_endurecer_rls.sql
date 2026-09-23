-- =====================================================================
-- Endurecer RLS y permisos. Auditoría del 2026-09-23.
--
-- La API de Supabase es pública por diseño: la anon key viaja en el bundle
-- del navegador, así que cualquiera puede llamar al REST directamente sin
-- pasar por la aplicación. Lo único que separa un documento de un extraño
-- son estas políticas. Esta migración corrige lo que la auditoría encontró
-- abierto.
-- =====================================================================

-- ---------- 1. El directorio de usuarios era público ----------
-- `0001_init.sql` dejó `perfil propio: leer` con `using (true)`, pensando en
-- "lectura pública básica para mostrar nombres". El efecto real: cualquiera
-- con la anon key se descargaba la tabla entera de correos. Comprobado contra
-- producción: devolvía las 7 filas sin sesión.
--
-- Se necesita seguir mostrando el nombre de quien comparte o firma, así que
-- no vale con `id = auth.uid()`: hay que ver el perfil de la gente con la que
-- se comparte algún documento, y solo de esa.

create or replace function shares_document_with(other_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- SECURITY DEFINER a propósito: mira documents/document_shares saltándose
  -- su RLS, que si no la política de profiles se muerde la cola.
  select exists (
    select 1
      from document_shares s
      join documents d on d.id = s.document_id
     where (d.owner_id = auth.uid() and s.user_id = other_id)
        or (d.owner_id = other_id  and s.user_id = auth.uid())
  ) or exists (
    -- Dos invitados del mismo documento también se ven entre ellos: si no,
    -- la lista de firmantes sale con huecos.
    select 1
      from document_shares mine
      join document_shares theirs on theirs.document_id = mine.document_id
     where mine.user_id = auth.uid()
       and theirs.user_id = other_id
  );
$$;

drop policy if exists "perfil propio: leer" on profiles;
create policy "perfiles visibles" on profiles for select
  using (id = auth.uid() or shares_document_with(id));

-- El WITH CHECK implícito ya impedía adueñarse de otro perfil, pero dejarlo
-- escrito evita que un cambio futuro lo pierda de vista.
drop policy if exists "perfil propio: actualizar" on profiles;
create policy "perfil propio: actualizar" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- El correo lo pone `handle_new_user` desde auth.users y se usa para enlazar
-- invitaciones pendientes; que el dueño del perfil lo reescriba solo sirve
-- para confundir la lista de firmantes.
--
-- Hay que quitar primero el UPDATE de tabla y volver a darlo por columnas:
-- revocar columnas sueltas contra un permiso concedido a nivel de tabla no
-- hace nada (Postgres solo avisa), y quedaría una protección de mentira.
revoke update on profiles from authenticated;
grant update (name, avatar_url) on profiles to authenticated;

-- ---------- 2. `anon` tenía permisos sobre todas las tablas ----------
-- Son los grants que Supabase da por defecto. Aquí no hay nada anónimo: toda
-- ruta exige sesión y /verify es texto estático. Sin grants, una anon key
-- filtrada no abre ninguna puerta aunque una política se relaje por error.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- Solo cubre lo que cree este rol; una tabla nueva creada por otro rol vuelve
-- a nacer con los grants de anon y hay que revocarlos en su propia migración.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------- 3. Funciones expuestas como RPC ----------
-- Todo esto es maquinaria interna de las políticas; nadie debe poder
-- llamarlo desde /rest/v1/rpc/.
-- OJO: revocar "from anon" no basta. Postgres concede EXECUTE a PUBLIC al
-- crear la función y anon lo hereda por ahí; esto se quedó corto y lo remata
-- `0011_revocar_execute_public.sql`.
revoke all on function can_edit_document(uuid)     from anon;
revoke all on function can_sign_document(uuid)     from anon;
revoke all on function document_role(uuid)         from anon;
revoke all on function has_document_access(uuid)   from anon;
revoke all on function is_document_owner(uuid)     from anon;
revoke all on function current_email()             from anon;
revoke all on function shares_document_with(uuid)  from anon;

-- Estas dos son funciones de trigger: llamarlas por RPC falla, pero no hay
-- razón para que aparezcan en la API.
revoke all on function handle_new_user()      from anon, authenticated;
revoke all on function link_pending_shares()  from anon, authenticated;

-- `current_email` era la única sin search_path fijo. Se ejecuta como quien
-- llama, así que el riesgo es bajo, pero con el search_path suelto un objeto
-- en otro esquema podría suplantar a `lower()`.
create or replace function current_email()
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function current_email() from anon;
grant execute on function current_email() to authenticated;

-- ---------- 4. Un editor podía borrar un campo ya firmado ----------
-- `campos editor escribe` era `for all`, sin mirar si el campo tenía firma.
-- La FK de signatures es ON DELETE SET NULL, así que la firma sobrevivía pero
-- se quedaba huérfana: el documento perdía el recuadro que la anclaba a una
-- página y a una persona. En una herramienta de firma eso es perder la
-- prueba, aunque la fila siga ahí.
--
-- El firmante ya tenía esa guarda desde `0005`; al editor le faltaba.
drop policy if exists "campos editor escribe" on signature_fields;

create policy "campos editor crea" on signature_fields for insert
  with check (can_edit_document(document_id));

create policy "campos editor modifica" on signature_fields for update
  using (can_edit_document(document_id))
  with check (can_edit_document(document_id));

create policy "campos editor borra sin firma" on signature_fields for delete
  using (
    can_edit_document(document_id)
    and not exists (
      select 1 from signatures sg where sg.field_id = signature_fields.id
    )
  );

comment on function shares_document_with(uuid) is
  'Cierto si quien llama y other_id comparten algún documento. Sostiene la '
  'visibilidad de perfiles sin exponer el directorio entero.';
