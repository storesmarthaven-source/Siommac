-- ============================================================================
-- SIOMAC — PENDING MIGRATIONS BUNDLE (apply order). Paste into Supabase SQL editor.
-- Idempotent + additive. After running, the NOTIFY at the bottom reloads PostgREST.
-- Then call POST /api/settings/catalog/sync to populate the settings catalog.
-- ============================================================================



-- ████████████████████ 20260702000004_hr_employee_master_profile_docs.sql ████████████████████

-- ============================================================================
-- HR Employee Master — profile fields + employee documents (enterprise build)
-- ============================================================================
-- Additive, building on the green foundation (HR fields live on app_users). Adds
-- the remaining profile fields and the private HR-documents table. Keyed to
-- app_users.id (TEXT), consistent with the other HR satellites (employee_id).
-- Run manually + NOTIFY pgrst.
-- ============================================================================

-- ── app_users: remaining Employee-Master profile fields ───────────────────────
alter table public.app_users add column if not exists emergency_contact_name         text;
alter table public.app_users add column if not exists emergency_contact_phone        text;
alter table public.app_users add column if not exists emergency_contact_relationship text;
alter table public.app_users add column if not exists sensitive_notes                text;
alter table public.app_users add column if not exists position_id                    uuid
  references public.hr_positions(id) on delete set null;

create index if not exists app_users_position_idx on public.app_users(position_id) where position_id is not null;

