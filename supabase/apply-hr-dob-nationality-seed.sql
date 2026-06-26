-- ============================================================================
-- HR Employee Master — Date of Birth + Nationality + demo avatars (demo data)
--
-- Populates the v36 Personal Summary fields + a profile photo for the demo
-- employees so the register + profile render complete. Idempotent: UPDATEs
-- existing app_users and is safe to re-run. Run AFTER migration
-- 20260710000000_hr_employee_dob_nationality.
--
-- Avatars use the real `profile_image_url` path (the FE shows it, else initials),
-- so this only affects demo rows — production employees still fall back to
-- initials until they upload a real avatar. Deterministic portrait per person
-- (i.pravatar.cc seeded by email), matching the v36 mockup's avatarSrc().
-- ============================================================================

update public.app_users set date_of_birth = d.dob, nationality = d.nat
from (values
  ('usr-001'::text, date '1986-03-14', 'Trinidadian'),
  ('usr-002',       date '1982-07-22', 'Trinidadian'),
  ('usr-003',       date '1990-11-05', 'Venezuelan'),
  ('usr-004',       date '1992-01-30', 'Trinidadian'),
  ('usr-005',       date '1988-09-12', 'Chinese'),
  ('usr-006',       date '1991-05-19', 'Trinidadian'),
  ('usr-007',       date '1989-02-19', 'Guinean'),
  ('usr-008',       date '1993-06-08', 'Venezuelan'),
  ('usr-009',       date '1980-12-01', 'Nigerian'),
  ('usr-010',       date '1994-04-17', 'Trinidadian'),
  ('usr-011',       date '1990-08-25', 'Trinidadian'),
  ('usr-012',       date '1995-10-03', 'Trinidadian'),
  ('usr-013',       date '1996-07-11', 'Trinidadian'),
  ('usr-014',       date '1984-03-28', 'Trinidadian'),
  ('usr-015',       date '1992-12-09', 'Trinidadian')
) as d(id, dob, nat)
where public.app_users.id = d.id;

-- Sensible default for any remaining employees without a nationality (T&T company).
update public.app_users set nationality = 'Trinidadian'
where nationality is null and role <> 'superadmin';

-- Demo profile photos — deterministic per person, only where none is uploaded.
update public.app_users
set profile_image_url = 'https://i.pravatar.cc/160?u=' || coalesce(email, username)
where profile_image_url is null and role <> 'superadmin';

-- Demo employment attributes (grade by role · standard schedule · cost center).
update public.app_users
set employee_grade = case when role = 'manager' then 'Manager' when role = 'supervisor' then 'Supervisor' else 'Grade 2' end,
    work_schedule  = 'Day Shift'
where employee_grade is null and role <> 'superadmin';

update public.app_users set cost_center = 'OPS-210'
where cost_center is null and role <> 'superadmin';
