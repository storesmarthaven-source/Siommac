-- ============================================================================
-- HR Employee Master — Onboarding (v36 §10)
-- ============================================================================
-- Onboarding cases instantiate a package of tasks (HR / Supervisor / IT / HSE /
-- Training / Payroll) + cross-module handoffs. Backend-only (service-role), gated
-- by hr.onboarding.* in the API. Cross-module handoff DELIVERY (to HSE/Training/
-- Payroll) is a later phase (those receivers aren't built) — handoffs are recorded
-- here as 'pending' + emit onboarding.handoff.created; they are NOT faked-delivered.
--
-- app_users.id is TEXT → employee/owner FKs are TEXT. Run manually, then NOTIFY pgrst.
-- ============================================================================

-- ── cases ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_onboarding_cases (
  id           uuid primary key default gen_random_uuid(),
  case_no      text unique not null,                          -- nextRef('ONB')
  employee_id  text references public.app_users(id) on delete cascade,
  worker_type  text,
  package_key  text not null,
  status       text not null default 'in_progress'
                 check (status in ('in_progress','blocked','completed','cancelled')),
  owner_id     text references public.app_users(id) on delete set null,
  due_at       timestamptz,
  started_by   text references public.app_users(id) on delete set null,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists hr_onboarding_cases_employee_idx on public.hr_onboarding_cases(employee_id, status);

-- ── tasks ─────────────────────────────────────────────────────────────────────
create table if not exists public.hr_onboarding_tasks (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  task_key     text not null,
  task_title   text not null,
  owner_role   text,
  assigned_to  text references public.app_users(id) on delete set null,
  module_key   text,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','completed','skipped','blocked')),
  due_at       timestamptz,
  completed_by text references public.app_users(id) on delete set null,
  completed_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists hr_onboarding_tasks_case_idx on public.hr_onboarding_tasks(case_id, status);

-- ── handoffs (intent records; delivery wired when target receivers exist) ──────
create table if not exists public.hr_onboarding_handoffs (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  target_module text not null,
  handoff_type text,
  status       text not null default 'pending'
                 check (status in ('pending','delivered','cancelled')),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists hr_onboarding_handoffs_case_idx on public.hr_onboarding_handoffs(case_id);

-- ── RLS + grants (backend-only via service_role; grant writes EXPLICITLY) ──────
alter table public.hr_onboarding_cases    enable row level security;
alter table public.hr_onboarding_tasks    enable row level security;
alter table public.hr_onboarding_handoffs enable row level security;

grant select, insert, update, delete on table public.hr_onboarding_cases    to service_role;
grant select, insert, update, delete on table public.hr_onboarding_tasks    to service_role;
grant select, insert, update, delete on table public.hr_onboarding_handoffs to service_role;

-- ── updated_at triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_hr_onboarding_cases_updated_at on public.hr_onboarding_cases;
create trigger trg_hr_onboarding_cases_updated_at before update on public.hr_onboarding_cases for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_onboarding_tasks_updated_at on public.hr_onboarding_tasks;
create trigger trg_hr_onboarding_tasks_updated_at before update on public.hr_onboarding_tasks for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_onboarding_handoffs_updated_at on public.hr_onboarding_handoffs;
create trigger trg_hr_onboarding_handoffs_updated_at before update on public.hr_onboarding_handoffs for each row execute function public.set_updated_at();

-- ── permission seed (v36 §12) — start/manage/cancel = full HR roles; view incl. manager ──
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.view'),('admin','hr.onboarding.view'),('manager','hr.onboarding.view'),('hr_manager','hr.onboarding.view'),
  ('superadmin','hr.onboarding.start'),('admin','hr.onboarding.start'),('hr_manager','hr.onboarding.start'),
  ('superadmin','hr.onboarding.task.manage'),('admin','hr.onboarding.task.manage'),('hr_manager','hr.onboarding.task.manage'),
  ('superadmin','hr.onboarding.cancel'),('admin','hr.onboarding.cancel'),('hr_manager','hr.onboarding.cancel')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
