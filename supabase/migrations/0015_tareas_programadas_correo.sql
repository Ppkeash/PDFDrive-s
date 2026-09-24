-- =====================================================================
-- Tareas programadas: vaciar la cola de correo y avisar de las pruebas.
--
-- Sin esto, `email_outbox` se llena y nadie la vacía: había que llamar a la
-- edge function a mano. `pg_cron` dispara, `pg_net` hace la petición.
--
-- NOTA: el secreto real se cargó aparte con `vault.create_secret`. No se
-- versiona aquí, por razones obvias. Para reconstruir el entorno desde cero:
--
--   select vault.create_secret('<el secreto>', 'send_emails_secret', '...');
--
-- y el mismo valor como `SEND_EMAILS_SECRET` en los secretos de las edge
-- functions (`supabase secrets set`).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

insert into app_settings (key, value, note) values
  ('edge_functions_url', 'https://ciummdvkyhihofpxzmjs.supabase.co/functions/v1',
   'Base de las edge functions. Sin barra final.')
on conflict (key) do nothing;

create or replace function public.drenar_cola_de_correo()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  secreto text;
  destino text;
begin
  -- El secreto vive en Vault, cifrado. Un `app_settings` sería una tabla en
  -- claro, y esta es la única llave de la función de envío.
  select decrypted_secret into secreto
    from vault.decrypted_secrets where name = 'send_emails_secret';
  if secreto is null then
    raise exception 'Falta el secreto send_emails_secret en Vault';
  end if;

  destino := app_setting('edge_functions_url', '') || '/send-emails';

  -- Disparo y olvido: `net.http_post` encola la petición y vuelve enseguida,
  -- así que la tarea no se queda esperando a que salga el correo.
  return net.http_post(
    url     := destino,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || secreto,
                 'Content-Type', 'application/json'
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.drenar_cola_de_correo() from public;

-- Cada dos minutos: suficiente para que un aviso se sienta inmediato sin
-- despertar la función a cada rato.
select cron.unschedule('drenar-cola-de-correo')
 where exists (select 1 from cron.job where jobname = 'drenar-cola-de-correo');
select cron.schedule('drenar-cola-de-correo', '*/2 * * * *',
  $$select public.drenar_cola_de_correo();$$);

-- Una vez al día, a las 9 de la mañana en Colombia (14:00 UTC): un aviso de
-- "te quedan 3 días" no gana nada por llegar de madrugada.
select cron.unschedule('avisos-de-prueba')
 where exists (select 1 from cron.job where jobname = 'avisos-de-prueba');
select cron.schedule('avisos-de-prueba', '0 14 * * *',
  $$select public.encolar_avisos_de_prueba();$$);
