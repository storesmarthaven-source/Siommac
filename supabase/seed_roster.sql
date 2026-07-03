-- =============================================================================
-- HR Shift / Roster Scheduling — manual seed data
-- Idempotent: safe to run multiple times.
-- Purpose: makes the Roster page render populated on first load.
-- Requires migrations 20260803000000 and 20260803000001 applied.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- =============================================================================

-- ── 1. Shift templates ────────────────────────────────────────────────────────
insert into public.hr_shift_templates
  (id, code, name, starts_at, ends_at, crosses_midnight, break_minutes, paid_hours, colour, is_active, created_by)
values
  ('00000000-0000-0000-0001-000000000001', 'DAY',   'Day Shift',    '07:00:00', '15:00:00', false, 30, 7.5, '#93c5fd', true,
    (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1)),
  ('00000000-0000-0000-0001-000000000002', 'NIGHT', 'Night Shift',  '23:00:00', '07:00:00', true,  30, 7.5, '#a78bfa', true,
    (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1)),
  ('00000000-0000-0000-0001-000000000003', 'EVE',   'Evening Shift','15:00:00', '23:00:00', false, 30, 7.5, '#6ee7b7', true,
    (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1)),
  ('00000000-0000-0000-0001-000000000004', 'SPLIT', 'Split Shift',  '06:00:00', '10:00:00', false, 0,  4.0, '#fcd34d', true,
    (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1))
on conflict (code) do nothing;

-- ── 2. Rotation pattern (4-on-4-off) ─────────────────────────────────────────
insert into public.hr_rotation_patterns
  (id, code, name, cycle_days, pattern, is_active, created_by)
values
  ('00000000-0000-0000-0002-000000000001', '4ON4OFF', '4-On 4-Off (Day)',
   8,
   '[{"dayIndex":0,"shiftTemplateCode":"DAY"},
     {"dayIndex":1,"shiftTemplateCode":"DAY"},
     {"dayIndex":2,"shiftTemplateCode":"DAY"},
     {"dayIndex":3,"shiftTemplateCode":"DAY"},
     {"dayIndex":4,"shiftTemplateCode":"off"},
     {"dayIndex":5,"shiftTemplateCode":"off"},
     {"dayIndex":6,"shiftTemplateCode":"off"},
     {"dayIndex":7,"shiftTemplateCode":"off"}]'::jsonb,
   true,
   (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1)),
  ('00000000-0000-0000-0002-000000000002', 'MON-FRI', 'Standard Mon-Fri',
   7,
   '[{"dayIndex":0,"shiftTemplateCode":"DAY"},
     {"dayIndex":1,"shiftTemplateCode":"DAY"},
     {"dayIndex":2,"shiftTemplateCode":"DAY"},
     {"dayIndex":3,"shiftTemplateCode":"DAY"},
     {"dayIndex":4,"shiftTemplateCode":"DAY"},
     {"dayIndex":5,"shiftTemplateCode":"off"},
     {"dayIndex":6,"shiftTemplateCode":"off"}]'::jsonb,
   true,
   (select id from public.app_users where role in ('hr_manager','admin','superadmin') limit 1))
on conflict (code) do nothing;

-- ── 3. Coverage requirements ──────────────────────────────────────────────────
-- Only seed if hr_shift_templates seed was applied (codes exist).
insert into public.hr_coverage_requirements
  (shift_template_id, required_headcount, day_of_week, is_active)
select t.id, 3, null, true
from public.hr_shift_templates t
where t.code = 'DAY'
  and not exists (
    select 1 from public.hr_coverage_requirements cr
    where cr.shift_template_id = t.id and cr.day_of_week is null
  )
limit 1;

insert into public.hr_coverage_requirements
  (shift_template_id, required_headcount, day_of_week, is_active)
select t.id, 2, null, true
from public.hr_shift_templates t
where t.code = 'NIGHT'
  and not exists (
    select 1 from public.hr_coverage_requirements cr
    where cr.shift_template_id = t.id and cr.day_of_week is null
  )
limit 1;

-- ── 4. Sample draft roster (current month) ────────────────────────────────────
-- Only seed if a project_site exists to attach it to.
do $$
declare
  v_site_id text;
  v_actor   text;
  v_start   date := date_trunc('month', current_date)::date;
  v_end     date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_roster_id uuid;
  v_exists  int;
begin
  select id into v_site_id from public.project_sites limit 1;
  select id into v_actor   from public.app_users where role in ('hr_manager','admin','superadmin') limit 1;
  if v_site_id is null or v_actor is null then return; end if;

  select count(*) into v_exists from public.hr_rosters where site_id = v_site_id and period_start = v_start and status <> 'archived';
  if v_exists > 0 then return; end if;

  insert into public.hr_rosters
    (roster_no, title, site_id, period_start, period_end, status, rotation_pattern_id, created_by)
  values
    ('ROS-2026-0001',
     'Month Roster — ' || to_char(v_start, 'Mon YYYY'),
     v_site_id, v_start, v_end, 'draft',
     '00000000-0000-0000-0002-000000000001',
     v_actor)
  on conflict do nothing
  returning id into v_roster_id;
end$$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
