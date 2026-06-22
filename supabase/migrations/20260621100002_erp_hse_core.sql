-- ============================================================================
-- ERP HSE Core
-- hse_incidents · hse_incident_people
-- hse_investigations · hse_investigation_evidence · hse_root_causes
-- hse_capa_actions
-- + skeleton tables for future HSE areas (schema locks in now, UI later)
-- ============================================================================

-- ── hse_incidents ─────────────────────────────────────────────────────────────

create table if not exists public.hse_incidents (
  id                uuid    primary key default gen_random_uuid(),
  ref               text    not null unique,   -- INC-2026-0001
  title             text    not null,
  description       text    not null default '',
  incident_date     timestamptz not null,
  reported_at       timestamptz not null default now(),
  reported_by       text    references public.app_users(id) on delete set null,
  site_id           text,
  department_id     text,
  location_text     text,
  incident_type     text    not null,          -- 'injury'|'near_miss'|'property_damage'|'environmental'|'other'
  severity          text    not null
                    check (severity in ('minor','moderate','high','critical')),
  status            text    not null default 'open'
                    check (status in (
                      'open','triage','investigation','capa',
                      'awaiting_closure','closed','cancelled'
                    )),
  immediate_action  text,
  regulatory_class  text,
  recordable        boolean not null default false,
  lost_time         boolean not null default false,
  workflow_id       uuid    references public.workflow_instances(id) on delete set null,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_inc_status_idx
  on public.hse_incidents(status, incident_date desc);

create index if not exists hse_inc_site_idx
  on public.hse_incidents(site_id, incident_date desc);

create index if not exists hse_inc_reporter_idx
  on public.hse_incidents(reported_by);

alter table public.hse_incidents enable row level security;

-- ── hse_incident_people ───────────────────────────────────────────────────────

create table if not exists public.hse_incident_people (
  id                uuid    primary key default gen_random_uuid(),
  incident_id       uuid    not null references public.hse_incidents(id) on delete cascade,
  person_type       text    not null
                    check (person_type in (
                      'injured','witness','reporter','supervisor','contractor','visitor'
                    )),
  user_id           text    references public.app_users(id) on delete set null,
  full_name         text    not null,
  role_or_company   text,
  injury_description text,
  created_at        timestamptz not null default now()
);

create index if not exists hip_incident_idx
  on public.hse_incident_people(incident_id);

alter table public.hse_incident_people enable row level security;

-- ── hse_investigations ────────────────────────────────────────────────────────

create table if not exists public.hse_investigations (
  id                    uuid    primary key default gen_random_uuid(),
  ref                   text    not null unique,   -- INV-2026-0001
  incident_id           uuid    not null references public.hse_incidents(id) on delete cascade,
  investigator_user_id  text    references public.app_users(id) on delete set null,
  status                text    not null default 'assigned'
                                check (status in (
                                  'assigned','collecting_evidence','root_cause',
                                  'findings','review','closed','overdue'
                                )),
  due_at                timestamptz,
  root_cause_method     text
                        check (root_cause_method in ('5why','fishbone','taproot','other')),
  summary               text,
  findings              text,
  recommendations       text,
  workflow_id           uuid    references public.workflow_instances(id) on delete set null,
  metadata              jsonb   not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  closed_at             timestamptz
);

create index if not exists hse_inv_incident_idx
  on public.hse_investigations(incident_id);

create index if not exists hse_inv_status_idx
  on public.hse_investigations(status, due_at);

create index if not exists hse_inv_investigator_idx
  on public.hse_investigations(investigator_user_id, status);

alter table public.hse_investigations enable row level security;

-- ── hse_investigation_evidence ────────────────────────────────────────────────

create table if not exists public.hse_investigation_evidence (
  id                uuid    primary key default gen_random_uuid(),
  investigation_id  uuid    not null references public.hse_investigations(id) on delete cascade,
  evidence_type     text    not null
                    check (evidence_type in (
                      'photo','document','statement','inspection','measurement','other'
                    )),
  title             text    not null,
  description       text,
  attachment_id     uuid    references public.attachments(id) on delete set null,
  collected_by      text    references public.app_users(id) on delete set null,
  collected_at      timestamptz,
  status            text    not null default 'pending'
                    check (status in ('pending','collected','rejected')),
  created_at        timestamptz not null default now()
);

create index if not exists hse_ev_investigation_idx
  on public.hse_investigation_evidence(investigation_id);

alter table public.hse_investigation_evidence enable row level security;

-- ── hse_root_causes ───────────────────────────────────────────────────────────

create table if not exists public.hse_root_causes (
  id                  uuid    primary key default gen_random_uuid(),
  investigation_id    uuid    not null references public.hse_investigations(id) on delete cascade,
  category            text    not null,
  cause               text    not null,
  contributing_factor boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists hse_rc_investigation_idx
  on public.hse_root_causes(investigation_id);

alter table public.hse_root_causes enable row level security;

-- ── hse_capa_actions ──────────────────────────────────────────────────────────

create table if not exists public.hse_capa_actions (
  id                    uuid    primary key default gen_random_uuid(),
  ref                   text    not null unique,   -- CAPA-2026-0001
  source_type           text    not null,          -- 'incident'|'investigation'|'audit'|'inspection'
  source_id             text    not null,
  title                 text    not null,
  description           text    not null,
  owner_user_id         text    references public.app_users(id) on delete set null,
  priority              text    not null default 'medium'
                                check (priority in ('low','medium','high','critical')),
  status                text    not null default 'open'
                                check (status in (
                                  'open','in_progress','implemented','verification',
                                  'returned','closed','overdue','cancelled'
                                )),
  due_at                timestamptz,
  completed_at          timestamptz,
  verified_by           text    references public.app_users(id) on delete set null,
  verified_at           timestamptz,
  effectiveness_result  text
                        check (effectiveness_result in (
                          'effective','partially_effective','ineffective'
                        )),
  workflow_id           uuid    references public.workflow_instances(id) on delete set null,
  created_by            text    references public.app_users(id) on delete set null,
  metadata              jsonb   not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

create index if not exists hse_capa_due_idx
  on public.hse_capa_actions(status, due_at);

create index if not exists hse_capa_owner_idx
  on public.hse_capa_actions(owner_user_id, status);

create index if not exists hse_capa_source_idx
  on public.hse_capa_actions(source_type, source_id);

alter table public.hse_capa_actions enable row level security;

-- ── Skeleton tables for future HSE areas ──────────────────────────────────────
-- Schema is locked in now so future UI expansion needs no migration redesign.
-- These tables are intentionally minimal; columns expand as areas are built.

create table if not exists public.hse_inspections (
  id              uuid    primary key default gen_random_uuid(),
  ref             text    not null unique,
  type            text    not null,
  site_id         text,
  inspector_id    text    references public.app_users(id) on delete set null,
  scheduled_date  date,
  completed_date  date,
  status          text    not null default 'scheduled',
  score           numeric,
  workflow_id     uuid    references public.workflow_instances(id) on delete set null,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
alter table public.hse_inspections enable row level security;

create table if not exists public.hse_inspection_findings (
  id              uuid    primary key default gen_random_uuid(),
  inspection_id   uuid    not null references public.hse_inspections(id) on delete cascade,
  description     text    not null,
  severity        text    not null default 'moderate',
  owner_id        text    references public.app_users(id) on delete set null,
  due_date        date,
  status          text    not null default 'open',
  capa_id         uuid    references public.hse_capa_actions(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.hse_inspection_findings enable row level security;

create table if not exists public.hse_permits (
  id              uuid    primary key default gen_random_uuid(),
  ref             text    not null unique,
  type            text    not null,
  site_id         text,
  requestor_id    text    references public.app_users(id) on delete set null,
  approver_id     text    references public.app_users(id) on delete set null,
  start_date      timestamptz,
  end_date        timestamptz,
  status          text    not null default 'draft',
  conditions      jsonb   not null default '[]'::jsonb,
  crew_ids        jsonb   not null default '[]'::jsonb,
  workflow_id     uuid    references public.workflow_instances(id) on delete set null,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
alter table public.hse_permits enable row level security;

create table if not exists public.hse_risk_assessments (
  id                      uuid    primary key default gen_random_uuid(),
  ref                     text    not null unique,
  hazard_description      text    not null,
  category                text,
  site_id                 text,
  likelihood              integer check (likelihood between 1 and 5),
  severity                integer check (severity between 1 and 5),
  rating                  integer generated always as (likelihood * severity) stored,
  controls                jsonb   not null default '[]'::jsonb,
  residual_likelihood     integer check (residual_likelihood between 1 and 5),
  residual_severity       integer check (residual_severity between 1 and 5),
  assessed_by             text    references public.app_users(id) on delete set null,
  review_date             date,
  status                  text    not null default 'draft',
  approved_at             timestamptz,
  metadata                jsonb   not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz
);
alter table public.hse_risk_assessments enable row level security;

create table if not exists public.hse_training_records (
  id              uuid    primary key default gen_random_uuid(),
  employee_id     text    not null references public.app_users(id) on delete cascade,
  course_id       text    not null,
  course_name     text    not null,
  completed_at    date    not null,
  expiry_date     date,
  provider        text,
  status          text    not null default 'current',
  cert_url        text,
  workflow_id     uuid    references public.workflow_instances(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists hse_tr_employee_idx
  on public.hse_training_records(employee_id, expiry_date);
alter table public.hse_training_records enable row level security;

create table if not exists public.hse_document_controls (
  id              uuid    primary key default gen_random_uuid(),
  ref             text    not null unique,
  title           text    not null,
  category        text,
  version         text    not null default '1.0',
  owner_id        text    references public.app_users(id) on delete set null,
  review_date     date,
  status          text    not null default 'draft',
  file_url        text,
  approved_at     timestamptz,
  workflow_id     uuid    references public.workflow_instances(id) on delete set null,
  retain_until    date,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
alter table public.hse_document_controls enable row level security;

create table if not exists public.hse_ppe_assignments (
  id              uuid    primary key default gen_random_uuid(),
  employee_id     text    not null references public.app_users(id) on delete cascade,
  item_code       text    not null,
  item_name       text    not null,
  assigned_at     timestamptz not null default now(),
  returned_at     timestamptz,
  condition       text    not null default 'good',
  qty             integer not null default 1,
  site_id         text,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists hse_ppe_emp_idx
  on public.hse_ppe_assignments(employee_id);
alter table public.hse_ppe_assignments enable row level security;

create table if not exists public.hse_environmental_records (
  id              uuid    primary key default gen_random_uuid(),
  ref             text    not null unique,
  record_type     text    not null,   -- 'spill'|'waste_manifest'|'ema_notification'|'monitoring'
  site_id         text,
  recorded_by     text    references public.app_users(id) on delete set null,
  incident_date   date,
  status          text    not null default 'open',
  payload         jsonb   not null default '{}'::jsonb,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
alter table public.hse_environmental_records enable row level security;

create table if not exists public.hse_emergency_drills (
  id              uuid    primary key default gen_random_uuid(),
  ref             text    not null unique,
  drill_type      text    not null,
  site_id         text,
  scheduled_date  date,
  completed_date  date,
  lead_id         text    references public.app_users(id) on delete set null,
  participants    jsonb   not null default '[]'::jsonb,
  outcome         text,
  notes           text,
  status          text    not null default 'scheduled',
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
alter table public.hse_emergency_drills enable row level security;

-- ── HSE permission seeding ────────────────────────────────────────────────────

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.dashboard.view'),
  ('superadmin', 'hse.incidents.view'),
  ('superadmin', 'hse.incidents.create'),
  ('superadmin', 'hse.incidents.manage'),
  ('superadmin', 'hse.investigations.manage'),
  ('superadmin', 'hse.capa.manage'),
  ('superadmin', 'hse.permits.manage'),
  ('superadmin', 'hse.inspections.manage'),
  ('superadmin', 'hse.training.manage'),
  ('superadmin', 'hse.documents.manage'),
  ('superadmin', 'hse.environmental.manage'),
  ('admin',      'hse.dashboard.view'),
  ('admin',      'hse.incidents.view'),
  ('admin',      'hse.incidents.create'),
  ('admin',      'hse.incidents.manage'),
  ('admin',      'hse.investigations.manage'),
  ('admin',      'hse.capa.manage'),
  ('admin',      'hse.permits.manage'),
  ('admin',      'hse.inspections.manage'),
  ('admin',      'hse.training.manage'),
  ('admin',      'hse.documents.manage'),
  ('admin',      'hse.environmental.manage'),
  ('manager',    'hse.dashboard.view'),
  ('manager',    'hse.incidents.view'),
  ('manager',    'hse.incidents.create'),
  ('manager',    'hse.incidents.manage'),
  ('manager',    'hse.investigations.manage'),
  ('manager',    'hse.capa.manage'),
  ('manager',    'hse.permits.manage'),
  ('manager',    'hse.inspections.manage'),
  ('manager',    'hse.training.manage'),
  ('manager',    'hse.documents.manage'),
  ('manager',    'hse.environmental.manage'),
  ('employee',   'hse.dashboard.view'),
  ('employee',   'hse.incidents.view'),
  ('employee',   'hse.incidents.create')
on conflict (role_name, permission) do nothing;
