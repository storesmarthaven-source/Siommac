-- ============================================================================
-- Module "staff" roles — HR Staff + HSE Staff
-- ============================================================================
-- Problem: only hr_manager/admin/superadmin can start or manage onboarding
-- cases (and equivalently, only manager/admin/superadmin can submit HSE
-- records like incidents/permits/inspections). Real orgs have people who work
-- IN a module day-to-day without being that module's manager (HR coordinators,
-- safety officers). These roles fill that gap: execution permissions (create /
-- submit / manage-own-work), NOT oversight (approve / manage org-wide / delete
-- / settings) — that stays with hr_manager / manager / admin.
--
-- Finance/Operations do NOT get a staff role here: neither module has a real
-- permission catalogue yet (skeleton tables only, per the build order) — a
-- role with nothing to grant would be ceremony, not a fix.
--
-- IMPORTANT — roles/role_permissions are NOT hierarchical. loadRolePermissions
-- (netlify/functions/lib/permissions.ts) does a flat `where role_name = $1`;
-- a user has exactly one role (app_users.role), so a role's grant list must be
-- a COMPLETE standalone set, not just a "delta" on top of employee. Each role
-- below = the full `employee` baseline + that module's execution keys.
--
-- Pre-existing gap noted, NOT fixed here (separate concern from adding new
-- roles): hr_manager's own grant list (20260702000003_hr_permissions.sql) is
-- missing this same employee baseline (communications.*, attendance.view_own,
-- leaves.*, hse.*.view, workflow.submit/view, ui.widgets.packages.view) — as
-- seeded, an hr_manager user cannot message, view own attendance, submit
-- leave, or use the widget board. Flagging for a deliberate follow-up decision
-- rather than silently changing existing role behaviour in this migration.
--
-- `roles` and `role_permissions` were created directly against the live DB
-- (no tracked CREATE TABLE) — the shape below is inferred from how every
-- other migration already uses them (see 20260702000003_hr_permissions.sql).
-- `create table if not exists` here is purely defensive: a no-op today, but
-- it means a from-scratch replay of this migration folder no longer fails the
-- moment it hits the first `insert into public.role_permissions`.
-- Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  label       text not null,
  description text,
  is_system   boolean not null default false,
  protected   boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table if not exists public.role_permissions (
  role_name  text not null,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role_name, permission)
);

-- app_users.role must already accept custom role strings (hr_manager already
-- works live), but the ORIGINAL base schema's CHECK constraint restricted it
-- to admin/manager/employee. Drop it defensively if it's still present —
-- roles are validated against the `roles` table now, not a hardcoded enum.
alter table public.app_users drop constraint if exists app_users_role_check;

-- ── HR Staff ──────────────────────────────────────────────────────────────────
insert into public.roles (name, label, description, is_system, protected, sort_order)
values ('hr_staff', 'HR Staff', 'Runs day-to-day HR onboarding and employee-document work without hr_manager''s org-wide oversight.', false, false, 40)
on conflict (name) do nothing;

