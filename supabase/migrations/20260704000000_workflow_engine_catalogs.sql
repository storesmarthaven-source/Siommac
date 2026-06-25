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
