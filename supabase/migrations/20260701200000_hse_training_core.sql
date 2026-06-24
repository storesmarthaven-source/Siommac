-- ============================================================================
-- HSE Training / Competency — Phase 1: Database Foundation
-- ============================================================================
-- NEW tables (the rich competency model — the legacy hse_training_records
-- skeleton is left untouched; its NOT NULL course_id/completed_at don't fit the
-- certificate lifecycle, so this module uses dedicated tables):
--   hse_training_competencies · hse_training_courses · hse_training_requirements
--   hse_worker_certificates · hse_certificate_evidence · hse_certificate_verifications
--   hse_training_assignments · hse_training_audit_events
--
-- Conventions (mirror 20260701000000_hse_inspections_core.sql):
--   • uuid PKs default gen_random_uuid(); created_at; updated_at on mutable tables.
--   • app_users FKs are TEXT. Cross-module refs (role_id, site_id, department_id)
--     are plain uuid, NO FK — modules stay decoupled.
--   • RLS enabled on every table; NO policies (service-role bypass).
--   • Status / enum columns use CHECK constraints.
-- ============================================================================

-- ── 1. hse_training_competencies ──────────────────────────────────────────────
create table if not exists public.hse_training_competencies (
  id                          uuid    primary key default gen_random_uuid(),
  name                        text    not null,
  code                        text    unique,
  category                    text,
  description                 text,
  default_validity_months     integer,
  default_renewal_window_days integer not null default 90,
  requires_evidence           boolean not null default true,
  requires_certificate_number boolean not null default false,
  requires_verification       boolean not null default true,
  is_active                   boolean not null default true,
  created_by                  text    references public.app_users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  metadata                    jsonb   not null default '{}'::jsonb
);
create index if not exists hse_training_competencies_active_idx on public.hse_training_competencies(is_active);
alter table public.hse_training_competencies enable row level security;

-- ── 2. hse_training_courses ───────────────────────────────────────────────────
create table if not exists public.hse_training_courses (
  id                  uuid    primary key default gen_random_uuid(),
  competency_id       uuid    references public.hse_training_competencies(id) on delete set null,
  name                text    not null,
  provider            text,
  course_code         text,
  validity_months     integer,
  renewal_window_days integer,
  is_internal         boolean not null default false,
  is_active           boolean not null default true,
  created_by          text    references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  metadata            jsonb   not null default '{}'::jsonb
);
create index if not exists hse_training_courses_competency_idx on public.hse_training_courses(competency_id, is_active);
alter table public.hse_training_courses enable row level security;

-- ── 3. hse_training_requirements (role/site/dept → competency) ─────────────────
create table if not exists public.hse_training_requirements (
  id                     uuid    primary key default gen_random_uuid(),
  role_id                uuid,                                          -- cross-module, no FK
  role_name              text,
  site_id                uuid,
  site_name              text,
  department_id          uuid,
  department_name        text,
  competency_id          uuid    not null references public.hse_training_competencies(id) on delete cascade,
  requirement_level      text    not null default 'required'
                                 check (requirement_level in ('required','recommended','optional','site_specific','task_specific')),
  mandatory_before_work  boolean not null default true,
  applies_to_contractors boolean not null default true,
  renewal_window_days    integer,
  is_active              boolean not null default true,
  created_by             text    references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  metadata               jsonb   not null default '{}'::jsonb
);
create index if not exists hse_training_requirements_role_idx on public.hse_training_requirements(role_name, is_active);
create index if not exists hse_training_requirements_site_idx on public.hse_training_requirements(site_id, is_active) where site_id is not null;
create index if not exists hse_training_requirements_competency_idx on public.hse_training_requirements(competency_id, is_active);
alter table public.hse_training_requirements enable row level security;

