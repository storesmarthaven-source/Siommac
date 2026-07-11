-- ============================================================================
-- Calendar & Tasks — demo seed (populates the calendar page + widgets)
-- ============================================================================
-- Standing, idempotent demo dataset so the Calendar renders populated for manual
-- review instead of an empty month. Separate from scripts/e2e/suites/calendar.mjs
-- (which creates + tears down its own TAG'd rows per run).
--
-- Owners/assignees/attendees are picked dynamically via a ranked CTE over active,
-- non-superadmin app_users (not hardcoded ids), so it runs against whatever roster
-- exists. Dates are current_date-relative so items land in the CURRENT month.
--
-- Idempotent: fixed uuids + on conflict (id) do nothing. Pure DML — no schema
-- reload needed. Apply AFTER migration 20260917000310 in the Supabase SQL editor.
-- ============================================================================

with people as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users
  where status = 'active' and role <> 'superadmin'
)
-- ── Tasks (all-day; status + priority required) ─────────────────────────────
insert into public.calendar_entries
  (id, type, title, notes, all_day, starts_on, owner_user_id, assignee_user_id,
   visibility, status, priority, completed_at, completed_by, created_by)
select v.id, 'task', v.title, v.notes, true, v.starts_on,
       (select id from people where rn = v.owner_rn),
       case when v.assignee_rn is null then null else (select id from people where rn = v.assignee_rn) end,
       v.visibility, v.status, v.priority,
       case when v.status = 'done' then now() - interval '1 day' else null end,
       case when v.status = 'done' then (select id from people where rn = v.owner_rn) else null end,
       (select id from people where rn = v.owner_rn)
from (values
  ('c0000000-0000-4000-8000-000000009201'::uuid, 'Prepare Q2 Cash Flow Forecast', 'Budgeting & Planning',        (current_date + 2), 1, 1::int,    'team',     'in_progress', 'high'),
  ('c0000000-0000-4000-8000-000000009202'::uuid, 'Update method statement',       'Site works',                  (current_date + 0), 2, null,      'personal', 'in_progress', 'medium'),
  ('c0000000-0000-4000-8000-000000009203'::uuid, 'Site photos upload',            'QA/QC evidence',              (current_date + 1), 3, null,      'personal', 'not_started', 'low'),
  ('c0000000-0000-4000-8000-000000009204'::uuid, 'Review inspection report',      'FA-045, Block A',            (current_date - 1), 1, 2::int,    'team',     'not_started', 'high'),
  ('c0000000-0000-4000-8000-000000009205'::uuid, 'Vendor performance check',      'Quarterly vendor review',    (current_date + 6), 2, null,      'team',     'done',        'medium'),
  ('c0000000-0000-4000-8000-000000009206'::uuid, 'Certificate check',             'Quality assurance',          (current_date + 3), 3, null,      'personal', 'in_review',   'medium'),
  ('c0000000-0000-4000-8000-000000009207'::uuid, 'Resolve blocked permit',        'Awaiting authority',         (current_date + 1), 1, null,      'team',     'blocked',     'high')
) as v(id, title, notes, starts_on, owner_rn, assignee_rn, visibility, status, priority)
on conflict (id) do nothing;

-- ── Recurring task (weekly) ─────────────────────────────────────────────────
with people as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users where status = 'active' and role <> 'superadmin'
)
insert into public.calendar_entries
  (id, type, title, notes, all_day, starts_on, owner_user_id, visibility, status, priority,
   recurrence_rule, recurrence_series_id, created_by)
select 'c0000000-0000-4000-8000-000000009210'::uuid, 'task', 'Weekly vendor follow-up', 'Recurring weekly',
       true, (current_date - extract(dow from current_date)::int + 1),  -- this week's Monday
       (select id from people where rn = 1), 'team', 'not_started', 'medium',
       'FREQ=WEEKLY;BYDAY=MO', 'c0000000-0000-4000-8000-0000000092a0'::uuid,
       (select id from people where rn = 1)
on conflict (id) do nothing;

-- ── Activities (all-day + timed; status/priority null) ──────────────────────
with people as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users where status = 'active' and role <> 'superadmin'
)
insert into public.calendar_entries
  (id, type, title, notes, all_day, starts_on, starts_at, ends_at,
   owner_user_id, visibility, created_by)
select v.id, 'activity', v.title, v.notes, v.all_day, v.starts_on, v.starts_at, v.ends_at,
       (select id from people where rn = v.owner_rn), v.visibility,
       (select id from people where rn = v.owner_rn)
from (values
  ('c0000000-0000-4000-8000-000000009220'::uuid, 'Team Meeting',           'Board Room',        false, null::date,        ((current_date + 1)::timestamp + interval '10 hour'), ((current_date + 1)::timestamp + interval '11 hour'), 1, 'team'),
  ('c0000000-0000-4000-8000-000000009221'::uuid, 'Site Visit – Lekki',     'Lekki Phase 1',     true,  (current_date + 3), null::timestamptz,                                     null::timestamptz,                                     2, 'team'),
  ('c0000000-0000-4000-8000-000000009222'::uuid, 'Safety Induction',       'Training room',     false, null::date,        ((current_date + 2)::timestamp + interval '14 hour'), ((current_date + 2)::timestamp + interval '15 hour'), 3, 'org')
) as v(id, title, notes, all_day, starts_on, starts_at, ends_at, owner_rn, visibility)
on conflict (id) do nothing;

-- ── Attendees for the Team Meeting ──────────────────────────────────────────
with people as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users where status = 'active' and role <> 'superadmin'
)
insert into public.calendar_activity_attendees (id, calendar_entry_id, user_id, response_status)
select v.id, 'c0000000-0000-4000-8000-000000009220'::uuid, (select id from people where rn = v.rn), v.response
from (values
  ('c0000000-0000-4000-8000-000000009230'::uuid, 2::int, 'accepted'),
  ('c0000000-0000-4000-8000-000000009231'::uuid, 3::int, 'invited')
) as v(id, rn, response)
where (select id from people where rn = v.rn) is not null
on conflict (calendar_entry_id, user_id) do nothing;
