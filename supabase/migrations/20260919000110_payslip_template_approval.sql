-- ============================================================================
-- payroll_payslip_templates -- maker-checker approval lifecycle (Phase 3)
-- ============================================================================
-- Extends payroll_payslip_templates with a full approval lifecycle:
--   draft -> pending_approval -> approved (or changes_requested -> pending_approval)
-- Existing 'active' rows are backfilled to 'approved' (they are already live).
-- Adds: workflow_id, version, parent_template_id, submitted_by, approved_by,
--       approved_at.
-- Updates: status check constraint, partial unique index, and both Postgres RPCs
--          (set-default and archive) to check status='approved' instead of 'active'.
-- Seeds:   workflow_templates + version + module_workflow_bindings for the
--          payslip_template_approval workflow (assigned to superadmin).
--
-- ASCII only, idempotent, named dollar-quote, <6KB.
--
-- Operator steps after applying:
--   1. Apply this migration.
--   2. Apply 20260919000120_payslip_template_approval_grants.sql.
--   3. NOTIFY pgrst, 'reload schema';
--   4. npm run build:backend && restart the dev server.
--   5. Run: npm run test:e2e -- payslipTemplateApproval
-- ============================================================================

-- ── Step 1: Add new columns (idempotent) ─────────────────────────────────────

alter table public.payroll_payslip_templates
  add column if not exists workflow_id        uuid,
  add column if not exists version            int not null default 1,
  add column if not exists parent_template_id uuid
    references public.payroll_payslip_templates(id) on delete set null,
  add column if not exists submitted_by       text
    references public.app_users(id) on delete set null,
  add column if not exists approved_by        text
    references public.app_users(id) on delete set null,
  add column if not exists approved_at        timestamptz;

-- ── Step 2: Expand the status check constraint ────────────────────────────────
-- Drop the old inline check (auto-generated name); add the new expanded one.
-- Both are idempotent: DROP IF EXISTS + ADD CONSTRAINT IF NOT EXISTS (PG15+) OR
-- guard with a DO block.

do $tmpl_status_check$
begin
  alter table public.payroll_payslip_templates
    drop constraint if exists payroll_payslip_templates_status_check;
exception when undefined_object then null;
end $tmpl_status_check$;

-- ── Step 3: Backfill existing 'active' rows to 'approved' BEFORE the new check ─
-- Existing templates were never drafted or reviewed -- they are live already.
-- This MUST run before ADD CONSTRAINT: 'active' is not in the new allowed set, so
-- adding the constraint while any row is still 'active' fails with a 23514.

update public.payroll_payslip_templates
  set status = 'approved'
  where status = 'active';

alter table public.payroll_payslip_templates
  add constraint payroll_payslip_templates_status_check
  check (status in (
    'draft',
    'pending_approval',
    'changes_requested',
    'approved',
    'archived'
  ));

-- ── Step 4: Update the partial unique index for is_default ───────────────────
-- The old index guarded is_default on status='active'; now guard on 'approved'.

drop index if exists public.one_default_payroll_payslip_template;

create unique index if not exists one_default_payroll_payslip_template
  on public.payroll_payslip_templates (is_default)
  where is_default = true
    and status = 'approved';

-- ── Step 5: Recreate payroll_set_default_template RPC ────────────────────────
-- Checks status='approved' (was 'active').

create or replace function public.payroll_set_default_template(
  p_id       uuid,
  p_actor_id text
)
returns public.payroll_payslip_templates
language plpgsql
security definer
set search_path = public
as $fn_setdef$
declare
  v_row public.payroll_payslip_templates;
begin
  if not exists (
    select 1
    from public.payroll_payslip_templates
    where id     = p_id
      and status = 'approved'
  ) then
    raise exception
      'payroll_set_default_template: template not found or not approved'
      using errcode = 'P0002';
  end if;

  update public.payroll_payslip_templates
  set    is_default = false,
         updated_by = p_actor_id
  where  status     = 'approved'
    and  is_default = true
    and  id        <> p_id;

  update public.payroll_payslip_templates
  set    is_default = true,
         updated_by = p_actor_id
  where  id     = p_id
    and  status = 'approved'
  returning * into v_row;

  if v_row is null then
    raise exception
      'payroll_set_default_template: failed to update target row'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$fn_setdef$;

