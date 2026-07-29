-- ============================================================================
-- Employee Profile — notice period as an effective-dated employment condition
-- ============================================================================
-- The locked drawer's Employment Terms card shows "Notice Period". It had NO
-- source anywhere in the schema: the only notice-shaped data in the build lives
-- on an offboarding CASE, which is the notice actually served when someone
-- leaves — not the contractual notice this employee's terms carry while they are
-- employed. Reading that would have shown an empty value for every current
-- employee and a departure-specific one for leavers.
--
-- It therefore belongs on `hr_employee_assignments`, the canonical effective-
-- dated employment record, alongside `weekly_hours` and `fte`. Putting it on
-- app_users would destroy the previous value on every change, so a historical
-- assignment period could no longer answer "what notice applied then?".
--
-- Stored in DAYS rather than a free-text label ("One Month") so it can be
-- compared, validated and used in a calculation. The UI formats it.
--
-- Operator-applied. The schema reload is executed by the migration itself.
-- ============================================================================

alter table public.hr_employee_assignments
  add column if not exists notice_period_days integer;

comment on column public.hr_employee_assignments.notice_period_days
  is 'Contractual notice period in days for this assignment period. NULL means not recorded — never assume a statutory default.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_assignments_notice_period_range'
  ) then
    alter table public.hr_employee_assignments
      add constraint hr_assignments_notice_period_range
      -- 0 is meaningful (immediate termination clauses exist); the upper bound
      -- catches a value entered in the wrong unit, e.g. months typed as days.
      check (notice_period_days is null or (notice_period_days >= 0 and notice_period_days <= 730));
  end if;
end $$;

notify pgrst, 'reload schema';
