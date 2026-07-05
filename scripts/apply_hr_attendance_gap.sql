-- ============================================================================
-- Consolidated apply bundle: HR Attendance & Timekeeping (genuinely missing)
-- ============================================================================
-- Root cause: the original hr_attendance_* migrations (2026-07-31) were never
-- applied to this database instance -- hr_attendance_records/_exceptions/
-- _corrections/hr_timesheets all return PGRST205 'table not found in schema
-- cache' on direct query (confirmed via service-role client, not just a
-- head:true count). This mirrors the earlier Finance payroll-phase-3 gap:
-- a pre-existing operator-apply gap, not something this session introduced.
--
-- Apply this whole file in the Supabase SQL editor, in one go, then run:
--   NOTIFY pgrst, 'reload schema';
-- (also included at the end of this bundle)
-- ============================================================================

-- ── supabase/migrations/20260731000000_hr_attendance_core.sql ──────────────────────────────────────────────
-- ============================================================================
-- HR Attendance & Timekeeping � core tables (5.1-5.4 ONLY; NOT 5.5)
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

-- ── supabase/migrations/20260731000001_hr_attendance_permissions.sql ──────────────────────────────────────────────
-- ============================================================================
-- HR Attendance & Timekeeping -- permissions (keys + DB grants)
-- ============================================================================
-- Keys: hr.attendance.{view,view_all,punch,correct}
--       hr.attendance.timesheets.{view,submit,approve}
--       hr.attendance.exceptions.{view,manage}
--       hr.attendance.compute.run
--       hr.attendance.policy.manage
--       hr.attendance.reports.{view,export}
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: punch own time; view own records; submit own timesheet; view own exceptions
  ('employee',   'hr.attendance.view'),
  ('employee',   'hr.attendance.punch'),
  ('employee',   'hr.attendance.timesheets.view'),
  ('employee',   'hr.attendance.timesheets.submit'),
  ('employee',   'hr.attendance.exceptions.view'),

  -- manager: view all under dept; correct; approve timesheets; manage exceptions
  ('manager',    'hr.attendance.view'),
  ('manager',    'hr.attendance.view_all'),
  ('manager',    'hr.attendance.punch'),
  ('manager',    'hr.attendance.correct'),
  ('manager',    'hr.attendance.timesheets.view'),
  ('manager',    'hr.attendance.timesheets.submit'),
  ('manager',    'hr.attendance.timesheets.approve'),
  ('manager',    'hr.attendance.exceptions.view'),
  ('manager',    'hr.attendance.exceptions.manage'),
  ('manager',    'hr.attendance.reports.view'),

  -- hr_staff: view all; correct; manage exceptions; view reports
  ('hr_staff',   'hr.attendance.view'),
  ('hr_staff',   'hr.attendance.view_all'),
  ('hr_staff',   'hr.attendance.punch'),
  ('hr_staff',   'hr.attendance.correct'),
  ('hr_staff',   'hr.attendance.timesheets.view'),
  ('hr_staff',   'hr.attendance.timesheets.submit'),
  ('hr_staff',   'hr.attendance.timesheets.approve'),
  ('hr_staff',   'hr.attendance.exceptions.view'),
  ('hr_staff',   'hr.attendance.exceptions.manage'),
  ('hr_staff',   'hr.attendance.compute.run'),
  ('hr_staff',   'hr.attendance.reports.view'),
  ('hr_staff',   'hr.attendance.reports.export'),

  -- hr_manager: full attendance management including policy
  ('hr_manager', 'hr.attendance.view'),
  ('hr_manager', 'hr.attendance.view_all'),
  ('hr_manager', 'hr.attendance.punch'),
  ('hr_manager', 'hr.attendance.correct'),
  ('hr_manager', 'hr.attendance.timesheets.view'),
  ('hr_manager', 'hr.attendance.timesheets.submit'),
  ('hr_manager', 'hr.attendance.timesheets.approve'),
  ('hr_manager', 'hr.attendance.exceptions.view'),
  ('hr_manager', 'hr.attendance.exceptions.manage'),
  ('hr_manager', 'hr.attendance.compute.run'),
  ('hr_manager', 'hr.attendance.policy.manage'),
  ('hr_manager', 'hr.attendance.reports.view'),
  ('hr_manager', 'hr.attendance.reports.export'),

  -- admin: all
  ('admin',      'hr.attendance.view'),
  ('admin',      'hr.attendance.view_all'),
  ('admin',      'hr.attendance.punch'),
  ('admin',      'hr.attendance.correct'),
  ('admin',      'hr.attendance.timesheets.view'),
  ('admin',      'hr.attendance.timesheets.submit'),
  ('admin',      'hr.attendance.timesheets.approve'),
  ('admin',      'hr.attendance.exceptions.view'),
  ('admin',      'hr.attendance.exceptions.manage'),
  ('admin',      'hr.attendance.compute.run'),
  ('admin',      'hr.attendance.policy.manage'),
  ('admin',      'hr.attendance.reports.view'),
  ('admin',      'hr.attendance.reports.export'),

  -- superadmin: all
  ('superadmin', 'hr.attendance.view'),
  ('superadmin', 'hr.attendance.view_all'),
  ('superadmin', 'hr.attendance.punch'),
  ('superadmin', 'hr.attendance.correct'),
  ('superadmin', 'hr.attendance.timesheets.view'),
  ('superadmin', 'hr.attendance.timesheets.submit'),
  ('superadmin', 'hr.attendance.timesheets.approve'),
  ('superadmin', 'hr.attendance.exceptions.view'),
  ('superadmin', 'hr.attendance.exceptions.manage'),
  ('superadmin', 'hr.attendance.compute.run'),
  ('superadmin', 'hr.attendance.policy.manage'),
  ('superadmin', 'hr.attendance.reports.view'),
  ('superadmin', 'hr.attendance.reports.export')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ── supabase/migrations/20260731000002_workflow_hr_attendance_binding.sql ──────────────────────────────────────────────
