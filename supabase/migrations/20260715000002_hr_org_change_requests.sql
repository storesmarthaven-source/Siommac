-- ============================================================================
-- HR Organization Structure (Phase B) — org change-request envelope
-- ============================================================================
-- Mirrors hr_employee_change_requests: the CENTRAL workflow engine owns the
-- approval lifecycle; this table is the envelope. `workflow_id` is a uuid FK to
-- workflow_instances (NOT text). Status is driven by the hr_org_structure adapter
-- (lib/workflow/orgAdapter). Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.hr_org_change_requests (
  id uuid primary key default gen_random_uuid(),
  change_no text unique,

  entity_type text not null check (entity_type in ('org_unit', 'position', 'cost_center')),
  entity_id   text,
  action      text not null,

  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'applied', 'cancelled', 'failed')),

  effective_from timestamptz not null default now(),
  effective_to   timestamptz,

  reason           text,
  rejection_reason text,

  old_state      jsonb not null default '{}'::jsonb,
  new_state      jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,

  workflow_id uuid references public.workflow_instances(id) on delete set null,

  requested_by text references public.app_users(id) on delete set null,
  decided_by   text references public.app_users(id) on delete set null,
  applied_by   text references public.app_users(id) on delete set null,

  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  applied_at   timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists hr_org_cr_entity_idx    on public.hr_org_change_requests(entity_type, entity_id);
create index if not exists hr_org_cr_status_idx     on public.hr_org_change_requests(status);
create index if not exists hr_org_cr_effective_idx  on public.hr_org_change_requests(effective_from);
create index if not exists hr_org_cr_workflow_idx   on public.hr_org_change_requests(workflow_id) where workflow_id is not null;

alter table public.hr_org_change_requests enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
