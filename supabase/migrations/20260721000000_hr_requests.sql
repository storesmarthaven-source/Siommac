-- ============================================================================
-- HR Requests (Request Center) — hr_requests table
-- ============================================================================
-- Self-service requests from employees (employment letters, document copies,
-- profile corrections, general inquiries) routed through the central workflow
-- engine. employee_id is the SUBJECT/requester; self-scope is enforced in the
-- application layer (routes/hrRequests.ts).
--
-- After applying, run:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.hr_requests (
  id               uuid primary key default gen_random_uuid(),
  request_no       text unique not null,                           -- nextRef('REQ') e.g. REQ-0001
  employee_id      text not null references public.app_users(id) on delete cascade,  -- the requester/subject
  request_type     text not null,                                  -- catalogue key validated in app layer
  title            text not null,
  details          jsonb not null default '{}'::jsonb,             -- type-specific payload
  status           text not null default 'submitted'
    check (status in ('draft','submitted','in_review','returned','approved','rejected','fulfilled','cancelled')),
  priority         text not null default 'normal'
    check (priority in ('low','normal','high')),
  workflow_id      uuid references public.workflow_instances(id) on delete set null,  -- uuid FK (not text)
  requested_by     text not null references public.app_users(id) on delete set null,  -- usually = employee_id
  decided_by       text references public.app_users(id) on delete set null,
  fulfilled_by     text references public.app_users(id) on delete set null,
  decision_comment text,
  resolution       jsonb not null default '{}'::jsonb,             -- artifact ref / fulfillment note
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

-- set_updated_at trigger (same function used by all other HR tables)
drop trigger if exists trg_hr_requests_updated_at on public.hr_requests;
create trigger trg_hr_requests_updated_at
  before update on public.hr_requests
  for each row execute function public.set_updated_at();

-- After applying, run:  NOTIFY pgrst, 'reload schema';
