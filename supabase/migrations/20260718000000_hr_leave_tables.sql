-- ============================================================================
-- HR Leave & Absence — core tables (Spec §HR-Leave)
-- ============================================================================
-- hr_leave_types       — configurable leave type catalogue
-- hr_leave_requests    — individual leave applications (the main entity)
-- hr_leave_balances    — per-employee per-type per-year snapshot (recomputed)
-- hr_leave_accruals    — append-only ledger (accrual/deduction/release/adjustment/pending_reserve)
-- hr_leave_attachments — supporting documents for a leave request
-- ============================================================================

create table if not exists public.hr_leave_types (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique not null,
  label               text not null,
  paid                boolean not null default true,
  unit                text not null check (unit in ('days','hours')) default 'days',
  requires_attachment boolean not null default false,
  requires_approval   boolean not null default true,
  accrual_rate        numeric,
  accrual_cadence     text not null check (accrual_cadence in ('none','monthly','annual')) default 'annual',
  max_carryover       numeric,
  applies_to_scope    text not null check (applies_to_scope in ('all','role','employment_type','department')) default 'all',
  applies_to_value    text,
  color               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
create or replace trigger set_updated_at_hr_leave_types
  before update on public.hr_leave_types
  for each row execute function public.set_updated_at();
alter table public.hr_leave_types enable row level security;
grant all on public.hr_leave_types to service_role;

create table if not exists public.hr_leave_requests (
  id              uuid primary key default gen_random_uuid(),
  case_no         text unique not null,
  employee_id     text not null references public.app_users(id),
  leave_type_id   uuid not null references public.hr_leave_types(id),
  from_date       date not null,
  to_date         date not null,
  unit            text not null check (unit in ('days','hours')) default 'days',
  days            numeric,
  hours           numeric,
  half_day        boolean not null default false,
  reason          text,
  status          text not null check (status in ('draft','pending_approval','approved','rejected','cancelled')) default 'pending_approval',
  workflow_id     uuid references public.workflow_instances(id) on delete set null,
  department_id   text,
  reviewed_by     text references public.app_users(id),
  reviewed_at     timestamptz,
  review_notes    text,
  applied_at      timestamptz default now(),
  cancelled_by    text references public.app_users(id),
  cancelled_at    timestamptz,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create or replace trigger set_updated_at_hr_leave_requests
  before update on public.hr_leave_requests
  for each row execute function public.set_updated_at();
create index if not exists hr_leave_requests_employee_id_idx on public.hr_leave_requests(employee_id);
create index if not exists hr_leave_requests_status_idx      on public.hr_leave_requests(status);
create index if not exists hr_leave_requests_from_date_idx   on public.hr_leave_requests(from_date);
alter table public.hr_leave_requests enable row level security;
grant all on public.hr_leave_requests to service_role;

create table if not exists public.hr_leave_balances (
  id            uuid primary key default gen_random_uuid(),
  employee_id   text not null references public.app_users(id),
  leave_type_id uuid not null references public.hr_leave_types(id),
  year          int not null,
  entitled      numeric not null default 0,
  accrued       numeric not null default 0,
  taken         numeric not null default 0,
  pending       numeric not null default 0,
  adjustment    numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique(employee_id, leave_type_id, year)
);
create or replace trigger set_updated_at_hr_leave_balances
  before update on public.hr_leave_balances
  for each row execute function public.set_updated_at();
alter table public.hr_leave_balances enable row level security;
grant all on public.hr_leave_balances to service_role;

create table if not exists public.hr_leave_accruals (
  id                uuid primary key default gen_random_uuid(),
  employee_id       text not null references public.app_users(id),
  leave_type_id     uuid not null references public.hr_leave_types(id),
  year              int not null,
  delta             numeric not null,
  kind              text not null check (kind in ('accrual','deduction','release','adjustment','pending_reserve')),
  idempotency_key   text unique not null,
  source_request_id uuid references public.hr_leave_requests(id) on delete set null,
  note              text,
  created_by        text references public.app_users(id),
  created_at        timestamptz not null default now()
);
create index if not exists hr_leave_accruals_employee_id_year_idx  on public.hr_leave_accruals(employee_id, year);
create index if not exists hr_leave_accruals_source_request_id_idx on public.hr_leave_accruals(source_request_id);
alter table public.hr_leave_accruals enable row level security;
grant all on public.hr_leave_accruals to service_role;

create table if not exists public.hr_leave_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.hr_leave_requests(id) on delete cascade,
  file_path    text not null,
  file_name    text not null,
  mime_type    text,
  uploaded_by  text references public.app_users(id),
  uploaded_at  timestamptz not null default now()
);
alter table public.hr_leave_attachments enable row level security;
grant all on public.hr_leave_attachments to service_role;

-- After applying: NOTIFY pgrst, 'reload schema';
