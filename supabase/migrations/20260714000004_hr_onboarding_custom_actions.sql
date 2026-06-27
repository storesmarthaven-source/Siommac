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
