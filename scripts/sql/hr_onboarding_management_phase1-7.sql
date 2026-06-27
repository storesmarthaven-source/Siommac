-- ============================================================================
-- HR ONBOARDING — Management + Custom Actions + Provisioning (Phases 1-7) BUNDLE
-- ============================================================================
-- Idempotent concatenation of migrations 20260714000000..000006 in dependency
-- order. Safe to run in full on any environment. After this, run the SETTINGS
-- CATALOG SYNC (POST /api/settings/catalog/sync, or seedSettingsFromManifests)
-- to publish the hr_onboarding.* setting keys. Ends with NOTIFY pgrst.
-- ============================================================================


-- ▼▼▼ 20260714000000_hr_onboarding_management.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — management-module foundation (Phase 1)
-- ============================================================================
-- Expands the launch-only backbone (20260709000000_hr_onboarding.sql) into the
-- full case state machine the management module needs:
--   • cases:    richer status state machine + pause timestamp
--   • tasks:    blocking / evidence / dependency / ordering flags + open/cancelled
--   • handoffs: full delivery lifecycle + ownership + lifecycle timestamps
--   • NEW hr_onboarding_blockers (Blocked tab + activation gates)
--
-- Progress %, open/blocking counts, and activation readiness are COMPUTED in the
-- API from tasks/blockers — NOT denormalized here (avoids stale-state band-aids).
-- Additive / forward-only; depends on 20260709000000. app_users.id is TEXT → all
-- user FKs are TEXT. Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── cases: expand status state machine + pause timestamp ────────────────────────
alter table public.hr_onboarding_cases drop constraint if exists hr_onboarding_cases_status_check;
alter table public.hr_onboarding_cases add constraint hr_onboarding_cases_status_check
  check (status in ('draft','open','in_progress','blocked','paused','ready_for_activation','completed','cancelled'));

alter table public.hr_onboarding_cases
  add column if not exists paused_at    timestamptz,
  add column if not exists cancelled_by text references public.app_users(id) on delete set null,
  add column if not exists cancelled_at timestamptz;

-- ── tasks: blocking / evidence / dependency / ordering + open/cancelled states ───
alter table public.hr_onboarding_tasks
  add column if not exists is_blocking       boolean not null default false,
  add column if not exists requires_evidence boolean not null default false,
  add column if not exists dependency_keys   jsonb   not null default '[]'::jsonb,
  add column if not exists sort_order        int     not null default 0,
  add column if not exists priority          text,
  add column if not exists blocked_reason    text;

alter table public.hr_onboarding_tasks drop constraint if exists hr_onboarding_tasks_status_check;
alter table public.hr_onboarding_tasks add constraint hr_onboarding_tasks_status_check
  check (status in ('pending','open','in_progress','blocked','completed','skipped','cancelled'));

-- ── handoffs: full delivery lifecycle + ownership + timestamps ───────────────────
alter table public.hr_onboarding_handoffs drop constraint if exists hr_onboarding_handoffs_status_check;
alter table public.hr_onboarding_handoffs add constraint hr_onboarding_handoffs_status_check
  check (status in ('pending','sent','accepted','blocked','delivered','completed','failed','cancelled'));

alter table public.hr_onboarding_handoffs
  add column if not exists handoff_key    text,
  add column if not exists owner_id       text references public.app_users(id) on delete set null,
  add column if not exists accepted_at    timestamptz,
  add column if not exists completed_at   timestamptz,
  add column if not exists failure_reason text,
  add column if not exists last_event_at  timestamptz;