-- ── 4. hse_worker_certificates ────────────────────────────────────────────────
create table if not exists public.hse_worker_certificates (
  id                      uuid    primary key default gen_random_uuid(),
  certificate_no          text    unique not null,                      -- nextRef('CERT')
  worker_id               text    not null references public.app_users(id) on delete cascade,
  worker_name             text,
  competency_id           uuid    references public.hse_training_competencies(id) on delete set null,
  course_id               uuid    references public.hse_training_courses(id) on delete set null,
  course_name             text    not null,
  provider                text,
  certificate_number      text,                                         -- provider's own cert number
  issued_at               date    not null,
  expires_at              date    not null,
  status                  text    not null default 'pending_verification'
                                  check (status in ('draft','pending_verification','current','due_soon','expired','rejected','revoked','archived')),
  verification_required   boolean not null default true,
  verified_by             text    references public.app_users(id) on delete set null,
  verified_at             timestamptz,
  verification_notes      text,
  rejected_by             text    references public.app_users(id) on delete set null,
  rejected_at             timestamptz,
  rejected_reason         text,
  revoked_by              text    references public.app_users(id) on delete set null,
  revoked_at              timestamptz,
  revoked_reason          text,
  previous_certificate_id uuid    references public.hse_worker_certificates(id) on delete set null,
  created_by              text    references public.app_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz,
  metadata                jsonb   not null default '{}'::jsonb
);
create index if not exists hse_worker_certificates_worker_idx on public.hse_worker_certificates(worker_id, status);
create index if not exists hse_worker_certificates_expiry_idx on public.hse_worker_certificates(expires_at, status);
create index if not exists hse_worker_certificates_competency_idx on public.hse_worker_certificates(worker_id, competency_id, status);
alter table public.hse_worker_certificates enable row level security;

-- ── 5. hse_certificate_evidence ───────────────────────────────────────────────
create table if not exists public.hse_certificate_evidence (
  id             uuid    primary key default gen_random_uuid(),
  certificate_id uuid    not null references public.hse_worker_certificates(id) on delete cascade,
  file_name      text    not null,
  file_path      text    not null,
  file_url       text,
  file_type      text,
  file_size      bigint,
  evidence_type  text    not null default 'certificate'
                         check (evidence_type in ('certificate','training_card','attendance_sheet','provider_confirmation','other')),
  uploaded_by    text    references public.app_users(id) on delete set null,
  uploaded_at    timestamptz not null default now(),
  metadata       jsonb   not null default '{}'::jsonb
);
create index if not exists hse_certificate_evidence_cert_idx on public.hse_certificate_evidence(certificate_id);
alter table public.hse_certificate_evidence enable row level security;

-- ── 6. hse_certificate_verifications ──────────────────────────────────────────
create table if not exists public.hse_certificate_verifications (
  id             uuid    primary key default gen_random_uuid(),
  certificate_id uuid    not null references public.hse_worker_certificates(id) on delete cascade,
  decision       text    not null check (decision in ('approved','rejected','more_information_required')),
  comments       text,
  verified_by    text    references public.app_users(id) on delete set null,
  verified_at    timestamptz not null default now(),
  metadata       jsonb   not null default '{}'::jsonb
);
create index if not exists hse_certificate_verifications_cert_idx on public.hse_certificate_verifications(certificate_id);
alter table public.hse_certificate_verifications enable row level security;

-- ── 7. hse_training_assignments ───────────────────────────────────────────────
create table if not exists public.hse_training_assignments (
  id                   uuid    primary key default gen_random_uuid(),
  assignment_no        text    unique not null,                         -- nextRef('TRN')
  worker_id            text    not null references public.app_users(id) on delete cascade,
  competency_id        uuid    references public.hse_training_competencies(id) on delete set null,
  course_id            uuid    references public.hse_training_courses(id) on delete set null,
  reason               text,
  priority             text    not null default 'medium' check (priority in ('low','medium','high','critical')),
  provider             text,
  scheduled_at         timestamptz,
  due_at               timestamptz not null,
  status               text    not null default 'assigned'
                               check (status in ('assigned','scheduled','in_progress','completed','overdue','cancelled')),
  completed_at         timestamptz,
  linked_certificate_id uuid   references public.hse_worker_certificates(id) on delete set null,
  assigned_by          text    references public.app_users(id) on delete set null,
  assigned_at          timestamptz not null default now(),
  updated_at           timestamptz,
  metadata             jsonb   not null default '{}'::jsonb
);
create index if not exists hse_training_assignments_worker_idx on public.hse_training_assignments(worker_id, status);
create index if not exists hse_training_assignments_due_idx on public.hse_training_assignments(due_at, status);
alter table public.hse_training_assignments enable row level security;

-- ── 8. hse_training_audit_events ──────────────────────────────────────────────
create table if not exists public.hse_training_audit_events (
  id            uuid    primary key default gen_random_uuid(),
  entity_type   text    not null
                        check (entity_type in ('competency','course','requirement','certificate','evidence','verification','assignment')),
  entity_id     uuid    not null,
  action        text    not null,
  actor_user_id text    references public.app_users(id) on delete set null,
  before_state  jsonb,
  after_state   jsonb,
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists hse_training_audit_entity_idx on public.hse_training_audit_events(entity_type, entity_id, created_at desc);
alter table public.hse_training_audit_events enable row level security;
