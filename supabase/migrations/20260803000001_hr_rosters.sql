-- ============================================================================
-- HR Shift / Roster Scheduling — Roster + Shift Assignments
-- ============================================================================
-- hr_rosters: one per site/dept + period (week/fortnight/month).
-- hr_shift_assignments: employee × date row within a roster.
--
-- Lifecycle: draft → (pending_approval →) published → archived
-- Publish freezes the roster; edits require reopen → re-notify.
-- Unique partial index prevents two non-archived rosters for the same
-- site/dept/period_start overlap (validated in-app with a clear message).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── Rosters ───────────────────────────────────────────────────────────────────
create table if not exists public.hr_rosters (
  id                   uuid primary key default gen_random_uuid(),
  roster_no            text not null unique,
  title                text not null,
  site_id              text not null references public.project_sites(id) on delete restrict,
  department_id        text references public.departments(id) on delete set null,
  period_start         date not null,
  period_end           date not null,
  status               text not null default 'draft'
    check (status in ('draft','pending_approval','returned','published','archived')),
  rotation_pattern_id  uuid references public.hr_rotation_patterns(id) on delete set null,
  workflow_id          uuid references public.workflow_instances(id) on delete set null,
  assignment_count     int not null default 0,
  open_shift_count     int not null default 0,
  created_by           text references public.app_users(id) on delete set null,
  published_by         text references public.app_users(id) on delete set null,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint hr_rosters_period_check check (period_end >= period_start)
);

-- Partial unique: only one active roster (not archived) per site+dept+period_start.
-- Two rosters can share a period_start if one is archived.
create unique index if not exists hr_rosters_active_unique_idx
  on public.hr_rosters(site_id, coalesce(department_id, ''), period_start)
  where status <> 'archived';

create index if not exists hr_rosters_site_idx    on public.hr_rosters(site_id);
create index if not exists hr_rosters_dept_idx    on public.hr_rosters(department_id);
create index if not exists hr_rosters_status_idx  on public.hr_rosters(status);
create index if not exists hr_rosters_period_idx  on public.hr_rosters(period_start, period_end);

alter table public.hr_rosters enable row level security;
grant select, insert, update, delete on public.hr_rosters to service_role;

drop trigger if exists trg_hr_rosters_updated_at on public.hr_rosters;
create trigger trg_hr_rosters_updated_at
  before update on public.hr_rosters
  for each row execute function public.set_updated_at();

-- ── Shift assignments ─────────────────────────────────────────────────────────
-- One row per employee per date per roster. kind = shift|off|leave|open.
create table if not exists public.hr_shift_assignments (
  id                uuid primary key default gen_random_uuid(),
  roster_id         uuid not null references public.hr_rosters(id) on delete cascade,
  employee_id       text not null references public.app_users(id) on delete cascade,
  work_date         date not null,
  shift_template_id uuid references public.hr_shift_templates(id) on delete set null,
  kind              text not null default 'shift'
    check (kind in ('shift','off','leave','open')),
  hours             numeric(5,2),
  note              text,
  source            text not null default 'manual'
    check (source in ('manual','rotation','leave_sync')),
  created_by        text references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (roster_id, employee_id, work_date)
);

create index if not exists hr_shift_assignments_roster_idx    on public.hr_shift_assignments(roster_id);
create index if not exists hr_shift_assignments_employee_idx  on public.hr_shift_assignments(employee_id);
create index if not exists hr_shift_assignments_date_idx      on public.hr_shift_assignments(work_date);
create index if not exists hr_shift_assignments_template_idx  on public.hr_shift_assignments(shift_template_id);

alter table public.hr_shift_assignments enable row level security;
grant select, insert, update, delete on public.hr_shift_assignments to service_role;

drop trigger if exists trg_hr_shift_assignments_updated_at on public.hr_shift_assignments;
create trigger trg_hr_shift_assignments_updated_at
  before update on public.hr_shift_assignments
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