revoke all on function public.payroll_set_default_template(uuid, text) from public;
revoke all on function public.payroll_set_default_template(uuid, text) from anon;
revoke all on function public.payroll_set_default_template(uuid, text) from authenticated;
grant  execute on function public.payroll_set_default_template(uuid, text) to service_role;

-- ── Step 6: Recreate payroll_archive_template RPC ────────────────────────────
-- Checks status='approved' (was 'active').

create or replace function public.payroll_archive_template(
  p_id       uuid,
  p_actor_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn_archive$
declare
  v_was_default boolean;
  v_next_id     uuid;
begin
  select is_default
    into v_was_default
    from public.payroll_payslip_templates
   where id     = p_id
     and status = 'approved';

  if not found then
    raise exception
      'payroll_archive_template: template not found or not approved'
      using errcode = 'P0002';
  end if;

  update public.payroll_payslip_templates
  set    status     = 'archived',
         is_default = false,
         updated_by = p_actor_id
  where  id     = p_id
    and  status = 'approved';

  if v_was_default then
    select id
      into v_next_id
      from public.payroll_payslip_templates
     where status = 'approved'
     order by created_at desc
     limit 1;

    if v_next_id is not null then
      update public.payroll_payslip_templates
      set    is_default = true,
             updated_by = p_actor_id
      where  id = v_next_id;
    end if;
  end if;
end;
$fn_archive$;

revoke all on function public.payroll_archive_template(uuid, text) from public;
revoke all on function public.payroll_archive_template(uuid, text) from anon;
revoke all on function public.payroll_archive_template(uuid, text) from authenticated;
grant  execute on function public.payroll_archive_template(uuid, text) to service_role;

-- ── Step 7: Seed workflow template + published version + binding ──────────────
-- Approval step assigned to superadmin (CEO). SoD enforced in the adapter + service.
-- SoD (submitted_by != approver) enforced in the adapter.
-- sourceStatusMap drives the adapter's status transitions.

do $wf_seed$
declare
  tpl_id  uuid;
  ver_id  uuid;
  dr jsonb := '{
    "canApprove":              true,
    "canReturn":               true,
    "canReject":               true,
    "canDelegate":             false,
    "requireCommentOnApprove": false,
    "requireCommentOnReturn":  true,
    "requireCommentOnReject":  true,
    "requireAttachment":       false
  }'::jsonb;
  base_settings jsonb := '{
    "allowReturn":              true,
    "allowReject":              true,
    "allowDelegate":            false,
    "allowAdminOverride":       true,
    "requireAuditAllTransitions": true
  }'::jsonb;
begin
  select id into tpl_id
    from public.workflow_templates
   where template_key = 'payslip_template_approval';

  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      (
        'payslip_template_approval',
        'finance_payroll_templates',
        'payslip_template_approval',
        'Payslip Template Approval',
        'Finance Manager approval of a Payslip Studio layout template. '
        'An approved template may be set as the default or assigned to a payroll run '
        'for rendering. Segregation of duties: creator cannot approve their own template.',
        'active', true, 1, '{}'::jsonb
      )
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key    = 'finance_payroll_templates',
          workflow_type = 'payslip_template_approval',
          status        = 'active',
          current_version = 1
    where id = tpl_id;
  end if;

  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',          'finance_manager_template_approval',
          'stepName',         'Finance Manager Template Approval',
          'stepType',         'approval',
          'sequenceNo',       1,
          'assignment',       jsonb_build_object('type', 'role', 'value', 'superadmin'),
          'dueDurationHours', 72,
          'required',         true,
          'decisionRules',    dr
        )
      ),
      'transitions',      '[]'::jsonb,
      'notifications',    '[]'::jsonb,
      'handoffs',         '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_approval',
        'onCompleted', 'approved',
        'onReturned',  'changes_requested',
        'onRejected',  'changes_requested',
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

  delete from public.module_workflow_bindings
   where module_key    = 'finance_payroll_templates'
     and workflow_type = 'payslip_template_approval'
     and trigger_event = 'finance.payroll.template.submitted'
     and scope_type    = 'global'
     and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    (
      'finance_payroll_templates',
      'payslip_template_approval',
      'finance.payroll.template.submitted',
      tpl_id, ver_id,
      'global', true, 100
    );
end $wf_seed$;

-- After applying, run:
--   NOTIFY pgrst, 'reload schema';
--   npm run build:backend && restart the dev server
--   npm run test:e2e -- payslipTemplateApproval
