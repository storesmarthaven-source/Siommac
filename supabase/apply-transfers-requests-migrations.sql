-- ============================================================================
-- APPLY BUNDLE — HR Transfers & Promotions + HR Requests (5 migrations, in order)
-- ============================================================================
-- Paste this whole file into the Supabase SQL editor and run it. It is the exact
-- content of the 5 tracked migrations concatenated in dependency order:
--   1. 20260719000000_hr_transfers_permissions.sql
--   2. 20260719000001_workflow_transfer_promotion_binding.sql   (needs 20260711000000 already applied)
--   3. 20260721000000_hr_requests.sql
--   4. 20260721000001_hr_requests_permissions.sql
--   5. 20260721000002_workflow_hr_requests_binding.sql
-- All idempotent (on conflict / if not exists / delete-then-insert). The single
-- NOTIFY at the very end reloads PostgREST once for all of them.
-- ============================================================================


-- ── 1/5 · Transfers permissions ─────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin',  'hr.transfers.view'),
  ('superadmin',  'hr.transfers.request'),
  ('superadmin',  'hr.transfers.approve'),
  ('superadmin',  'hr.transfers.cancel'),
  ('admin',       'hr.transfers.view'),
  ('admin',       'hr.transfers.request'),
  ('admin',       'hr.transfers.approve'),
  ('admin',       'hr.transfers.cancel'),
  ('hr_manager',  'hr.transfers.view'),
  ('hr_manager',  'hr.transfers.request'),
  ('hr_manager',  'hr.transfers.approve'),
  ('hr_manager',  'hr.transfers.cancel'),
  ('manager',     'hr.transfers.view'),
  ('manager',     'hr.transfers.request'),
  ('hr_staff',    'hr.transfers.view'),
  ('hr_staff',    'hr.transfers.request')
on conflict do nothing;


-- ── 2/5 · Transfer/promotion workflow binding (reuses hr_employee_change_approval) ──
do $$
declare
  tpl_id uuid;
  ver_id uuid;
begin
  select id into tpl_id from public.workflow_templates where template_key = 'hr_employee_change_approval';
  if tpl_id is null then
    raise exception 'workflow_templates row hr_employee_change_approval not found — apply 20260711000000 first';
  end if;

  select id into ver_id
    from public.workflow_template_versions
    where template_id = tpl_id and version_no = 1 and version_status = 'published';
  if ver_id is null then
    raise exception 'No published v1 for hr_employee_change_approval — check 20260711000000 applied correctly';
  end if;

  delete from public.module_workflow_bindings
    where module_key = 'hr_employee_master' and workflow_type = 'hr_change_approval'
      and trigger_event = 'hr.employee.transfer_promotion' and scope_type = 'global' and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_employee_master', 'hr_change_approval', 'hr.employee.transfer_promotion', tpl_id, ver_id, 'global', true, 100);
end $$;


-- ── 3/5 · HR Requests table ─────────────────────────────────────────────────
create table if not exists public.hr_requests (
  id               uuid primary key default gen_random_uuid(),
  request_no       text unique not null,
  employee_id      text not null references public.app_users(id) on delete cascade,
  request_type     text not null,
  title            text not null,
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'submitted'
    check (status in ('draft','submitted','in_review','returned','approved','rejected','fulfilled','cancelled')),
  priority         text not null default 'normal'
    check (priority in ('low','normal','high')),
  workflow_id      uuid references public.workflow_instances(id) on delete set null,
  requested_by     text not null references public.app_users(id) on delete set null,
  decided_by       text references public.app_users(id) on delete set null,
  fulfilled_by     text references public.app_users(id) on delete set null,
  decision_comment text,
  resolution       jsonb not null default '{}'::jsonb,
  requested_at     timestamptz not null default now(),
  decided_at       timestamptz,
  fulfilled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);
create index if not exists hr_requests_employee_idx  on public.hr_requests(employee_id, status);
create index if not exists hr_requests_status_idx    on public.hr_requests(status);
create index if not exists hr_requests_workflow_idx  on public.hr_requests(workflow_id) where workflow_id is not null;
create index if not exists hr_requests_requested_at  on public.hr_requests(requested_at desc);
alter table public.hr_requests enable row level security;
grant select, insert, update, delete on table public.hr_requests to service_role;
drop trigger if exists trg_hr_requests_updated_at on public.hr_requests;
create trigger trg_hr_requests_updated_at
  before update on public.hr_requests
  for each row execute function public.set_updated_at();


-- ── 4/5 · HR Requests permissions ───────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('employee',   'hr.requests.submit_own'),
  ('manager',    'hr.requests.submit_own'),
  -- 'supervisor' omitted: not a row in public.roles (FK role_permissions_role_name_fkey → roles.name)
  ('hr_staff',   'hr.requests.submit_own'),
  ('hr_manager', 'hr.requests.submit_own'),
  ('admin',      'hr.requests.submit_own'),
  ('superadmin', 'hr.requests.submit_own'),
  ('hr_staff',   'hr.requests.manage'),
  ('hr_manager', 'hr.requests.manage'),
  ('admin',      'hr.requests.manage'),
  ('superadmin', 'hr.requests.manage')
on conflict do nothing;


-- ── 5/5 · HR Requests workflow (template + published v1 + binding) ──────────
do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  select id into tpl_id from public.workflow_templates where template_key = 'hr_request_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_request_approval', 'hr_requests', 'hr_request_approval',
       'HR Request Approval', 'Single HR-Manager approval for employee self-service requests.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_requests', workflow_type = 'hr_request_approval', status = 'active', current_version = 1
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
          'stepKey','hr_approval','stepName','HR Approval','stepType','approval','sequenceNo',1,
          'assignment', jsonb_build_object('type','role','value','hr_manager'),
          'dueDurationHours', 48, 'required', true, 'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb, 'notifications', '[]'::jsonb, 'handoffs', '[]'::jsonb,
      'sourceStatusMap', '{}'::jsonb, 'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status, definition = excluded.definition, published_at = excluded.published_at
  returning id into ver_id;

  delete from public.module_workflow_bindings
    where module_key = 'hr_requests' and workflow_type = 'hr_request_approval'
      and trigger_event = 'hr.request.submitted' and scope_type = 'global' and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_requests', 'hr_request_approval', 'hr.request.submitted', tpl_id, ver_id, 'global', true, 100);
end $$;


-- ── reload PostgREST once for everything above ──────────────────────────────
NOTIFY pgrst, 'reload schema';
