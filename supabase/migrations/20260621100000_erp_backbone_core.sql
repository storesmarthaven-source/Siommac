-- ============================================================================
-- ERP Backbone Core (Step 4 canonical)
-- app_events · workflow_templates · workflow_instances · workflow_tasks
-- workflow_events · handoff_outbox · reference_counters
--
-- NOTE: Supersedes the draft 20260621000000_app_events.sql (which was never
-- applied). Differences from the draft:
--   - app_events.id is uuid (gen_random_uuid()), not text
--   - severity adds 'high' between 'warning' and 'critical'
--   - workflow tables are platform-level (not hse-specific)
--   - handoff_outbox is in this file (was planned for Step 6)
--   - reference_counters supports ref generation (INC-YYYY-0001 pattern)
--
-- app_users.id is TEXT. All user FK columns use text references.
-- ============================================================================

-- ── app_events ────────────────────────────────────────────────────────────────
-- Immutable activity stream. Every significant mutation across every module
-- writes one row here. Never update or delete these rows.

create table if not exists public.app_events (
  id                  uuid        primary key default gen_random_uuid(),
  event_type          text        not null,
  source_module       text        not null,
  source_entity_type  text        not null,
  source_entity_id    text        not null,
  actor_user_id       text        references public.app_users(id) on delete set null,
  site_id             text,
  department_id       text,
  severity            text        not null default 'info'
                                  check (severity in ('info','success','warning','high','critical')),
  payload             jsonb       not null default '{}'::jsonb,
  dedupe_key          text,
  created_at          timestamptz not null default now()
);

create unique index if not exists app_events_dedupe_uidx
  on public.app_events(dedupe_key)
  where dedupe_key is not null;

create index if not exists app_events_source_idx
  on public.app_events(source_module, source_entity_type, source_entity_id, created_at desc);

create index if not exists app_events_actor_idx
  on public.app_events(actor_user_id, created_at desc);

create index if not exists app_events_type_idx
  on public.app_events(event_type, created_at desc);

alter table public.app_events enable row level security;

-- ── workflow_templates ────────────────────────────────────────────────────────