-- ── hr_employee_documents — private HR documents (contract, ID, letters, etc.) ──
create table if not exists public.hr_employee_documents (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text not null references public.app_users(id) on delete cascade,
  document_type   text not null,
  title           text not null,
  file_path       text not null,
  file_name       text not null,
  mime_type       text,
  file_size       bigint,
  confidentiality text not null default 'internal'
                  check (confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
  status          text not null default 'uploaded'
                  check (status in ('uploaded','verified','rejected','archived')),
  expiry_date     date,
  uploaded_by     text references public.app_users(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  verified_by     text references public.app_users(id) on delete set null,
  verified_at     timestamptz,
  rejected_reason text,
  archived_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);
create index if not exists hr_emp_docs_employee_idx on public.hr_employee_documents(employee_id, status);
create index if not exists hr_emp_docs_expiry_idx on public.hr_employee_documents(expiry_date) where expiry_date is not null;
alter table public.hr_employee_documents enable row level security;


-- ████████████████████ 20260702000005_hr_document_permissions.sql ████████████████████

-- ============================================================================
-- HR employee-document permissions — DB role_permissions seed
-- ============================================================================
-- Mirrors the code catalogue for the 6 hr.employee_documents.* keys. Admin +
-- HR Manager get all; generic manager gets view + download only. Idempotent.
-- Run manually + NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.employee_documents.view'),('superadmin','hr.employee_documents.upload'),
  ('superadmin','hr.employee_documents.verify'),('superadmin','hr.employee_documents.archive'),
  ('superadmin','hr.employee_documents.download'),('superadmin','hr.employee_documents.sensitive_view'),
  ('admin','hr.employee_documents.view'),('admin','hr.employee_documents.upload'),
  ('admin','hr.employee_documents.verify'),('admin','hr.employee_documents.archive'),
  ('admin','hr.employee_documents.download'),('admin','hr.employee_documents.sensitive_view'),
  ('hr_manager','hr.employee_documents.view'),('hr_manager','hr.employee_documents.upload'),
  ('hr_manager','hr.employee_documents.verify'),('hr_manager','hr.employee_documents.archive'),
  ('hr_manager','hr.employee_documents.download'),('hr_manager','hr.employee_documents.sensitive_view'),
  ('manager','hr.employee_documents.view'),('manager','hr.employee_documents.download')
on conflict do nothing;


-- ████████████████████ 20260703000000_settings_architecture.sql ████████████████████

-- ============================================================================
-- SIOMAC Settings & Preferences — core architecture (Spec §5–§7)
-- ============================================================================
-- Catalog-driven, scoped settings with governance + manifest review:
--   app_setting_catalog            — defines every setting (class/scope/perm/flags)
--   app_setting_values             — scoped overrides (global→module→site→dept→role→user)
--   app_setting_audit_log          — append-only change log
--   module_setting_profiles        — reusable setting packs (e.g. "Strict HSE Site")
--   module_setting_profile_values  — values inside a profile
--   module_settings_manifests      — per-module settings review record (build gate)
--   module_settings_manifest_sections
--   module_settings_review_approvals
-- Conventions: snake_case, platform-level (no module prefix), uuid PK,
-- app_users.id is TEXT, RLS enabled (service-role bypass), set_updated_at trigger.
-- Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- set_updated_at() already exists (declared by the workflow backbone migration);
-- re-declared idempotently here so this file stands alone if run first.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── app_setting_catalog ──────────────────────────────────────────────────────
create table if not exists public.app_setting_catalog (
  id           uuid primary key default gen_random_uuid(),

  setting_key  text unique not null,
  module_key   text not null,

  label        text not null,
  description  text,

  data_type    text not null check (data_type in (
                 'boolean','number','string','select','multi_select','json','duration','time','array')),

  default_value  jsonb not null,
  allowed_values jsonb,

  min_value    numeric,
  max_value    numeric,

  setting_class text not null default 'module_policy' check (setting_class in (
                 'system_security','system_policy','module_policy','safety_rule','workflow_rule',
                 'notification_rule','message_policy','file_policy','audit_policy',
                 'personal_preference','ui_preference')),

  scope        jsonb not null default '["global"]'::jsonb,

  user_override_allowed       boolean not null default false,
  role_override_allowed       boolean not null default false,
  site_override_allowed       boolean not null default false,
  department_override_allowed boolean not null default false,
  module_override_allowed     boolean not null default false,

  can_reduce_strictness          boolean not null default false,
  can_suppress_required_delivery boolean not null default false,

  is_critical  boolean not null default false,
  is_sensitive boolean not null default false,
  is_audited   boolean not null default true,
  is_active    boolean not null default true,

  requires_permission       text not null,
  minimum_manage_permission text,

  source_manifest_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists app_setting_catalog_module_idx on public.app_setting_catalog(module_key);
create index if not exists app_setting_catalog_active_idx on public.app_setting_catalog(is_active);
create index if not exists app_setting_catalog_class_idx  on public.app_setting_catalog(setting_class);

create trigger trg_app_setting_catalog_updated_at
  before update on public.app_setting_catalog
  for each row execute function public.set_updated_at();

alter table public.app_setting_catalog enable row level security;

-- ── app_setting_values ───────────────────────────────────────────────────────
create table if not exists public.app_setting_values (
  id          uuid primary key default gen_random_uuid(),

  setting_key text not null references public.app_setting_catalog(setting_key),

  scope_type  text not null check (scope_type in ('global','module','site','department','role','user')),
  scope_id    text,

  value       jsonb not null,

  updated_by  text references public.app_users(id),
  updated_at  timestamptz not null default now(),

  metadata    jsonb not null default '{}'::jsonb,

  unique (setting_key, scope_type, scope_id)
);

create index if not exists app_setting_values_key_scope_idx
  on public.app_setting_values(setting_key, scope_type, scope_id);

create trigger trg_app_setting_values_updated_at
  before update on public.app_setting_values
  for each row execute function public.set_updated_at();

alter table public.app_setting_values enable row level security;

-- ── app_setting_audit_log (append-only) ──────────────────────────────────────
create table if not exists public.app_setting_audit_log (
  id          uuid primary key default gen_random_uuid(),

  setting_key text not null,
  module_key  text not null,

  scope_type  text not null,
  scope_id    text,

  previous_value jsonb,
  new_value      jsonb,

  changed_by  text references public.app_users(id),
  changed_at  timestamptz not null default now(),

  reason      text,
  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists app_setting_audit_key_idx        on public.app_setting_audit_log(setting_key);
create index if not exists app_setting_audit_module_idx     on public.app_setting_audit_log(module_key);
create index if not exists app_setting_audit_changed_at_idx on public.app_setting_audit_log(changed_at desc);

alter table public.app_setting_audit_log enable row level security;

-- ── module_setting_profiles ──────────────────────────────────────────────────
create table if not exists public.module_setting_profiles (
  id           uuid primary key default gen_random_uuid(),

  profile_name text not null,
  module_key   text not null,

  description  text,
  is_default   boolean not null default false,
  is_active    boolean not null default true,

  created_by   text references public.app_users(id),
  created_at   timestamptz not null default now(),

  metadata     jsonb not null default '{}'::jsonb
);

alter table public.module_setting_profiles enable row level security;

-- ── module_setting_profile_values ────────────────────────────────────────────
create table if not exists public.module_setting_profile_values (
  id          uuid primary key default gen_random_uuid(),

  profile_id  uuid not null references public.module_setting_profiles(id) on delete cascade,
  setting_key text not null references public.app_setting_catalog(setting_key),

  value       jsonb not null,

  created_at  timestamptz not null default now(),

  unique (profile_id, setting_key)
);

alter table public.module_setting_profile_values enable row level security;

-- ── module_settings_manifests ────────────────────────────────────────────────
create table if not exists public.module_settings_manifests (
  id           uuid primary key default gen_random_uuid(),

  module_key   text not null unique,
  module_label text not null,

  has_settings       boolean not null,
  reason_no_settings text,

  module_category text not null default 'standard' check (module_category in (
                    'standard','hse','safety_critical','compliance','finance','hr',
                    'communications','admin','system')),

  review_status text not null default 'draft' check (review_status in (
                  'draft','pending_review','approved','returned','deprecated')),

  requires_compliance_review boolean not null default false,
  requires_hse_review        boolean not null default false,
  requires_security_review   boolean not null default false,

  reviewed_by_product     boolean not null default false,
  reviewed_by_module_owner boolean not null default false,
  reviewed_by_engineering boolean not null default false,
  reviewed_by_super_admin boolean not null default false,
  reviewed_by_compliance  boolean not null default false,
  reviewed_by_hse         boolean not null default false,
  reviewed_by_security    boolean not null default false,

  settings_count          integer not null default 0,
  critical_settings_count integer not null default 0,
  user_preferences_count  integer not null default 0,

  manifest_version integer not null default 1,

  created_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),

  approved_by text references public.app_users(id),
  approved_at timestamptz,

  returned_reason text,

  metadata jsonb not null default '{}'::jsonb,

  check (has_settings = true or reason_no_settings is not null)
);

create index if not exists module_settings_manifests_status_idx on public.module_settings_manifests(review_status);
create index if not exists module_settings_manifests_module_idx on public.module_settings_manifests(module_key);

alter table public.module_settings_manifests enable row level security;

-- ── module_settings_manifest_sections ────────────────────────────────────────
create table if not exists public.module_settings_manifest_sections (
  id          uuid primary key default gen_random_uuid(),

  manifest_id uuid not null references public.module_settings_manifests(id) on delete cascade,

  section_key text not null check (section_key in (
                'general','numbering','validation','workflow','notifications','messages','files',
                'permissions','assignment','automation','escalation','handoffs','audit_retention',
                'personal_preferences','critical_governance')),

  applies               boolean not null default false,
  reason_not_applicable text,

  reviewed boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  unique (manifest_id, section_key),

  check (applies = true or reason_not_applicable is not null)
);

alter table public.module_settings_manifest_sections enable row level security;

-- ── module_settings_review_approvals ─────────────────────────────────────────
create table if not exists public.module_settings_review_approvals (
  id          uuid primary key default gen_random_uuid(),

  manifest_id uuid not null references public.module_settings_manifests(id) on delete cascade,

  reviewer_role text not null check (reviewer_role in (
                  'product_owner','module_owner','engineering','super_admin','compliance','hse','security')),

  reviewer_id text references public.app_users(id),

  decision    text not null check (decision in ('approved','returned','not_required')),

  comment     text,

  reviewed_at timestamptz not null default now(),

  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists module_settings_review_manifest_idx on public.module_settings_review_approvals(manifest_id);

alter table public.module_settings_review_approvals enable row level security;

-- ============================================================================
-- After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================


-- ████████████████████ 20260703000001_settings_permissions_seed.sql ████████████████████

-- ============================================================================
-- Settings & Preferences — role_permissions seed (Spec §8)
-- ============================================================================
-- Mirrors the code catalogue (src/lib/permissions.ts ROLE_PERMISSIONS):
--   employee   — own personal preferences only
--   manager    — own prefs + view notification/message module settings
--   admin      — module policy + non-critical governance
--   superadmin — full settings governance (critical/safety/security/audit + manifests)
-- Idempotent. Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('employee','settings.own_preferences.view'),
  ('employee','settings.own_preferences.manage'),
  ('manager','settings.own_preferences.view'),
  ('manager','settings.own_preferences.manage'),
  ('manager','settings.notifications.view'),
  ('manager','settings.messages.view'),
  ('admin','settings.manage'),
  ('admin','settings.own_preferences.view'),
  ('admin','settings.own_preferences.manage'),
  ('admin','settings.user_preferences.view'),
  ('admin','settings.user_preferences.manage'),
  ('admin','settings.global.view'),
  ('admin','settings.global.manage'),
  ('admin','settings.system.view'),
  ('admin','settings.system.manage'),
  ('admin','settings.critical.view'),
  ('admin','settings.security.view'),
  ('admin','settings.notification_policy.view'),
  ('admin','settings.notification_policy.manage'),
  ('admin','settings.message_policy.view'),
  ('admin','settings.message_policy.manage'),
  ('admin','settings.workflow.view'),
  ('admin','settings.workflow.manage'),
  ('admin','settings.file_policy.view'),
  ('admin','settings.file_policy.manage'),
  ('admin','settings.audit_policy.view'),
  ('admin','settings.safety_rules.view'),
  ('admin','settings.notifications.view'),
  ('admin','settings.notifications.manage'),
  ('admin','settings.messages.view'),
  ('admin','settings.messages.manage'),
  ('admin','settings.files.view'),
  ('admin','settings.files.manage'),
  ('admin','settings.employees.view'),
  ('admin','settings.employees.manage'),
  ('admin','settings.incidents.view'),
  ('admin','settings.incidents.manage'),
  ('admin','settings.investigations.view'),
  ('admin','settings.investigations.manage'),
  ('admin','settings.capa.view'),
  ('admin','settings.capa.manage'),
  ('admin','settings.jsa.view'),
  ('admin','settings.jsa.manage'),
  ('admin','settings.ptw.view'),
  ('admin','settings.ptw.manage'),
  ('admin','settings.inspections.view'),
  ('admin','settings.inspections.manage'),
  ('admin','settings.training.view'),
  ('admin','settings.training.manage'),
  ('admin','settings.documents.view'),
  ('admin','settings.documents.manage'),
  ('admin','settings.sds.view'),
  ('admin','settings.sds.manage'),
  ('admin','settings.ppe.view'),
  ('admin','settings.ppe.manage'),
  ('admin','settings.command_center.view'),
  ('admin','settings.command_center.manage'),
  ('admin','settings.admin.view'),
  ('admin','settings.admin.manage'),
  ('admin','settings.manifests.view'),
  ('admin','settings.manifests.create'),
  ('admin','settings.manifests.update'),
  ('admin','settings.manifests.submit'),
  ('superadmin','settings.manage'),
  ('superadmin','settings.own_preferences.view'),
  ('superadmin','settings.own_preferences.manage'),
  ('superadmin','settings.user_preferences.view'),
  ('superadmin','settings.user_preferences.manage'),
  ('superadmin','settings.global.view'),
  ('superadmin','settings.global.manage'),
  ('superadmin','settings.system.view'),
  ('superadmin','settings.system.manage'),
  ('superadmin','settings.critical.view'),
  ('superadmin','settings.critical.manage'),
  ('superadmin','settings.security.view'),
  ('superadmin','settings.security.manage'),
  ('superadmin','settings.notification_policy.view'),
  ('superadmin','settings.notification_policy.manage'),
  ('superadmin','settings.message_policy.view'),
  ('superadmin','settings.message_policy.manage'),
  ('superadmin','settings.workflow.view'),
  ('superadmin','settings.workflow.manage'),
  ('superadmin','settings.file_policy.view'),
  ('superadmin','settings.file_policy.manage'),
  ('superadmin','settings.audit_policy.view'),
  ('superadmin','settings.audit_policy.manage'),
  ('superadmin','settings.safety_rules.view'),
  ('superadmin','settings.safety_rules.manage'),
  ('superadmin','settings.notifications.view'),
  ('superadmin','settings.notifications.manage'),
  ('superadmin','settings.messages.view'),
  ('superadmin','settings.messages.manage'),
  ('superadmin','settings.files.view'),
  ('superadmin','settings.files.manage'),
  ('superadmin','settings.employees.view'),
  ('superadmin','settings.employees.manage'),
  ('superadmin','settings.incidents.view'),
  ('superadmin','settings.incidents.manage'),
  ('superadmin','settings.investigations.view'),
  ('superadmin','settings.investigations.manage'),
  ('superadmin','settings.capa.view'),
  ('superadmin','settings.capa.manage'),
  ('superadmin','settings.jsa.view'),
  ('superadmin','settings.jsa.manage'),
  ('superadmin','settings.ptw.view'),
  ('superadmin','settings.ptw.manage'),
  ('superadmin','settings.inspections.view'),
  ('superadmin','settings.inspections.manage'),
  ('superadmin','settings.training.view'),
  ('superadmin','settings.training.manage'),
  ('superadmin','settings.documents.view'),
  ('superadmin','settings.documents.manage'),
  ('superadmin','settings.sds.view'),
  ('superadmin','settings.sds.manage'),
  ('superadmin','settings.ppe.view'),
  ('superadmin','settings.ppe.manage'),
  ('superadmin','settings.command_center.view'),
  ('superadmin','settings.command_center.manage'),
  ('superadmin','settings.admin.view'),
  ('superadmin','settings.admin.manage'),
  ('superadmin','settings.manifests.view'),
  ('superadmin','settings.manifests.create'),
  ('superadmin','settings.manifests.update'),
  ('superadmin','settings.manifests.submit'),
  ('superadmin','settings.manifests.review'),
  ('superadmin','settings.manifests.approve'),
  ('superadmin','settings.manifests.return'),
  ('superadmin','settings.manifests.deprecate'),
  ('superadmin','settings.manifests.review.product'),
  ('superadmin','settings.manifests.review.module_owner'),
  ('superadmin','settings.manifests.review.engineering'),
  ('superadmin','settings.manifests.review.super_admin'),
  ('superadmin','settings.manifests.review.compliance'),
  ('superadmin','settings.manifests.review.hse'),
  ('superadmin','settings.manifests.review.security'),
  ('superadmin','communications.participants.remove_required'),
  ('superadmin','notifications.required_delivery.manage')
on conflict do nothing;


-- ████████████████████ 20260703000003_message_participant_required.sql ████████████████████

-- ============================================================================
-- Required message participants (Spec §22)
-- ============================================================================
-- Lets source modules lock responsible owners / approvers / reviewers into a
-- thread so employees cannot remove them. Enforced by assertCanRemoveParticipant
-- (communications.participants.remove_required overrides). Run manually + NOTIFY.
-- ============================================================================

alter table public.message_participants
  add column if not exists is_required boolean not null default false;

alter table public.message_participants
  add column if not exists required_reason text;

alter table public.message_participants
  add column if not exists can_be_removed_by_user boolean not null default true;


-- ████████████████████ 20260704000000_workflow_engine_catalogs.sql ████████████████████

-- ============================================================================
-- Central Workflow Engine — future-proofing catalogs (Spec §1-§3 addendum)
-- ============================================================================
-- Catalog-driven registries so HR/Finance/Operations (and any future module)
-- plug into the engine WITHOUT changing engine code. All NEW tables — no
-- collision with the existing workflow_templates/instances/tasks (those are
-- restructured in a later, deliberate phase). Conventions: snake_case, uuid PK,
-- app_users.id TEXT, RLS enabled. Run manually, then NOTIFY pgrst.
-- module_key uses SHORT tokens (ptw, incidents, leave…) + module_group
-- (hse/hr/finance/operations) — matches app_events.source_module, the settings
-- catalog, and the adapter registry.
-- ============================================================================

-- ── erp_modules — formal module registry ─────────────────────────────────────
create table if not exists public.erp_modules (
  id            uuid primary key default gen_random_uuid(),
  module_key    text unique not null,
  module_label  text not null,
  module_group  text not null,                 -- hse | hr | finance | operations | admin | communications
  is_active     boolean not null default true,
  supports_workflows     boolean not null default false,
  supports_handoffs      boolean not null default false,
  supports_files         boolean not null default false,
  supports_notifications boolean not null default true,
  supports_messages      boolean not null default false,
  created_at    timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb
);
create index if not exists erp_modules_group_idx on public.erp_modules(module_group);
alter table public.erp_modules enable row level security;

-- ── module_event_catalog — trigger events a module can raise ─────────────────
create table if not exists public.module_event_catalog (
  id            uuid primary key default gen_random_uuid(),
  module_key    text not null,
  event_key     text unique not null,
  event_label   text not null,
  description   text,
  event_type    text not null check (event_type in (
                  'record_created','record_submitted','status_changed','file_uploaded',
                  'due_date_reached','approval_requested','closure_requested',
                  'verification_requested','handoff_requested','system_generated')),
  can_start_workflow        boolean not null default true,
  can_send_notification     boolean not null default true,
  can_create_message_thread boolean not null default false,
  is_critical   boolean not null default false,
  is_active     boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  unique (module_key, event_key)
);
create index if not exists module_event_catalog_module_idx on public.module_event_catalog(module_key);
alter table public.module_event_catalog enable row level security;

-- ── workflow_type_catalog — workflow types per module ────────────────────────
create table if not exists public.workflow_type_catalog (
  id            uuid primary key default gen_random_uuid(),
  module_key    text not null,
  workflow_type text not null,
  label         text not null,
  description   text,
  default_priority  text not null default 'normal',
  requires_approval boolean not null default true,
  requires_audit    boolean not null default true,
  is_active     boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  unique (module_key, workflow_type)
);
alter table public.workflow_type_catalog enable row level security;

-- ── workflow_assignment_resolvers — how a step finds its assignee ────────────
create table if not exists public.workflow_assignment_resolvers (
  id             uuid primary key default gen_random_uuid(),
  resolver_key   text unique not null,
  resolver_label text not null,
  module_group   text,
  module_key     text,
  description    text,
  resolver_type  text not null check (resolver_type in (
                   'fixed_user','role','dynamic_field','relationship','org_structure','module_owner','custom')),
  config_schema  jsonb not null default '{}'::jsonb,
  is_active      boolean not null default true,
  metadata       jsonb not null default '{}'::jsonb
);
alter table public.workflow_assignment_resolvers enable row level security;

-- ── workflow_handoff_action_catalog — registered cross-module handoff actions ─
create table if not exists public.workflow_handoff_action_catalog (
  id              uuid primary key default gen_random_uuid(),
  action_key      text unique not null,
  action_label    text not null,
  from_module_key text,
  to_module_key   text,
  description     text,
  requires_permission text,
  is_critical     boolean not null default false,
  is_active       boolean not null default true,
  payload_schema  jsonb not null default '{}'::jsonb,
  metadata        jsonb not null default '{}'::jsonb
);
alter table public.workflow_handoff_action_catalog enable row level security;

-- ============================================================================
-- Seed — current modules + their events/types + the common/HSE resolvers and
-- handoff actions. HR/Finance/Operations rows are added when those modules ship.
-- ============================================================================

insert into public.erp_modules (module_key, module_label, module_group, supports_workflows, supports_handoffs, supports_files, supports_messages) values
  ('incidents','Incidents','hse',true,true,true,true),
  ('investigations','Investigations','hse',true,true,true,true),
  ('capa','CAPA','hse',true,true,true,true),
  ('jsa','JSA','hse',true,true,true,false),
  ('ptw','Permit to Work','hse',true,true,true,true),
  ('inspections','Inspections','hse',true,true,true,false),
  ('training','Training & Competency','hse',true,true,true,false),
  ('documents','Documents','hse',true,true,true,false),
  ('sds','SDS / Chemicals','hse',true,true,true,false),
  ('ppe','PPE','hse',false,true,false,false),
  ('employees','Employee Master','hr',true,true,true,false),
  ('leave','Leave','hr',true,false,false,false),
  ('communications','Communications','communications',false,false,true,true)
on conflict (module_key) do nothing;

insert into public.workflow_type_catalog (module_key, workflow_type, label) values
  ('ptw','permit_approval','Permit Approval'),
  ('jsa','jsa_approval','JSA Approval'),
  ('incidents','incident_review','Incident Review'),
  ('investigations','investigation_review','Investigation Review'),
  ('capa','capa_closeout','CAPA Closeout'),
  ('inspections','inspection_review','Inspection Review'),
  ('training','certificate_verification','Certificate Verification'),
  ('documents','document_approval','Document Approval'),
  ('sds','sds_review','SDS Review'),
  ('employees','employee_change_approval','Employee Change Approval'),
  ('leave','leave_approval','Leave Approval')
on conflict (module_key, workflow_type) do nothing;

insert into public.module_event_catalog (module_key, event_key, event_label, event_type) values
  ('ptw','ptw.submitted','PTW Submitted','record_submitted'),
  ('ptw','ptw.closeout_requested','PTW Closeout Requested','closure_requested'),
  ('jsa','jsa.submitted','JSA Submitted','record_submitted'),
  ('incidents','incident.submitted','Incident Submitted','record_submitted'),
  ('investigations','investigation.submitted_for_review','Investigation Submitted','record_submitted'),
  ('capa','capa.submitted_for_closure','CAPA Closure Requested','closure_requested'),
  ('inspections','inspection.submitted','Inspection Submitted','record_submitted'),
  ('training','certificate.uploaded','Certificate Uploaded','file_uploaded'),
  ('documents','document.route_for_approval','Document Routed for Approval','approval_requested'),
  ('sds','sds.uploaded_for_review','SDS Uploaded for Review','file_uploaded'),
  ('employees','hr.employee.change_requested','Employee Change Requested','approval_requested'),
  ('leave','hr.leave.submitted','Leave Submitted','record_submitted')
on conflict (event_key) do nothing;

insert into public.workflow_assignment_resolvers (resolver_key, resolver_label, resolver_type, module_group) values
  ('common.fixed_user','Fixed User','fixed_user',null),
  ('common.role','Role','role',null),
  ('common.supervisor','Supervisor','relationship',null),
  ('common.department_manager','Department Manager','org_structure',null),
  ('common.site_manager','Site Manager','org_structure',null),
  ('common.record_owner','Record Owner','module_owner',null),
  ('common.requester_manager','Requester''s Manager','relationship',null),
  ('hse.hse_manager','HSE Manager','role','hse'),
  ('hse.permit_area_owner','Permit Area Owner','dynamic_field','hse'),
  ('hse.document_owner','Document Owner','dynamic_field','hse'),
  ('hse.chemical_owner','Chemical Owner','dynamic_field','hse'),
  ('hr.hr_manager','HR Manager','role','hr'),
  ('hr.employee_supervisor','Employee Supervisor','relationship','hr'),
  ('finance.finance_manager','Finance Manager','role','finance'),
  ('finance.budget_owner','Budget Owner','dynamic_field','finance'),
  ('operations.asset_owner','Asset Owner','dynamic_field','operations'),
  ('operations.maintenance_supervisor','Maintenance Supervisor','role','operations')
on conflict (resolver_key) do nothing;

insert into public.workflow_handoff_action_catalog (action_key, action_label, from_module_key, to_module_key, is_critical) values
  ('hse.create_capa','Create CAPA','incidents','capa',true),
  ('hse.create_investigation','Create Investigation','incidents','investigations',true),
  ('hse.create_acknowledgement_tasks','Create Acknowledgement Tasks','documents',null,false),
  ('hse.validate_training','Validate Training','ptw','training',true),
  ('hse.validate_sds','Validate SDS','ptw','sds',true),
  ('common.create_message_thread','Create Message Thread',null,'communications',false),
  ('common.update_source_record','Update Source Record',null,null,false),
  ('hr.notify_payroll','Notify Payroll','leave',null,false)
on conflict (action_key) do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ████████████████████ 20260704000001_workflow_engine_core.sql ████████████████████

-- ============================================================================
-- Central Workflow Engine — core schema (Spec §3) — Option 3 (spec schema)
-- ============================================================================
-- Restructures the existing uuid-keyed workflow_templates/instances/tasks to the
-- spec schema and adds the versioning / binding / decision / handoff / audit
-- tables. SAFE-CUTOVER approach: spec columns are ADDED + BACKFILLED from the
-- current columns; the legacy columns are dropped in the final cutover migration
-- once every consumer uses the new schema. Run manually, then NOTIFY pgrst.
-- ============================================================================

-- ── workflow_templates → spec ────────────────────────────────────────────────
alter table public.workflow_templates add column if not exists template_key text;
alter table public.workflow_templates add column if not exists module_key text;
alter table public.workflow_templates add column if not exists workflow_type text;
alter table public.workflow_templates add column if not exists status text not null default 'active';
alter table public.workflow_templates add column if not exists current_version integer not null default 1;
alter table public.workflow_templates add column if not exists created_by text references public.app_users(id);
alter table public.workflow_templates add column if not exists updated_by text references public.app_users(id);
alter table public.workflow_templates add column if not exists updated_at timestamptz;
alter table public.workflow_templates add column if not exists metadata jsonb not null default '{}'::jsonb;
update public.workflow_templates set template_key = coalesce(template_key, key), module_key = coalesce(module_key, module) where template_key is null or module_key is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workflow_templates_status_check') then
    alter table public.workflow_templates add constraint workflow_templates_status_check check (status in ('draft','active','inactive','deprecated'));
  end if;
end $$;
create unique index if not exists workflow_templates_template_key_uidx on public.workflow_templates(template_key);
create index if not exists workflow_templates_module_idx on public.workflow_templates(module_key);

-- ── workflow_template_versions (new) ─────────────────────────────────────────
create table if not exists public.workflow_template_versions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.workflow_templates(id) on delete cascade,
  version_no    integer not null,
  version_status text not null default 'draft' check (version_status in ('draft','published','archived')),
  definition    jsonb not null,
  change_summary text,
  published_by  text references public.app_users(id),
  published_at  timestamptz,
  created_by    text references public.app_users(id),
  created_at    timestamptz not null default now(),
  unique (template_id, version_no)
);
create index if not exists workflow_template_versions_template_idx on public.workflow_template_versions(template_id, version_no);
alter table public.workflow_template_versions enable row level security;

-- ── workflow_template_steps (new) ────────────────────────────────────────────
create table if not exists public.workflow_template_steps (
  id            uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.workflow_template_versions(id) on delete cascade,
  step_key      text not null,
  step_name     text not null,
  step_type     text not null check (step_type in ('review','approval','verification','acknowledgement','assignment','handoff','automation','closeout')),
  sequence_no   integer not null,
  assignment_type text not null,
  assignment_value text,
  due_duration_hours integer,
  is_required   boolean not null default true,
  is_parallel   boolean not null default false,
  can_return    boolean not null default true,
  can_reject    boolean not null default true,
  can_delegate  boolean not null default false,
  require_comment_on_approve boolean not null default false,
  require_comment_on_return  boolean not null default true,
  require_comment_on_reject  boolean not null default true,
  require_attachment boolean not null default false,
  rules         jsonb not null default '{}'::jsonb,
  metadata      jsonb not null default '{}'::jsonb,
  unique (template_version_id, step_key)
);
alter table public.workflow_template_steps enable row level security;

-- ── module_workflow_bindings (new) — what makes a module USE a workflow ──────
create table if not exists public.module_workflow_bindings (
  id            uuid primary key default gen_random_uuid(),
  module_key    text not null,
  workflow_type text not null,
  trigger_event text not null,
  template_id   uuid not null references public.workflow_templates(id),
  template_version_id uuid references public.workflow_template_versions(id),
  scope_type    text not null default 'global' check (scope_type in ('global','site','department','role')),
  scope_id      text,
  priority      integer not null default 100,
  conditions    jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_by    text references public.app_users(id),
  created_at    timestamptz not null default now(),
  updated_by    text references public.app_users(id),
  updated_at    timestamptz,
  unique (module_key, workflow_type, trigger_event, scope_type, scope_id, priority)
);
create index if not exists workflow_bindings_lookup_idx on public.module_workflow_bindings(module_key, workflow_type, trigger_event, is_active);
alter table public.module_workflow_bindings enable row level security;

-- ── workflow_instances → spec (add + backfill) ───────────────────────────────
alter table public.workflow_instances add column if not exists workflow_no text;
alter table public.workflow_instances add column if not exists template_version_id uuid references public.workflow_template_versions(id);
alter table public.workflow_instances add column if not exists module_key text;
alter table public.workflow_instances add column if not exists workflow_type text;
alter table public.workflow_instances add column if not exists source_record_id text;
alter table public.workflow_instances add column if not exists source_record_ref text;
alter table public.workflow_instances add column if not exists current_step_key text;
alter table public.workflow_instances add column if not exists site_id text;
alter table public.workflow_instances add column if not exists department_id text;
alter table public.workflow_instances add column if not exists requested_by text references public.app_users(id);
alter table public.workflow_instances add column if not exists owner_id text references public.app_users(id);
alter table public.workflow_instances add column if not exists started_at timestamptz;
alter table public.workflow_instances add column if not exists completed_at timestamptz;
alter table public.workflow_instances add column if not exists cancelled_at timestamptz;
alter table public.workflow_instances add column if not exists template_snapshot jsonb not null default '{}'::jsonb;
alter table public.workflow_instances add column if not exists source_snapshot jsonb not null default '{}'::jsonb;
update public.workflow_instances set
  workflow_no       = coalesce(workflow_no, ref),
  module_key        = coalesce(module_key, source_module),
  source_record_id  = coalesce(source_record_id, source_entity_id),
  current_step_key  = coalesce(current_step_key, current_step),
  requested_by      = coalesce(requested_by, created_by),
  owner_id          = coalesce(owner_id, owner_user_id),
  started_at        = coalesce(started_at, created_at)
where workflow_no is null or module_key is null;
create unique index if not exists workflow_instances_workflow_no_uidx on public.workflow_instances(workflow_no);
create index if not exists workflow_instances_module_record_idx on public.workflow_instances(module_key, source_record_id);
-- Expand the status enum to the spec set.
do $$ begin
  alter table public.workflow_instances drop constraint if exists workflow_instances_status_check;
  alter table public.workflow_instances add constraint workflow_instances_status_check check (status in (
    'draft','submitted','triage','in_review','in_progress','awaiting_evidence','awaiting_approval',
    'pending_approval','returned','rejected','approved','completed','closed','cancelled','escalated','overdue','stuck'));
end $$;

-- ── workflow_tasks → spec (add + backfill) ───────────────────────────────────
alter table public.workflow_tasks add column if not exists step_name text;
alter table public.workflow_tasks add column if not exists step_type text;
alter table public.workflow_tasks add column if not exists task_title text;
alter table public.workflow_tasks add column if not exists assigned_to text references public.app_users(id);
alter table public.workflow_tasks add column if not exists decided_at timestamptz;
alter table public.workflow_tasks add column if not exists decision_comment text;
alter table public.workflow_tasks add column if not exists delegated_to text references public.app_users(id);
alter table public.workflow_tasks add column if not exists returned_to text references public.app_users(id);
alter table public.workflow_tasks add column if not exists is_required boolean not null default true;
update public.workflow_tasks set
  step_type        = coalesce(step_type, task_type),
  assigned_to      = coalesce(assigned_to, assigned_user_id),
  decision_comment = coalesce(decision_comment, decision_note),
  step_name        = coalesce(step_name, step_key),
  task_title       = coalesce(task_title, step_key)
where step_type is null or assigned_to is null or step_name is null;
create index if not exists workflow_tasks_assigned_idx on public.workflow_tasks(assigned_to, status);
create index if not exists workflow_tasks_due_idx on public.workflow_tasks(due_at);
-- Expand the task status enum to the spec set.
do $$ begin
  alter table public.workflow_tasks drop constraint if exists workflow_tasks_status_check;
  alter table public.workflow_tasks add constraint workflow_tasks_status_check check (status in (
    'open','pending','in_progress','approved','returned','rejected','delegated','reassigned','cancelled','completed','overdue'));
end $$;

-- ── workflow_decisions (new) ─────────────────────────────────────────────────
create table if not exists public.workflow_decisions (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflow_instances(id) on delete cascade,
  task_id       uuid references public.workflow_tasks(id),
  actor_id      text references public.app_users(id),
  decision      text not null check (decision in ('approved','returned','rejected','delegated','reassigned','cancelled','admin_override')),
  comment       text,
  attachment_ids jsonb not null default '[]'::jsonb,
  previous_status text,
  new_status    text,
  created_at    timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb
);
create index if not exists workflow_decisions_workflow_idx on public.workflow_decisions(workflow_id);
alter table public.workflow_decisions enable row level security;

-- ── workflow_handoffs (new) ──────────────────────────────────────────────────
create table if not exists public.workflow_handoffs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid references public.workflow_instances(id),
  from_module   text not null,
  to_module     text not null,
  source_record_id text not null,
  target_record_id text,
  trigger_event text not null,
  action_key    text,
  status        text not null default 'pending' check (status in ('pending','completed','failed','blocked','retrying','cancelled')),
  payload       jsonb not null default '{}'::jsonb,
  mapped_fields jsonb not null default '{}'::jsonb,
  error_message text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_handoffs_status_idx on public.workflow_handoffs(status);
alter table public.workflow_handoffs enable row level security;

-- ── workflow_audit_log (new, immutable) ──────────────────────────────────────
create table if not exists public.workflow_audit_log (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid,
  task_id       uuid,
  module_key    text,
  source_record_id text,
  actor_id      text references public.app_users(id),
  action        text not null,
  previous_state jsonb,
  new_state     jsonb,
  reason        text,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb
);
create index if not exists workflow_audit_workflow_idx on public.workflow_audit_log(workflow_id);
create index if not exists workflow_audit_created_idx on public.workflow_audit_log(created_at desc);
alter table public.workflow_audit_log enable row level security;

-- After applying:  NOTIFY pgrst, 'reload schema';
-- Legacy columns (templates.key/module, instances.ref/source_module/source_entity_*/
-- current_step/owner_user_id/created_by, tasks.task_type/assigned_user_id/decision_note)
-- are dropped in the final cutover migration once all consumers use the spec columns.


-- ████████████████████ 20260704000002_workflow_permissions_seed.sql ████████████████████

-- ============================================================================
-- Central Workflow Engine — role_permissions seed (Spec §22)
-- ============================================================================
-- Mirrors the code catalogue. employee = my tasks + decide-when-assigned;
-- manager = approvals + instance management; admin = full except admin_override;
-- superadmin = full. Idempotent. Run manually, then NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('employee','workflow.my_tasks.view'),
  ('employee','workflow.tasks.approve'),
  ('employee','workflow.tasks.return'),
  ('employee','workflow.tasks.reject'),
  ('manager','workflow.dashboard.view'),
  ('manager','workflow.my_tasks.view'),
  ('manager','workflow.register.view'),
  ('manager','workflow.tasks.approve'),
  ('manager','workflow.tasks.return'),
  ('manager','workflow.tasks.reject'),
  ('manager','workflow.tasks.delegate'),
  ('manager','workflow.instances.view'),
  ('manager','workflow.instances.reassign'),
  ('manager','workflow.instances.escalate'),
  ('manager','workflow.instances.cancel'),
  ('manager','workflow.handoffs.view'),
  ('manager','workflow.audit.view'),
  ('admin','workflow.dashboard.view'),
  ('admin','workflow.my_tasks.view'),
  ('admin','workflow.register.view'),
  ('admin','workflow.tasks.approve'),
  ('admin','workflow.tasks.return'),
  ('admin','workflow.tasks.reject'),
  ('admin','workflow.tasks.delegate'),
  ('admin','workflow.instances.view'),
  ('admin','workflow.instances.reassign'),
  ('admin','workflow.instances.escalate'),
  ('admin','workflow.instances.cancel'),
  ('admin','workflow.instances.migrate'),
  ('admin','workflow.templates.view'),
  ('admin','workflow.templates.create'),
  ('admin','workflow.templates.update'),
  ('admin','workflow.templates.publish'),
  ('admin','workflow.templates.clone'),
  ('admin','workflow.templates.deprecate'),
  ('admin','workflow.bindings.view'),
  ('admin','workflow.bindings.create'),
  ('admin','workflow.bindings.update'),
  ('admin','workflow.bindings.activate'),
  ('admin','workflow.bindings.deactivate'),
  ('admin','workflow.handoffs.view'),
  ('admin','workflow.handoffs.retry'),
  ('admin','workflow.handoffs.cancel'),
  ('admin','workflow.audit.view'),
  ('admin','workflow.audit.export'),
  ('superadmin','workflow.dashboard.view'),
  ('superadmin','workflow.my_tasks.view'),
  ('superadmin','workflow.register.view'),
  ('superadmin','workflow.tasks.approve'),
  ('superadmin','workflow.tasks.return'),
  ('superadmin','workflow.tasks.reject'),
  ('superadmin','workflow.tasks.delegate'),
  ('superadmin','workflow.instances.view'),
  ('superadmin','workflow.instances.reassign'),
  ('superadmin','workflow.instances.escalate'),
  ('superadmin','workflow.instances.cancel'),
  ('superadmin','workflow.instances.admin_override'),
  ('superadmin','workflow.instances.migrate'),
  ('superadmin','workflow.templates.view'),
  ('superadmin','workflow.templates.create'),
  ('superadmin','workflow.templates.update'),
  ('superadmin','workflow.templates.publish'),
  ('superadmin','workflow.templates.clone'),
  ('superadmin','workflow.templates.deprecate'),
  ('superadmin','workflow.bindings.view'),
  ('superadmin','workflow.bindings.create'),
  ('superadmin','workflow.bindings.update'),
  ('superadmin','workflow.bindings.activate'),
  ('superadmin','workflow.bindings.deactivate'),
  ('superadmin','workflow.handoffs.view'),
  ('superadmin','workflow.handoffs.retry'),
  ('superadmin','workflow.handoffs.cancel'),
  ('superadmin','workflow.audit.view'),
  ('superadmin','workflow.audit.export')
on conflict do nothing;


NOTIFY pgrst, 'reload schema';
