-- ============================================================================
-- SIOMAC — Payroll Phase 3 gap-fill + Finance Tier A/B remittances/disbursements
-- ----------------------------------------------------------------------------
-- Root cause: finance_payroll_runs (+ siblings) were never applied to this DB.
-- Remittances/Disbursements failed as a direct consequence (FK to a missing
-- table). This bundle creates the payroll tables first, then the dependents.
-- All statements are idempotent (create ... if not exists / on conflict do
-- nothing) -- safe to re-run even for pieces that already applied.
-- Apply in this order (already ordered below), then run the trailing NOTIFY,
-- then also click Dashboard -> Settings -> API -> Reload schema cache.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000000_finance_payroll_runs.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 2
-- Tables: finance_payroll_runs, finance_payroll_run_inputs,
--         finance_payroll_run_lines, finance_payroll_run_warnings
-- Spec §8.1 / §8.2 / §8.3 / §8.6
-- ============================================================================

-- ── finance_payroll_runs (§8.1) ───────────────────────────────────────────────
create table if not exists public.finance_payroll_runs (
  id                    uuid primary key default gen_random_uuid(),
  run_no                text unique not null,
  period_month          date unique not null,
  pay_frequency         text not null default 'monthly',
  status                text not null default 'draft' check (status in (
                          'draft','input_locked','calculated','pending_approval',
                          'returned','approved','locked','exported','cancelled')),
  statutory_version_id  uuid not null references public.finance_statutory_versions(id) on delete restrict,
  weeks_in_period       numeric(6,3) not null default 4.333,
  employee_count        int not null default 0,
  gross_total           numeric(14,2) not null default 0,
  deduction_total       numeric(14,2) not null default 0,
  net_total             numeric(14,2) not null default 0,
  nis_employer_total    numeric(14,2) not null default 0,
  workflow_id           uuid references public.workflow_instances(id) on delete set null,
  input_locked_by       text references public.app_users(id) on delete set null,
  input_locked_at       timestamptz,
  created_by            text references public.app_users(id) on delete set null,
  approved_by           text references public.app_users(id) on delete set null,
  locked_by             text references public.app_users(id) on delete set null,
  locked_at             timestamptz,
  reopened_by           text references public.app_users(id) on delete set null,
  reopened_at           timestamptz,
  reopen_reason         text,
  exported_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists finance_payroll_runs_period_idx   on public.finance_payroll_runs(period_month);
create index if not exists finance_payroll_runs_status_idx   on public.finance_payroll_runs(status);
create index if not exists finance_payroll_runs_workflow_idx  on public.finance_payroll_runs(workflow_id)
  where workflow_id is not null;
alter table public.finance_payroll_runs enable row level security;
grant select, insert, update, delete on public.finance_payroll_runs to service_role;
drop trigger if exists trg_finance_payroll_runs_updated_at on public.finance_payroll_runs;
create trigger trg_finance_payroll_runs_updated_at
  before update on public.finance_payroll_runs
  for each row execute function public.set_updated_at();

-- ── finance_payroll_run_inputs (§8.2) ─────────────────────────────────────────
-- Frozen snapshot of HR inputs (base pay, pay items, OT, timesheets) at lock time.
-- Immutable after creation; no updated_at needed.
create table if not exists public.finance_payroll_run_inputs (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id    text not null references public.app_users(id) on delete restrict,
  source_type    text not null check (source_type in ('base_pay','pay_item','overtime','timesheet')),
  source_id      text,
  component_code text,
  label          text,
  amount         numeric(12,2),
  quantity       numeric(12,4),
  rate           numeric(12,4),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_run_inputs_run_idx      on public.finance_payroll_run_inputs(run_id);
create index if not exists finance_payroll_run_inputs_employee_idx on public.finance_payroll_run_inputs(employee_id);
alter table public.finance_payroll_run_inputs enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_inputs to service_role;

-- ── finance_payroll_run_lines (§8.3) ──────────────────────────────────────────
-- Calculated results per employee per run, including NIS continuity snapshot.
create table if not exists public.finance_payroll_run_lines (
  id                          uuid primary key default gen_random_uuid(),
  run_id                      uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id                 text not null references public.app_users(id) on delete restrict,
  base                        numeric(12,2) not null default 0,
  taxable_gross               numeric(12,2) not null default 0,
  gross                       numeric(12,2) not null default 0,
  nis_employee                numeric(12,2) not null default 0,
  nis_employer                numeric(12,2) not null default 0,
  health_surcharge            numeric(12,2) not null default 0,
  chargeable_income           numeric(12,2) not null default 0,
  paye                        numeric(12,2) not null default 0,
  voluntary_deductions        numeric(12,2) not null default 0,
  net                         numeric(12,2) not null default 0,
  breakdown                   jsonb not null default '{}'::jsonb,
  department_id               text,
  cost_center_id              uuid references public.finance_cost_centers(id) on delete set null,
  -- NIS continuity snapshot (immutable audit of what was used at run time)
  nis_number_masked           text,
  nis_status                  text,
  nis_class_no                int,
  opening_ytd_nis_employee    numeric(12,2) not null default 0,
  opening_ytd_nis_employer    numeric(12,2) not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique(run_id, employee_id)
);
create index if not exists finance_payroll_run_lines_run_idx         on public.finance_payroll_run_lines(run_id);
create index if not exists finance_payroll_run_lines_employee_idx    on public.finance_payroll_run_lines(employee_id);
create index if not exists finance_payroll_run_lines_cost_center_idx on public.finance_payroll_run_lines(cost_center_id);
alter table public.finance_payroll_run_lines enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_lines to service_role;
drop trigger if exists trg_finance_payroll_run_lines_updated_at on public.finance_payroll_run_lines;
create trigger trg_finance_payroll_run_lines_updated_at
  before update on public.finance_payroll_run_lines
  for each row execute function public.set_updated_at();

-- ── finance_payroll_run_warnings (§8.6) ───────────────────────────────────────
-- NIS + input exceptions emitted during calculate, gated by policy settings.
-- Warning types: missing_nis_number, nis_pending_verification, nis_not_applicable,
--                nis_class_not_found, previous_employer_data_missing, opening_balance_missing.
create table if not exists public.finance_payroll_run_warnings (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id    text references public.app_users(id) on delete cascade,
  warning_type   text not null,
  severity       text not null default 'warning' check (severity in ('info','warning','blocker')),
  message        text not null,
  metadata       jsonb not null default '{}'::jsonb,
  resolved       boolean not null default false,
  resolved_by    text references public.app_users(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_run_warnings_run_idx      on public.finance_payroll_run_warnings(run_id);
create index if not exists finance_payroll_run_warnings_employee_idx on public.finance_payroll_run_warnings(employee_id);
alter table public.finance_payroll_run_warnings enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_warnings to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000002_finance_payslips_exports.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 3
-- Tables: finance_payslips (§8.4), finance_payroll_exports (§8.5)
-- ============================================================================

-- ── finance_payslips (§8.4) ───────────────────────────────────────────────────
-- One row per employee per run; created only after the run is locked.
-- Privacy: employee sees only own; manager cannot see subordinate by default;
-- HR cannot see payslips unless explicitly granted; bulk export Finance-only.
-- Signed URLs (expiring) generated on demand; download audited.
create table if not exists public.finance_payslips (
  id             uuid primary key default gen_random_uuid(),
  payslip_no     text unique not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  run_line_id    uuid not null references public.finance_payroll_run_lines(id) on delete cascade,
  employee_id    text not null references public.app_users(id) on delete restrict,
  file_path      text,
  generated_at   timestamptz not null default now(),
  generated_by   text references public.app_users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  unique(run_id, employee_id)
);
create index if not exists finance_payslips_employee_idx on public.finance_payslips(employee_id);
create index if not exists finance_payslips_run_idx      on public.finance_payslips(run_id);
alter table public.finance_payslips enable row level security;
grant select, insert, update, delete on public.finance_payslips to service_role;
-- No updated_at: payslips are immutable after generation.

-- ── finance_payroll_exports (§8.5) ───────────────────────────────────────────
-- One artifact per export action; re-export creates a new version (old is_current→false).
-- Only locked runs may be exported. Audited; does NOT disburse.
create table if not exists public.finance_payroll_exports (
  id             uuid primary key default gen_random_uuid(),
  export_no      text unique not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  format         text not null check (format in ('csv','xlsx','pdf','json')),
  file_path      text not null,
  checksum       text,
  generated_by   text references public.app_users(id) on delete set null,
  generated_at   timestamptz not null default now(),
  is_current     boolean not null default true,
  metadata       jsonb not null default '{}'::jsonb
);
create index if not exists finance_payroll_exports_run_idx       on public.finance_payroll_exports(run_id);
create index if not exists finance_payroll_exports_current_idx   on public.finance_payroll_exports(run_id, is_current)
  where is_current = true;
alter table public.finance_payroll_exports enable row level security;
grant select, insert, update, delete on public.finance_payroll_exports to service_role;
-- Exports are immutable artifacts; no updated_at trigger needed.

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000001_payroll_run_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 2 — Run Permissions (Spec §9)
-- Keys: finance.payroll.{view_own, view_all, run.manage, reports.view, reports.export}
-- Grants: employee, finance_staff, finance_manager, admin, superadmin
--
-- Stage 3 keys (approve, lock, export) are NOT added here.
-- ============================================================================

-- ── Catalogue the 5 payroll run keys in role_permissions ─────────────────────

-- employee → view_own (see own payslip line; full payslip gated in stage 3)
insert into public.role_permissions (role_name, permission) values
  ('employee', 'finance.payroll.view_own')
on conflict do nothing;

-- finance_staff → view_all + run.manage + reports.view
insert into public.role_permissions (role_name, permission)
  select 'finance_staff', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view'
  ]) as p
on conflict do nothing;

-- finance_manager → all five
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- admin → all five
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- no rows needed but add for completeness so DB is authoritative
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000003_payroll_approve_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 3 — Approve / Lock / Export Permissions
-- Keys: finance.payroll.{approve, lock, export}
-- Grants: finance_manager, admin, superadmin (NOT finance_staff — SoD)
-- Spec §9 / §10
-- ============================================================================

-- ── Catalogue the 3 stage-3 keys for role_permissions ────────────────────────

-- finance_manager → approve + lock + export (SoD: finance_staff does NOT get these)
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- admin → approve + lock + export
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- add for DB completeness
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000004_workflow_finance_payroll_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:     finance_payroll
-- Workflow type:  finance_payroll_approval
-- Trigger event:  finance.payroll.run.submitted
--
-- Approval step is assigned to finance_manager role.
-- Segregation of duties (creator ≠ approver) is enforced in the adapter
-- (financePayrollAdapter.ts → assertDifferentApprover), NOT in the template.
--
-- sourceStatusMap:
--   onStarted   → pending_approval  (already set at submit time)
--   onCompleted → approved
--   onReturned  → returned
--   onRejected  → returned
--   onCancelled → cancelled
-- ============================================================================

do $$
declare
  tpl_id  uuid;
  ver_id  uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'finance_payroll_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_payroll_approval', 'finance_payroll', 'finance_payroll_approval',
       'Finance Payroll Run Approval',
       'Finance Manager approval of a calculated payroll run before it can be locked and payslips generated.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_payroll', workflow_type = 'finance_payroll_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Finance Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',           'finance_manager_payroll_approval',
          'stepName',          'Finance Manager Payroll Approval',
          'stepType',          'approval',
          'sequenceNo',        1,
          'assignment',        jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours',  72,
          'required',          true,
          'decisionRules',     dr
        )
      ),
      'transitions',   '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs',      '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_approval',
        'onCompleted', 'approved',
        'onReturned',  'returned',
        'onRejected',  'returned',
        'onCancelled', 'cancelled'
      ),
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition     = excluded.definition,
        published_at   = excluded.published_at
  returning id into ver_id;

  -- 3. global binding (idempotent: delete then insert)
  delete from public.module_workflow_bindings
    where module_key    = 'finance_payroll'
      and workflow_type  = 'finance_payroll_approval'
      and trigger_event  = 'finance.payroll.run.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_payroll', 'finance_payroll_approval', 'finance.payroll.run.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260805000000_finance_remittances.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance — Statutory Remittances & Filing (F1)
