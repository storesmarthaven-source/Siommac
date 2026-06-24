-- ============================================================================
-- HSE Inspections — Phase 1: Database Foundation
-- ============================================================================
-- EXTENDS existing skeletons:  hse_inspections · hse_inspection_findings
--   (both created in 20260621100002_erp_hse_core.sql)
-- NEW tables:
--   hse_inspection_templates · hse_inspection_template_sections
--   hse_inspection_template_items · hse_inspection_responses
--   hse_inspection_finding_actions · hse_inspection_evidence
--   hse_inspection_comments · hse_inspection_audit_events
--
-- Convention notes (mirrors 20260625000000_hse_ptw_core.sql):
--   • Existing tables EXTENDED via add column if not exists (no recreate).
--   • New tables: create table if not exists (safely re-runnable).
--   • PKs: id uuid primary key default gen_random_uuid().
--   • Timestamps: timestamptz. Every table: created_at. Mutable tables also
--     updated_at timestamptz (no default — app sets it).
--   • User FK columns: text references public.app_users(id) on delete set null
--     (app_users.id is TEXT).
--   • Cross-module refs (site_id, asset_id, department_id): plain uuid/text,
--     NO foreign key — modules stay decoupled. site_id stays TEXT to match the
--     existing hse_inspections skeleton.
--   • RLS enabled on every new table; NO permissive policies (service-role bypass).
--   • status/severity on the existing skeleton columns are left CHECK-free to
--     avoid breaking seeded rows; the richer value sets are enforced in the app.
-- ============================================================================

-- ── 1. hse_inspection_templates ───────────────────────────────────────────────
create table if not exists public.hse_inspection_templates (
  id              uuid    primary key default gen_random_uuid(),
  name            text    not null,
  inspection_type text    not null,
  description     text,
  is_active       boolean not null default true,
  created_by      text    references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  metadata        jsonb   not null default '{}'::jsonb
);

create index if not exists hse_inspection_templates_type_idx
  on public.hse_inspection_templates(inspection_type, is_active);

alter table public.hse_inspection_templates enable row level security;