-- ============================================================================
-- HR Attendance & Timekeeping -- workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key: hr_attendance
-- Workflow type: hr_timesheet_approval
-- Trigger event: hr.timesheet.submitted
--
-- The engine throws "no published version" if this binding has none,
-- so we must publish v1 here. The null-binding fallback in submitTimesheet
-- (workflow == null -> status approved) handles the case where selectWorkflowBinding
-- returns null (e.g. binding deactivated).
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. template
  select id into tpl_id from public.workflow_templates
    where template_key = 'hr_timesheet_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_timesheet_approval', 'hr_attendance', 'hr_timesheet_approval',
       'HR Timesheet Approval', 'Manager approval of employee timesheets.', 'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_attendance', workflow_type = 'hr_timesheet_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 -- single manager-approval step; linear, completes on approve
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey', 'manager_approval',
          'stepName', 'Manager Approval',
          'stepType', 'approval',
          'sequenceNo', 1,
          'assignment', jsonb_build_object('type', 'department_manager'),
          'dueDurationHours', 72,
          'required', true,
          'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'in_review',
        'onCompleted', 'approved',
        'onReturned',  'draft',
        'onRejected',  'rejected',
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

  -- 3. global binding
  delete from public.module_workflow_bindings
    where module_key = 'hr_attendance'
      and workflow_type = 'hr_timesheet_approval'
      and trigger_event = 'hr.timesheet.submitted'
      and scope_type = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_attendance', 'hr_timesheet_approval', 'hr.timesheet.submitted', tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ── supabase/migrations/20260731000003_hr_attendance_storage_policies.sql ──────────────────────────────────────────────
-- ============================================================================
-- HR Attendance & Timekeeping -- private storage bucket + policies
-- ============================================================================
-- Creates the hr-attendance-photos private bucket for punch-evidence photos.
-- Presigned upload/read URLs are generated server-side (routes/hrAttendance.ts).
-- Signed URLs only; the bucket is NOT public.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-attendance-photos',
  'hr-attendance-photos',
  false,
  6291456,  -- 6 MB
  array['image/jpeg','image/jpg','image/png','image/webp']
)
on conflict (id) do update
  set public              = excluded.public,
      file_size_limit     = excluded.file_size_limit,
      allowed_mime_types  = excluded.allowed_mime_types;

-- service_role can manage objects (used for presigned URL generation + server reads)
create policy "hr_attendance_photos_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'hr-attendance-photos')
  with check (bucket_id = 'hr-attendance-photos');

-- No public read access -- all access via presigned signed URLs only

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ── supabase/migrations/20260731000004_hr_attendance_settings.sql ──────────────────────────────────────────────
-- ============================================================================
-- HR Attendance & Timekeeping -- settings catalog defaults
-- ============================================================================
-- Seeds app_setting_catalog rows for the hrAttendance manifest.
-- The application resolveSettingValue resolves these defaults; admins can
-- override via the Settings UI.
-- ============================================================================

insert into public.app_setting_catalog
  (setting_key, module_key, label, description, data_type, default_value,
   is_active, scope, user_override_allowed, role_override_allowed,
   site_override_allowed, department_override_allowed, module_override_allowed,
   requires_permission)
values
  ('hr_attendance.enabled',                  'hr_attendance', 'Attendance Module Enabled',
   'Master switch for the HR Attendance & Timekeeping module.',
   'boolean', 'true', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.shift_start',              'hr_attendance', 'Shift Start Time',
   'Default shift start time in HH:MM (24-hour). Used by computeDay to calculate lateness.',
   'string', '"08:00"', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.grace_minutes',            'hr_attendance', 'Grace Period (minutes)',
   'Minutes after shift_start within which a punch-in is NOT flagged as late.',
   'number', '5', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.standard_day_minutes',     'hr_attendance', 'Standard Day (minutes)',
   'Full-day worked-minutes threshold. Records below this (and above short_hours) may flag short_hours.',
   'number', '480', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.overtime_threshold_minutes','hr_attendance', 'Overtime Threshold (minutes)',
   'Worked minutes above which time is counted as overtime.',
   'number', '480', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.rounding_minutes',         'hr_attendance', 'Punch Rounding (minutes)',
   'Round punch times to the nearest N minutes. Set 0 to disable rounding.',
   'number', '0', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.workweek',                 'hr_attendance', 'Workweek Days',
   'JSON array of workday numbers (0=Sun ... 6=Sat). Default Mon-Fri.',
   'string', '"[1,2,3,4,5]"', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.geofence_radius_m',        'hr_attendance', 'Geofence Radius (metres)',
   'Maximum distance in metres from site centre for a punch to be within the geofence.',
   'number', '100', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.pay_period',               'hr_attendance', 'Pay Period',
   'Period for timesheet roll-up: weekly, biweekly, or monthly.',
   'string', '"biweekly"', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage')

on conflict (setting_key) do update
  set label                      = excluded.label,
      description                = excluded.description,
      default_value              = excluded.default_value,
      is_active                  = excluded.is_active,
      requires_permission        = excluded.requires_permission;

-- After applying, run: NOTIFY pgrst, 'reload schema';

NOTIFY pgrst, 'reload schema';
