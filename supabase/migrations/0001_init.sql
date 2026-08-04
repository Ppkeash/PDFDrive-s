-- =====================================================================
-- FirmaDrive - Esquema inicial + RLS
-- Fase 0: tablas núcleo, roles, políticas de seguridad y buckets Storage.
-- =====================================================================

-- ---------- Tipos ----------
create type doc_status as enum ('borrador', 'en_firma', 'firmado', 'archivado');
create type share_role as enum ('propietario', 'editor', 'firmante', 'lector');

-- ---------- profiles ----------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  email      text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Crear perfil automáticamente al registrarse un usuario.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data->>'name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- folders ----------
create table folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  parent_id  uuid references folders(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------- documents ----------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  folder_id    uuid references folders(id) on delete set null,
  name         text not null,
  storage_path text not null,
  signed_path  text,
  mime         text not null,
  status       doc_status not null default 'borrador',
  current_hash text,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- document_shares ----------
create table document_shares (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  email        text not null,
  role         share_role not null default 'lector',
  invite_token uuid default gen_random_uuid(),
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (document_id, email)
);

-- ---------- signature_fields ----------
create table signature_fields (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  page          int not null,
  x             real not null,
  y             real not null,
  w             real not null,
  h             real not null,
  assigned_email text,
  order_index   int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- signatures ----------
create table signatures (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  field_id     uuid references signature_fields(id) on delete set null,
  signer_id    uuid references auth.users(id) on delete set null,
  signed_at    timestamptz not null default now(),
  ip           text,
  cert_subject text,
  tsa_token    text
);

-- ---------- audit_log (append-only) ----------
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  ip          text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- comments ----------
create table comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  page        int,
  x           real,
  y           real,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Helper: ¿el usuario actual tiene acceso al documento?
-- Propietario, o compartido (share vigente).
-- =====================================================================
create function public.has_document_access(doc_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from documents d where d.id = doc_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from document_shares s
    where s.document_id = doc_id
      and s.user_id = auth.uid()
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

create function public.is_document_owner(doc_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from documents d where d.id = doc_id and d.owner_id = auth.uid()
  );
$$;

-- =====================================================================
-- GRANTs para los roles de PostgREST.
-- RLS restringe las FILAS; estos GRANT dan el privilegio base a la tabla.
-- Sin ellos PostgREST devuelve 42501 "permission denied for table".
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- service_role (edge functions/backend) bypassa RLS pero igual necesita el GRANT
-- base de la tabla (en local no viene por defecto como en la nube).
grant all on all tables in schema public to service_role;
-- anon (no autenticado) no toca tablas; solo rutas públicas del front.

-- =====================================================================
-- RLS
-- =====================================================================
alter table profiles          enable row level security;
alter table folders           enable row level security;
alter table documents         enable row level security;
alter table document_shares   enable row level security;
alter table signature_fields  enable row level security;
alter table signatures        enable row level security;
alter table audit_log         enable row level security;
alter table comments          enable row level security;

-- profiles: cada quien ve/edita su perfil (lectura pública básica para mostrar nombres).
create policy "perfil propio: leer" on profiles for select using (true);
create policy "perfil propio: actualizar" on profiles for update using (id = auth.uid());

-- folders: solo el dueño.
create policy "folders dueño" on folders for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- documents: dueño (todo) o compartido (lectura).
create policy "documents leer" on documents for select
  using (owner_id = auth.uid() or has_document_access(id));
create policy "documents insertar" on documents for insert
  with check (owner_id = auth.uid());
create policy "documents actualizar dueño" on documents for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "documents borrar dueño" on documents for delete
  using (owner_id = auth.uid());

-- document_shares: dueño del doc gestiona; invitado ve su propia fila.
create policy "shares dueño gestiona" on document_shares for all
  using (is_document_owner(document_id))
  with check (is_document_owner(document_id));
create policy "shares invitado ve" on document_shares for select
  using (user_id = auth.uid());

-- signature_fields: quien tenga acceso lee; solo dueño escribe.
create policy "campos leer" on signature_fields for select
  using (has_document_access(document_id));
create policy "campos dueño escribe" on signature_fields for all
  using (is_document_owner(document_id))
  with check (is_document_owner(document_id));

-- signatures: quien tenga acceso lee; inserta el propio firmante con acceso.
create policy "firmas leer" on signatures for select
  using (has_document_access(document_id));
create policy "firmas insertar" on signatures for insert
  with check (has_document_access(document_id) and signer_id = auth.uid());

-- audit_log: append-only. Lee quien tenga acceso; inserta quien tenga acceso
-- (sin update/delete → registro inmutable). El backend con service role también
-- puede insertar saltándose RLS.
create policy "auditoria leer" on audit_log for select
  using (has_document_access(document_id));
create policy "auditoria insertar" on audit_log for insert
  with check (has_document_access(document_id) and actor_id = auth.uid());

-- comments: quien tenga acceso lee; autor con acceso escribe; autor edita/borra lo suyo.
create policy "comentarios leer" on comments for select
  using (has_document_access(document_id));
create policy "comentarios crear" on comments for insert
  with check (has_document_access(document_id) and author_id = auth.uid());
create policy "comentarios propios" on comments for update
  using (author_id = auth.uid());
create policy "comentarios borrar propios" on comments for delete
  using (author_id = auth.uid());

-- =====================================================================
-- Storage buckets
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('originals', 'originals', false),
  ('signed',    'signed',    false),
  ('avatars',   'avatars',   true)
on conflict (id) do nothing;

-- Política Storage: los archivos se guardan bajo <user_id>/... ; el dueño gestiona.
create policy "originals dueño" on storage.objects for all
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "signed dueño" on storage.objects for all
  using (bucket_id = 'signed' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'signed' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars lectura pública" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars dueño escribe" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Realtime: publicar cambios de las tablas colaborativas.
-- =====================================================================
alter publication supabase_realtime add table documents;
alter publication supabase_realtime add table signature_fields;
alter publication supabase_realtime add table signatures;
alter publication supabase_realtime add table comments;
