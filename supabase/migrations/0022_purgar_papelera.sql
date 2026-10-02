-- =====================================================================
-- Purga de la papelera
--
-- La papelera (migración 0021 y pantalla /drive/papelera) deja restaurar lo
-- borrado, pero sin nadie que la vacíe se queda llena para siempre: cada
-- documento que alguien manda a la papelera deja su PDF en el bucket, y la
-- promesa de "se elimina solo a los 30 días" sería mentira.
--
-- `pg_cron` dispara, `pg_net` llama a la edge function `purge-trash`. Tiene
-- que ser una función y no SQL porque desde la base no se pueden borrar
-- objetos de Storage.
--
-- Mismo patrón que `drenar_cola_de_correo` (migración 0015), con una
-- diferencia: el secreto no se copia a las variables de la edge function.
-- Se genera aquí, vive solo en Vault, y la función pregunta a la base si el
-- Bearer que recibió coincide. Así no hay un segundo sitio donde el secreto
-- pueda quedar desincronizado, ni un paso manual que haya que repetir al
-- reconstruir el entorno.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- El secreto, generado dentro de la base y nunca impreso en ninguna parte.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'purge_trash_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'purge_trash_secret',
      'Bearer con el que la tarea purgar-papelera llama a purge-trash'
    );
  end if;
end $$;

/**
 * ¿El Bearer recibido es el de la purga?
 *
 * Deliberadamente específica en vez de genérica (`coincide_secreto(nombre,
 * valor)`): una función que compare contra cualquier secreto de Vault por
 * nombre se puede usar para adivinar los demás, uno a uno. Esta solo sabe
 * responder por el suyo.
 *
 * La comparación no es de tiempo constante. Son 64 caracteres hexadecimales
 * sobre HTTP: la diferencia de tiempo entre un fallo en el primer carácter y
 * uno en el segundo queda muy por debajo del ruido de la red.
 */
create or replace function public.es_secreto_de_purga(valor text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  esperado text;
begin
  if valor is null or length(valor) < 16 then
    return false;
  end if;

  select decrypted_secret into esperado
    from vault.decrypted_secrets where name = 'purge_trash_secret';

  return esperado is not null and esperado = valor;
end;
$$;

-- EXECUTE es de PUBLIC por defecto (lección de 0011): hay que revocarlo
-- explícitamente. Solo la edge function, que corre con service_role, la usa.
revoke all on function public.es_secreto_de_purga(text) from public;
grant execute on function public.es_secreto_de_purga(text) to service_role;

-- ---------------------------------------------------------------------
-- La llamada programada
-- ---------------------------------------------------------------------
create or replace function public.purgar_papelera()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  secreto text;
  destino text;
begin
  select decrypted_secret into secreto
    from vault.decrypted_secrets where name = 'purge_trash_secret';
  if secreto is null then
    raise exception 'Falta el secreto purge_trash_secret en Vault';
  end if;

  destino := app_setting('edge_functions_url', '') || '/purge-trash';

  -- Disparo y olvido, como en la cola de correo: la tarea no se queda
  -- esperando a que termine de borrar archivos.
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

revoke all on function public.purgar_papelera() from public;

-- Una vez al día, a las 3 de la mañana en Colombia (08:00 UTC): borrar
-- archivos es trabajo de fondo y a esa hora no le quita ancho de banda a
-- nadie que esté firmando.
select cron.unschedule('purgar-papelera')
 where exists (select 1 from cron.job where jobname = 'purgar-papelera');
select cron.schedule('purgar-papelera', '0 8 * * *',
  $$select public.purgar_papelera();$$);