-- ── 2. hse_inspection_template_sections ───────────────────────────────────────
create table if not exists public.hse_inspection_template_sections (
  id            uuid    primary key default gen_random_uuid(),
  template_id   uuid    not null references public.hse_inspection_templates(id) on delete cascade,
  title         text    not null,
  description   text,
  sort_order    integer not null default 0,
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists hse_inspection_template_sections_template_idx
  on public.hse_inspection_template_sections(template_id, sort_order);

alter table public.hse_inspection_template_sections enable row level security;

-- ── 3. hse_inspection_template_items ──────────────────────────────────────────
create table if not exists public.hse_inspection_template_items (
  id            uuid    primary key default gen_random_uuid(),
  template_id   uuid    not null references public.hse_inspection_templates(id) on delete cascade,
  section_id    uuid    references public.hse_inspection_template_sections(id) on delete set null,
  question      text    not null,
  help_text     text,
  response_type text    not null
                        check (response_type in ('pass_fail_na','yes_no_na','numeric','text','photo_required','signature','multi_select')),
  is_required                 boolean not null default true,
  is_critical                 boolean not null default false,
  requires_evidence_on_fail   boolean not null default false,
  auto_create_finding_on_fail boolean not null default false,
  sort_order    integer not null default 0,
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists hse_inspection_template_items_template_idx
  on public.hse_inspection_template_items(template_id, sort_order);

alter table public.hse_inspection_template_items enable row level security;

-- ── 4. EXTEND hse_inspections ─────────────────────────────────────────────────
-- Skeleton has: id, ref, type, site_id (text), inspector_id, scheduled_date,
-- completed_date, status, score, workflow_id, metadata, created_at, updated_at.
alter table public.hse_inspections
  add column if not exists inspection_no    text,                            -- human ref alias (nextRef 'INSP')
  add column if not exists title            text,
  add column if not exists description      text,
  add column if not exists inspection_type  text,                            -- normalised from "type"
  add column if not exists priority         text not null default 'medium'
                                            check (priority in ('low','medium','high','critical')),
  add column if not exists area             text,
  add column if not exists asset_id         uuid,                            -- cross-module, no FK
  add column if not exists asset_name       text,
  add column if not exists department_id    uuid,                            -- cross-module, no FK
  add column if not exists site_name        text,
  add column if not exists template_id      uuid references public.hse_inspection_templates(id) on delete set null,
  add column if not exists assignee_id      text references public.app_users(id) on delete set null,  -- alias for inspector_id
  add column if not exists reviewer_id      text references public.app_users(id) on delete set null,
  add column if not exists due_at           timestamptz,
  add column if not exists scheduled_at     timestamptz,
  add column if not exists started_at       timestamptz,
  add column if not exists submitted_at     timestamptz,
  add column if not exists reviewed_at      timestamptz,
  add column if not exists completed_at     timestamptz,
  add column if not exists cancelled_at     timestamptz,
  add column if not exists created_by       text references public.app_users(id) on delete set null;

create index if not exists hse_inspections_status_idx
  on public.hse_inspections(status);

create index if not exists hse_inspections_type_idx
  on public.hse_inspections(inspection_type)
  where inspection_type is not null;

create index if not exists hse_inspections_assignee_idx
  on public.hse_inspections(assignee_id, status)
  where assignee_id is not null;

create index if not exists hse_inspections_due_at_idx
  on public.hse_inspections(due_at, status)
  where due_at is not null;

create index if not exists hse_inspections_site_idx
  on public.hse_inspections(site_id)
  where site_id is not null;

-- ── 5. hse_inspection_responses ───────────────────────────────────────────────
create table if not exists public.hse_inspection_responses (
  id               uuid    primary key default gen_random_uuid(),
  inspection_id    uuid    not null references public.hse_inspections(id) on delete cascade,
  template_item_id uuid    not null references public.hse_inspection_template_items(id) on delete cascade,
  response_value   text,
  response_status  text    check (response_status in ('unanswered','passed','failed','not_applicable','requires_follow_up')),
  comment          text,
  finding_id       uuid,                                                     -- links to a created finding; plain uuid (no FK, avoids cycle)
  answered_by      text    references public.app_users(id) on delete set null,
  answered_at      timestamptz,
  metadata         jsonb   not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (inspection_id, template_item_id)
);

create index if not exists hse_inspection_responses_inspection_idx
  on public.hse_inspection_responses(inspection_id);

alter table public.hse_inspection_responses enable row level security;

-- ── 6. EXTEND hse_inspection_findings ─────────────────────────────────────────
-- Skeleton has: id, inspection_id, description, severity (default 'moderate'),
-- owner_id, due_date, status (default 'open'), capa_id, created_at.
alter table public.hse_inspection_findings
  add column if not exists finding_no   text,                               -- human ref alias (nextRef 'FND')
  add column if not exists response_id  uuid,                               -- source checklist response; plain uuid (no FK, avoids cycle)
  add column if not exists title        text,
  add column if not exists category     text,
  add column if not exists site_id      text,
  add column if not exists site_name    text,
  add column if not exists area         text,
  add column if not exists reviewer_id  text references public.app_users(id) on delete set null,
  add column if not exists due_at       timestamptz,                        -- richer alias for due_date
  add column if not exists closed_at    timestamptz,
  add column if not exists created_by   text references public.app_users(id) on delete set null,
  add column if not exists updated_at   timestamptz,
  add column if not exists metadata     jsonb not null default '{}'::jsonb;

create index if not exists hse_inspection_findings_status_severity_idx
  on public.hse_inspection_findings(status, severity);

create index if not exists hse_inspection_findings_owner_idx
  on public.hse_inspection_findings(owner_id, status)
  where owner_id is not null;

create index if not exists hse_inspection_findings_due_at_idx
  on public.hse_inspection_findings(due_at, status)
  where due_at is not null;

-- ── 7. hse_inspection_finding_actions ─────────────────────────────────────────
create table if not exists public.hse_inspection_finding_actions (
  id                 uuid    primary key default gen_random_uuid(),
  finding_id         uuid    not null references public.hse_inspection_findings(id) on delete cascade,
  action_description text    not null,
  owner_id           text    references public.app_users(id) on delete set null,
  due_at             timestamptz,
  status             text    not null default 'open'
                             check (status in ('open','in_progress','awaiting_review','completed','rejected','cancelled')),
  completed_at       timestamptz,
  reviewed_at        timestamptz,
  created_by         text    references public.app_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  metadata           jsonb   not null default '{}'::jsonb
);

create index if not exists hse_inspection_finding_actions_finding_idx
  on public.hse_inspection_finding_actions(finding_id);

alter table public.hse_inspection_finding_actions enable row level security;

-- ── 8. hse_inspection_evidence ────────────────────────────────────────────────
create table if not exists public.hse_inspection_evidence (
  id            uuid    primary key default gen_random_uuid(),
  inspection_id uuid    references public.hse_inspections(id) on delete cascade,
  finding_id    uuid    references public.hse_inspection_findings(id) on delete cascade,
  response_id   uuid    references public.hse_inspection_responses(id) on delete cascade,
  file_name     text    not null,
  file_path     text    not null,
  file_url      text,
  file_type     text,
  file_size     bigint,
  evidence_type text    check (evidence_type in ('photo','document','signature','checklist','corrective_action','other')),
  uploaded_by   text    references public.app_users(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  metadata      jsonb   not null default '{}'::jsonb
);

create index if not exists hse_inspection_evidence_inspection_idx
  on public.hse_inspection_evidence(inspection_id)
  where inspection_id is not null;

create index if not exists hse_inspection_evidence_finding_idx
  on public.hse_inspection_evidence(finding_id)
  where finding_id is not null;

alter table public.hse_inspection_evidence enable row level security;

-- ── 9. hse_inspection_comments ────────────────────────────────────────────────
create table if not exists public.hse_inspection_comments (
  id            uuid    primary key default gen_random_uuid(),
  inspection_id uuid    references public.hse_inspections(id) on delete cascade,
  finding_id    uuid    references public.hse_inspection_findings(id) on delete cascade,
  body          text    not null,
  created_by    text    references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  metadata      jsonb   not null default '{}'::jsonb
);

create index if not exists hse_inspection_comments_inspection_idx
  on public.hse_inspection_comments(inspection_id)
  where inspection_id is not null;

create index if not exists hse_inspection_comments_finding_idx
  on public.hse_inspection_comments(finding_id)
  where finding_id is not null;

alter table public.hse_inspection_comments enable row level security;

-- ── 10. hse_inspection_audit_events ───────────────────────────────────────────
-- Module-scoped timeline (complements global audit_logs). Generic entity so it
-- covers inspections, findings, actions, evidence, and templates.
create table if not exists public.hse_inspection_audit_events (
  id            uuid    primary key default gen_random_uuid(),
  entity_type   text    not null
                        check (entity_type in ('inspection','finding','finding_action','evidence','template')),
  entity_id     uuid    not null,
  action        text    not null,                                           -- e.g. 'scheduled','started','submitted','finding_created'
  actor_user_id text    references public.app_users(id) on delete set null,
  before_state  jsonb,
  after_state   jsonb,
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists hse_inspection_audit_entity_idx
  on public.hse_inspection_audit_events(entity_type, entity_id, created_at desc);

alter table public.hse_inspection_audit_events enable row level security;
