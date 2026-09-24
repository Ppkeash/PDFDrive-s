-- =====================================================================
-- Límites de plan: la prueba deja de ser decorativa.
--
-- Hasta ahora la prueba de `0012` vencía, salía el correo de `0014`, y no
-- pasaba nada: se podía seguir firmando igual. `evaluateDocumentEntitlement`
-- llevaba desde la `0009` escrita y sin usar.
--
-- Lo que se cobra es **cerrar un documento**, no subirlo ni firmarlo suelto:
-- es el momento en que el trámite queda hecho y es lo que el cliente
-- reconoce como "un documento". Los firmantes externos nunca consumen cupo.
--
-- Todo esto arranca APAGADO (`billing_enforcement_enabled`), igual que el
-- registro restringido. Encender un límite sobre gente que ya está
-- trabajando, sin avisar, es la forma más rápida de que abandonen.
-- =====================================================================

insert into app_settings (key, value, note) values
  ('billing_enforcement_enabled', 'false',
   'Cuando es true, cerrar un documento sin cupo falla. Encenderlo solo cuando el producto ya muestre el cupo en pantalla.')
on conflict (key) do nothing;

-- ---------- Qué plan rige hoy para un espacio ----------
-- Una suscripción viva manda sobre el plan escrito en el workspace: así una
-- prueba concede el plan de pago sin tener que tocar el workspace, y al
-- vencer se cae sola al gratuito sin que nadie corra nada.
create or replace function public.plan_vigente(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select s.plan_code
       from billing_subscriptions s
      where s.workspace_id = p_workspace
        and s.status in ('trialing', 'active')
        and (s.current_period_end is null or s.current_period_end > now())
      order by case s.status when 'active' then 0 else 1 end
      limit 1),
    (select w.plan_code from workspaces w where w.id = p_workspace),
    'free'
  );
$$;

revoke all on function public.plan_vigente(uuid) from public;
grant execute on function public.plan_vigente(uuid) to authenticated, service_role;

