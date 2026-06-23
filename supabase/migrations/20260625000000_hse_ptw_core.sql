-- ============================================================================
-- HSE Permit-to-Work (PTW) — Phase 1: Database Foundation
-- ============================================================================
-- hse_permits (EXTEND existing skeleton)
-- hse_permit_hazards · hse_permit_controls · hse_permit_approvals
-- hse_permit_isolations · hse_permit_gas_tests · hse_permit_simops_conflicts
-- hse_permit_extensions · hse_permit_handovers · hse_permit_suspensions
-- hse_permit_closeouts · hse_permit_attachments · hse_permit_audit_events
-- hse_permit_templates · hse_permit_type_config
--
-- Convention notes:
--   • hse_permits ALREADY EXISTS (skeleton in 20260621100002_erp_hse_core.sql).
--     We ADD COLUMN IF NOT EXISTS for every new field; no create table.
--   • All new tables: create table if not exists (safely re-runnable).
--   • PKs:  id uuid primary key default gen_random_uuid()
--   • Timestamps: timestamptz (never TIMESTAMP). Every table: created_at.
--     Mutable tables also: updated_at timestamptz (no default — set by app/trigger).
--   • User FK columns: text references public.app_users(id) on delete set null
--     (app_users.id is TEXT, not uuid).
--   • Cross-module refs (site_id, area_id, work_order_id, jsa_id, etc.):
--     plain uuid, NO foreign key — modules stay decoupled.
--   • RLS enabled on every table; NO permissive policies (service-role bypasses).
-- ============================================================================

-- ── 1. EXTEND hse_permits ─────────────────────────────────────────────────────
-- The skeleton has: id, ref, type, site_id, requestor_id, approver_id,
-- start_date, end_date, status, conditions, crew_ids, workflow_id, metadata,
-- created_at, updated_at.
-- We normalise and add all PTW-spec fields.

alter table public.hse_permits
  -- permit identity / classification
  add column if not exists permit_type           text,                             -- normalised from "type"; kept both for compat
  add column if not exists permit_number         text,                             -- human-readable ref alias
  add column if not exists title                 text,
  add column if not exists description           text,
  add column if not exists risk_level            text    check (risk_level in ('low','medium','high','critical')),

  -- work location
  add column if not exists area_id               uuid,                             -- cross-module, no FK
  add column if not exists department_id         uuid,                             -- cross-module, no FK
  add column if not exists specific_location     text,
  add column if not exists asset_id              uuid,                             -- cross-module, no FK

  -- timing
  add column if not exists requested_at          timestamptz,
  add column if not exists start_datetime        timestamptz,                      -- richer alias for start_date
  add column if not exists end_datetime          timestamptz,                      -- richer alias for end_date
  add column if not exists actual_start          timestamptz,
  add column if not exists actual_end            timestamptz,
  add column if not exists max_duration_hours    integer,

  -- people
  add column if not exists requester_id          text    references public.app_users(id) on delete set null,  -- normalised alias for requestor_id
  add column if not exists work_supervisor_id    text    references public.app_users(id) on delete set null,
  add column if not exists safety_officer_id     text    references public.app_users(id) on delete set null,
  add column if not exists area_authority_id     text    references public.app_users(id) on delete set null,
  add column if not exists issued_by             text    references public.app_users(id) on delete set null,
  add column if not exists closed_by             text    references public.app_users(id) on delete set null,
  add column if not exists created_by            text    references public.app_users(id) on delete set null,

  -- contractor
  add column if not exists contractor_company_id uuid,                             -- cross-module, no FK
  add column if not exists contractor_name       text,
  add column if not exists contractor_rep        text,

  -- cross-module links (all plain uuid, no FK)
  add column if not exists linked_jsa_id              uuid,
  add column if not exists linked_risk_assessment_id  uuid,
  add column if not exists linked_work_order_id       uuid,
  add column if not exists linked_incident_id         uuid,

  -- type-specific flags (set from permit_type_config at creation)
  add column if not exists requires_jsa           boolean not null default false,
  add column if not exists requires_isolation     boolean not null default false,
  add column if not exists requires_gas_test      boolean not null default false,
  add column if not exists requires_simops_check  boolean not null default false,
  add column if not exists requires_height_plan   boolean not null default false,
  add column if not exists requires_hot_work_cert boolean not null default false,
  add column if not exists requires_confined_space_cert boolean not null default false,
  add column if not exists requires_radiation_badge boolean not null default false,
  add column if not exists requires_excavation_survey  boolean not null default false,
  add column if not exists requires_lifting_plan  boolean not null default false,
  add column if not exists requires_line_break_cert boolean not null default false,

  -- lifecycle tracking
  add column if not exists issued_at              timestamptz,
  add column if not exists closed_at              timestamptz,
  add column if not exists cancelled_at           timestamptz,
  add column if not exists cancelled_reason       text,
  add column if not exists current_extension_id   uuid,                           -- self-ref set after insert; no FK here
  add column if not exists current_suspension_id  uuid,

  -- sign-off checklist snapshots (jsonb arrays)
  add column if not exists pre_work_checks        jsonb   not null default '[]'::jsonb,
  add column if not exists post_work_checks       jsonb   not null default '[]'::jsonb,

  -- template / approval routing
  add column if not exists template_id            uuid,                           -- cross-module, no FK
  add column if not exists approval_route         jsonb   not null default '[]'::jsonb;

