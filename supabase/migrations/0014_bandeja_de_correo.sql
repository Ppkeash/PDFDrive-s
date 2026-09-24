-- =====================================================================
-- Fase C: avisos por correo.
--
-- Hasta ahora la aplicación no mandaba un solo correo. "Compartir por correo"
-- daba acceso y no avisaba a nadie: quien recibía un documento para firmar no
-- se enteraba salvo que se lo dijeran por WhatsApp. El link de invitación de
-- `0006` era el parche a eso.
--
-- Los correos no se mandan en el momento de la acción, sino que se encolan
-- aquí. Dos razones: que el proveedor esté caído no puede hacer que firmar
-- falle, y un aviso que no salió tiene que poder reintentarse en vez de
-- perderse sin rastro.
-- =====================================================================

create table if not exists email_outbox (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in (
                  'documento_compartido',
                  'documento_completado',
                  'prueba_por_vencer',
                  'prueba_vencida'
                )),
  to_email      text not null,
  subject       text not null,
  body_text     text not null,
  body_html     text,
  document_id   uuid references documents(id) on delete cascade,
  workspace_id  uuid references workspaces(id) on delete cascade,
  -- Evita el aviso repetido: encolar dos veces la misma cosa no manda dos
  -- correos. Los triggers construyen la clave con el evento que la origina.
  dedupe_key    text unique,
  status        text not null default 'pendiente'
                check (status in ('pendiente', 'enviado', 'fallido', 'descartado')),
  attempts      integer not null default 0,
  last_error    text,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index email_outbox_pendientes_idx
  on email_outbox(scheduled_for)
  where status = 'pendiente';

alter table email_outbox enable row level security;
revoke all on email_outbox from anon, authenticated;

comment on table email_outbox is
  'Cola de avisos. La vacia la edge function send-emails con service_role; '
  'ningun cliente la lee ni la escribe.';

-- ---------- De dónde sale la URL de los enlaces ----------
insert into app_settings (key, value, note) values
  ('app_url', 'https://pdfdrive-s.vercel.app',
   'Base de los enlaces que van dentro de los correos. Sin barra final.')
on conflict (key) do nothing;

create or replace function public.app_setting(p_key text, p_default text default null)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select value from app_settings where key = p_key), p_default);
$$;

revoke all on function public.app_setting(text, text) from public;

-- ---------- Aviso: te compartieron un documento ----------
create or replace function public.encolar_aviso_documento_compartido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  doc      documents%rowtype;
  quien    text;
  enlace   text;
  asunto   text;
  papel    text;
