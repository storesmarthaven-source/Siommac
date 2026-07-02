-- ============================================================================
-- SIOMAC HR — combined migrations to apply (this session)
-- Org Structure (20260715000000-000004) + HR Documents (20260716000000-000002)
-- + Offboarding (20260717000000) + HR Leave (20260718000000-000004).
-- Run this whole file once (Supabase SQL editor runs it atomically). Idempotent.
-- ============================================================================


-- ========== 20260715000000_hr_org_structure_fields.sql ==========
-- ============================================================================
-- HR Organization Structure (Phase A) — structured fields on existing tables
-- ============================================================================
-- `departments` stays the canonical org-unit tree; `finance_cost_centers` stays
-- the shared cost-centre registry; `hr_positions` stays the positions table.
-- This migration only ADDS the structured columns the Organization Structure
-- module needs — no new hr_org_units / hr_cost_centers fork. Additive + idempotent.
-- Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── departments: structured code + cost-centre link + display ordering ─────────
alter table public.departments add column if not exists code           text;
alter table public.departments add column if not exists cost_center_id uuid
  references public.finance_cost_centers(id) on delete set null;
alter table public.departments add column if not exists sort_order     integer not null default 0;

create unique index if not exists departments_code_key
  on public.departments(lower(code)) where code is not null;
create index if not exists departments_cost_center_idx
  on public.departments(cost_center_id) where cost_center_id is not null;

-- ── hr_positions: grade / headcount budget / position-level reports-to ─────────
alter table public.hr_positions add column if not exists grade                  text;
alter table public.hr_positions add column if not exists headcount_budget       integer;
alter table public.hr_positions add column if not exists reports_to_position_id uuid
  references public.hr_positions(id) on delete set null;

-- ── finance_cost_centers: promote the skeleton to a manageable registry ────────
-- Additive only — Finance owns this table long-term; HR Org Structure manages the
-- registry until the Finance module lands (both reference the SAME table).
alter table public.finance_cost_centers add column if not exists code       text;
alter table public.finance_cost_centers add column if not exists is_active  boolean not null default true;
alter table public.finance_cost_centers add column if not exists manager_id text
  references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists created_by text
  references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists updated_at timestamptz;

create unique index if not exists finance_cost_centers_code_key
  on public.finance_cost_centers(lower(code)) where code is not null;
create index if not exists finance_cost_centers_active_idx
  on public.finance_cost_centers(is_active);

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260715000001_hr_cost_centers_perms.sql ==========
-- ============================================================================
-- HR Organization Structure (Phase A) — cost-centre permission grants
-- ============================================================================
-- Dedicated cost-centre keys (financial reference data). Org-unit + positions
-- reuse the existing hr.organization.* / hr.positions.* keys. Mirrors the code
-- catalogue (src/lib/permissions.ts) for the DB matrix. Run manually, then:
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.cost_centers.view'),('superadmin','hr.cost_centers.manage'),
  ('admin','hr.cost_centers.view'),('admin','hr.cost_centers.manage'),
  ('hr_manager','hr.cost_centers.view'),('hr_manager','hr.cost_centers.manage'),
  ('manager','hr.cost_centers.view'),
  -- HR execution tier: read-only org visibility to do their job (no manage)
  ('hr_staff','hr.cost_centers.view'),
  ('hr_staff','hr.organization.view'),
  ('hr_staff','hr.positions.view')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260715000002_hr_org_change_requests.sql ==========
-- ============================================================================
-- HR Organization Structure (Phase B) — org change-request envelope
-- ============================================================================
-- Mirrors hr_employee_change_requests: the CENTRAL workflow engine owns the
-- approval lifecycle; this table is the envelope. `workflow_id` is a uuid FK to
-- workflow_instances (NOT text). Status is driven by the hr_org_structure adapter
-- (lib/workflow/orgAdapter). Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.hr_org_change_requests (
  id uuid primary key default gen_random_uuid(),
  change_no text unique,

  entity_type text not null check (entity_type in ('org_unit', 'position', 'cost_center')),
  entity_id   text,
  action      text not null,

  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'applied', 'cancelled', 'failed')),

  effective_from timestamptz not null default now(),
  effective_to   timestamptz,

  reason           text,
  rejection_reason text,

  old_state      jsonb not null default '{}'::jsonb,
  new_state      jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,

  workflow_id uuid references public.workflow_instances(id) on delete set null,

  requested_by text references public.app_users(id) on delete set null,
  decided_by   text references public.app_users(id) on delete set null,
  applied_by   text references public.app_users(id) on delete set null,

  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  applied_at   timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists hr_org_cr_entity_idx    on public.hr_org_change_requests(entity_type, entity_id);