-- Tables: finance_remittances (header), finance_remittance_lines (per-employee)
-- Spec §F1 / Statutory Remittances & Filing
-- ============================================================================
-- This migration is OPERATOR-APPLIED only — DO NOT run from application code.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── finance_remittances (remittance header per authority per payroll run) ─────
create table if not exists public.finance_remittances (
  id                  uuid primary key default gen_random_uuid(),
  remittance_no       text unique not null,
  period_year         int not null check (period_year >= 2000 and period_year <= 2100),
  period_month        int not null check (period_month >= 1 and period_month <= 12),
  authority           text not null check (authority in ('paye_bir','nis_nibtt','health_surcharge')),
  payroll_run_id      uuid not null references public.finance_payroll_runs(id) on delete restrict,
  employee_portion    numeric(15,2) not null default 0,
  employer_portion    numeric(15,2) not null default 0,
  total_due           numeric(15,2) not null default 0,
  currency            text not null default 'TTD',
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','paid','filed','cancelled')),
  due_date            date,
  paid_date           date,
  filed_date          date,
  authority_reference text,           -- receipt / filing reference # from the authority
  workflow_id         uuid references public.workflow_instances(id) on delete set null,
  created_by          text references public.app_users(id) on delete set null,
  approved_by         text references public.app_users(id) on delete set null,
  cancelled_by        text references public.app_users(id) on delete set null,
  cancel_reason       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- One remittance per (run, authority): avoids accidental double-creation
  unique (payroll_run_id, authority)
);