-- ── blockers (Blocked tab + activation gates) ───────────────────────────────────
create table if not exists public.hr_onboarding_blockers (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  task_id         uuid references public.hr_onboarding_tasks(id)    on delete set null,
  handoff_id      uuid references public.hr_onboarding_handoffs(id) on delete set null,
  blocker_key     text not null,
  blocker_title   text not null,
  blocking_module text not null,
  severity        text not null default 'medium'
                    check (severity in ('low','medium','high','critical')),
  status          text not null default 'active'
                    check (status in ('active','acknowledged','waiting_on_owner','escalated','resolved','waived')),
  owner_id        text references public.app_users(id) on delete set null,
  due_at          timestamptz,
  resolved_by     text references public.app_users(id) on delete set null,
  resolved_at     timestamptz,
  waiver_reason   text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index if not exists hr_onboarding_blockers_case_idx on public.hr_onboarding_blockers(case_id, status);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_blockers enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_blockers to service_role;

-- ── updated_at trigger ──────────────────────────────────────────────────────────
drop trigger if exists trg_hr_onboarding_blockers_updated_at on public.hr_onboarding_blockers;
create trigger trg_hr_onboarding_blockers_updated_at before update on public.hr_onboarding_blockers
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ▲▲▲ end 20260714000000_hr_onboarding_management ▲▲▲

-- ▼▼▼ 20260714000001_hr_onboarding_management_perms.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — management-module permission grants (Phase 3)
-- ============================================================================
-- New enforced keys: case.manage (add task / pause-resume / reassign owner / mark
-- ready / blocker resolve-escalate-waive), complete (close a case), audit.view
-- (case Audit tab). Granted to the same roles as the existing onboarding manage
-- keys (superadmin / admin / hr_manager). Catalogue entries live in
-- netlify/functions/lib/permissions.ts + src/lib/permissions.ts + permissionMeta.ts.
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.case.manage'),('admin','hr.onboarding.case.manage'),('hr_manager','hr.onboarding.case.manage'),
  ('superadmin','hr.onboarding.complete'),   ('admin','hr.onboarding.complete'),   ('hr_manager','hr.onboarding.complete'),
  ('superadmin','hr.onboarding.audit.view'), ('admin','hr.onboarding.audit.view'), ('hr_manager','hr.onboarding.audit.view')
on conflict do nothing;

-- ▲▲▲ end 20260714000001_hr_onboarding_management_perms ▲▲▲

-- ▼▼▼ 20260714000002_hr_onboarding_packages.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — packages → DB (Phase 4)
-- ============================================================================
-- Moves onboarding packages from the code constant (lib/hr/onboardingPackages.ts,
-- DELETED in this phase) into DB template tables, so packages become admin-editable
-- and so Custom Onboarding Actions (Phase 5) can FK a real package. Seeded from the
-- former code constant in 20260714000003_hr_onboarding_packages_seed.sql.
-- app_users.id is TEXT → created_by/updated_by are TEXT. Operator-applied; after
-- applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── packages ────────────────────────────────────────────────────────────────────
create table if not exists public.hr_onboarding_packages (
  id                     uuid primary key default gen_random_uuid(),
  package_key            text unique not null,
  package_name           text not null,
  description            text,
  worker_types           jsonb not null default '[]'::jsonb,
  default_sla_days       int  not null default 10,
  default_owner_role     text,
  applies_to_departments jsonb not null default '[]'::jsonb,
  applies_to_sites       jsonb not null default '[]'::jsonb,
  status                 text not null default 'draft'
                           check (status in ('draft','active','retired')),
  version_no             int  not null default 1,
  metadata               jsonb not null default '{}'::jsonb,
  created_by             text references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             text references public.app_users(id) on delete set null,
  updated_at             timestamptz
);

-- ── task templates ────────────────────────────────────────────────────────────--
create table if not exists public.hr_onboarding_task_templates (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null references public.hr_onboarding_packages(id) on delete cascade,
  task_key          text not null,
  task_title        text not null,
  owner_role        text not null,
  module_key        text,
  due_rule          jsonb not null default '{}'::jsonb,
  is_required       boolean not null default true,
  is_blocking       boolean not null default false,
  requires_evidence boolean not null default false,
  dependency_keys   jsonb not null default '[]'::jsonb,
  sort_order        int not null default 0,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (package_id, task_key)
);
create index if not exists hr_onboarding_task_templates_pkg_idx on public.hr_onboarding_task_templates(package_id);

-- ── handoff templates ─────────────────────────────────────────────────────────--
create table if not exists public.hr_onboarding_handoff_templates (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references public.hr_onboarding_packages(id) on delete cascade,
  handoff_key      text not null,
  target_module    text not null,
  handoff_type     text not null,
  trigger_rule     jsonb not null default '{}'::jsonb,
  payload_template jsonb not null default '{}'::jsonb,
  is_required      boolean not null default true,
  sort_order       int not null default 0,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (package_id, handoff_key)
);
create index if not exists hr_onboarding_handoff_templates_pkg_idx on public.hr_onboarding_handoff_templates(package_id);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_packages         enable row level security;
alter table public.hr_onboarding_task_templates    enable row level security;
alter table public.hr_onboarding_handoff_templates enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_packages         to service_role;
grant select, insert, update, delete on table public.hr_onboarding_task_templates    to service_role;
grant select, insert, update, delete on table public.hr_onboarding_handoff_templates to service_role;

-- ── updated_at trigger (packages are mutable via the package editor) ─────────────
drop trigger if exists trg_hr_onboarding_packages_updated_at on public.hr_onboarding_packages;
create trigger trg_hr_onboarding_packages_updated_at before update on public.hr_onboarding_packages
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ▲▲▲ end 20260714000002_hr_onboarding_packages ▲▲▲

-- ▼▼▼ 20260714000003_hr_onboarding_packages_seed.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — seed the 5 packages from the former code constant (Phase 4)
-- ============================================================================
-- Faithful migration of lib/hr/onboardingPackages.ts (now DELETED) into the DB
-- template tables. Idempotent (on conflict do nothing) — safe to re-run, and it
-- will NOT clobber packages later edited via the package editor. is_blocking /
-- requires_evidence are seeded false to preserve the exact current behaviour (the
-- code constant had no gating concept); mark them via the editor when desired.
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.hr_onboarding_packages (package_key, package_name, description, worker_types, default_owner_role, status) values
  ('standard_employee',        'Standard Employee',     'Best for ordinary employees',                          '["employee"]'::jsonb,                       'hr', 'active'),
  ('safety_critical_employee', 'Safety-Critical Employee','Adds induction, PTW/JSA, competency, medical',        '["employee"]'::jsonb,                       'hr', 'active'),
  ('contractor_worker',        'Contractor Worker',     'No payroll; strong access and HSE gate',                '["contractor","contractor_worker"]'::jsonb, 'hr', 'active'),
  ('supervisor_manager',       'Supervisor / Manager',  'Adds approval rights and management policy pack',       '["employee"]'::jsonb,                       'hr', 'active'),
  ('office_admin',             'Office / Admin',        'Standard office onboarding',                           '["employee"]'::jsonb,                       'hr', 'active')
on conflict (package_key) do nothing;

-- ── standard_employee ───────────────────────────────────────────────────────────
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('site_induction','Site induction','hse','hse',110),
  ('ppe_requirements','PPE requirements','hse','hse',120),
  ('hse_briefing','HSE briefing','hse','hse',130),
  ('training_matrix','Training matrix assignment','training','training',140),
  ('competency_requirements','Competency requirements','training','training',150),
  ('statutory_review','Statutory readiness review','payroll','payroll',160),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',170),
  ('payroll_gate','Payroll gate','payroll','payroll',180)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'standard_employee'
on conflict (package_id, task_key) do nothing;

-- ── safety_critical_employee ──────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('site_induction','Site induction','hse','hse',110),
  ('ppe_requirements','PPE requirements','hse','hse',120),
  ('hse_briefing','HSE briefing','hse','hse',130),
  ('medical_clearance','Medical / fitness clearance','hse','hse',140),
  ('training_matrix','Training matrix assignment','training','training',150),
  ('competency_requirements','Competency requirements','training','training',160),
  ('safety_competency','Safety-critical competency sign-off','training','training',170),
  ('statutory_review','Statutory readiness review','payroll','payroll',180),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',190),
  ('payroll_gate','Payroll gate','payroll','payroll',200)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'safety_critical_employee'
on conflict (package_id, task_key) do nothing;

-- ── contractor_worker ─────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm contractor profile','hr',null,10),
  ('document_collection','Collect contractor documents','hr',null,20),
  ('site_induction','Site induction','hse','hse',30),
  ('ppe_requirements','PPE requirements','hse','hse',40),
  ('hse_briefing','HSE briefing','hse','hse',50),
  ('contractor_readiness','Contractor HSE readiness','hse','hse',60),
  ('application_access','Grant limited access','it',null,70)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'contractor_worker'
on conflict (package_id, task_key) do nothing;

-- ── supervisor_manager ────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('leadership_orientation','Leadership orientation','hr',null,110),
  ('site_induction','Site induction','hse','hse',120),
  ('ppe_requirements','PPE requirements','hse','hse',130),
  ('hse_briefing','HSE briefing','hse','hse',140),
  ('training_matrix','Training matrix assignment','training','training',150),
  ('competency_requirements','Competency requirements','training','training',160),
  ('statutory_review','Statutory readiness review','payroll','payroll',170),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',180),
  ('payroll_gate','Payroll gate','payroll','payroll',190)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'supervisor_manager'
on conflict (package_id, task_key) do nothing;

-- ── office_admin ──────────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('office_induction','Office induction','hse','hse',110),
  ('statutory_review','Statutory readiness review','payroll','payroll',120),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',130),
  ('payroll_gate','Payroll gate','payroll','payroll',140)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'office_admin'
on conflict (package_id, task_key) do nothing;

-- ── handoff templates ─────────────────────────────────────────────────────────--
insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, h.handoff_key, h.target_module, h.handoff_type, h.sort_order
from public.hr_onboarding_packages p cross join (values
  ('onboarding_induction','hse','onboarding_induction',10),
  ('onboarding_training','training','onboarding_training',20),
  ('onboarding_payroll','payroll','onboarding_payroll',30)
) as h(handoff_key, target_module, handoff_type, sort_order)
where p.package_key in ('standard_employee','safety_critical_employee','supervisor_manager')
on conflict (package_id, handoff_key) do nothing;

insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, 'onboarding_contractor_readiness','hse','onboarding_contractor_readiness',10
from public.hr_onboarding_packages p where p.package_key = 'contractor_worker'
on conflict (package_id, handoff_key) do nothing;

insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, 'onboarding_payroll','payroll','onboarding_payroll',10
from public.hr_onboarding_packages p where p.package_key = 'office_admin'
on conflict (package_id, handoff_key) do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ▲▲▲ end 20260714000003_hr_onboarding_packages_seed ▲▲▲

-- ▼▼▼ 20260714000004_hr_onboarding_custom_actions.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — Custom Onboarding Actions (Phase 5)
-- ============================================================================
-- Package-level reusable custom-action templates + per-case one-off actions, each
-- instantiated into the NORMAL onboarding lifecycle (task / handoff / workflow /
-- notification) — never a disconnected custom system. app_users.id is TEXT → user
-- FKs are TEXT. Subsystems not yet built (documents / training / notification
-- templates) are stored as plain uuid columns WITHOUT a FK; their instantiation
-- creates a `pending` handoff (honest, not faked). workflow_template_id FKs the real
-- workflow_templates table. Operator-applied; after applying: NOTIFY pgrst.
-- ============================================================================

-- ── action templates (attached to a package) ────────────────────────────────────
create table if not exists public.hr_onboarding_action_templates (
  id                  uuid primary key default gen_random_uuid(),
  package_id          uuid not null references public.hr_onboarding_packages(id) on delete cascade,
  action_name         text not null,
  action_type         text not null check (action_type in (
                        'custom_task','custom_handoff','custom_document_request','custom_training_request',
                        'custom_approval','custom_notification','custom_checklist_item','custom_external_action')),
  description         text,
  instructions       text,
  owner_type         text not null default 'role' check (owner_type in ('role','employee','department','system','external')),
  owner_role         text,
  owner_employee_id  text references public.app_users(id) on delete set null,
  owner_department_id uuid,                                          -- soft ref (departments); no FK to avoid coupling
  due_offset_days    int,
  priority           text not null default 'normal' check (priority in ('low','normal','high','critical')),
  is_required        boolean not null default true,
  is_active          boolean not null default true,
  blocks_onboarding  boolean not null default false,
  requires_evidence  boolean not null default false,
  document_type_id      uuid,                                        -- soft ref (documents subsystem not built)
  training_requirement_id uuid,                                      -- soft ref (training subsystem not built)
  workflow_template_id  uuid references public.workflow_templates(id) on delete set null,
  notification_template_id uuid,                                     -- soft ref (notification templates)
  external_system_key  text,
  external_action_url  text,
  display_order       int not null default 100,
  created_by          text references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          text references public.app_users(id) on delete set null,
  updated_at          timestamptz,
  retired_by          text references public.app_users(id) on delete set null,
  retired_at          timestamptz
);
create index if not exists hr_onboarding_action_templates_pkg_idx on public.hr_onboarding_action_templates(package_id, is_active);

-- ── per-case actions (one-off tracking shell linked to the real lifecycle record) ─
create table if not exists public.hr_onboarding_case_actions (
  id                          uuid primary key default gen_random_uuid(),
  case_id                     uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  source_template_id          uuid references public.hr_onboarding_action_templates(id) on delete set null,
  action_name                 text not null,
  action_type                 text not null,
  status                      text not null default 'open'
                                check (status in ('open','in_progress','completed','cancelled','blocked')),
  linked_task_id              uuid references public.hr_onboarding_tasks(id)    on delete set null,
  linked_handoff_id           uuid references public.hr_onboarding_handoffs(id) on delete set null,
  linked_workflow_instance_id uuid references public.workflow_instances(id)     on delete set null,
  linked_document_request_id  uuid,                                  -- soft ref
  linked_training_request_id  uuid,                                  -- soft ref
  added_by                    text references public.app_users(id) on delete set null,
  added_at                    timestamptz not null default now(),
  completed_by                text references public.app_users(id) on delete set null,
  completed_at                timestamptz,
  cancelled_by                text references public.app_users(id) on delete set null,
  cancelled_at                timestamptz,
  metadata                    jsonb not null default '{}'::jsonb
);
create index if not exists hr_onboarding_case_actions_case_idx on public.hr_onboarding_case_actions(case_id, status);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_action_templates enable row level security;
alter table public.hr_onboarding_case_actions      enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_action_templates to service_role;
grant select, insert, update, delete on table public.hr_onboarding_case_actions      to service_role;

-- ── updated_at trigger (templates are mutable via the editor) ────────────────────
drop trigger if exists trg_hr_onboarding_action_templates_updated_at on public.hr_onboarding_action_templates;
create trigger trg_hr_onboarding_action_templates_updated_at before update on public.hr_onboarding_action_templates
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ▲▲▲ end 20260714000004_hr_onboarding_custom_actions ▲▲▲

-- ▼▼▼ 20260714000005_hr_onboarding_custom_actions_perms.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — Custom Onboarding Actions permission grants (Phase 5)
-- ============================================================================
-- 8 enforced keys for template management + case-level custom actions. Granted to
-- superadmin / admin / hr_manager (same roles as the other onboarding manage keys).
-- Catalogue entries: netlify/functions/lib/permissions.ts + src/lib/permissions.ts
-- + src/lib/permissionMeta.ts. Operator-applied; after applying: NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.custom_actions.view'),         ('admin','hr.onboarding.custom_actions.view'),         ('hr_manager','hr.onboarding.custom_actions.view'),
  ('superadmin','hr.onboarding.custom_actions.create'),       ('admin','hr.onboarding.custom_actions.create'),       ('hr_manager','hr.onboarding.custom_actions.create'),
  ('superadmin','hr.onboarding.custom_actions.update'),       ('admin','hr.onboarding.custom_actions.update'),       ('hr_manager','hr.onboarding.custom_actions.update'),
  ('superadmin','hr.onboarding.custom_actions.retire'),       ('admin','hr.onboarding.custom_actions.retire'),       ('hr_manager','hr.onboarding.custom_actions.retire'),
  ('superadmin','hr.onboarding.custom_actions.case_add'),     ('admin','hr.onboarding.custom_actions.case_add'),     ('hr_manager','hr.onboarding.custom_actions.case_add'),
  ('superadmin','hr.onboarding.custom_actions.case_update'),  ('admin','hr.onboarding.custom_actions.case_update'),  ('hr_manager','hr.onboarding.custom_actions.case_update'),
  ('superadmin','hr.onboarding.custom_actions.case_complete'),('admin','hr.onboarding.custom_actions.case_complete'),('hr_manager','hr.onboarding.custom_actions.case_complete'),
  ('superadmin','hr.onboarding.custom_actions.case_cancel'),  ('admin','hr.onboarding.custom_actions.case_cancel'),  ('hr_manager','hr.onboarding.custom_actions.case_cancel')
on conflict do nothing;

-- ▲▲▲ end 20260714000005_hr_onboarding_custom_actions_perms ▲▲▲

-- ▼▼▼ 20260714000006_hr_onboarding_account_provisioning.sql ▼▼▼
-- ============================================================================
-- HR Onboarding — Account / Work-Email provisioning (Phase 6)
-- ============================================================================
-- HR-created employees (routes/hr.ts) get an app_users row but NO Supabase Auth
-- login. Provisioning creates the login + a work email and sends an invite link
-- (set-own-password). app_users gains provisioning state; a token table backs the
-- invite (sha256 token hash, expiry, single-use). app_users.id is TEXT → user FKs
-- are TEXT. Operator-applied; after applying: NOTIFY pgrst.
-- ============================================================================

alter table public.app_users
  add column if not exists work_email      text,
  add column if not exists account_status  text,   -- null=unset · 'invited' · 'active' · 'disabled'
  add column if not exists provisioned_at  timestamptz,
  add column if not exists provisioned_by  text references public.app_users(id) on delete set null;

comment on column public.app_users.work_email     is 'Generated company work email (Onboarding provisioning).';
comment on column public.app_users.account_status is 'Login account state: invited / active / disabled.';

-- ── invite tokens (set-own-password) ────────────────────────────────────────────
create table if not exists public.hr_onboarding_account_invites (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references public.app_users(id) on delete cascade,
  case_id     uuid references public.hr_onboarding_cases(id) on delete set null,
  token_hash  text not null unique,                 -- sha256(raw token); raw is emailed, never stored
  work_email  text,
  delivery    text,                                 -- 'email' | 'surfaced'
  status      text not null default 'pending'
                check (status in ('pending','accepted','expired','revoked')),
  expires_at  timestamptz not null,
  created_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists hr_onboarding_account_invites_user_idx on public.hr_onboarding_account_invites(user_id, status);

alter table public.hr_onboarding_account_invites enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_account_invites to service_role;

-- ── permission grant (catalogued in lib/permissions.ts + src/lib/permissions.ts) ──
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.provision_account'),
  ('admin','hr.onboarding.provision_account'),
  ('hr_manager','hr.onboarding.provision_account')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ▲▲▲ end 20260714000006_hr_onboarding_account_provisioning ▲▲▲

NOTIFY pgrst, 'reload schema';
