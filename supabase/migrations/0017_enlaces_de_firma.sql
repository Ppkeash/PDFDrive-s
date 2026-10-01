-- =====================================================================
-- Enlaces de firma de un solo uso.
--
-- El link de `0006` sirve para invitar: quien lo abre tiene que entrar con
-- Google y queda como firmante del documento. Eso no sirve cuando hay que
-- mandarle un acta a alguien de fuera que no va a crearse una cuenta para
-- firmar una vez.
--
-- Este enlace es otra cosa: un solo uso, apunta a un campo concreto, y quien
-- lo abre escribe su nombre y firma sin cuenta.
--
-- A cambio hay que ser honestos sobre lo que vale: **el enlace es la
-- credencial**. Quien lo tenga puede firmar poniendo el nombre que quiera.
-- Por eso se guarda todo lo que identifica el acto -- nombre escrito, IP,
-- navegador, hora -- y la firma queda marcada como `enlace`, no como
-- `cuenta`, para que al revisar el documento se vea con qué respaldo se
-- firmó cada rúbrica. Una firma con cuenta vale más y tiene que notarse.
-- =====================================================================

-- ---------- Cómo se firmó cada rúbrica ----------
alter table signatures
  add column if not exists signer_name text,
  add column if not exists signer_kind text not null default 'cuenta',
  add column if not exists signer_user_agent text;

alter table signatures drop constraint if exists signatures_signer_kind_check;
alter table signatures add constraint signatures_signer_kind_check
  check (signer_kind in ('cuenta', 'enlace'));

-- Una firma por enlace no tiene cuenta detrás, así que el nombre escrito es
-- lo único que identifica a la persona: sin él la firma no dice nada.
alter table signatures drop constraint if exists signatures_enlace_necesita_nombre;
alter table signatures add constraint signatures_enlace_necesita_nombre
  check (signer_kind <> 'enlace' or coalesce(btrim(signer_name), '') <> '');

comment on column signatures.signer_kind is
  'cuenta = firmo alguien identificado por Google. enlace = firmo por un '
  'enlace de un solo uso, sin cuenta: respaldo mas debil, debe verse en la UI.';

-- ---------- Los enlaces ----------
create table if not exists signing_links (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  field_id     uuid references signature_fields(id) on delete set null,
  token        text not null unique check (length(token) >= 24),
  label        text,
  created_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  -- Un solo uso: `used_at` no nulo lo deja inservible para siempre.
  used_at      timestamptz,
  signer_name  text,
  signer_ip    inet,
  signer_user_agent text,
  signature_id uuid references signatures(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index signing_links_document_idx on signing_links(document_id);
create index signing_links_vigentes_idx on signing_links(document_id)
  where used_at is null and revoked_at is null;

alter table signing_links enable row level security;

-- Quien manda en el documento ve y administra sus enlaces desde la aplicación.
-- El token no se puede adivinar desde aquí: sin ser dueño o editor no hay
-- ninguna fila visible.
create policy "enlaces de firma: gestiona quien edita" on signing_links
  for all
  using (can_edit_document(document_id))
  with check (can_edit_document(document_id));

revoke all on signing_links from anon;
grant select, insert, update, delete on signing_links to authenticated;

comment on table signing_links is
  'Enlaces de un solo uso para firmar sin cuenta. El token es la credencial: '
  'se valida solo desde edge functions con service_role.';

-- ---------- Estado de un enlace, en una sola expresión ----------
-- La usan la edge function que abre el enlace y la que firma. Tenerla aquí
-- evita que las dos decidan distinto sobre el mismo enlace.
create or replace function public.estado_enlace_de_firma(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when l.id is null then jsonb_build_object('ok', false, 'motivo', 'no_existe')
    when l.revoked_at is not null then jsonb_build_object('ok', false, 'motivo', 'revocado')
    when l.used_at is not null then jsonb_build_object('ok', false, 'motivo', 'ya_usado',
      'firmado_por', l.signer_name, 'firmado_el', l.used_at)
    when l.expires_at is not null and l.expires_at <= now()
      then jsonb_build_object('ok', false, 'motivo', 'vencido')
    when d.deleted_at is not null then jsonb_build_object('ok', false, 'motivo', 'no_existe')
    when d.status::text = 'firmado' then jsonb_build_object('ok', false, 'motivo', 'documento_cerrado')
    else jsonb_build_object(
      'ok', true,
      'link_id', l.id,
      'document_id', d.id,
      'documento', d.name,
      'field_id', l.field_id,
      'etiqueta', l.label
    )
  end
  from (select 1) uno
  left join signing_links l on l.token = p_token
  left join documents d on d.id = l.document_id;
$$;

revoke all on function public.estado_enlace_de_firma(text) from public;
grant execute on function public.estado_enlace_de_firma(text) to service_role;
