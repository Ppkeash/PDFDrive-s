-- =====================================================================
-- Base de monetización (INACTIVA): planes, espacios, consumo y antiabuso.
--
-- Esta migración NO bloquea subidas ni firmas y NO cobra. Deja el modelo
-- preparado para activar esas decisiones más adelante desde backend.
-- Los firmantes externos no son asientos facturables.
-- =====================================================================

-- ---------- Catálogo comercial ----------
create table billing_plans (
  code                          text primary key,
  name                          text not null,
  monthly_price_cop             integer not null check (monthly_price_cop >= 0),
  annual_price_cop              integer not null check (annual_price_cop >= 0),
  completed_documents_per_month integer not null check (completed_documents_per_month >= 0),
  organizer_seats               integer not null check (organizer_seats > 0),
  external_signers_are_free     boolean not null default true,
  entitlements                  jsonb not null default '{}'::jsonb,
  active                        boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

insert into billing_plans (
  code, name, monthly_price_cop, annual_price_cop,
  completed_documents_per_month, organizer_seats, entitlements
) values
  ('free', 'Gratis', 0, 0, 3, 1,
   '{"audit":"basic","templates":0}'::jsonb),
  ('personal', 'Personal', 12900, 129000, 20, 1,
   '{"audit":"certificate","templates":5,"reminders":true}'::jsonb),
  ('team', 'Equipo', 39900, 399000, 100, 3,
   '{"audit":"certificate","templates":-1,"reminders":true,"branding":true,"comments":true}'::jsonb)
on conflict (code) do update set
  name = excluded.name,
  monthly_price_cop = excluded.monthly_price_cop,
  annual_price_cop = excluded.annual_price_cop,
  completed_documents_per_month = excluded.completed_documents_per_month,
  organizer_seats = excluded.organizer_seats,
  external_signers_are_free = excluded.external_signers_are_free,
  entitlements = excluded.entitlements,
  updated_at = now();

-- ---------- Sujeto de gratuidad ----------
-- Una persona puede crear varias cuentas, pero todas pueden enlazarse al mismo
-- sujeto y compartir una sola cuota gratuita. El enlace se hace en backend a
-- partir de HMACs; nunca se guardan correo, teléfono o tarjeta en claro aquí.
create table billing_subjects (
  id                 uuid primary key default gen_random_uuid(),
  status             text not null default 'active'
                     check (status in ('active', 'limited', 'blocked', 'review')),
  free_tier_started_at timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table billing_subject_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  subject_id   uuid not null references billing_subjects(id) on delete cascade,
  link_reason  text not null default 'new_account',
  linked_at    timestamptz not null default now()
);
create index billing_subject_users_subject_idx on billing_subject_users(subject_id);

create table billing_identity_keys (
  id               uuid primary key default gen_random_uuid(),
  subject_id       uuid not null references billing_subjects(id) on delete cascade,
  kind             text not null check (
                     kind in ('email_canonical', 'verified_phone', 'payment_method', 'device_cookie')
                   ),
  fingerprint_hmac text not null check (length(fingerprint_hmac) >= 32),
  confidence       smallint not null default 50 check (confidence between 0 and 100),
  verified_at      timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  unique (kind, fingerprint_hmac)
);
create index billing_identity_keys_subject_idx on billing_identity_keys(subject_id);

-- ---------- Espacios de trabajo ----------
create table workspaces (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id) on delete restrict,
  billing_subject_id   uuid references billing_subjects(id) on delete restrict,
  name                 text not null,
  kind                 text not null default 'personal' check (kind in ('personal', 'team')),
  plan_code            text not null default 'free' references billing_plans(code),
  billing_email        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index workspaces_one_personal_per_owner
  on workspaces(owner_id) where kind = 'personal';

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'member')),
  can_organize boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

-- Se conserva owner_id en documentos/carpetas durante la transición. Así esta
-- migración no cambia todavía las políticas ni los flujos que ya funcionan.
alter table documents add column if not exists workspace_id uuid references workspaces(id);
alter table folders add column if not exists workspace_id uuid references workspaces(id);
create index documents_workspace_idx on documents(workspace_id);
create index folders_workspace_idx on folders(workspace_id);

-- ---------- Suscripciones y créditos ----------
create table billing_subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,
  provider                 text not null check (provider in ('wompi', 'mercadopago', 'manual')),
  provider_customer_id     text,
  provider_subscription_id text,
  plan_code                text not null references billing_plans(code),
  status                   text not null check (
                             status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')
                           ),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index billing_subscriptions_workspace_idx on billing_subscriptions(workspace_id);