create index if not exists finance_remittances_run_idx
  on public.finance_remittances(payroll_run_id);
create index if not exists finance_remittances_status_idx
  on public.finance_remittances(status);
create index if not exists finance_remittances_period_idx
  on public.finance_remittances(period_year, period_month);
create index if not exists finance_remittances_authority_idx
  on public.finance_remittances(authority);
create index if not exists finance_remittances_workflow_idx
  on public.finance_remittances(workflow_id) where workflow_id is not null;

alter table public.finance_remittances enable row level security;
grant select, insert, update, delete on public.finance_remittances to service_role;

drop trigger if exists trg_finance_remittances_updated_at on public.finance_remittances;
create trigger trg_finance_remittances_updated_at
  before update on public.finance_remittances
  for each row execute function public.set_updated_at();

-- ── finance_remittance_lines (per-employee breakdown) ─────────────────────────
-- Each row = one employee's contribution to a given remittance.
-- Computed from finance_payroll_run_lines at create time and frozen.
create table if not exists public.finance_remittance_lines (
  id               uuid primary key default gen_random_uuid(),
  remittance_id    uuid not null references public.finance_remittances(id) on delete cascade,
  employee_id      text not null references public.app_users(id) on delete restrict,
  employee_portion numeric(12,2) not null default 0,
  employer_portion numeric(12,2) not null default 0,
  line_total       numeric(12,2) not null default 0,
  source_line_id   uuid references public.finance_payroll_run_lines(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (remittance_id, employee_id)
);

create index if not exists finance_remittance_lines_remittance_idx
  on public.finance_remittance_lines(remittance_id);
create index if not exists finance_remittance_lines_employee_idx
  on public.finance_remittance_lines(employee_id);

alter table public.finance_remittance_lines enable row level security;
grant select, insert, update, delete on public.finance_remittance_lines to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260805000001_finance_remittances_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Remittances — permissions (keys + DB grants)
-- ============================================================================
-- Keys:
--   finance.remittances.{view,manage,approve,reports.view,reports.export}
--
-- Column is `permission` (NOT permission_key).
-- Grants: finance_staff → view, manage
--         finance_manager → all including approve
--         admin, superadmin → all
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- finance_staff: can view and create/manage remittances (not approve)
  ('finance_staff',   'finance.remittances.view'),
  ('finance_staff',   'finance.remittances.manage'),

  -- finance_manager: full remittance lifecycle + reports
  ('finance_manager', 'finance.remittances.view'),
  ('finance_manager', 'finance.remittances.manage'),
  ('finance_manager', 'finance.remittances.approve'),
  ('finance_manager', 'finance.remittances.reports.view'),
  ('finance_manager', 'finance.remittances.reports.export'),

  -- admin: all remittance keys
  ('admin',           'finance.remittances.view'),
  ('admin',           'finance.remittances.manage'),
  ('admin',           'finance.remittances.approve'),
  ('admin',           'finance.remittances.reports.view'),
  ('admin',           'finance.remittances.reports.export'),

  -- superadmin: all remittance keys
  ('superadmin',      'finance.remittances.view'),
  ('superadmin',      'finance.remittances.manage'),
  ('superadmin',      'finance.remittances.approve'),
  ('superadmin',      'finance.remittances.reports.view'),
  ('superadmin',      'finance.remittances.reports.export')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260805000002_workflow_finance_remittance_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Remittances — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:    finance_remittances
-- Workflow type: finance_remittance_approval
-- Trigger event: finance.remittance.submitted
--
-- Approval step is assigned to finance_manager role.
-- Segregation of duties (creator ≠ approver) is enforced in the adapter
-- (financeRemittancesAdapter) and the service layer.
--
-- sourceStatusMap:
--   onStarted   → submitted  (already set at submit time; here for audit)
--   onCompleted → approved
--   onReturned  → draft
--   onRejected  → draft
--   onCancelled → draft
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'finance_remittance_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_remittance_approval', 'finance_remittances', 'finance_remittance_approval',
       'Finance Remittance Approval',
       'Finance Manager approval of a statutory remittance before it is marked approved and processed for payment/filing.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_remittances', workflow_type = 'finance_remittance_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Finance Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',        'finance_manager_approval',
          'stepName',       'Finance Manager Approval',
          'stepType',       'approval',
          'sequenceNo',     1,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours', 72,
          'required',       true,
          'decisionRules',  dr
        )
      ),
      'transitions',   '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs',      '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'submitted',
        'onCompleted', 'approved',
        'onReturned',  'draft',
        'onRejected',  'draft',
        'onCancelled', 'draft'
      ),
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition     = excluded.definition,
        published_at   = excluded.published_at
  returning id into ver_id;

  -- 3. global binding
  delete from public.module_workflow_bindings
    where module_key    = 'finance_remittances'
      and workflow_type  = 'finance_remittance_approval'
      and trigger_event  = 'finance.remittance.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_remittances', 'finance_remittance_approval', 'finance.remittance.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260808000001_finance_disbursements.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance — Payroll Bank Disbursements (F2)
