-- ============================================================================
-- HR Attendance & Timekeeping — core tables (5.1-5.4 ONLY; NOT 5.5)
-- ============================================================================
-- hr_attendance_records     -- daily punch records (raw + computed)
-- hr_timesheets             -- period rollup with workflow approval lifecycle
-- hr_attendance_exceptions  -- computed exceptions per record
-- hr_attendance_corrections -- audited correction log
--
-- NOTE: hr_timesheet_payroll_links (5.5) is NOT created -- it would FK
-- to finance_payroll_runs which does not exist yet. Build when Finance exists.
-- ============================================================================

create table if not exists public.hr_attendance_records (
  id              uuid primary key default gen_random_uuid(),
  record_no       text unique not null,
  employee_id     text not null references public.app_users(id),
  work_date       date not null,
  punch_in_at     timestamptz,
  punch_out_at    timestamptz,
  punch_in_site   text references public.project_sites(id) on delete set null,
  punch_out_site  text references public.project_sites(id) on delete set null,
  punch_in_lat    numeric,
  punch_in_lng    numeric,
  punch_out_lat   numeric,
  punch_out_lng   numeric,
  geofence_violation boolean not null default false,
  photo_in_path   text,
  photo_out_path  text,
  status          text not null check (status in (
    'present','absent','late','half_day','on_leave','holiday','missing_punch','short_hours','over_hours'
  )) default 'absent',
  worked_minutes   integer not null default 0,
  late_minutes     integer not null default 0,
  overtime_minutes integer not null default 0,
  timesheet_id    uuid,
  notes           text,
  source          text not null check (source in ('manual','kiosk','mobile','import')) default 'mobile',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create unique index if not exists hr_attendance_records_emp_date_ux
  on public.hr_attendance_records(employee_id, work_date);
create index if not exists hr_attendance_records_emp_idx  on public.hr_attendance_records(employee_id);
create index if not exists hr_attendance_records_date_idx on public.hr_attendance_records(work_date);
create index if not exists hr_attendance_records_ts_idx   on public.hr_attendance_records(timesheet_id);
create or replace trigger set_updated_at_hr_attendance_records
  before update on public.hr_attendance_records
  for each row execute function public.set_updated_at();
alter table public.hr_attendance_records enable row level security;
grant all on public.hr_attendance_records to service_role;

create table if not exists public.hr_timesheets (
  id             uuid primary key default gen_random_uuid(),
  timesheet_no   text unique not null,
  employee_id    text not null references public.app_users(id),
  period_start   date not null,
  period_end     date not null,
  total_worked_minutes   integer not null default 0,
  total_late_minutes     integer not null default 0,
  total_overtime_minutes integer not null default 0,
  days_present           integer not null default 0,
  days_absent            integer not null default 0,
  days_on_leave          integer not null default 0,
  status         text not null check (status in (
    'draft','submitted','in_review','approved','rejected','reopened'
  )) default 'draft',
  submitted_at   timestamptz,
  submitted_by   text references public.app_users(id),
  approved_by    text references public.app_users(id),
  approved_at    timestamptz,
  rejection_note text,
  workflow_id    uuid references public.workflow_instances(id) on delete set null,
  open_exception_count integer not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create unique index if not exists hr_timesheets_emp_period_ux
  on public.hr_timesheets(employee_id, period_start, period_end);
create index if not exists hr_timesheets_emp_idx    on public.hr_timesheets(employee_id);
create index if not exists hr_timesheets_status_idx on public.hr_timesheets(status);
create or replace trigger set_updated_at_hr_timesheets
  before update on public.hr_timesheets
  for each row execute function public.set_updated_at();
alter table public.hr_timesheets enable row level security;
grant all on public.hr_timesheets to service_role;

alter table public.hr_attendance_records
  add constraint hr_attendance_records_timesheet_fk
  foreign key (timesheet_id) references public.hr_timesheets(id) on delete set null;

create table if not exists public.hr_attendance_exceptions (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references public.hr_attendance_records(id) on delete cascade,
  employee_id    text not null references public.app_users(id),
  work_date      date not null,
  exception_type text not null check (exception_type in (
    'late_arrival','early_departure','absent','missing_punch','short_hours',
    'over_hours','geofence_violation','unapproved_overtime'
  )),
  minutes        integer,
  status         text not null check (status in ('open','waived','resolved')) default 'open',
  waived_by      text references public.app_users(id),
  waived_at      timestamptz,
  waive_reason   text,
  resolved_by    text references public.app_users(id),
  resolved_at    timestamptz,
  resolve_note   text,
  timesheet_id   uuid references public.hr_timesheets(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index if not exists hr_attendance_exc_record_idx    on public.hr_attendance_exceptions(record_id);
create index if not exists hr_attendance_exc_employee_idx  on public.hr_attendance_exceptions(employee_id);
create index if not exists hr_attendance_exc_status_idx    on public.hr_attendance_exceptions(status);
create index if not exists hr_attendance_exc_timesheet_idx on public.hr_attendance_exceptions(timesheet_id);
create or replace trigger set_updated_at_hr_attendance_exceptions
  before update on public.hr_attendance_exceptions
  for each row execute function public.set_updated_at();
alter table public.hr_attendance_exceptions enable row level security;
grant all on public.hr_attendance_exceptions to service_role;

create table if not exists public.hr_attendance_corrections (
  id           uuid primary key default gen_random_uuid(),
  record_id    uuid not null references public.hr_attendance_records(id),
  employee_id  text not null references public.app_users(id),
  work_date    date not null,
  field_name   text not null,
  old_value    text,
  new_value    text,
  reason       text not null,
  corrected_by text not null references public.app_users(id),
  created_at   timestamptz not null default now()
);
create index if not exists hr_attendance_corr_record_idx   on public.hr_attendance_corrections(record_id);
create index if not exists hr_attendance_corr_employee_idx on public.hr_attendance_corrections(employee_id);
alter table public.hr_attendance_corrections enable row level security;
grant all on public.hr_attendance_corrections to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
