-- ============================================================================
-- HR Employee Master — additional Create-wizard profile fields (v36 §New Employee)
--
-- app_users is the employee master. These are the v36 Create wizard's
-- identity / employment / organization attributes the schema didn't have.
-- (Preferred Name reuses the existing display_name column.) Non-destructive;
-- app_users RLS + service_role grants already cover new columns.
-- Operator-applied. After applying, NOTIFY pgrst.
-- ============================================================================

alter table public.app_users
  add column if not exists government_id      text,   -- ID / passport number
  add column if not exists probation_end_date date,
  add column if not exists employee_grade     text,
  add column if not exists work_schedule      text,
  add column if not exists cost_center        text;

comment on column public.app_users.government_id      is 'Government ID / passport number (HR Employee Master).';
comment on column public.app_users.probation_end_date is 'Probation end date (HR Employee Master).';
comment on column public.app_users.employee_grade     is 'Employee grade / band (HR Employee Master).';
comment on column public.app_users.work_schedule      is 'Work schedule / shift pattern (HR Employee Master).';
comment on column public.app_users.cost_center        is 'Cost center for the primary assignment (HR Employee Master).';