-- Tables: finance_disbursements (header), finance_disbursement_lines (per-employee)
-- Spec §F2 / Payroll Bank Disbursement
-- ============================================================================
-- Lifecycle: draft → submitted → approved → file_generated → paid → cancelled
-- SoD: creator ≠ approver (enforced in the lib adapter).
-- Net pay per employee is derived from finance_payslips joined to
-- finance_payroll_run_lines (net column).
-- ============================================================================
-- This migration is OPERATOR-APPLIED only — DO NOT run from application code.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── finance_disbursements (disbursement header per payroll run) ───────────────
create table if not exists public.finance_disbursements (
  id               uuid primary key default gen_random_uuid(),
  disbursement_no  text unique not null,
  payroll_run_id   uuid not null references public.finance_payroll_runs(id) on delete restrict,
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','file_generated','paid','cancelled')),
  total_amount     numeric(15,2) not null default 0,
  employee_count   int not null default 0,
  bank_file_path   text,           -- storage path to the generated ACH/EFT file
  currency         text not null default 'TTD',
  approved_by      text references public.app_users(id) on delete set null,
  created_by       text references public.app_users(id) on delete set null,
  cancelled_by     text references public.app_users(id) on delete set null,
  cancel_reason    text,
  workflow_id      uuid references public.workflow_instances(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One disbursement per run (prevent duplicate disbursements for same payroll run)
  unique (payroll_run_id)
);

create index if not exists finance_disbursements_run_idx
  on public.finance_disbursements(payroll_run_id);
create index if not exists finance_disbursements_status_idx
  on public.finance_disbursements(status);
create index if not exists finance_disbursements_workflow_idx
  on public.finance_disbursements(workflow_id) where workflow_id is not null;

alter table public.finance_disbursements enable row level security;
grant select, insert, update, delete on public.finance_disbursements to service_role;

drop trigger if exists trg_finance_disbursements_updated_at on public.finance_disbursements;
create trigger trg_finance_disbursements_updated_at
  before update on public.finance_disbursements
  for each row execute function public.set_updated_at();

-- ── finance_disbursement_lines (per-employee lines within a disbursement) ─────
-- Each row = one employee's net pay to be disbursed to their bank account.
create table if not exists public.finance_disbursement_lines (
  id                uuid primary key default gen_random_uuid(),
  disbursement_id   uuid not null references public.finance_disbursements(id) on delete cascade,
  employee_id       text not null references public.app_users(id) on delete restrict,
  bank_account_id   uuid references public.finance_employee_bank_accounts(id) on delete restrict,
  net_amount        numeric(12,2) not null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (disbursement_id, employee_id)
);

create index if not exists fin_disb_lines_disb_idx
  on public.finance_disbursement_lines(disbursement_id);
create index if not exists fin_disb_lines_employee_idx
  on public.finance_disbursement_lines(employee_id);

alter table public.finance_disbursement_lines enable row level security;
grant select, insert, update, delete on public.finance_disbursement_lines to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260808000002_finance_disbursements_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Disbursements & Bank Accounts — permissions (keys + DB grants)
-- ============================================================================
-- New keys:
--   finance.bank_accounts.view       — view bank account listings (masked)
--   finance.bank_accounts.manage     — create / update / deactivate own bank accounts
--   finance.disbursement.view        — view disbursements and per-employee lines
--   finance.disbursement.manage      — create, submit and cancel disbursements
--   finance.disbursement.approve     — approve submitted disbursements (SoD: creator cannot approve)
--
-- Grants:
--   employee:        bank_accounts.view + manage (own only — scoped in route layer)
--   finance_staff:   bank_accounts.view + disbursement.view + disbursement.manage
--   finance_manager: all five keys
--   admin:           all five keys
--   superadmin:      all five keys
--
-- Column is `permission` (NOT permission_key). On conflict do nothing.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: self-manage own bank accounts only (route enforces self-scope)
  ('employee',        'finance.bank_accounts.view'),
  ('employee',        'finance.bank_accounts.manage'),

  -- finance_staff: view bank accounts, view and manage disbursements
  ('finance_staff',   'finance.bank_accounts.view'),
  ('finance_staff',   'finance.disbursement.view'),
  ('finance_staff',   'finance.disbursement.manage'),

  -- finance_manager: full lifecycle + approve
  ('finance_manager', 'finance.bank_accounts.view'),
  ('finance_manager', 'finance.bank_accounts.manage'),
  ('finance_manager', 'finance.disbursement.view'),
  ('finance_manager', 'finance.disbursement.manage'),
  ('finance_manager', 'finance.disbursement.approve'),

  -- admin: all five keys
  ('admin',           'finance.bank_accounts.view'),
  ('admin',           'finance.bank_accounts.manage'),
  ('admin',           'finance.disbursement.view'),
  ('admin',           'finance.disbursement.manage'),
  ('admin',           'finance.disbursement.approve'),

  -- superadmin: all five keys
  ('superadmin',      'finance.bank_accounts.view'),
  ('superadmin',      'finance.bank_accounts.manage'),
  ('superadmin',      'finance.disbursement.view'),
  ('superadmin',      'finance.disbursement.manage'),
  ('superadmin',      'finance.disbursement.approve')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260808000003_workflow_finance_disbursement_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Disbursements — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:    finance_disbursements
-- Workflow type: finance_disbursement_approval
-- Trigger event: finance.disbursement.submitted
--
-- Approval step assigned to finance_manager role.
-- Segregation of duties (creator ≠ approver) enforced in disbursements.ts
-- adapter via assertDifferentApprover.
--
-- sourceStatusMap:
--   onStarted   → submitted  (already set at submit time)
--   onCompleted → approved
--   onReturned  → draft
--   onRejected  → draft
--   onCancelled → draft
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'finance_disbursement_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_disbursement_approval', 'finance_disbursements', 'finance_disbursement_approval',
       'Finance Disbursement Approval',
       'Finance Manager approval of a payroll bank disbursement before the EFT/ACH file is generated and payments released.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_disbursements', workflow_type = 'finance_disbursement_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Finance Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',        'finance_manager_approval',
          'stepName',       'Finance Manager Approval',
          'stepType',       'approval',
          'sequenceNo',     1,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours', 72,
          'required',       true,
          'decisionRules',  dr
        )
      ),
      'transitions',   '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs',      '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'submitted',
        'onCompleted', 'approved',
        'onReturned',  'draft',
        'onRejected',  'draft',
        'onCancelled', 'draft'
      ),
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition     = excluded.definition,
        published_at   = excluded.published_at
  returning id into ver_id;

  -- 3. global binding
  delete from public.module_workflow_bindings
    where module_key    = 'finance_disbursements'
      and workflow_type  = 'finance_disbursement_approval'
      and trigger_event  = 'finance.disbursement.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_disbursements', 'finance_disbursement_approval', 'finance.disbursement.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260808000004_finance_disbursements_bucket.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Bank Disbursement -- private storage bucket for generated bank files
-- ============================================================================
-- F2's generateBankFile() uploads the ACH/EFT bank file (CSV) to the
-- `disbursements` bucket via presigned/server writes. Private bucket; access is
-- server-side (service_role) + signed URLs only. Without this the generate-file
-- action (and its E2E) cannot run. Mirrors 20260804000000_hr_documents_storage_limit.sql
-- and 20260731000003_hr_attendance_storage_policies.sql.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('disbursements', 'disbursements', false, 10485760)  -- 10 MB
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (presigned generation + server reads/writes).
drop policy if exists "disbursements_service_all" on storage.objects;
create policy "disbursements_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'disbursements')
  with check (bucket_id = 'disbursements');

-- No public read access -- all access via presigned signed URLs only.
-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ── Reload PostgREST schema cache ──
NOTIFY pgrst, 'reload schema';
