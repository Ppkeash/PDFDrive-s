-- =====================================================================
-- Enlace abierto: un solo link y ya.
--
-- La lista de nombres de la `0018` resultó demasiado trabajo para quien envía:
-- antes de mandar nada hay que escribir los 20 nombres. Para el caso real
-- --un acta que firman los asistentes de una reunión-- eso sobra.
--
-- Un enlace grupal SIN cupos pasa a significar "abierto": se manda al grupo y
-- cada quien escribe su nombre. Antes se consideraba agotado por no tener
-- ningún nombre libre, que era justo al revés de lo que significa.
--
-- El tope deja de ser una lista y pasa a ser el documento: se firma mientras
-- queden espacios de firma sin ocupar. Así nadie configura nada -- se ponen
-- los recuadros que hagan falta y el enlace se apaga solo.
--
-- Decisión tomada a conciencia, no por descuido: con el nombre libre, nada
-- impide que la misma persona firme dos veces con nombres distintos, ni que
-- alguien a quien le reenvíen el enlace firme. Queda el rastro --nombre, IP,
-- navegador, hora-- y la firma se marca como `enlace`, nunca como `cuenta`.
-- `signing_link_slots` sigue en pie para el día que haga falta la variante con
-- lista cerrada.
-- =====================================================================

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
    else
      -- Enlace abierto: el tope son los espacios de firma del documento.
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
    'espacios_libres', espacios_libres,
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