-- indexes on hse_permits
create index if not exists hse_permits_status_idx
  on public.hse_permits(status);

create index if not exists hse_permits_permit_type_idx
  on public.hse_permits(permit_type);

create index if not exists hse_permits_end_datetime_idx
  on public.hse_permits(end_datetime)
  where end_datetime is not null;

create index if not exists hse_permits_site_id_idx
  on public.hse_permits(site_id)
  where site_id is not null;

create index if not exists hse_permits_requester_id_idx
  on public.hse_permits(requester_id)
  where requester_id is not null;

-- ── 2. hse_permit_hazards ─────────────────────────────────────────────────────
create table if not exists public.hse_permit_hazards (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  hazard_type       text    not null,
  description       text    not null,
  risk_level        text    check (risk_level in ('low','medium','high','critical')),
  likelihood        integer check (likelihood between 1 and 5),
  severity          integer check (severity between 1 and 5),
  risk_score        integer generated always as (coalesce(likelihood,1) * coalesce(severity,1)) stored,
  residual_likelihood integer check (residual_likelihood between 1 and 5),
  residual_severity   integer check (residual_severity between 1 and 5),
  residual_score    integer generated always as (coalesce(residual_likelihood,1) * coalesce(residual_severity,1)) stored,
  sort_order        integer not null default 0,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_permit_hazards_permit_id_idx
  on public.hse_permit_hazards(permit_id);

alter table public.hse_permit_hazards enable row level security;

-- ── 3. hse_permit_controls ────────────────────────────────────────────────────
create table if not exists public.hse_permit_controls (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  hazard_id         uuid    references public.hse_permit_hazards(id) on delete set null,
  control_type      text    not null,                              -- elimination|substitution|engineering|administrative|ppe
  description       text    not null,
  is_mandatory      boolean not null default false,
  verified          boolean not null default false,
  verified_by       text    references public.app_users(id) on delete set null,
  verified_at       timestamptz,
  sort_order        integer not null default 0,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_permit_controls_permit_id_idx
  on public.hse_permit_controls(permit_id);

create index if not exists hse_permit_controls_hazard_id_idx
  on public.hse_permit_controls(hazard_id)
  where hazard_id is not null;

alter table public.hse_permit_controls enable row level security;

-- ── 4. hse_permit_approvals ───────────────────────────────────────────────────
create table if not exists public.hse_permit_approvals (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  step_order        integer not null default 0,
  role_required     text    not null,
  approver_user_id  text    references public.app_users(id) on delete set null,
  status            text    not null default 'pending'
                            check (status in ('pending','approved','rejected','delegated','skipped')),
  decision_at       timestamptz,
  comments          text,
  delegated_to      text    references public.app_users(id) on delete set null,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_permit_approvals_permit_id_idx
  on public.hse_permit_approvals(permit_id);

create index if not exists hse_permit_approvals_status_idx
  on public.hse_permit_approvals(status);

alter table public.hse_permit_approvals enable row level security;

-- ── 5. hse_permit_isolations ──────────────────────────────────────────────────
-- LOTO / energy isolation points
create table if not exists public.hse_permit_isolations (
  id                    uuid    primary key default gen_random_uuid(),
  permit_id             uuid    not null references public.hse_permits(id) on delete cascade,
  isolation_point       text    not null,
  isolation_type        text    not null,                          -- loto|valve|electrical|pneumatic|hydraulic|gravity|thermal|radiation
  tag_number            text,
  energy_source         text,
  isolation_method      text,
  asset_id              uuid,                                      -- cross-module, no FK
  applied_by            text    references public.app_users(id) on delete set null,
  applied_at            timestamptz,
  verified_by           text    references public.app_users(id) on delete set null,
  verified_at           timestamptz,
  removed_by            text    references public.app_users(id) on delete set null,
  removed_at            timestamptz,
  status                text    not null default 'pending'
                                check (status in ('pending','applied','verified','removed')),
  sort_order            integer not null default 0,
  metadata              jsonb   not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

create index if not exists hse_permit_isolations_permit_id_idx
  on public.hse_permit_isolations(permit_id);

alter table public.hse_permit_isolations enable row level security;

-- ── 6. hse_permit_gas_tests ───────────────────────────────────────────────────
create table if not exists public.hse_permit_gas_tests (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  test_sequence     integer not null default 1,
  tested_at         timestamptz not null default now(),
  tester_id         text    references public.app_users(id) on delete set null,
  location          text,
  oxygen_pct        numeric(5,2),
  lel_pct           numeric(5,2),                                 -- lower explosive limit
  h2s_ppm           numeric(8,2),
  co_ppm            numeric(8,2),
  so2_ppm           numeric(8,2),
  toxic_gas_ppm     numeric(8,2),
  toxic_gas_name    text,
  instrument_id     text,
  instrument_cal_date date,
  result            text    not null default 'pending'
                            check (result in ('pending','pass','fail','retest')),
  notes             text,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists hse_permit_gas_tests_permit_id_idx
  on public.hse_permit_gas_tests(permit_id);

create index if not exists hse_permit_gas_tests_tested_at_idx
  on public.hse_permit_gas_tests(tested_at desc);

alter table public.hse_permit_gas_tests enable row level security;

-- ── 7. hse_permit_simops_conflicts ───────────────────────────────────────────
-- Simultaneous Operations conflict register
create table if not exists public.hse_permit_simops_conflicts (
  id                        uuid    primary key default gen_random_uuid(),
  permit_id                 uuid    not null references public.hse_permits(id) on delete cascade,
  conflicting_permit_id     uuid    references public.hse_permits(id) on delete set null,
  conflict_type             text    not null,
  description               text,
  resolution                text,
  resolved_by               text    references public.app_users(id) on delete set null,
  resolved_at               timestamptz,
  status                    text    not null default 'open'
                                    check (status in ('open','mitigated','resolved','accepted')),
  metadata                  jsonb   not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz
);

create index if not exists hse_permit_simops_permit_id_idx
  on public.hse_permit_simops_conflicts(permit_id);

create index if not exists hse_permit_simops_conflicting_idx
  on public.hse_permit_simops_conflicts(conflicting_permit_id)
  where conflicting_permit_id is not null;

alter table public.hse_permit_simops_conflicts enable row level security;

-- ── 8. hse_permit_extensions ──────────────────────────────────────────────────
create table if not exists public.hse_permit_extensions (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  extension_number  integer not null default 1,
  requested_by      text    references public.app_users(id) on delete set null,
  requested_at      timestamptz not null default now(),
  original_end      timestamptz not null,
  new_end           timestamptz not null,
  reason            text    not null,
  approved_by       text    references public.app_users(id) on delete set null,
  approved_at       timestamptz,
  status            text    not null default 'pending'
                            check (status in ('pending','approved','rejected')),
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_permit_extensions_permit_id_idx
  on public.hse_permit_extensions(permit_id);

alter table public.hse_permit_extensions enable row level security;

-- ── 9. hse_permit_handovers ───────────────────────────────────────────────────
-- Shift handover records for long-duration permits
create table if not exists public.hse_permit_handovers (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  handover_sequence integer not null default 1,
  handed_over_by    text    references public.app_users(id) on delete set null,
  handed_over_at    timestamptz not null default now(),
  received_by       text    references public.app_users(id) on delete set null,
  received_at       timestamptz,
  work_status       text,
  site_conditions   text,
  outstanding_hazards text,
  notes             text,
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists hse_permit_handovers_permit_id_idx
  on public.hse_permit_handovers(permit_id);

alter table public.hse_permit_handovers enable row level security;

-- ── 10. hse_permit_suspensions ────────────────────────────────────────────────
create table if not exists public.hse_permit_suspensions (
  id                uuid    primary key default gen_random_uuid(),
  permit_id         uuid    not null references public.hse_permits(id) on delete cascade,
  suspended_by      text    references public.app_users(id) on delete set null,
  suspended_at      timestamptz not null default now(),
  reason            text    not null,
  hazard_description text,
  reinstated_by     text    references public.app_users(id) on delete set null,
  reinstated_at     timestamptz,
  reinstatement_conditions text,
  status            text    not null default 'active'
                            check (status in ('active','reinstated','cancelled')),
  metadata          jsonb   not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists hse_permit_suspensions_permit_id_idx
  on public.hse_permit_suspensions(permit_id);

create index if not exists hse_permit_suspensions_status_idx
  on public.hse_permit_suspensions(status);

alter table public.hse_permit_suspensions enable row level security;

-- ── 11. hse_permit_closeouts ──────────────────────────────────────────────────
create table if not exists public.hse_permit_closeouts (
  id                        uuid    primary key default gen_random_uuid(),
  permit_id                 uuid    not null references public.hse_permits(id) on delete cascade,
  closed_by                 text    references public.app_users(id) on delete set null,
  closed_at                 timestamptz not null default now(),
  close_type                text    not null default 'normal'
                                    check (close_type in ('normal','emergency','cancelled','expired')),
  work_completed            boolean not null default true,
  site_restored             boolean not null default false,
  isolations_removed        boolean not null default false,
  area_cleared              boolean not null default false,
  tools_equipment_removed   boolean not null default false,
  incidents_reported        boolean not null default false,
  incidents_description     text,
  authority_acknowledged    boolean not null default false,
  authority_acknowledged_by text    references public.app_users(id) on delete set null,
  authority_acknowledged_at timestamptz,
  closeout_notes            text,
  lessons_learned           text,
  metadata                  jsonb   not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

create unique index if not exists hse_permit_closeouts_permit_id_uidx
  on public.hse_permit_closeouts(permit_id);

alter table public.hse_permit_closeouts enable row level security;

-- ── 12. hse_permit_attachments ────────────────────────────────────────────────
create table if not exists public.hse_permit_attachments (
  id              uuid    primary key default gen_random_uuid(),
  permit_id       uuid    not null references public.hse_permits(id) on delete cascade,
  file_name       text    not null,
  file_path       text    not null,
  file_url        text,
  content_type    text,
  size_bytes      bigint,
  attachment_type text    not null default 'general',              -- general|jsa|risk_assessment|photo|drawing|certificate|gas_test
  description     text,
  uploaded_by     text    references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists hse_permit_attachments_permit_id_idx
  on public.hse_permit_attachments(permit_id);

alter table public.hse_permit_attachments enable row level security;

-- ── 13. hse_permit_audit_events ───────────────────────────────────────────────
-- PTW-scoped timeline (complements the global audit_logs table).
-- Captures every state change, edit, and action on a permit.
create table if not exists public.hse_permit_audit_events (
  id              uuid    primary key default gen_random_uuid(),
  permit_id       uuid    not null references public.hse_permits(id) on delete cascade,
  action          text    not null,                                -- e.g. 'submitted','approved','suspended','gas_test_added'
  actor_user_id   text    references public.app_users(id) on delete set null,
  before_state    jsonb,
  after_state     jsonb,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists hse_permit_audit_permit_id_idx
  on public.hse_permit_audit_events(permit_id);

create index if not exists hse_permit_audit_created_at_idx
  on public.hse_permit_audit_events(permit_id, created_at desc);

alter table public.hse_permit_audit_events enable row level security;

-- ── 14. hse_permit_templates ──────────────────────────────────────────────────
-- Reusable permit templates — pre-populate hazards, controls, approval routes.
create table if not exists public.hse_permit_templates (
  id                    uuid    primary key default gen_random_uuid(),
  name                  text    not null,
  description           text,
  permit_type           text    not null,
  risk_level            text    check (risk_level in ('low','medium','high','critical')),
  requires_jsa          boolean not null default false,
  requires_isolation    boolean not null default false,
  requires_gas_test     boolean not null default false,
  approval_route        jsonb   not null default '[]'::jsonb,
  hazards               jsonb   not null default '[]'::jsonb,
  controls              jsonb   not null default '[]'::jsonb,
  pre_work_checks       jsonb   not null default '[]'::jsonb,
  post_work_checks      jsonb   not null default '[]'::jsonb,
  active                boolean not null default true,
  config                jsonb   not null default '{}'::jsonb,
  created_by            text    references public.app_users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

create index if not exists hse_permit_templates_permit_type_idx
  on public.hse_permit_templates(permit_type);

create index if not exists hse_permit_templates_active_idx
  on public.hse_permit_templates(active)
  where active;

alter table public.hse_permit_templates enable row level security;

-- ── 15. hse_permit_type_config ────────────────────────────────────────────────
-- One row per permit type: display name, duration limits, and requirement flags.
-- Unique on permit_type so seed is idempotent.
create table if not exists public.hse_permit_type_config (
  id                          uuid    primary key default gen_random_uuid(),
  permit_type                 text    not null unique,
  display_name                text    not null,
  description                 text,
  max_duration_hours          integer not null default 8,
  requires_jsa                boolean not null default false,
  requires_isolation          boolean not null default false,
  requires_gas_test           boolean not null default false,
  requires_simops_check       boolean not null default false,
  requires_height_plan        boolean not null default false,
  requires_hot_work_cert      boolean not null default false,
  requires_confined_space_cert boolean not null default false,
  requires_radiation_badge    boolean not null default false,
  requires_excavation_survey  boolean not null default false,
  requires_lifting_plan       boolean not null default false,
  requires_line_break_cert    boolean not null default false,
  requires_energized_cert     boolean not null default false,
  default_approval_route      jsonb   not null default '[]'::jsonb,
  color_code                  text,                               -- UI badge color hex
  icon                        text,                              -- icon key for UI
  active                      boolean not null default true,
  sort_order                  integer not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz
);

create index if not exists hse_permit_type_config_active_idx
  on public.hse_permit_type_config(active, sort_order)
  where active;

alter table public.hse_permit_type_config enable row level security;

-- ── 16. SEED hse_permit_type_config ──────────────────────────────────────────
-- 14 permit types from Spec §4.
-- Keys are snake_case. on conflict do nothing = idempotent re-runs.
insert into public.hse_permit_type_config (
  permit_type,
  display_name,
  description,
  max_duration_hours,
  requires_jsa,
  requires_isolation,
  requires_gas_test,
  requires_simops_check,
  requires_height_plan,
  requires_hot_work_cert,
  requires_confined_space_cert,
  requires_radiation_badge,
  requires_excavation_survey,
  requires_lifting_plan,
  requires_line_break_cert,
  requires_energized_cert,
  color_code,
  sort_order
) values
-- 1. General Work
(
  'general_work',
  'General Work',
  'Routine non-hazardous maintenance or construction work.',
  8,
  false, false, false, false, false, false, false, false, false, false, false, false,
  '#6B7280', 1
),
-- 2. Hot Work
(
  'hot_work',
  'Hot Work',
  'Work involving open flames, sparks, or heat sufficient to ignite flammable materials.',
  8,
  true,   -- requires JSA
  true,   -- requires isolation (area isolation/clearance)
  true,   -- gas test mandatory
  true,   -- simops conflict check
  false,
  true,   -- hot work certificate
  false, false, false, false, false, false,
  '#EF4444', 2
),
-- 3. Cold Work
(
  'cold_work',
  'Cold Work',
  'Non-sparking, non-heat-generating mechanical work on non-energised equipment.',
  12,
  true,  -- JSA
  false,
  false,
  false, false, false, false, false, false, false, false, false,
  '#3B82F6', 3
),
-- 4. Confined Space Entry
(
  'confined_space',
  'Confined Space Entry',
  'Entry into spaces not designed for continuous human occupancy with restricted ingress/egress.',
  8,
  true,   -- JSA
  true,   -- isolation of all energy sources
  true,   -- continuous gas monitoring
  true,   -- simops
  false,
  false,
  true,   -- confined space entry certificate
  false, false, false, false, false,
  '#F59E0B', 4
),
-- 5. Electrical Work
(
  'electrical_work',
  'Electrical Work',
  'Work on or near electrical systems, switchgear, and energised conductors.',
  8,
  true,   -- JSA
  true,   -- LOTO / electrical isolation mandatory
  false,
  true,   -- simops
  false,
  false, false, false, false, false, false,
  true,   -- energized work cert if live work
  '#FBBF24', 5
),
-- 6. Working at Height
(
  'working_at_height',
  'Working at Height',
  'Work performed at heights above 1.8 m where fall hazard exists.',
  8,
  true,   -- JSA
  false,
  false,
  false,
  true,   -- height plan / rescue plan required
  false, false, false, false, false, false, false,
  '#8B5CF6', 6
),
-- 7. Excavation
(
  'excavation',
  'Excavation',
  'Ground-breaking, trenching, or excavation work.',
  12,
  true,  -- JSA
  true,  -- utility isolation
  true,  -- gas check post-excavation
  true,  -- simops
  false, false, false, false,
  true,  -- excavation survey (underground utilities)
  false, false, false,
  '#92400E', 7
),
-- 8. Lifting Operations
(
  'lifting_operation',
  'Lifting Operation',
  'Crane, hoist, or rigging operations involving suspended loads.',
  8,
  true,  -- JSA
  false,
  false,
  true,  -- simops (exclusion zones)
  false, false, false, false, false,
  true,  -- lifting plan
  false, false,
  '#10B981', 8
),
-- 9. Line Break / Breaking Containment
(
  'line_break',
  'Line Break / Breaking Containment',
  'Opening of pipelines, vessels, or equipment containing hazardous substances.',
  8,
  true,  -- JSA
  true,  -- full isolation & depressurisation
  true,  -- gas / atmospheric test
  true,  -- simops
  false, false, false, false, false, false,
  true,  -- line break certificate
  false,
  '#F97316', 9
),
-- 10. Energized Work
(
  'energized_work',
  'Energized Work',
  'Deliberate work on energised electrical equipment where LOTO cannot be applied.',
  4,
  true,  -- JSA
  false, -- by definition cannot isolate; work management instead
  false,
  true,  -- simops
  false, false, false, false, false, false, false,
  true,  -- energized work (live work) certificate
  '#DC2626', 10
),
-- 11. Radiography
(
  'radiography',
  'Radiography',
  'Use of radiographic equipment (X-ray, gamma-ray) for NDT inspection.',
  8,
  true,  -- JSA
  true,  -- area exclusion zone isolation
  false,
  true,  -- simops (exclusion zone conflicts)
  false, false, false,
  true,  -- radiation badge / dosimeter
  false, false, false, false,
  '#7C3AED', 11
),
-- 12. Vehicle / Mobile Equipment
(
  'vehicle_mobile_equipment',
  'Vehicle / Mobile Equipment',
  'Operation of vehicles, forklifts, MEWPs, or mobile plant on-site.',
  12,
  true,  -- JSA
  false,
  false,
  true,  -- simops (pedestrian/vehicle separation)
  false, false, false, false, false, false, false, false,
  '#0EA5E9', 12
),
-- 13. Roof Access
(
  'roof_access',
  'Roof Access',
  'Access to rooftops and elevated structures for inspection or maintenance.',
  8,
  true,  -- JSA
  false,
  false,
  false,
  true,  -- height plan
  false, false, false, false, false, false, false,
  '#6D28D9', 13
),
-- 14. Chemical Handling
(
  'chemical_handling',
  'Chemical Handling',
  'Handling, transfer, or disposal of hazardous chemicals, solvents, or acids.',
  8,
  true,  -- JSA
  false,
  false,
  true,  -- simops
  false, false, false, false, false, false,
  true,  -- line break cert if breaking containment during transfer
  false,
  '#059669', 14
)
on conflict (permit_type) do nothing;
