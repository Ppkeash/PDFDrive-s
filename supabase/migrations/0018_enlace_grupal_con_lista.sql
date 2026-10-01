-- =====================================================================
-- Enlace grupal con lista de nombres.
--
-- El caso que lo pide: un acta que tienen que firmar 20 personas que no son
-- usuarias de la aplicación. Generar 20 enlaces de un solo uso no es viable
-- -- nadie va a mandar 20 mensajes distintos.
--
-- La solución no es un enlace libre para todos. Sin nada que lo sujete, la
-- misma persona firma dos veces con nombres distintos, o firma en el lugar de
-- otro, y el enlace reenviado deja entrar a cualquiera.
--
-- Lo que lo sujeta es la lista: quien manda el enlace escribe de antemano a
-- quién espera, y quien lo abre escoge cuál de esos es. Un extraño que reciba
-- el enlace no puede inventarse un nombre; tendría que tomar el cupo de una
-- persona concreta, y esa persona lo nota porque ve su nombre ya firmado.
--
-- La IP no sirve para detectar abusos en este caso: 20 personas firmando
-- desde la misma oficina comparten una sola IP y marcarlas a todas no dice
-- nada. La señal útil es el dispositivo, y aun así solo como aviso -- un acta
-- firmada por todos en la misma tablet, pasándola de mano en mano, es un uso
-- legítimo y frecuente.
-- =====================================================================

alter table signing_links
  add column if not exists kind text not null default 'individual';

alter table signing_links drop constraint if exists signing_links_kind_check;
alter table signing_links add constraint signing_links_kind_check
  check (kind in ('individual', 'grupal'));

comment on column signing_links.kind is
  'individual = un uso, el firmante escribe su nombre. grupal = lista cerrada '
  'de nombres, cada uno se gasta una vez.';

create table if not exists signing_link_slots (
  id                uuid primary key default gen_random_uuid(),
  link_id           uuid not null references signing_links(id) on delete cascade,
  display_name      text not null check (btrim(display_name) <> ''),
  position          integer not null default 0,
  used_at           timestamptz,
  signature_id      uuid references signatures(id) on delete set null,
  signer_ip         inet,
  signer_user_agent text,
  -- Marca aleatoria que el navegador guarda la primera vez que firma. Si dos
  -- cupos del mismo enlace traen la misma marca, se anota: puede ser alguien
  -- firmando dos veces, o una tablet que va pasando por la mesa. Por eso se
  -- avisa y no se bloquea.
  device_hash       text,
  device_reused     boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists signing_link_slots_link_idx
  on signing_link_slots(link_id, position);

-- Dos "Juan Pérez" en la misma lista harían imposible saber quién firmó.
create unique index if not exists signing_link_slots_nombre_unico
  on signing_link_slots(link_id, lower(btrim(display_name)));

alter table signing_link_slots enable row level security;

create policy "cupos de firma: gestiona quien edita" on signing_link_slots
  for all
  using (
    exists (
      select 1 from signing_links l
       where l.id = signing_link_slots.link_id
         and can_edit_document(l.document_id)
    )
  )
  with check (
    exists (
      select 1 from signing_links l
       where l.id = signing_link_slots.link_id
         and can_edit_document(l.document_id)
    )
  );

revoke all on signing_link_slots from anon;
grant select, insert, update, delete on signing_link_slots to authenticated;

-- ---------- Estado del enlace, ahora con los dos tipos ----------
create or replace function public.estado_enlace_de_firma(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  l signing_links%rowtype;
  d documents%rowtype;
  libres integer;
begin
  select * into l from signing_links where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  select * into d from documents where id = l.document_id;
  if not found or d.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  if l.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'revocado');
  end if;
  if l.expires_at is not null and l.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'vencido');
  end if;
  if d.status::text = 'firmado' then
    return jsonb_build_object('ok', false, 'motivo', 'documento_cerrado');
  end if;

  if l.kind = 'individual' then
    if l.used_at is not null then
      return jsonb_build_object('ok', false, 'motivo', 'ya_usado',
        'firmado_por', l.signer_name, 'firmado_el', l.used_at);
    end if;
  else
    -- Un enlace grupal se agota cuando ya no queda ningún nombre libre.
    select count(*) into libres
      from signing_link_slots s where s.link_id = l.id and s.used_at is null;
    if coalesce(libres, 0) = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'lista_completa');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', l.kind,
    'link_id', l.id,
    'document_id', d.id,
    'documento', d.name,
    'field_id', l.field_id,
    'etiqueta', l.label,
    'cupos', case when l.kind = 'individual' then null else (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'nombre', s.display_name,
          'firmado', s.used_at is not null
        ) order by s.position, s.display_name
      ), '[]'::jsonb)
      from signing_link_slots s where s.link_id = l.id
    ) end
  );
end;
$$;

revoke all on function public.estado_enlace_de_firma(text) from public;
grant execute on function public.estado_enlace_de_firma(text) to service_role;

-- ---------- Tomar un cupo ----------
-- Lo llama `sign-pdf` antes de estampar. Hace la reserva en una sola
-- sentencia condicionada a que siga libre: si dos personas abren el mismo
-- nombre a la vez, una gana y la otra recibe que ya está tomado.
create or replace function public.tomar_cupo_de_firma(
  p_link_id uuid,
  p_slot_id uuid,
  p_device  text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  nombre    text;
  repetido  boolean;
begin
  select exists (
    select 1 from signing_link_slots
     where link_id = p_link_id
       and used_at is not null
       and device_hash is not null
       and p_device is not null
       and device_hash = p_device
  ) into repetido;

  update signing_link_slots
     set used_at = now(),
         device_hash = p_device,
         device_reused = coalesce(repetido, false)
   where id = p_slot_id
     and link_id = p_link_id
     and used_at is null
  returning display_name into nombre;

  if nombre is null then
    return jsonb_build_object('ok', false, 'motivo', 'cupo_tomado');
  end if;

  return jsonb_build_object(
    'ok', true,
    'nombre', nombre,
    'dispositivo_repetido', coalesce(repetido, false)
  );
end;
$$;

revoke all on function public.tomar_cupo_de_firma(uuid, uuid, text) from public;
grant execute on function public.tomar_cupo_de_firma(uuid, uuid, text) to service_role;