create index if not exists hr_org_cr_status_idx     on public.hr_org_change_requests(status);
create index if not exists hr_org_cr_effective_idx  on public.hr_org_change_requests(effective_from);
create index if not exists hr_org_cr_workflow_idx   on public.hr_org_change_requests(workflow_id) where workflow_id is not null;

alter table public.hr_org_change_requests enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260715000003_hr_org_enterprise_permissions.sql ==========
-- ============================================================================
-- HR Organization Structure (Phase B) — enterprise permission grants
-- ============================================================================
-- hr.organization.delete           — the guarded hard-delete of an org unit
-- hr.organization.override_approval — override/expedite a high-risk org change
-- Both are also catalogued in src/lib/permissions.ts + netlify .../permissions.ts
-- + permissionMeta.ts (the drift-guard requires it). Run manually, then:
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.organization.delete'),('admin','hr.organization.delete'),
  ('superadmin','hr.organization.override_approval')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260715000004_workflow_org_change_bindings.sql ==========
-- ============================================================================
-- Central Workflow Engine — seed the Org-Structure change-approval workflow
-- ============================================================================
-- Routes high-risk Organization Structure changes through the central engine
-- (Phase B). Mirrors the hr_employee_change_approval seed:
--   • ONE template `hr_org_change_approval` (module_key = hr_org_structure,
--     workflow_type = hr_org_change_approval) — a single HR-Manager approval step.
--   • ONE published v1 version.
--   • ONE global binding per risky trigger event, so
--     startWorkflowForRecord({ moduleKey:'hr_org_structure', workflowType:
--     'hr_org_change_approval', triggerEvent:'hr.org.<entity>.<action>' }) resolves.
--
-- The registered hr_org_structure adapter (lib/workflow/orgAdapter.ts) applies the
-- approved change on completion (or marks it scheduled when effective-dated) and
-- sets the hr_org_change_requests status. sourceStatusMap is empty — the adapter
-- owns the envelope status. Idempotent. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  ev     text;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
  trigger_events text[] := array[
    'hr.org.org_unit.move', 'hr.org.org_unit.archive', 'hr.org.org_unit.delete', 'hr.org.org_unit.update',
    'hr.org.position.retire', 'hr.org.position.update',
    'hr.org.cost_center.retire', 'hr.org.cost_center.update'
  ];
