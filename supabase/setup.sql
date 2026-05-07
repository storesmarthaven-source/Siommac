-- ============================================================
-- Siomac Attendance System — Database Setup / Reset SQL
-- Run this in Supabase SQL Editor AFTER running schema.sql
-- ============================================================

-- ── 1. Correct all settings (safe to run multiple times) ──
insert into public.settings (key, value, updated_at) values
  ('companyName',       'My Company',  now()),
  ('workStartHour',     '6',           now()),
  ('workEndHour',       '22',          now()),
  ('lateThresholdHHMM', '09:00',       now()),
  ('maxDistanceM',      '200',         now()),
  ('currency',          'TT',          now()),
  ('companyLogoUrl',    '',            now()),
  ('latePenaltyPerDay', '0',           now()),
  ('leaveFinePerDay',   '0',           now())
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- ── 2. Departments (safe to run multiple times) ──
insert into public.departments (id, name, description) values
  ('DEPT-001', 'Operations',     'Field operations team'),
  ('DEPT-002', 'Administration', 'Office and administrative team'),
  ('DEPT-003', 'Engineering',    'Technical and engineering team'),
  ('DEPT-004', 'Finance',        'Accounts and finance team')
on conflict (id) do nothing;

-- ── 3. Create demo users ──
-- After running this SQL, call the Netlify function to create hashed-password users:
--
--   curl -s -X POST https://<your-site>.netlify.app/api \
--     -H "Content-Type: application/json" \
--     -d '{"action":"setupDemoUsers","args":{}}'
--
-- This creates:
--   admin / admin123    (Administrator)
--   manager1 / manager123
--   employee1 / emp123
--
-- Or just log in immediately if admin already exists from a previous setupDemoUsers call.

-- ── 4. Fix stale currency/companyName from old Pakistan seed ──
-- (safe to run anytime — just corrects wrong values)
update public.settings set value = 'TT',         updated_at = now() where key = 'currency'    and value in ('Rs.','Rs');
update public.settings set value = 'My Company', updated_at = now() where key = 'companyName' and value in ('Rameez Scripts','ZKB');
delete from public.settings where key = 'projectAreaCenter';

-- ── 5. Remove old Pakistan project sites from the live map ──
-- Deletes any site whose latitude is in the Pakistan range (23–37°N, 60–77°E).
-- Safe to run multiple times — only affects Pakistan-coordinate rows.
delete from public.project_sites
where latitude between 23 and 37
  and longitude between 60 and 77;