create table if not exists public.workflow_templates (
  id          uuid    primary key default gen_random_uuid(),
  module      text    not null,
  key         text    not null unique,
  name        text    not null,
  description text    not null default '',
  is_active   boolean not null default true,
  definition  jsonb   not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.workflow_templates enable row level security;

-- ── workflow_instances ────────────────────────────────────────────────────────

create table if not exists public.workflow_instances (
  id                  uuid    primary key default gen_random_uuid(),
  ref                 text    not null unique,
  template_id         uuid    not null references public.workflow_templates(id),
  source_module       text    not null,
  source_entity_type  text    not null,
  source_entity_id    text    not null,
  status              text    not null default 'draft'
                              check (status in (
                                'draft','submitted','triage','in_review',
                                'awaiting_evidence','awaiting_approval',
                                'returned','approved','rejected',
                                'closed','cancelled','overdue'
                              )),
  priority            text    not null default 'medium'
                              check (priority in ('low','medium','high','critical')),
  current_step        text    not null default 'draft',
  owner_user_id       text    references public.app_users(id) on delete set null,
  due_at              timestamptz,
  created_by          text    references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  closed_at           timestamptz,
  metadata            jsonb   not null default '{}'::jsonb
);

create index if not exists workflow_instances_source_idx
  on public.workflow_instances(source_module, source_entity_type, source_entity_id);

create index if not exists workflow_instances_status_due_idx
  on public.workflow_instances(status, due_at);

create index if not exists workflow_instances_owner_idx
  on public.workflow_instances(owner_user_id, status);

alter table public.workflow_instances enable row level security;

-- ── workflow_tasks ────────────────────────────────────────────────────────────

create table if not exists public.workflow_tasks (
  id                  uuid    primary key default gen_random_uuid(),
  workflow_id         uuid    not null references public.workflow_instances(id) on delete cascade,
  step_key            text    not null,
  task_type           text    not null
                              check (task_type in ('review','approve','verify','evidence','handoff')),
  assigned_user_id    text    references public.app_users(id) on delete set null,
  assigned_role       text,
  assigned_department_id text,
  status              text    not null default 'open'
                              check (status in (
                                'open','in_progress','completed','returned','cancelled','overdue'
                              )),
  due_at              timestamptz,
  completed_by        text    references public.app_users(id) on delete set null,
  decision            text    check (decision in ('approved','rejected','returned','verified','completed')),
  decision_note       text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  metadata            jsonb   not null default '{}'::jsonb
);

create index if not exists workflow_tasks_assignee_idx
  on public.workflow_tasks(assigned_user_id, status, due_at);

create index if not exists workflow_tasks_workflow_idx
  on public.workflow_tasks(workflow_id);

create index if not exists workflow_tasks_role_idx
  on public.workflow_tasks(assigned_role, status) where assigned_role is not null;

alter table public.workflow_tasks enable row level security;

-- ── workflow_events ───────────────────────────────────────────────────────────

create table if not exists public.workflow_events (
  id          uuid    primary key default gen_random_uuid(),
  workflow_id uuid    not null references public.workflow_instances(id) on delete cascade,
  event_type  text    not null,
  actor_user_id text  references public.app_users(id) on delete set null,
  note        text,
  payload     jsonb   not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists workflow_events_workflow_idx
  on public.workflow_events(workflow_id, created_at desc);

alter table public.workflow_events enable row level security;

-- ── handoff_outbox ────────────────────────────────────────────────────────────
-- Cross-module handoff with retry semantics.

create table if not exists public.handoff_outbox (
  id                  uuid    primary key default gen_random_uuid(),
  source_module       text    not null,
  target_module       text    not null,
  source_entity_type  text    not null,
  source_entity_id    text    not null,
  target_entity_type  text,
  target_entity_id    text,
  payload             jsonb   not null default '{}'::jsonb,
  status              text    not null default 'pending'
                              check (status in (
                                'pending','processing','completed','failed','cancelled','manual_review'
                              )),
  attempts            integer not null default 0,
  error               text,
  created_by          text    references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);

create index if not exists handoff_status_idx
  on public.handoff_outbox(status, created_at);

create index if not exists handoff_target_idx
  on public.handoff_outbox(target_module, status);

alter table public.handoff_outbox enable row level security;

-- ── reference_counters ────────────────────────────────────────────────────────
-- Used by refGenerator.ts to produce sequential human-readable refs like
-- INC-2026-0001. Increment happens inside a transaction with FOR UPDATE to
-- avoid duplicate refs under concurrent inserts.

create table if not exists public.reference_counters (
  prefix      text    not null,
  year        integer not null,
  next_number integer not null default 1,
  primary key (prefix, year)
);

alter table public.reference_counters enable row level security;

-- ── Workflow template seeds ───────────────────────────────────────────────────
-- Minimal definitions. The workflow engine reads `definition` at runtime;
-- steps are resolved from definition.steps[].

insert into public.workflow_templates (module, key, name, description, is_active, definition)
values
  ('hse', 'hse_incident_investigation',
   'HSE Incident Investigation',
   'Full investigation workflow from triage through CAPA closure.',
   true,
   '{
     "steps": [
       {"key":"triage",             "name":"Triage",              "type":"review",   "assigned_role":"manager",  "due_hours":24},
       {"key":"assign_investigator","name":"Assign Investigator",  "type":"review",   "assigned_role":"manager",  "due_hours":48},
       {"key":"evidence",           "name":"Evidence Collection",  "type":"evidence", "assigned_role":"investigator", "due_hours":120},
       {"key":"root_cause",         "name":"Root Cause Analysis",  "type":"review",   "assigned_role":"investigator", "due_hours":48},
       {"key":"capa_review",        "name":"CAPA Review",          "type":"approve",  "assigned_role":"manager",  "due_hours":48},
       {"key":"closure_approval",   "name":"Closure Approval",     "type":"approve",  "assigned_role":"manager",  "due_hours":48}
     ],
     "handoffs_on_approval": ["hr_injury_record","finance_cost_claim","ops_equipment_damage"]
   }'::jsonb
  ),
  ('hse', 'hse_capa_closure',
   'CAPA Closure',
   'Corrective and Preventive Action closure with owner verification.',
   true,
   '{
     "steps": [
       {"key":"assign_owner",           "name":"Assign Owner",             "type":"review",  "assigned_role":"manager", "due_hours":24},
       {"key":"implementation",         "name":"Implementation",           "type":"evidence","assigned_role":"owner",   "due_hours":null},
       {"key":"effectiveness_verify",   "name":"Effectiveness Verification","type":"verify", "assigned_role":"manager", "due_hours":48},
       {"key":"closure_approval",       "name":"Closure Approval",         "type":"approve", "assigned_role":"manager", "due_hours":48}
     ],
     "overdue_escalation_hours": 48
   }'::jsonb
  ),
  ('hr', 'leave_approval',
   'Leave Approval',
   'Manager review and approval of leave requests.',
   true,
   '{
     "steps": [
       {"key":"manager_review","name":"Manager Review","type":"approve","assigned_role":"manager","due_hours":24}
     ]
   }'::jsonb
  ),
  ('payroll', 'payroll_run_approval',
   'Payroll Run Approval',
   'Finance manager approval of a payroll run before payslip publication.',
   true,
   '{
     "steps": [
       {"key":"draft_validation","name":"Draft Validation",  "type":"review",  "assigned_role":"manager",         "due_hours":8},
       {"key":"payroll_review",  "name":"Payroll Review",    "type":"approve", "assigned_role":"manager",         "due_hours":24},
       {"key":"finance_approval","name":"Finance Approval",  "type":"approve", "assigned_role":"finance_manager", "due_hours":24},
       {"key":"publish_payslips","name":"Publish Payslips",  "type":"handoff", "assigned_role":"manager",         "due_hours":8}
     ]
   }'::jsonb
  )
on conflict (key) do nothing;