insert into public.role_permissions (role_name, permission) values
  -- employee baseline (roles don't inherit — this must be a complete set)
  ('hr_staff','attendance.view_own'),('hr_staff','leaves.view_own'),('hr_staff','leaves.submit'),
  ('hr_staff','payroll.view_own'),('hr_staff','dashboard.view'),
  ('hr_staff','hse.incidents.view'),('hr_staff','hse.capa.view'),('hr_staff','hse.risk.view'),
  ('hr_staff','hse.ptw.view'),('hr_staff','hse.inspections.view'),('hr_staff','hse.training.view'),
  ('hr_staff','hse.toolbox.view'),('hr_staff','hse.documents.view'),('hr_staff','hse.contractors.view'),
  ('hr_staff','hse.legal.view'),('hr_staff','hse.emergency.view'),('hr_staff','hse.environmental.view'),
  ('hr_staff','hse.ppe.view'),('hr_staff','hse.dashboard.view'),('hr_staff','hse.workflows.view'),
  ('hr_staff','workflow.submit'),('hr_staff','workflow.view'),
  ('hr_staff','communications.view'),('hr_staff','communications.thread_create'),
  ('hr_staff','communications.thread_manage_own'),('hr_staff','communications.messages.post'),
  ('hr_staff','communications.messages.attach'),('hr_staff','communications.messages.download_attachment'),
  ('hr_staff','communications.messages.delete_own_attachment'),('hr_staff','communications.messages.pin_own'),
  ('hr_staff','communications.messages.unpin_own'),('hr_staff','communications.participants.add'),
  ('hr_staff','communications.participants.remove'),('hr_staff','ui.widgets.packages.view'),
  -- HR execution (NOT hr.settings.*, hr.audit.view, hr.employees.{create,update,status_change,
  -- transfer,role_change,supervisor_change,sensitive_view,statutory.*,import*} — those stay
  -- oversight/manager-tier)
  ('hr_staff','hr.view'),('hr_staff','hr.dashboard.view'),
  ('hr_staff','hr.employees.view'),
  ('hr_staff','hr.onboarding.view'),('hr_staff','hr.onboarding.start'),
  ('hr_staff','hr.onboarding.task.manage'),('hr_staff','hr.onboarding.case.manage'),
  ('hr_staff','hr.onboarding.complete'),('hr_staff','hr.onboarding.cancel'),
  ('hr_staff','hr.onboarding.custom_actions.view'),('hr_staff','hr.onboarding.custom_actions.case_add'),
  ('hr_staff','hr.onboarding.custom_actions.case_update'),('hr_staff','hr.onboarding.custom_actions.case_complete'),
  ('hr_staff','hr.onboarding.custom_actions.case_cancel'),
  ('hr_staff','hr.employee_documents.view'),('hr_staff','hr.employee_documents.upload')
on conflict do nothing;

-- ── HSE Staff ─────────────────────────────────────────────────────────────────
insert into public.roles (name, label, description, is_system, protected, sort_order)
values ('hse_staff', 'HSE Staff', 'Submits and works HSE records day-to-day (incidents, permits, inspections) without manager-level approval authority.', false, false, 40)
on conflict (name) do nothing;

insert into public.role_permissions (role_name, permission) values
  -- employee baseline (same as above — standalone set)
  ('hse_staff','attendance.view_own'),('hse_staff','leaves.view_own'),('hse_staff','leaves.submit'),
  ('hse_staff','payroll.view_own'),('hse_staff','dashboard.view'),
  ('hse_staff','hse.incidents.view'),('hse_staff','hse.capa.view'),('hse_staff','hse.risk.view'),
  ('hse_staff','hse.ptw.view'),('hse_staff','hse.inspections.view'),('hse_staff','hse.training.view'),
  ('hse_staff','hse.toolbox.view'),('hse_staff','hse.documents.view'),('hse_staff','hse.contractors.view'),
  ('hse_staff','hse.legal.view'),('hse_staff','hse.emergency.view'),('hse_staff','hse.environmental.view'),
  ('hse_staff','hse.ppe.view'),('hse_staff','hse.dashboard.view'),('hse_staff','hse.workflows.view'),
  ('hse_staff','workflow.submit'),('hse_staff','workflow.view'),
  ('hse_staff','communications.view'),('hse_staff','communications.thread_create'),
  ('hse_staff','communications.thread_manage_own'),('hse_staff','communications.messages.post'),
  ('hse_staff','communications.messages.attach'),('hse_staff','communications.messages.download_attachment'),
  ('hse_staff','communications.messages.delete_own_attachment'),('hse_staff','communications.messages.pin_own'),
  ('hse_staff','communications.messages.unpin_own'),('hse_staff','communications.participants.add'),
  ('hse_staff','communications.participants.remove'),('hse_staff','ui.widgets.packages.view'),
  -- HSE execution (NOT any .manage/.approve key, hse.ptw.activate — the safety-critical
  -- go/no-go gate — or hse.ptw.manage/.risk.library.manage/.workflows.manage/.legal.manage;
  -- those stay manager/admin-tier)
  ('hse_staff','hse.incidents.create'),
  ('hse_staff','hse.ptw.create'),
  ('hse_staff','hse.inspections.create'),('hse_staff','hse.inspections.review'),
  ('hse_staff','hse.training.verify')
on conflict do nothing;