begin
  -- 1. template (granular module_key = hr_org_structure)
  select id into tpl_id from public.workflow_templates where template_key = 'hr_org_change_approval';
  if tpl_id is null then
    insert into public.workflow_templates (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values ('hr_org_change_approval', 'hr_org_structure', 'hr_org_change_approval',
            'Org Structure Change Approval', 'Approval of high-risk organization structure changes.', 'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_org_structure', workflow_type = 'hr_org_change_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 (single HR-Manager approval step; linear → completes on approve)
  insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey','org_approval','stepName','Org Change Approval','stepType','approval','sequenceNo',1,
          'assignment', jsonb_build_object('type','role','value','hr_manager'),
          'dueDurationHours', 48, 'required', true, 'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', '{}'::jsonb,
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status, definition = excluded.definition, published_at = excluded.published_at
  returning id into ver_id;

  -- 3. one global binding per risky trigger event → the same template/version
  foreach ev in array trigger_events loop
    delete from public.module_workflow_bindings
      where module_key = 'hr_org_structure' and workflow_type = 'hr_org_change_approval' and trigger_event = ev
        and scope_type = 'global' and scope_id is null;
    insert into public.module_workflow_bindings
      (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
    values
      ('hr_org_structure', 'hr_org_change_approval', ev, tpl_id, ver_id, 'global', true, 100);
  end loop;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ========== 20260716000000_hr_document_requirements.sql ==========
-- HR Document Requirements — policy table for required document types per scope.
-- Operator-applied. Run after: 20260702000004_hr_employee_master_profile_docs.sql

create table if not exists public.hr_document_requirements (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  label text not null,
  applies_to_scope text not null default 'all'
    check (applies_to_scope in ('all','role','employment_type','department')),
  applies_to_value text,                          -- null for 'all'; role/type/dept id otherwise
  requires_expiry boolean not null default false, -- if true, a present doc without expiry_date is non-compliant
  reminder_days integer[] not null default '{30,7,0}',   -- per-requirement override; else settings default
  min_confidentiality text
    check (min_confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
  is_active boolean not null default true,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_type, applies_to_scope, applies_to_value)
);

create index if not exists hr_doc_req_active_idx on public.hr_document_requirements(is_active);

alter table public.hr_document_requirements enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260716000001_hr_document_reminders.sql ==========
-- HR Document Reminders — dedupe ledger for expiry reminder notifications.
-- Idempotent: unique constraint prevents re-notifying on the same (doc, window, expiry).
-- Operator-applied.

create table if not exists public.hr_document_reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.hr_employee_documents(id) on delete cascade,
  threshold_days integer not null,                -- which reminder window fired
  expiry_date date not null,                      -- guards re-fire if the doc's expiry is later changed
  sent_at timestamptz not null default now(),
  unique (document_id, threshold_days, expiry_date)
);

create index if not exists hr_doc_reminders_doc_idx on public.hr_document_reminders(document_id);

alter table public.hr_document_reminders enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260716000002_hr_documents_perms.sql ==========
-- HR Documents — grant requirements.manage permission to oversight roles.
-- NOTE: column name is role_name (not role).

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.employee_documents.requirements.manage'),
  ('admin','hr.employee_documents.requirements.manage'),
  ('hr_manager','hr.employee_documents.requirements.manage')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';


-- ========== 20260717000000_hr_offboarding.sql ==========
-- ============================================================================
-- HR Offboarding — the exit bookend of the employee lifecycle
-- ============================================================================
-- A dedicated hr_offboarding_* domain (NOT a discriminator on onboarding). Cases
-- instantiate a standard exit plan of tasks + cross-module handoffs by reason.
-- The genuinely-inverse piece is FINALIZE: it terminates the employee (status →
-- terminated, auth synced to inactive) and raises an IT access-removal handoff
-- (recorded 'pending' — the inverse of onboarding's account-provisioning handoff;
-- never faked). app_users.id is TEXT → employee/owner FKs are TEXT. Backend-only
-- (service-role), gated by hr.offboarding.* in the API. Run manually, then NOTIFY pgrst.
-- ============================================================================

-- ── cases ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_cases (
  id                 uuid primary key default gen_random_uuid(),
  case_no            text unique not null,                       -- nextRef('OFB')
  employee_id        text references public.app_users(id) on delete cascade,
  reason             text not null
                       check (reason in ('resignation','termination','redundancy','end_of_contract','retirement')),
  package_key        text not null default 'standard_exit',
  status             text not null default 'in_progress'
                       check (status in ('draft','open','in_progress','blocked','paused','ready_for_exit','completed','cancelled')),
  owner_id           text references public.app_users(id) on delete set null,
  last_working_day   date,
  exit_date          date,
  notice_period_days integer,
  started_by         text references public.app_users(id) on delete set null,
  started_at         timestamptz not null default now(),
  ready_at           timestamptz,
  completed_at       timestamptz,
  paused_at          timestamptz,
  cancelled_by       text references public.app_users(id) on delete set null,
  cancelled_at       timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);
create index if not exists hr_offboarding_cases_employee_idx on public.hr_offboarding_cases(employee_id, status);

-- ── tasks ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_tasks (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  task_key     text not null,
  task_title   text not null,
  owner_role   text,
  assigned_to  text references public.app_users(id) on delete set null,
  module_key   text,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','completed','skipped','blocked')),
  is_blocking  boolean not null default false,
  sort_order   integer not null default 0,
  due_at       timestamptz,
  completed_by text references public.app_users(id) on delete set null,
  completed_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists hr_offboarding_tasks_case_idx on public.hr_offboarding_tasks(case_id, status);

-- ── handoffs (intent records; delivery wired when target receivers exist) ──────
create table if not exists public.hr_offboarding_handoffs (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  handoff_key   text,
  target_module text not null,
  handoff_type  text,
  status        text not null default 'pending'
                  check (status in ('pending','delivered','cancelled')),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index if not exists hr_offboarding_handoffs_case_idx on public.hr_offboarding_handoffs(case_id);

-- ── blockers ────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_blockers (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  blocker_key    text,
  title          text not null,
  blocking_module text,
  severity       text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status         text not null default 'open' check (status in ('open','resolved','waived')),
  owner_id       text references public.app_users(id) on delete set null,
  due_at         timestamptz,
  resolved_by    text references public.app_users(id) on delete set null,
  resolved_at    timestamptz,
  waiver_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index if not exists hr_offboarding_blockers_case_idx on public.hr_offboarding_blockers(case_id, status);

-- ── RLS + grants (backend-only via service_role) ───────────────────────────────
alter table public.hr_offboarding_cases    enable row level security;
alter table public.hr_offboarding_tasks    enable row level security;
alter table public.hr_offboarding_handoffs enable row level security;
alter table public.hr_offboarding_blockers enable row level security;

grant select, insert, update, delete on table public.hr_offboarding_cases    to service_role;
grant select, insert, update, delete on table public.hr_offboarding_tasks    to service_role;
grant select, insert, update, delete on table public.hr_offboarding_handoffs to service_role;
grant select, insert, update, delete on table public.hr_offboarding_blockers to service_role;

-- ── updated_at triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_hr_offboarding_cases_updated_at on public.hr_offboarding_cases;
create trigger trg_hr_offboarding_cases_updated_at before update on public.hr_offboarding_cases for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_tasks_updated_at on public.hr_offboarding_tasks;
create trigger trg_hr_offboarding_tasks_updated_at before update on public.hr_offboarding_tasks for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_handoffs_updated_at on public.hr_offboarding_handoffs;
create trigger trg_hr_offboarding_handoffs_updated_at before update on public.hr_offboarding_handoffs for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_blockers_updated_at on public.hr_offboarding_blockers;
create trigger trg_hr_offboarding_blockers_updated_at before update on public.hr_offboarding_blockers for each row execute function public.set_updated_at();

-- ── permission seed (hr.offboarding.*) ─────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.offboarding.view'),('admin','hr.offboarding.view'),('manager','hr.offboarding.view'),('hr_manager','hr.offboarding.view'),('hr_staff','hr.offboarding.view'),
  ('superadmin','hr.offboarding.start'),('admin','hr.offboarding.start'),('hr_manager','hr.offboarding.start'),('hr_staff','hr.offboarding.start'),
  ('superadmin','hr.offboarding.task.manage'),('admin','hr.offboarding.task.manage'),('hr_manager','hr.offboarding.task.manage'),('hr_staff','hr.offboarding.task.manage'),
  ('superadmin','hr.offboarding.case.manage'),('admin','hr.offboarding.case.manage'),('hr_manager','hr.offboarding.case.manage'),('hr_staff','hr.offboarding.case.manage'),
  ('superadmin','hr.offboarding.complete'),('admin','hr.offboarding.complete'),('hr_manager','hr.offboarding.complete'),
  ('superadmin','hr.offboarding.finalize'),('admin','hr.offboarding.finalize'),('hr_manager','hr.offboarding.finalize'),
  ('superadmin','hr.offboarding.cancel'),('admin','hr.offboarding.cancel'),('hr_manager','hr.offboarding.cancel'),
  ('superadmin','hr.offboarding.audit.view'),('admin','hr.offboarding.audit.view'),('hr_manager','hr.offboarding.audit.view')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ========== 20260718000000_hr_leave_tables.sql ==========
-- ============================================================================
-- HR Leave & Absence — core tables (Spec §HR-Leave)
-- ============================================================================
-- hr_leave_types       — configurable leave type catalogue
-- hr_leave_requests    — individual leave applications (the main entity)
-- hr_leave_balances    — per-employee per-type per-year snapshot (recomputed)
-- hr_leave_accruals    — append-only ledger (accrual/deduction/release/adjustment/pending_reserve)
-- hr_leave_attachments — supporting documents for a leave request
-- ============================================================================

create table if not exists public.hr_leave_types (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique not null,
  label               text not null,
  paid                boolean not null default true,
  unit                text not null check (unit in ('days','hours')) default 'days',
  requires_attachment boolean not null default false,
  requires_approval   boolean not null default true,
  accrual_rate        numeric,
  accrual_cadence     text not null check (accrual_cadence in ('none','monthly','annual')) default 'annual',
  max_carryover       numeric,
  applies_to_scope    text not null check (applies_to_scope in ('all','role','employment_type','department')) default 'all',
  applies_to_value    text,
  color               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
create or replace trigger set_updated_at_hr_leave_types
  before update on public.hr_leave_types
  for each row execute function public.set_updated_at();
alter table public.hr_leave_types enable row level security;
grant all on public.hr_leave_types to service_role;

create table if not exists public.hr_leave_requests (
  id              uuid primary key default gen_random_uuid(),
  case_no         text unique not null,
  employee_id     text not null references public.app_users(id),
  leave_type_id   uuid not null references public.hr_leave_types(id),
  from_date       date not null,
  to_date         date not null,
  unit            text not null check (unit in ('days','hours')) default 'days',
  days            numeric,
  hours           numeric,
  half_day        boolean not null default false,
  reason          text,
  status          text not null check (status in ('draft','pending_approval','approved','rejected','cancelled')) default 'pending_approval',
  workflow_id     uuid references public.workflow_instances(id) on delete set null,
  department_id   text,
  reviewed_by     text references public.app_users(id),
  reviewed_at     timestamptz,
  review_notes    text,
  applied_at      timestamptz default now(),
  cancelled_by    text references public.app_users(id),
  cancelled_at    timestamptz,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create or replace trigger set_updated_at_hr_leave_requests
  before update on public.hr_leave_requests
  for each row execute function public.set_updated_at();
create index hr_leave_requests_employee_id_idx on public.hr_leave_requests(employee_id);
create index hr_leave_requests_status_idx      on public.hr_leave_requests(status);
create index hr_leave_requests_from_date_idx   on public.hr_leave_requests(from_date);
alter table public.hr_leave_requests enable row level security;
grant all on public.hr_leave_requests to service_role;

create table if not exists public.hr_leave_balances (
  id            uuid primary key default gen_random_uuid(),
  employee_id   text not null references public.app_users(id),
  leave_type_id uuid not null references public.hr_leave_types(id),
  year          int not null,
  entitled      numeric not null default 0,
  accrued       numeric not null default 0,
  taken         numeric not null default 0,
  pending       numeric not null default 0,
  adjustment    numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique(employee_id, leave_type_id, year)
);
create or replace trigger set_updated_at_hr_leave_balances
  before update on public.hr_leave_balances
  for each row execute function public.set_updated_at();
alter table public.hr_leave_balances enable row level security;
grant all on public.hr_leave_balances to service_role;

create table if not exists public.hr_leave_accruals (
  id                uuid primary key default gen_random_uuid(),
  employee_id       text not null references public.app_users(id),
  leave_type_id     uuid not null references public.hr_leave_types(id),
  year              int not null,
  delta             numeric not null,
  kind              text not null check (kind in ('accrual','deduction','release','adjustment','pending_reserve')),
  idempotency_key   text unique not null,
  source_request_id uuid references public.hr_leave_requests(id) on delete set null,
  note              text,
  created_by        text references public.app_users(id),
  created_at        timestamptz not null default now()
);
create index hr_leave_accruals_employee_id_year_idx  on public.hr_leave_accruals(employee_id, year);
create index hr_leave_accruals_source_request_id_idx on public.hr_leave_accruals(source_request_id);
alter table public.hr_leave_accruals enable row level security;
grant all on public.hr_leave_accruals to service_role;

create table if not exists public.hr_leave_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.hr_leave_requests(id) on delete cascade,
  file_path    text not null,
  file_name    text not null,
  mime_type    text,
  uploaded_by  text references public.app_users(id),
  uploaded_at  timestamptz not null default now()
);
alter table public.hr_leave_attachments enable row level security;
grant all on public.hr_leave_attachments to service_role;

-- After applying: NOTIFY pgrst, 'reload schema';


-- ========== 20260718000001_hr_leave_seed_types.sql ==========
-- ============================================================================
-- HR Leave & Absence — seed leave types
-- ============================================================================
-- Standard leave types covering the most common employment policies.
-- All entries are idempotent (on conflict do nothing).
-- ============================================================================

insert into public.hr_leave_types (code, label, paid, unit, requires_attachment, requires_approval, accrual_rate, accrual_cadence, max_carryover, applies_to_scope, color, is_active)
values
  ('annual',      'Annual Leave',      true,  'days', false, true,  20,   'annual',  10,   'all',             '#4CAF50', true),
  ('sick',        'Sick Leave',        true,  'days', false, true,  10,   'annual',  0,    'all',             '#F44336', true),
  ('unpaid',      'Unpaid Leave',      false, 'days', false, true,  null, 'none',    null, 'all',             '#9E9E9E', true),
  ('maternity',   'Maternity Leave',   true,  'days', false, true,  90,   'none',    null, 'employment_type', '#E91E63', true),
  ('paternity',   'Paternity Leave',   true,  'days', false, true,  5,    'none',    null, 'employment_type', '#2196F3', true),
  ('bereavement', 'Bereavement Leave', true,  'days', true,  true,  3,    'none',    null, 'all',             '#795548', true)
on conflict (code) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';


-- ========== 20260718000002_hr_leave_permissions.sql ==========
-- ============================================================================
-- HR Leave & Absence — role_permissions grants
-- ============================================================================
-- hr.leave.* permissions granted by role_name. The role_permissions table is
-- (role_name, permission) — there is NO `granted` column. Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  -- employee: own leave only
  ('employee', 'hr.leave.view'),
  ('employee', 'hr.leave.submit'),
  ('employee', 'hr.leave.cancel_own'),
  ('employee', 'hr.leave.balances.view'),
  ('employee', 'hr.leave.calendar.view'),
  -- manager: dept-scoped view + approve
  ('manager',  'hr.leave.view'),
  ('manager',  'hr.leave.view_all'),
  ('manager',  'hr.leave.submit'),
  ('manager',  'hr.leave.cancel_own'),
  ('manager',  'hr.leave.approve'),
  ('manager',  'hr.leave.balances.view'),
  ('manager',  'hr.leave.calendar.view'),
  ('manager',  'hr.leave.reports.view'),
  -- hr_staff: execution tier (no types.manage / balances.adjust / accruals.run / reports.export)
  ('hr_staff', 'hr.leave.view'),
  ('hr_staff', 'hr.leave.view_all'),
  ('hr_staff', 'hr.leave.submit'),
  ('hr_staff', 'hr.leave.cancel_own'),
  ('hr_staff', 'hr.leave.approve'),
  ('hr_staff', 'hr.leave.manage'),
  ('hr_staff', 'hr.leave.balances.view'),
  ('hr_staff', 'hr.leave.calendar.view'),
  ('hr_staff', 'hr.leave.reports.view'),
  -- hr_manager: all leave capabilities
  ('hr_manager', 'hr.leave.view'),
  ('hr_manager', 'hr.leave.view_all'),
  ('hr_manager', 'hr.leave.submit'),
  ('hr_manager', 'hr.leave.cancel_own'),
  ('hr_manager', 'hr.leave.approve'),
  ('hr_manager', 'hr.leave.manage'),
  ('hr_manager', 'hr.leave.types.manage'),
  ('hr_manager', 'hr.leave.balances.view'),
  ('hr_manager', 'hr.leave.balances.adjust'),
  ('hr_manager', 'hr.leave.accruals.run'),
  ('hr_manager', 'hr.leave.calendar.view'),
  ('hr_manager', 'hr.leave.reports.view'),
  ('hr_manager', 'hr.leave.reports.export'),
  -- admin + superadmin: all
  ('admin', 'hr.leave.view'),('admin', 'hr.leave.view_all'),('admin', 'hr.leave.submit'),
  ('admin', 'hr.leave.cancel_own'),('admin', 'hr.leave.approve'),('admin', 'hr.leave.manage'),
  ('admin', 'hr.leave.types.manage'),('admin', 'hr.leave.balances.view'),('admin', 'hr.leave.balances.adjust'),
  ('admin', 'hr.leave.accruals.run'),('admin', 'hr.leave.calendar.view'),('admin', 'hr.leave.reports.view'),
  ('admin', 'hr.leave.reports.export'),
  ('superadmin', 'hr.leave.view'),('superadmin', 'hr.leave.view_all'),('superadmin', 'hr.leave.submit'),
  ('superadmin', 'hr.leave.cancel_own'),('superadmin', 'hr.leave.approve'),('superadmin', 'hr.leave.manage'),
  ('superadmin', 'hr.leave.types.manage'),('superadmin', 'hr.leave.balances.view'),('superadmin', 'hr.leave.balances.adjust'),
  ('superadmin', 'hr.leave.accruals.run'),('superadmin', 'hr.leave.calendar.view'),('superadmin', 'hr.leave.reports.view'),
  ('superadmin', 'hr.leave.reports.export')
on conflict do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';


-- ========== 20260718000003_hr_leave_settings.sql ==========
-- ============================================================================
-- HR Leave & Absence — settings (no-op migration)
-- ============================================================================
-- INTENTIONALLY EMPTY. HR Leave settings are declared in the settings MANIFEST
-- (netlify/functions/lib/settings/manifests/hrLeave.manifest.ts, registered in
-- manifests/index.ts) and seeded into the catalog by seedSettingsFromManifests()
-- — exactly like every other module (onboarding, employees, …). resolveSettingValue()
-- falls back to each setting's manifest defaultValue until the catalog is synced, so
-- the module is fully functional without any manual catalog rows.
--
-- The original hand-written INSERT here targeted a non-existent `settings_catalog`
-- table (the real table is `app_setting_catalog`) and duplicated the manifest — both
-- band-aids. Removed. Nothing to apply.
-- ============================================================================

-- (no-op)


-- ========== 20260718000004_hr_leave_workflow.sql ==========
-- ============================================================================
-- HR Leave — workflow template + published version + binding
-- ============================================================================
-- Seeds the central engine with the Leave Request Approval workflow:
--   • ONE template `hr_leave_approval` (module_key = hr_leave)
--   • ONE published v1 version (single manager approval step)
--   • ONE global binding for trigger_event = 'hr.leave.requested'
--
-- The registered hr_leave adapter (lib/workflow/hrAdapters.ts) drives leave
-- request status on engine decisions. Idempotent.
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. template
  select id into tpl_id from public.workflow_templates where template_key = 'hr_leave_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_leave_approval', 'hr_leave', 'hr_leave_approval',
       'Leave Request Approval', 'Manager approval of employee leave requests.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_leave', workflow_type = 'hr_leave_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 (single manager approval step; linear → completes on approve)
  insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey','leave_approval','stepName','Leave Approval','stepType','approval','sequenceNo',1,
          'assignment', jsonb_build_object('type','role','value','manager'),
          'dueDurationHours', 48, 'required', true, 'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', '{}'::jsonb,
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition = excluded.definition,
        published_at = excluded.published_at
  returning id into ver_id;

  -- 3. one global binding for the leave request trigger event
  delete from public.module_workflow_bindings
    where module_key = 'hr_leave'
      and workflow_type = 'hr_leave_approval'
      and trigger_event = 'hr.leave.requested'
      and scope_type = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_leave', 'hr_leave_approval', 'hr.leave.requested', tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying: NOTIFY pgrst, 'reload schema';


-- ===== reload PostgREST schema cache (once, at the very end) =====
NOTIFY pgrst, 'reload schema';
