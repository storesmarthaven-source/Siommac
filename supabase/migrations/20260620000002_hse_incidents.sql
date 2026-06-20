-- Phase 1A: HSE Incident → Investigation → CAPA vertical slice
-- These are the first HSE module tables. Platform workflow tables (Phase 0A)
-- must already exist before this migration runs.

-- ── hse_incidents ─────────────────────────────────────────────────────────────
create table if not exists public.hse_incidents (
  id                  text        primary key,                      -- INC-<ulid>
  ref                 text        unique not null,                   -- INC-2026-001
  type                text        not null
                      check (type in ('injury','near-miss','property-damage','environmental','unsafe-act','unsafe-condition')),
  severity            text        not null
                      check (severity in ('critical','major','moderate','minor')),
  site_id             text        references public.project_sites(id) on delete set null,
  site_name           text,                                         -- denormalised for fast display (updated by trigger)
  status              text        not null default 'reported'
                      check (status in ('reported','under-investigation','capa-raised','closed')),
  reporter_id         uuid        references public.app_users(id) on delete set null,
  reporter_name       text,                                         -- denormalised snapshot
  description         text,
  immediate_actions   text,
  occurred_at         timestamptz not null default now(),
  -- OSH Act 2004 T&T statutory compliance columns
  -- Timeframes: 24 h verbal notification for critical/specified injury, 7-day written report
  -- These are configurable — hardcoded to OSH Act defaults; adjust via DB if Act changes.
  osh_notification_due  timestamptz,                                -- occurred_at + 24 h (critical/major only)
  osh_notified_at       timestamptz,                                -- when verbal notification was made
  osh_written_due       timestamptz,                                -- occurred_at + 7 days  (critical/major only)
  osh_written_at        timestamptz,                                -- when written report was submitted
  retain_until          timestamptz,                                -- occurred_at + 5 years (accident register)
  workflow_id         text        references public.workflow_instances(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_hse_incidents_status      on public.hse_incidents(status);
create index if not exists idx_hse_incidents_severity    on public.hse_incidents(severity);
create index if not exists idx_hse_incidents_occurred_at on public.hse_incidents(occurred_at desc);
create index if not exists idx_hse_incidents_reporter_id on public.hse_incidents(reporter_id);
create index if not exists idx_hse_incidents_site_id     on public.hse_incidents(site_id);
create index if not exists idx_hse_incidents_osh_notif_due on public.hse_incidents(osh_notification_due)
  where osh_notification_due is not null and osh_notified_at is null;

create trigger trg_hse_incidents_updated_at
  before update on public.hse_incidents
  for each row execute function public.set_updated_at();

alter table public.hse_incidents enable row level security;

create policy "hse_incidents: reporter can read own"
  on public.hse_incidents for select
  using (reporter_id = auth.uid());

create policy "hse_incidents: manager/admin full access"
  on public.hse_incidents for all
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );

-- ── hse_investigations ────────────────────────────────────────────────────────
create table if not exists public.hse_investigations (
  id          text        primary key,                              -- INV-<ulid>
  incident_id text        not null references public.hse_incidents(id) on delete cascade,
  method      text        not null default '5-whys'
              check (method in ('5-whys','rca','bowtie','fault-tree','incident-mapping')),
  findings    jsonb       not null default '[]',                    -- [{ why: text, because: text }]
  root_cause  text,
  lead_id     uuid        references public.app_users(id) on delete set null,
  lead_name   text,
  status      text        not null default 'open'
              check (status in ('open','in-progress','closed')),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_hse_investigations_incident_id on public.hse_investigations(incident_id);
create index if not exists idx_hse_investigations_status      on public.hse_investigations(status);

create trigger trg_hse_investigations_updated_at
  before update on public.hse_investigations
  for each row execute function public.set_updated_at();

alter table public.hse_investigations enable row level security;

create policy "hse_investigations: manager/admin full access"
  on public.hse_investigations for all
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );

-- ── hse_capa ──────────────────────────────────────────────────────────────────
create table if not exists public.hse_capa (
  id                text        primary key,                        -- CAPA-<ulid>
  ref               text        unique not null,                    -- CAPA-2026-001
  source_ref        text        not null,                          -- incident ref, finding ref, etc.
  source_type       text        not null
                    check (source_type in ('incident','finding','audit','inspection','toolbox')),
  title             text        not null,
  description       text        not null,
  owner_id          uuid        references public.app_users(id) on delete set null,
  owner_name        text,
  due_date          date        not null,
  priority          text        not null default 'medium'
                    check (priority in ('critical','high','medium','low')),
  status            text        not null default 'open'
                    check (status in ('open','in-progress','overdue','closed','verified')),
  verification_note text,
  closed_at         timestamptz,
  workflow_id       text        references public.workflow_instances(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_hse_capa_status     on public.hse_capa(status);
create index if not exists idx_hse_capa_due_date   on public.hse_capa(due_date);
create index if not exists idx_hse_capa_owner_id   on public.hse_capa(owner_id);
create index if not exists idx_hse_capa_source_ref on public.hse_capa(source_ref);

create trigger trg_hse_capa_updated_at
  before update on public.hse_capa
  for each row execute function public.set_updated_at();

alter table public.hse_capa enable row level security;

create policy "hse_capa: owner can read own"
  on public.hse_capa for select
  using (owner_id = auth.uid());

create policy "hse_capa: manager/admin full access"
  on public.hse_capa for all
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );
