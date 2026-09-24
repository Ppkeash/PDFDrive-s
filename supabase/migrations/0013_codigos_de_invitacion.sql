-- =====================================================================
-- Plan B del registro: códigos de invitación.
--
-- Si la empresa tiene dominio propio basta una fila en `signup_allowlist`
-- ('domain', 'laempresa.com') y esto sobra. Pero si su gente usa correos
-- personales no hay dominio que filtre, y mantener a mano la lista de
-- correos es trabajo que nadie va a hacer.
--
-- Con un código, quien administra reparte una cadena por el canal que sea y
-- cada quien se registra solo. Nadie tiene que conocer los correos de nadie.
--
-- El orden va al revés de lo esperable, y es a propósito: con Google no hay
-- dónde escribir un código durante el login, y cuando vuelve el OAuth la
-- cuenta ya está creada -- demasiado tarde para el trigger de `0012`. Así
-- que primero se canjea el código declarando el correo (que queda habilitado
-- en `signup_allowlist`) y después se entra con Google. Si alguien declara un
-- correo y luego entra con otra cuenta de Google, rebota.
-- =====================================================================

create table if not exists signup_invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (length(code) >= 12),
  note        text,
  max_uses    integer check (max_uses is null or max_uses > 0),
  uses        integer not null default 0 check (uses >= 0),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table signup_invite_codes enable row level security;
revoke all on signup_invite_codes from anon, authenticated;

comment on table signup_invite_codes is
  'Codigos que habilitan el registro cuando no hay dominio de empresa. '
  'max_uses null = sin limite de usos.';

-- Cada canje queda registrado: es el único rastro de quién entró por dónde.
-- La IP se guarda aquí como señal, nunca como bloqueo: una oficina entera
-- comparte una sola IP, así que sirve para notar "30 canjes en 10 minutos",
-- no para decidir quién pasa.
create table if not exists signup_invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code_id     uuid references signup_invite_codes(id) on delete set null,
  email       text not null,
  outcome     text not null check (outcome in ('ok', 'codigo_invalido', 'codigo_agotado', 'codigo_vencido', 'correo_invalido')),
  ip          inet,
  created_at  timestamptz not null default now()
);
create index signup_invite_redemptions_ip_idx on signup_invite_redemptions(ip, created_at);
create index signup_invite_redemptions_email_idx on signup_invite_redemptions(lower(email));

alter table signup_invite_redemptions enable row level security;
revoke all on signup_invite_redemptions from anon, authenticated;

-- ---------- Canje ----------
-- La llama gente sin sesión, así que es la única función que `anon` puede
-- ejecutar. El secreto es el código: por eso se exigen 12 caracteres como
-- mínimo, se registran los intentos fallidos y se frena por IP. Devuelve
-- siempre la misma forma de respuesta, sin decir si falló el código o el
-- correo, para no servir de oráculo a quien esté probando.
create or replace function public.redeem_signup_code(p_code text, p_email text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  fila      signup_invite_codes%rowtype;
  correo    text;
  ip_inet   inet;
  recientes integer;
begin
  correo  := lower(trim(coalesce(p_email, '')));
  ip_inet := case when p_ip is null or p_ip = '' then null else p_ip::inet end;

  -- Freno de fuerza bruta. No bloquea a la oficina: 20 intentos en 10
  -- minutos desde la misma IP es mucho más de lo que hace gente registrandose.
  if ip_inet is not null then
    select count(*) into recientes
      from signup_invite_redemptions
     where ip = ip_inet and created_at > now() - interval '10 minutes';
    if recientes >= 20 then
      return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos');
    end if;
  end if;

  if correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    insert into signup_invite_redemptions(email, outcome, ip)
      values (correo, 'correo_invalido', ip_inet);
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  select * into fila from signup_invite_codes
   where code = trim(coalesce(p_code, '')) and revoked_at is null;

  if not found then
    insert into signup_invite_redemptions(email, outcome, ip)
      values (correo, 'codigo_invalido', ip_inet);
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  if fila.expires_at is not null and fila.expires_at <= now() then
    insert into signup_invite_redemptions(code_id, email, outcome, ip)
      values (fila.id, correo, 'codigo_vencido', ip_inet);
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  if fila.max_uses is not null and fila.uses >= fila.max_uses then
    insert into signup_invite_redemptions(code_id, email, outcome, ip)
      values (fila.id, correo, 'codigo_agotado', ip_inet);
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  -- Habilita ese correo concreto. Si la persona ya estaba habilitada, no se
  -- gasta un uso del código: repetir el canje no debe agotarlo.
  if not exists (
    select 1 from signup_allowlist where kind = 'email' and lower(value) = correo
  ) then
    insert into signup_allowlist(kind, value, note)
      values ('email', correo, 'canje de codigo ' || coalesce(fila.note, fila.code));
    update signup_invite_codes set uses = uses + 1 where id = fila.id;
  end if;

  insert into signup_invite_redemptions(code_id, email, outcome, ip)
    values (fila.id, correo, 'ok', ip_inet);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.redeem_signup_code(text, text, text) from public;
grant execute on function public.redeem_signup_code(text, text, text) to anon, authenticated;

comment on function public.redeem_signup_code(text, text, text) is
  'Unica funcion que anon puede ejecutar: la llama gente que todavia no tiene '
  'cuenta. El secreto es el codigo; los intentos quedan registrados.';