-- ---------- Cuánto cupo queda ----------
-- Devuelve lo mismo que `evaluateDocumentEntitlement` en TypeScript. Existen
-- las dos a propósito: la de aquí decide (y nadie la puede saltar desde el
-- cliente), la de allá pinta la pantalla.
create or replace function public.cupo_de_documentos(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  codigo     text;
  incluidos  integer;
  usados     integer;
  creditos   integer;
  restantes  integer;
  vence      timestamptz;
  estado     text;
begin
  codigo := plan_vigente(p_workspace);

  select completed_documents_per_month into incluidos
    from billing_plans where code = codigo;
  incluidos := coalesce(incluidos, 0);

  -- El periodo es el mes natural. Coincide con cómo la gente piensa la
  -- factura, y no depende de cuándo se creó cada espacio.
  select count(*) into usados
    from billing_usage_events
   where workspace_id = p_workspace
     and metric = 'document_completed'
     and occurred_at >= date_trunc('month', now());

  select coalesce(sum(quantity - consumed), 0) into creditos
    from billing_credit_grants
   where workspace_id = p_workspace
     and consumed < quantity
     and (expires_at is null or expires_at > now());

  restantes := greatest(0, incluidos - usados);

  select s.status, s.current_period_end into estado, vence
    from billing_subscriptions s
   where s.workspace_id = p_workspace
     and s.status in ('trialing', 'active')
     and (s.current_period_end is null or s.current_period_end > now())
   order by case s.status when 'active' then 0 else 1 end
   limit 1;

  return jsonb_build_object(
    'plan',              codigo,
    'en_prueba',         coalesce(estado, '') = 'trialing',
    'vence',             vence,
    'incluidos',         incluidos,
    'usados',            usados,
    'restantes',         restantes,
    'creditos',          creditos,
    'permitido',         (restantes > 0 or creditos > 0),
    'origen',            case when restantes > 0 then 'incluido'
                              when creditos > 0 then 'creditos'
                              else 'ninguno' end
  );
end;
$$;

revoke all on function public.cupo_de_documentos(uuid) from public;
grant execute on function public.cupo_de_documentos(uuid) to authenticated, service_role;

-- ---------- Mi cupo, sin tener que saber el id del espacio ----------
-- Es la que llama la aplicación: resuelve el espacio de quien pregunta, para
-- que el cliente no pueda pedir el cupo de otro.
create or replace function public.mi_cupo_de_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  mi_espacio uuid;
begin
  select id into mi_espacio
    from workspaces
   where owner_id = auth.uid() and kind = 'personal'
   limit 1;

  if mi_espacio is null then
    return jsonb_build_object('permitido', true, 'plan', 'free', 'sin_espacio', true);
  end if;

  return cupo_de_documentos(mi_espacio);
end;
$$;

revoke all on function public.mi_cupo_de_documentos() from public;
grant execute on function public.mi_cupo_de_documentos() to authenticated;

-- ---------- El cobro, al cerrar el documento ----------
create or replace function public.cobrar_documento_completado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  espacio   uuid;
  cupo      jsonb;
  credito   uuid;
begin
  if new.status::text <> 'firmado' or old.status::text = 'firmado' then
    return new;
  end if;

  espacio := new.workspace_id;
  if espacio is null then
    select id into espacio from workspaces
     where owner_id = new.owner_id and kind = 'personal' limit 1;
  end if;
  if espacio is null then
    return new;  -- sin espacio no hay a quién cobrarle
  end if;

  cupo := cupo_de_documentos(espacio);

  if app_setting('billing_enforcement_enabled', 'false') = 'true'
     and not (cupo->>'permitido')::boolean then
    raise exception 'Se acabaron los documentos de este mes en tu plan. Activa un plan o agrega documentos para seguir.'
      using errcode = 'check_violation';
  end if;

  -- El ledger es append-only y tiene un índice único por documento, así que
  -- reintentar el cierre no cobra dos veces.
  insert into billing_usage_events (
    workspace_id, billing_subject_id, document_id, metric, idempotency_key, metadata
  )
  select espacio, w.billing_subject_id, new.id, 'document_completed',
         'doc:' || new.id::text,
         jsonb_build_object('plan', cupo->>'plan', 'origen', cupo->>'origen')
    from workspaces w where w.id = espacio
  on conflict (idempotency_key) do nothing;

  -- Si el cupo incluido ya estaba agotado, el documento sale de un paquete
  -- comprado. Se gasta el que venza antes, que si no caduca sin usarse.
  if (cupo->>'origen') = 'creditos' then
    select id into credito
      from billing_credit_grants
     where workspace_id = espacio
       and consumed < quantity
       and (expires_at is null or expires_at > now())
     order by expires_at nulls last, created_at
     limit 1;

    if credito is not null then
      update billing_credit_grants set consumed = consumed + 1 where id = credito;
    end if;
  end if;

  return new;
end;
$$;

-- BEFORE, no AFTER: si no hay cupo hay que impedir el cierre, y en un AFTER
-- el documento ya quedaría firmado.
drop trigger if exists on_document_completed_billing on documents;
create trigger on_document_completed_billing
  before update of status on documents
  for each row execute function public.cobrar_documento_completado();

revoke all on function public.cobrar_documento_completado() from public;

-- ---------- Cerrar las pruebas vencidas ----------
-- Sin esto una prueba vencida se queda en 'trialing' para siempre. El plan ya
-- caduca solo por la fecha, pero dejar el estado mintiendo hace que cualquier
-- informe futuro cuente mal.
create or replace function public.expirar_pruebas()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  update billing_subscriptions
     set status = 'expired', updated_at = now()
   where status = 'trialing'
     and current_period_end is not null
     and current_period_end <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expirar_pruebas() from public;

-- Va pegado al aviso diario: primero se avisa, después se cierra lo vencido.
select cron.unschedule('expirar-pruebas')
 where exists (select 1 from cron.job where jobname = 'expirar-pruebas');
select cron.schedule('expirar-pruebas', '15 14 * * *',
  $$select public.expirar_pruebas();$$);
