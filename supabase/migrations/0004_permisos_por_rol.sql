-- =====================================================================
-- Los permisos compartidos pasan a significar algo.
--
-- Hasta ahora `document_shares.role` se guardaba pero nadie lo miraba: un
-- "lector" tenía exactamente las mismas capacidades que un "firmante", y
-- "editor" no editaba nada porque solo el dueño podía tocar los campos de
-- firma. Elegir permiso era decorativo.
--
-- A partir de aquí:
--   propietario  todo, incluida la gestión de accesos
--   editor       coloca y mueve campos de firma de cualquiera, y firma
--   firmante     firma (el suyo, o colocando su propia firma donde quiera)
--   lector       solo ve y descarga
-- =====================================================================

-- Emails normalizados en minúsculas. El código ya lo hace al escribir, pero
-- quedaban filas anteriores; sin esto, buscar por email exacto falla de forma
-- silenciosa (y usar LIKE es peor: el "_" de un juan_perez@… es comodín).
update document_shares  set email = lower(email)
 where email is not null and email <> lower(email);
update signature_fields set assigned_email = lower(assigned_email)
 where assigned_email is not null and assigned_email <> lower(assigned_email);

-- Rol efectivo del usuario actual sobre un documento. Null = sin acceso.
-- Si por lo que sea hubiera varias filas, gana la más permisiva.
create or replace function public.document_role(doc_id uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    when exists (
      select 1 from documents d where d.id = doc_id and d.owner_id = auth.uid()
    ) then 'propietario'
    else (
      select s.role::text
        from document_shares s
       where s.document_id = doc_id
         and s.user_id = auth.uid()
         and (s.expires_at is null or s.expires_at > now())
       order by case s.role::text
                  when 'propietario' then 0
                  when 'editor'      then 1
                  when 'firmante'    then 2
                  else 3
                end
       limit 1
    )
  end;
$$;

create or replace function public.can_edit_document(doc_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.document_role(doc_id) in ('propietario', 'editor');
$$;

create or replace function public.can_sign_document(doc_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.document_role(doc_id) in ('propietario', 'editor', 'firmante');
$$;

-- El email del JWT, en minúsculas, para comparar con assigned_email.
create or replace function public.current_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- ---------------------------------------------------------------------
-- signature_fields: el dueño ya no es el único que escribe.
-- ---------------------------------------------------------------------
drop policy if exists "campos dueño escribe" on signature_fields;

create policy "campos editor escribe" on signature_fields for all
  using (can_edit_document(document_id))
  with check (can_edit_document(document_id));

-- Un firmante puede crear el campo donde va SU firma (es lo que hace el flujo
-- de "dibuja y coloca"), pero no asignarle un campo a otra persona.
create policy "campos firmante crea el suyo" on signature_fields for insert
  with check (
    can_sign_document(document_id)
    and lower(coalesce(assigned_email, '')) = current_email()
    and current_email() <> ''
  );

create policy "campos firmante mueve el suyo" on signature_fields for update
  using (
    can_sign_document(document_id)
    and lower(coalesce(assigned_email, '')) = current_email()
    and current_email() <> ''
  )
  with check (
    can_sign_document(document_id)
    and lower(coalesce(assigned_email, '')) = current_email()
  );

-- Solo mientras siga sin firmar: un campo ya firmado es prueba, no se borra.
create policy "campos firmante borra el suyo" on signature_fields for delete
  using (
    can_sign_document(document_id)
    and lower(coalesce(assigned_email, '')) = current_email()
    and current_email() <> ''
    and not exists (
      select 1 from signatures sg where sg.field_id = signature_fields.id
    )
  );

-- ---------------------------------------------------------------------
-- signatures: un lector con acceso ya no puede insertar una firma.
-- ---------------------------------------------------------------------
drop policy if exists "firmas insertar" on signatures;
create policy "firmas insertar" on signatures for insert
  with check (can_sign_document(document_id) and signer_id = auth.uid());
