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
