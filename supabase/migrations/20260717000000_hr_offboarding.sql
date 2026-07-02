-- ============================================================================
-- HR Offboarding — the exit bookend of the employee lifecycle
-- ============================================================================
-- A dedicated hr_offboarding_* domain (NOT a discriminator on onboarding). Cases
-- instantiate a standard exit plan of tasks + cross-module handoffs by reason.
-- The genuinely-inverse piece is FINALIZE: it terminates the employee (status →
-- terminated, auth synced to inactive) and raises an IT access-removal handoff
-- (recorded 'pending' — the inverse of onboarding's account-provisioning handoff;
-- never faked). app_users.id is TEXT → employee/owner FKs are TEXT. Backend-only
-- (service-role), gated by hr.offboarding.* in the API. Run manually, then NOTIFY pgrst.
-- ============================================================================

-- ── cases ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_cases (
  id                 uuid primary key default gen_random_uuid(),
  case_no            text unique not null,                       -- nextRef('OFB')
  employee_id        text references public.app_users(id) on delete cascade,
  reason             text not null
                       check (reason in ('resignation','termination','redundancy','end_of_contract','retirement')),
  package_key        text not null default 'standard_exit',
  status             text not null default 'in_progress'
                       check (status in ('draft','open','in_progress','blocked','paused','ready_for_exit','completed','cancelled')),
  owner_id           text references public.app_users(id) on delete set null,
  last_working_day   date,
  exit_date          date,
  notice_period_days integer,
  started_by         text references public.app_users(id) on delete set null,
  started_at         timestamptz not null default now(),
  ready_at           timestamptz,
  completed_at       timestamptz,
  paused_at          timestamptz,
  cancelled_by       text references public.app_users(id) on delete set null,
  cancelled_at       timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);
create index if not exists hr_offboarding_cases_employee_idx on public.hr_offboarding_cases(employee_id, status);

-- ── tasks ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_tasks (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  task_key     text not null,
  task_title   text not null,
  owner_role   text,
  assigned_to  text references public.app_users(id) on delete set null,
  module_key   text,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','completed','skipped','blocked')),
  is_blocking  boolean not null default false,
  sort_order   integer not null default 0,
  due_at       timestamptz,
  completed_by text references public.app_users(id) on delete set null,
  completed_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists hr_offboarding_tasks_case_idx on public.hr_offboarding_tasks(case_id, status);

-- ── handoffs (intent records; delivery wired when target receivers exist) ──────
create table if not exists public.hr_offboarding_handoffs (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  handoff_key   text,
  target_module text not null,
  handoff_type  text,
  status        text not null default 'pending'
                  check (status in ('pending','delivered','cancelled')),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index if not exists hr_offboarding_handoffs_case_idx on public.hr_offboarding_handoffs(case_id);

-- ── blockers ────────────────────────────────────────────────────────────────
create table if not exists public.hr_offboarding_blockers (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.hr_offboarding_cases(id) on delete cascade,
  blocker_key    text,
  title          text not null,
  blocking_module text,
  severity       text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status         text not null default 'open' check (status in ('open','resolved','waived')),
  owner_id       text references public.app_users(id) on delete set null,
  due_at         timestamptz,
  resolved_by    text references public.app_users(id) on delete set null,
  resolved_at    timestamptz,
  waiver_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index if not exists hr_offboarding_blockers_case_idx on public.hr_offboarding_blockers(case_id, status);

-- ── RLS + grants (backend-only via service_role) ───────────────────────────────
alter table public.hr_offboarding_cases    enable row level security;
alter table public.hr_offboarding_tasks    enable row level security;
alter table public.hr_offboarding_handoffs enable row level security;
alter table public.hr_offboarding_blockers enable row level security;

grant select, insert, update, delete on table public.hr_offboarding_cases    to service_role;
grant select, insert, update, delete on table public.hr_offboarding_tasks    to service_role;
grant select, insert, update, delete on table public.hr_offboarding_handoffs to service_role;
grant select, insert, update, delete on table public.hr_offboarding_blockers to service_role;

-- ── updated_at triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_hr_offboarding_cases_updated_at on public.hr_offboarding_cases;
create trigger trg_hr_offboarding_cases_updated_at before update on public.hr_offboarding_cases for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_tasks_updated_at on public.hr_offboarding_tasks;
create trigger trg_hr_offboarding_tasks_updated_at before update on public.hr_offboarding_tasks for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_handoffs_updated_at on public.hr_offboarding_handoffs;
create trigger trg_hr_offboarding_handoffs_updated_at before update on public.hr_offboarding_handoffs for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_offboarding_blockers_updated_at on public.hr_offboarding_blockers;
create trigger trg_hr_offboarding_blockers_updated_at before update on public.hr_offboarding_blockers for each row execute function public.set_updated_at();

-- ── permission seed (hr.offboarding.*) ─────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.offboarding.view'),('admin','hr.offboarding.view'),('manager','hr.offboarding.view'),('hr_manager','hr.offboarding.view'),('hr_staff','hr.offboarding.view'),
  ('superadmin','hr.offboarding.start'),('admin','hr.offboarding.start'),('hr_manager','hr.offboarding.start'),('hr_staff','hr.offboarding.start'),
  ('superadmin','hr.offboarding.task.manage'),('admin','hr.offboarding.task.manage'),('hr_manager','hr.offboarding.task.manage'),('hr_staff','hr.offboarding.task.manage'),
  ('superadmin','hr.offboarding.case.manage'),('admin','hr.offboarding.case.manage'),('hr_manager','hr.offboarding.case.manage'),('hr_staff','hr.offboarding.case.manage'),
  ('superadmin','hr.offboarding.complete'),('admin','hr.offboarding.complete'),('hr_manager','hr.offboarding.complete'),
  ('superadmin','hr.offboarding.finalize'),('admin','hr.offboarding.finalize'),('hr_manager','hr.offboarding.finalize'),
  ('superadmin','hr.offboarding.cancel'),('admin','hr.offboarding.cancel'),('hr_manager','hr.offboarding.cancel'),
  ('superadmin','hr.offboarding.audit.view'),('admin','hr.offboarding.audit.view'),('hr_manager','hr.offboarding.audit.view')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