create table billing_credit_grants (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  provider_reference text,
  quantity           integer not null check (quantity > 0),
  consumed           integer not null default 0 check (consumed >= 0 and consumed <= quantity),
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index billing_credit_grants_available_idx
  on billing_credit_grants(workspace_id, expires_at) where consumed < quantity;

-- Ledger append-only. Una restricción por documento hace que reintentos de un
-- webhook o de la función de sellado no cobren dos veces el mismo documento.
create table billing_usage_events (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  billing_subject_id uuid references billing_subjects(id) on delete restrict,
  document_id        uuid references documents(id) on delete set null,
  metric             text not null check (metric in ('document_completed')),
  quantity           integer not null default 1 check (quantity > 0),
  idempotency_key    text not null unique,
  occurred_at        timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb
);
create unique index billing_usage_one_completion_per_document
  on billing_usage_events(document_id, metric)
  where document_id is not null and metric = 'document_completed';
create index billing_usage_workspace_period_idx
  on billing_usage_events(workspace_id, occurred_at);
create index billing_usage_subject_period_idx
  on billing_usage_events(billing_subject_id, occurred_at);

-- Señales, no sentencias. Compartir red o dispositivo nunca debe bloquear por
-- sí solo; puede pedir verificación adicional o revisión.
create table billing_risk_events (
  id                 uuid primary key default gen_random_uuid(),
  subject_id         uuid references billing_subjects(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  workspace_id       uuid references workspaces(id) on delete cascade,
  code               text not null,
  weight             smallint not null default 0,
  evidence_hmac      text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz
);
create index billing_risk_events_subject_idx on billing_risk_events(subject_id, created_at);

-- ---------- Backfill y creación automática ----------
do $$
declare
  p record;
  new_subject_id uuid;
  new_workspace_id uuid;
begin
  for p in
    select id, coalesce(nullif(name, ''), split_part(email, '@', 1), 'Mi espacio') as workspace_name,
           email
      from profiles
     where not exists (
       select 1 from workspaces w where w.owner_id = profiles.id and w.kind = 'personal'
     )
  loop
    insert into billing_subjects default values returning id into new_subject_id;
    insert into billing_subject_users(user_id, subject_id, link_reason)
      values (p.id, new_subject_id, 'existing_account');
    insert into workspaces(owner_id, billing_subject_id, name, billing_email)
      values (p.id, new_subject_id, p.workspace_name, p.email)
      returning id into new_workspace_id;
    insert into workspace_members(workspace_id, user_id, role, can_organize)
      values (new_workspace_id, p.id, 'owner', true);
  end loop;
end $$;

update documents d
   set workspace_id = w.id
  from workspaces w
 where d.workspace_id is null and w.owner_id = d.owner_id and w.kind = 'personal';

update folders f
   set workspace_id = w.id
  from workspaces w
 where f.workspace_id is null and w.owner_id = f.owner_id and w.kind = 'personal';

create or replace function public.create_personal_billing_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_subject_id uuid;
  new_workspace_id uuid;
begin
  if exists (select 1 from workspaces where owner_id = new.id and kind = 'personal') then
    return new;
  end if;

  insert into billing_subjects default values returning id into new_subject_id;
  insert into billing_subject_users(user_id, subject_id) values (new.id, new_subject_id);
  insert into workspaces(owner_id, billing_subject_id, name, billing_email)
    values (
      new.id,
      new_subject_id,
      coalesce(nullif(new.name, ''), split_part(new.email, '@', 1), 'Mi espacio'),
      new.email
    )
    returning id into new_workspace_id;
  insert into workspace_members(workspace_id, user_id, role, can_organize)
    values (new_workspace_id, new.id, 'owner', true);
  return new;
end;
$$;

drop trigger if exists on_profile_created_billing_workspace on profiles;
create trigger on_profile_created_billing_workspace
  after insert on profiles
  for each row execute function public.create_personal_billing_workspace();

create or replace function public.assign_personal_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.workspace_id is null then
    select id into new.workspace_id
      from workspaces
     where owner_id = new.owner_id and kind = 'personal'
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_assign_workspace on documents;
create trigger documents_assign_workspace before insert on documents
  for each row execute function public.assign_personal_workspace();
drop trigger if exists folders_assign_workspace on folders;
create trigger folders_assign_workspace before insert on folders
  for each row execute function public.assign_personal_workspace();

create or replace function public.billing_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger billing_plans_updated_at before update on billing_plans
  for each row execute function public.billing_set_updated_at();
create trigger billing_subjects_updated_at before update on billing_subjects
  for each row execute function public.billing_set_updated_at();
create trigger workspaces_updated_at before update on workspaces
  for each row execute function public.billing_set_updated_at();
create trigger billing_subscriptions_updated_at before update on billing_subscriptions
  for each row execute function public.billing_set_updated_at();

-- ---------- Lectura segura; todas las escrituras de billing van por backend ----------
create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;

alter table billing_plans          enable row level security;
alter table billing_subjects       enable row level security;
alter table billing_subject_users  enable row level security;
alter table billing_identity_keys  enable row level security;
alter table workspaces             enable row level security;
alter table workspace_members      enable row level security;
alter table billing_subscriptions  enable row level security;
alter table billing_credit_grants  enable row level security;
alter table billing_usage_events   enable row level security;
alter table billing_risk_events    enable row level security;

create policy "planes públicos: leer" on billing_plans for select using (active);
create policy "workspace miembros: leer" on workspaces for select
  using (owner_id = auth.uid() or is_workspace_member(id));
create policy "workspace dueño: crear" on workspaces for insert
  with check (owner_id = auth.uid());
create policy "workspace dueño: actualizar" on workspaces for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "workspace dueño: borrar" on workspaces for delete
  using (owner_id = auth.uid());
create policy "miembros del workspace: leer" on workspace_members for select
  using (is_workspace_member(workspace_id));
create policy "suscripción del workspace: leer" on billing_subscriptions for select
  using (is_workspace_member(workspace_id));
create policy "créditos del workspace: leer" on billing_credit_grants for select
  using (is_workspace_member(workspace_id));
create policy "consumo del workspace: leer" on billing_usage_events for select
  using (is_workspace_member(workspace_id));

grant select on billing_plans to anon, authenticated;
grant select, insert, update, delete on workspaces to authenticated;
grant select on workspace_members, billing_subscriptions,
  billing_credit_grants, billing_usage_events to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- Tablas sensibles sin políticas de cliente: solo service_role puede usarlas.
revoke all on billing_subjects, billing_subject_users,
  billing_identity_keys, billing_risk_events from anon, authenticated;

comment on table billing_usage_events is
  'Ledger append-only. Activar escritura únicamente desde sellado/webhooks con service_role.';
comment on table billing_identity_keys is
  'HMACs para agrupar elegibilidad gratuita; nunca almacenar identificadores en claro.';
