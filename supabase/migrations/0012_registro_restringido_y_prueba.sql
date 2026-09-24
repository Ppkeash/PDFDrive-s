-- =====================================================================
-- Registro restringido + prueba gratuita de 14 días.
--
-- El producto es un SaaS de una sola empresa: cualquiera de dentro debe
-- poder darse de alta solo, pero nadie de fuera, y la misma persona no debe
-- poder encadenar pruebas gratuitas creándose cuentas.
--
-- La IP no sirve para nada de esto. Una oficina entera sale por una sola IP:
-- limitar por IP dejaría fuera a todos menos al primero que se registre, que
-- es justo el cliente. Quien sí identifica a una persona es su correo de
-- trabajo, y ese lo controla la empresa.
-- =====================================================================

-- ---------- Quién puede registrarse ----------
-- Acepta dominios y correos sueltos a propósito: si la empresa tiene dominio
-- propio basta una fila ('domain', 'laempresa.com'); si su gente usa correos
-- personales, se van aprobando de a uno. El mecanismo es el mismo.
create table if not exists signup_allowlist (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('domain', 'email')),
  value      text not null,
  note       text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

alter table signup_allowlist enable row level security;
revoke all on signup_allowlist from anon, authenticated;

comment on table signup_allowlist is
  'Quién puede crear cuenta. Solo la toca service_role o el Dashboard.';

-- Interruptor aparte, para que aplicar esta migración no cambie nada hoy.
-- Se enciende cuando la lista ya tenga contenido: encenderla vacía dejaría
-- fuera a todo el mundo.
create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  note       text,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

insert into app_settings (key, value, note) values
  ('signup_restriction_enabled', 'false',
   'Pasar a true cuando signup_allowlist tenga filas. Con la lista vacia nadie podria registrarse.')
on conflict (key) do nothing;

-- ---------- El filtro, en la base y no en la interfaz ----------
-- Tiene que vivir aquí: el endpoint de OAuth de Supabase es público, así que
-- una comprobación en el formulario no protege nada. Un trigger sobre
-- auth.users aborta la creación venga de donde venga.
create or replace function public.enforce_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  activo   text;
  correo   text;
  dominio  text;
begin
  select value into activo from app_settings where key = 'signup_restriction_enabled';
  if coalesce(activo, 'false') <> 'true' then
    return new;
  end if;

  correo := lower(trim(coalesce(new.email, '')));
  if correo = '' then
    raise exception 'Se necesita un correo para crear la cuenta.'
      using errcode = 'check_violation';
  end if;

  dominio := split_part(correo, '@', 2);

  if exists (
    select 1 from signup_allowlist
     where (kind = 'email'  and lower(value) = correo)
        or (kind = 'domain' and lower(value) = dominio)
  ) then
    return new;
  end if;

  raise exception 'Esta cuenta no tiene acceso. Pidele a quien administra que la habilite.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists on_auth_user_signup_allowlist on auth.users;
create trigger on_auth_user_signup_allowlist
  before insert on auth.users
  for each row execute function public.enforce_signup_allowlist();

revoke all on function public.enforce_signup_allowlist() from public;

-- ---------- Prueba gratuita, una por persona ----------
-- `billing_subjects` agrupa las cuentas de una misma persona (ver 0009). La
-- prueba se marca en el sujeto, no en la cuenta: crearse una segunda cuenta
-- no devuelve otra prueba, siempre que el enlace por correo canonicalizado
-- esté puesto desde backend.
alter table billing_subjects
  add column if not exists trial_granted_at timestamptz;

create or replace function public.grant_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  dias        integer;
  ya_tuvo     timestamptz;
begin
  if new.billing_subject_id is null then
    return new;
  end if;

  select trial_granted_at into ya_tuvo
    from billing_subjects where id = new.billing_subject_id;
  if ya_tuvo is not null then
    return new;  -- esta persona ya gastó su prueba
  end if;

  select coalesce(value, '14')::int into dias
    from app_settings where key = 'trial_days';
  dias := coalesce(dias, 14);

  insert into billing_subscriptions (
    workspace_id, provider, plan_code, status,
    current_period_start, current_period_end, metadata
  ) values (
    new.id, 'manual', 'personal', 'trialing',
    now(), now() + make_interval(days => dias),
    jsonb_build_object('origen', 'prueba_automatica')
  );

  update billing_subjects
     set trial_granted_at = now()
   where id = new.billing_subject_id;

  return new;
end;
$$;

drop trigger if exists on_workspace_created_trial on workspaces;
create trigger on_workspace_created_trial
  after insert on workspaces
  for each row execute function public.grant_trial_subscription();

revoke all on function public.grant_trial_subscription() from public;

insert into app_settings (key, value, note) values
  ('trial_days', '14', 'Duracion de la prueba gratuita al crear el espacio personal.')
on conflict (key) do nothing;

-- ---------- Coherencia con 0010/0011 ----------
-- `0009` se escribió antes del endurecimiento de hoy y concedía lectura de
-- los planes a `anon`. Aquí no hay pantalla pública de precios: sin sesión no
-- se lee nada.
revoke all on billing_plans from anon;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
