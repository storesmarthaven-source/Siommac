-- ============================================================================
-- Central Workflow Engine — FINAL CUTOVER: drop legacy columns (Spec §3, Option 3)
-- ============================================================================
-- The spec columns were ADDED + BACKFILLED in 20260704000001. Every consumer now
-- reads/writes ONLY the spec columns:
--   • lib/workflowEngine.ts        (legacy engine — createWorkflow/decideWorkflowTask)
--   • lib/workflow/service.ts      (central engine — startWorkflowForRecord/decideTask)
--   • routes/workflows.ts          (aliases spec cols → stable API DTO names)
--   • routes/hseIncidents.ts       (dashboard KPI counts by module_key)
--   • routes/hseRiskJsa.ts         (linked-workflow reads aliased to DTO names)
-- The dead routes/workflow.ts (record_ref/stage_key/target_module — never existed
-- on live) has been deleted. This migration removes the legacy duplicate columns,
-- backfills the one column the add-migration missed (workflow_type), and tightens
-- NOT NULL on the spec columns that are now always written.
--
-- Run manually, then:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

begin;

-- ── Defensive: drop artifacts from the never-applied early migration ──────────
-- (20260620000000 created a record_ref/created_by(uuid) variant whose CREATE was
--  superseded by 20260621100000's `if not exists`. These are no-ops on live but
--  keep a fresh full replay safe — a policy on created_by would block the drop.)
drop policy if exists "workflow_instances: creator can read own"        on public.workflow_instances;
drop policy if exists "workflow_instances: superadmin/admin full access" on public.workflow_instances;
drop index  if exists public.idx_workflow_instances_source_module;
drop index  if exists public.idx_workflow_instances_record_ref;
drop index  if exists public.idx_workflow_instances_created_by;

-- ── Backfill the spec columns before tightening NOT NULL ──────────────────────
-- 20260704000001 backfilled everything EXCEPT workflow_type — copy it now.
update public.workflow_instances
   set workflow_type = coalesce(workflow_type, source_entity_type, 'generic')
 where workflow_type is null;
update public.workflow_instances set
  workflow_no      = coalesce(workflow_no, ref),
  module_key       = coalesce(module_key, source_module),
  source_record_id = coalesce(source_record_id, source_entity_id)
 where workflow_no is null or module_key is null or source_record_id is null;

update public.workflow_tasks set
  step_type  = coalesce(step_type, task_type, 'review'),
  step_name  = coalesce(step_name, step_key),
  task_title = coalesce(task_title, step_key)
 where step_type is null or step_name is null or task_title is null;

update public.workflow_templates set
  template_key = coalesce(template_key, key),
  module_key   = coalesce(module_key, module)
 where template_key is null or module_key is null;

-- ── workflow_instances: drop legacy columns ──────────────────────────────────
-- (single + composite indexes on these columns are auto-dropped with them)
alter table public.workflow_instances drop column if exists ref;
alter table public.workflow_instances drop column if exists source_module;
alter table public.workflow_instances drop column if exists source_entity_type;
alter table public.workflow_instances drop column if exists source_entity_id;
alter table public.workflow_instances drop column if exists current_step;
alter table public.workflow_instances drop column if exists owner_user_id;
alter table public.workflow_instances drop column if exists created_by;

alter table public.workflow_instances alter column workflow_no      set not null;
alter table public.workflow_instances alter column module_key       set not null;
alter table public.workflow_instances alter column workflow_type    set not null;
alter table public.workflow_instances alter column source_record_id set not null;

-- ── workflow_tasks: drop legacy columns ──────────────────────────────────────
alter table public.workflow_tasks drop column if exists task_type;
alter table public.workflow_tasks drop column if exists assigned_user_id;
alter table public.workflow_tasks drop column if exists decision_note;
alter table public.workflow_tasks drop column if exists assigned_department_id;  -- unused legacy

alter table public.workflow_tasks alter column step_type  set not null;
alter table public.workflow_tasks alter column step_name  set not null;
alter table public.workflow_tasks alter column task_title set not null;

-- ── workflow_templates: drop legacy columns ──────────────────────────────────
-- (template_key/module_key already unique-indexed + backfilled in 20260704000001)
alter table public.workflow_templates drop column if exists key;
alter table public.workflow_templates drop column if exists module;

alter table public.workflow_templates alter column template_key set not null;
alter table public.workflow_templates alter column module_key   set not null;

commit;

-- After applying:  NOTIFY pgrst, 'reload schema';
