-- =====================================================================
-- El enlace trae su propio cupo y vence en horas.
--
-- El tope se deducía de los espacios de firma libres del documento, y eso
-- tenía un problema: si el documento ya traía recuadros de antes, el enlace
-- admitía más firmas de las que su dueño creía haber autorizado. Un contador
-- propio dice exactamente lo que se prometió al crearlo.
--
-- El vencimiento baja de días a horas. Un acta se firma en la reunión o no se
-- firma; un enlace que sigue vivo dos semanas después es una puerta abierta
-- sin motivo.
-- =====================================================================

alter table signing_links
  add column if not exists max_signatures integer,
  add column if not exists uses integer not null default 0;

alter table signing_links drop constraint if exists signing_links_max_signatures_check;
alter table signing_links add constraint signing_links_max_signatures_check
  check (max_signatures is null or (max_signatures > 0 and max_signatures <= 200));

comment on column signing_links.max_signatures is
  'Cuantas firmas admite el enlace. Null = sin tope propio (enlaces viejos).';

-- `estado_enlace_de_firma` se reemplaza entera para que el cupo propio mande
-- sobre el conteo de espacios libres; el resto queda igual que en la 0019.
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
  cupos_totales integer;
  cupos_libres  integer;
  espacios_libres integer;
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
    select count(*) into cupos_totales
      from signing_link_slots s where s.link_id = l.id;

    if cupos_totales > 0 then
      select count(*) into cupos_libres
        from signing_link_slots s where s.link_id = l.id and s.used_at is null;
      if cupos_libres = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'lista_completa');
      end if;
    elsif l.max_signatures is not null then
      if l.uses >= l.max_signatures then
        return jsonb_build_object('ok', false, 'motivo', 'cupo_lleno');
      end if;
    else
      select count(*) into espacios_libres
        from signature_fields f
       where f.document_id = d.id
         and f.assigned_email is null
         and not exists (select 1 from signatures g where g.field_id = f.id);
      if espacios_libres = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'sin_espacios');
      end if;
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
    'abierto', (l.kind <> 'individual' and coalesce(cupos_totales, 0) = 0),
    'firmas_usadas', l.uses,
    'firmas_maximas', l.max_signatures,
    'vence', l.expires_at,
    'cupos', case
      when l.kind = 'individual' or coalesce(cupos_totales, 0) = 0 then null
      else (
        select coalesce(jsonb_agg(
          jsonb_build_object('id', s.id, 'nombre', s.display_name,
                             'firmado', s.used_at is not null)
          order by s.position, s.display_name
        ), '[]'::jsonb)
        from signing_link_slots s where s.link_id = l.id
      ) end
  );
end;
$$;

revoke all on function public.estado_enlace_de_firma(text) from public;
grant execute on function public.estado_enlace_de_firma(text) to service_role;

-- Reserva una plaza. La condición va en la misma sentencia: si diez personas
-- pulsan firmar a la vez sobre las últimas dos plazas, solo dos pasan.
create or replace function public.reservar_uso_de_enlace(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  restantes integer;
begin
  update signing_links
     set uses = uses + 1
   where id = p_link_id
     and (max_signatures is null or uses < max_signatures)
     and revoked_at is null
     and (expires_at is null or expires_at > now())
  returning coalesce(max_signatures - uses, 0) into restantes;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cupo_lleno');
  end if;

  return jsonb_build_object('ok', true, 'restantes', restantes);
end;
$$;

revoke all on function public.reservar_uso_de_enlace(uuid) from public;
grant execute on function public.reservar_uso_de_enlace(uuid) to service_role;

-- Si el estampado se cae después de reservar hay que devolver la plaza: un
-- error de red no puede robarle un cupo al grupo.
create or replace function public.devolver_uso_de_enlace(p_link_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update signing_links set uses = greatest(0, uses - 1) where id = p_link_id;
$$;

revoke all on function public.devolver_uso_de_enlace(uuid) from public;
grant execute on function public.devolver_uso_de_enlace(uuid) to service_role;