begin
  select * into doc from documents where id = new.document_id;
  if not found or doc.deleted_at is not null then
    return new;
  end if;

  -- Compartir consigo mismo no genera aviso.
  if new.email is not null and doc.owner_id is not null
     and lower(new.email) = lower(coalesce(
       (select email from profiles where id = doc.owner_id), '')) then
    return new;
  end if;

  select coalesce(nullif(name, ''), email, 'Alguien')
    into quien from profiles where id = doc.owner_id;

  enlace := app_setting('app_url', '') || '/doc/' || doc.id;
  papel  := new.role::text;

  asunto := case papel
    when 'firmante' then coalesce(quien, 'Alguien') || ' te pidió firmar ' || doc.name
    else coalesce(quien, 'Alguien') || ' compartió contigo ' || doc.name
  end;

  insert into email_outbox (kind, to_email, subject, body_text, document_id, dedupe_key)
  values (
    'documento_compartido',
    lower(new.email),
    asunto,
    case papel
      when 'firmante' then
        coalesce(quien, 'Alguien') || ' te pidió firmar el documento "' || doc.name || '".' ||
        E'\n\nPuedes abrirlo aquí:\n' || enlace ||
        E'\n\nSi no esperabas esto, ignora el mensaje.'
      else
        coalesce(quien, 'Alguien') || ' compartió contigo el documento "' || doc.name || '".' ||
        E'\n\nPuedes abrirlo aquí:\n' || enlace ||
        E'\n\nSi no esperabas esto, ignora el mensaje.'
    end,
    doc.id,
    'compartido:' || new.id::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists on_share_created_email on document_shares;
create trigger on_share_created_email
  after insert on document_shares
  for each row execute function public.encolar_aviso_documento_compartido();

revoke all on function public.encolar_aviso_documento_compartido() from public;

-- ---------- Aviso: el documento quedó firmado ----------
-- Le llega a todo el mundo con acceso, dueño incluido: es el cierre del
-- trámite y es lo que la gente espera saber sin tener que entrar a mirar.
create or replace function public.encolar_aviso_documento_completado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  enlace       text;
  destinatario text;
begin
  if new.status::text <> 'firmado' or old.status::text = 'firmado' then
    return new;
  end if;

  enlace := app_setting('app_url', '') || '/doc/' || new.id;

  for destinatario in
    select distinct lower(correo) from (
      select email as correo from document_shares where document_id = new.id and email is not null
      union
      select email from profiles where id = new.owner_id and email is not null
    ) todos
    where correo is not null and correo <> ''
  loop
    insert into email_outbox (kind, to_email, subject, body_text, document_id, dedupe_key)
    values (
      'documento_completado',
      destinatario,
      'Documento firmado: ' || new.name,
      'El documento "' || new.name || '" ya está firmado por todas las partes.' ||
      E'\n\nPuedes verlo y descargarlo aquí:\n' || enlace,
      new.id,
      'completado:' || new.id::text || ':' || destinatario
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_document_signed_email on documents;
create trigger on_document_signed_email
  after update of status on documents
  for each row execute function public.encolar_aviso_documento_completado();

revoke all on function public.encolar_aviso_documento_completado() from public;

-- ---------- Aviso: la prueba se vence ----------
-- Hoy la prueba de `0012` caduca en silencio. Esta función la llama una tarea
-- programada; es idempotente por la clave de deduplicación, así que correrla
-- de más no manda correos de más.
create or replace function public.encolar_avisos_de_prueba()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  fila     record;
  enlace   text;
  encolados integer := 0;
begin
  enlace := app_setting('app_url', '') || '/drive';

  for fila in
    select s.id, s.workspace_id, s.current_period_end, w.billing_email, w.name as espacio,
           greatest(0, ceil(extract(epoch from (s.current_period_end - now())) / 86400))::int as dias
      from billing_subscriptions s
      join workspaces w on w.id = s.workspace_id
     where s.status = 'trialing'
       and s.current_period_end is not null
       and w.billing_email is not null
       and s.current_period_end between now() - interval '1 day' and now() + interval '3 days'
  loop
    if fila.current_period_end <= now() then
      insert into email_outbox (kind, to_email, subject, body_text, workspace_id, dedupe_key)
      values (
        'prueba_vencida',
        lower(fila.billing_email),
        'Tu prueba de FirmaDrive terminó',
        'La prueba gratuita de "' || fila.espacio || '" terminó.' ||
        E'\n\nTus documentos siguen ahí y no se borran. Para seguir firmando ' ||
        'sin límites hay que activar un plan.' ||
        E'\n\n' || enlace,
        fila.workspace_id,
        'prueba_vencida:' || fila.id::text
      )
      on conflict (dedupe_key) do nothing;
    else
      insert into email_outbox (kind, to_email, subject, body_text, workspace_id, dedupe_key)
      values (
        'prueba_por_vencer',
        lower(fila.billing_email),
        'Te quedan ' || fila.dias || ' días de prueba en FirmaDrive',
        'A la prueba gratuita de "' || fila.espacio || '" le quedan ' ||
        fila.dias || ' días.' ||
        E'\n\nCuando termine, tus documentos siguen ahí. Para seguir firmando ' ||
        'sin límites hay que activar un plan.' ||
        E'\n\n' || enlace,
        fila.workspace_id,
        'prueba_por_vencer:' || fila.id::text
      )
      on conflict (dedupe_key) do nothing;
    end if;

    encolados := encolados + 1;
  end loop;

  return encolados;
end;
$$;

revoke all on function public.encolar_avisos_de_prueba() from public;

comment on function public.encolar_avisos_de_prueba() is
  'La llama una tarea programada. Idempotente: correrla de mas no manda correos de mas.';
