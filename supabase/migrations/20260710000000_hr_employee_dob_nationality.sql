-- ============================================================================
-- HR Employee Master — Date of Birth + Nationality (v36 §Profile · Personal Summary)
--
-- app_users IS the employee master (no fork). These are personal-identity
-- columns the v36 Employee Profile shows but the schema didn't have yet.
-- Added non-destructively; RLS + grants on app_users already cover them.
-- Operator-applied (no DDL channel from the app). After applying, NOTIFY pgrst.
-- ============================================================================

alter table public.app_users add column if not exists date_of_birth date;
alter table public.app_users add column if not exists nationality   text;

comment on column public.app_users.date_of_birth is 'Employee date of birth (HR Employee Master · Personal Summary).';
comment on column public.app_users.nationality   is 'Employee nationality (HR Employee Master · Personal Summary).';
