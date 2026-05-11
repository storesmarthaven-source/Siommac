-- ─────────────────────────────────────────────────────────────────────────────
-- Payroll dummy data seed — Trinidad & Tobago
-- Run this in the Supabase SQL editor (project → SQL Editor → New query).
-- Safe to run multiple times (uses ON CONFLICT / UPDATE WHERE).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Assign payroll settings to all active non-admin employees ─────────────
-- We spread employees across the four pay cycles with realistic TTD salaries/rates.

UPDATE public.app_users
SET
  pay_cycle                   = 'monthly',
  pay_basis                   = 'salary',
  monthly_salary              = 8500.00,
  hourly_rate                 = 0,
  standard_hours_per_day      = 8,
  nis_applicable              = true,
  health_surcharge_applicable = true,
  tax_resident                = true
WHERE role IN ('employee', 'manager')
  AND status = 'active';

-- ─── 2. Spread a sample across different cycles / bases ──────────────────────
-- Grab the first 3 employees and make them weekly-hourly workers
-- (we use a CTE so it works regardless of actual usernames)

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY full_name) AS rn
  FROM public.app_users
  WHERE role = 'employee' AND status = 'active'
)
UPDATE public.app_users u
SET
  pay_cycle              = 'weekly',
  pay_basis              = 'hourly',
  hourly_rate            = 45.00,
  monthly_salary         = 0,
  standard_hours_per_day = 8
FROM ranked r
WHERE u.id = r.id AND r.rn <= 3;

-- Make the next 2 employees fortnightly-salary
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY full_name) AS rn
  FROM public.app_users
  WHERE role = 'employee' AND status = 'active'
)
UPDATE public.app_users u
SET
  pay_cycle              = 'fortnightly',
  pay_basis              = 'salary',
  monthly_salary         = 11200.00,
  hourly_rate            = 0,
  standard_hours_per_day = 8
FROM ranked r
WHERE u.id = r.id AND r.rn BETWEEN 4 AND 5;

-- Make the next 2 employees daily-hourly (casual workers)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY full_name) AS rn
  FROM public.app_users
  WHERE role = 'employee' AND status = 'active'
)
UPDATE public.app_users u
SET
  pay_cycle              = 'daily',
  pay_basis              = 'hourly',
  hourly_rate            = 38.50,
  monthly_salary         = 0,
  standard_hours_per_day = 8
FROM ranked r
WHERE u.id = r.id AND r.rn BETWEEN 6 AND 7;

-- Managers get a higher monthly salary
UPDATE public.app_users
SET
  pay_cycle              = 'monthly',
  pay_basis              = 'salary',
  monthly_salary         = 18500.00,
  hourly_rate            = 0,
  standard_hours_per_day = 8
WHERE role = 'manager' AND status = 'active';

-- ─── 3. Attendance records for May 2026 (weekdays only) ──────────────────────
-- Insert realistic check-in/check-out records for May 1–9, 2026.
-- Uses INSERT … ON CONFLICT DO NOTHING so safe to re-run.
-- We generate one row per (user, date) for all active non-admin employees.

INSERT INTO public.attendance
  (user_id, username, work_date, check_in_time, check_out_time, total_hours, status, check_in_site_id)
SELECT
  u.id                                                                           AS user_id,
  u.username,
  d.work_date,
  (d.work_date::date + TIME '07:45:00' + (RANDOM() * INTERVAL '30 minutes'))    AS check_in_time,
  (d.work_date::date + TIME '16:15:00' + (RANDOM() * INTERVAL '45 minutes'))    AS check_out_time,
  ROUND((8.0 + RANDOM() * 1.5)::NUMERIC, 2)                                     AS total_hours,
  CASE WHEN RANDOM() < 0.08 THEN 'late' ELSE 'present' END                      AS status,
  (SELECT id FROM public.project_sites LIMIT 1)                                 AS check_in_site_id
FROM public.app_users u
CROSS JOIN (
  VALUES
    ('2026-05-01'::date),
    ('2026-05-04'::date),
    ('2026-05-05'::date),
    ('2026-05-06'::date),
    ('2026-05-07'::date),
    ('2026-05-08'::date),
    ('2026-05-09'::date)
) AS d(work_date)
WHERE u.role IN ('employee', 'manager')
  AND u.status = 'active'
ON CONFLICT (user_id, work_date) DO NOTHING;

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- After running:
--   1. Go to Payroll page in the app.
--   2. Set date range 2026-05-01 → 2026-05-31 and click "Run Payroll".
--   3. You should see all active employees with calculated gross / deductions / net.
