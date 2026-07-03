-- ============================================================================
-- HR Offboarding — demo seed (populates the Overview dashboard + cases table)
-- ============================================================================
-- Separate from scripts/e2e/suites/hrOffboarding.mjs (which creates + tears down
-- its own h.TAG-ed rows per run). This is a standing, idempotent demo dataset so
-- the Offboarding page renders populated for manual review.
--
-- Employees are picked dynamically via a ranked CTE over active, non-superadmin
-- app_users (not hardcoded usr-IDs) so this runs against whatever roster exists.
-- The exit-task and handoff templates mirror the code-defined plan in
-- lib/hr/offboardingCore.ts (STANDARD_EXIT_TASKS / STANDARD_EXIT_HANDOFFS)
-- exactly, so the seeded rows look like real `start` output, just varied in
-- status across 7 cases spanning every dashboard state (in-progress, ready for
-- exit, blocked with open blockers, paused, completed this month, cancelled).
--
-- Idempotent: fixed uuids + on conflict (id) do nothing. Safe to re-run.
-- Needs 7+ active non-superadmin app_users and at least one manager-tier user
-- to exist; if the roster is thinner, the join simply seeds fewer cases.
-- ============================================================================

-- ── cases ─────────────────────────────────────────────────────────────────────
with employees as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users
  where status = 'active' and role <> 'superadmin'
),
hr_owner as (
  select id from public.app_users
  where status = 'active' and role in ('hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin')
  order by created_at limit 1
)
insert into public.hr_offboarding_cases
  (id, case_no, employee_id, reason, package_key, status, owner_id, last_working_day,
   started_by, started_at, ready_at, completed_at, paused_at, cancelled_by, cancelled_at)
select
  v.id, v.case_no, e.id, v.reason, 'standard_exit', v.status, (select id from hr_owner),
  v.last_working_day, (select id from hr_owner), v.started_at, v.ready_at, v.completed_at, v.paused_at,
  case when v.cancelled_at is not null then (select id from hr_owner) else null end, v.cancelled_at
from (values
  ('d0000000-0000-4000-8000-000000009101'::uuid, 'OFB-2026-DEMO01', 1, 'resignation',     'in_progress',    (current_date + 5),  now() - interval '9 day',  null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000009102'::uuid, 'OFB-2026-DEMO02', 2, 'resignation',     'in_progress',    (current_date + 12), now() - interval '3 day',  null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000009103'::uuid, 'OFB-2026-DEMO03', 3, 'termination',     'ready_for_exit', (current_date + 2),  now() - interval '14 day', now() - interval '1 day', null::timestamptz, null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000009104'::uuid, 'OFB-2026-DEMO04', 4, 'redundancy',      'blocked',        (current_date - 2),  now() - interval '20 day', null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000009105'::uuid, 'OFB-2026-DEMO05', 5, 'end_of_contract', 'paused',         (current_date + 20), now() - interval '6 day',  null::timestamptz, null::timestamptz, now() - interval '2 day', null::timestamptz),
  ('d0000000-0000-4000-8000-000000009106'::uuid, 'OFB-2026-DEMO06', 6, 'resignation',     'completed',      (current_date - 10), now() - interval '25 day', null::timestamptz, now() - interval '3 day', null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000009107'::uuid, 'OFB-2026-DEMO07', 7, 'retirement',      'cancelled',      null,                 now() - interval '8 day',  null::timestamptz, null::timestamptz, null::timestamptz, now() - interval '1 day')
) as v(id, case_no, rn, reason, status, last_working_day, started_at, ready_at, completed_at, paused_at, cancelled_at)
join employees e on e.rn = v.rn
on conflict (id) do nothing;

-- ── tasks (7 standard exit tasks per case, status varied to drive clearance %) ──
with tpl(task_key, task_title, owner_role, module_key, is_blocking, sort_order) as (values
  ('clearance_checklist', 'Complete exit clearance checklist',                'hr',      'hr',      true,  1),
  ('asset_return',        'Collect company assets (laptop, phone, keys)',     'it',      'it',      true,  2),
  ('access_removal',      'Remove system & building access',                  'it',      'it',      true,  3),
  ('ppe_return',          'Return issued PPE',                                'hse',     'hse',     false, 4),
  ('exit_interview',      'Conduct exit interview',                           'hr',      'hr',      false, 5),
  ('final_pay_review',    'Review final pay & entitlements',                  'finance', 'finance', true,  6),
  ('final_documents',     'Issue final documents (letter, references)',       'hr',      'hr',      false, 7)
),
rows(seq, case_id, task_key, status) as (values
  -- case 1 (in_progress): 3 done / 4 open, incl. blocking access_removal + final_pay_review
  (1,  'd0000000-0000-4000-8000-000000009101'::uuid, 'clearance_checklist', 'completed'),
  (2,  'd0000000-0000-4000-8000-000000009101'::uuid, 'asset_return',        'completed'),
  (3,  'd0000000-0000-4000-8000-000000009101'::uuid, 'access_removal',      'pending'),
  (4,  'd0000000-0000-4000-8000-000000009101'::uuid, 'ppe_return',          'pending'),
  (5,  'd0000000-0000-4000-8000-000000009101'::uuid, 'exit_interview',      'completed'),
  (6,  'd0000000-0000-4000-8000-000000009101'::uuid, 'final_pay_review',    'pending'),
  (7,  'd0000000-0000-4000-8000-000000009101'::uuid, 'final_documents',     'pending'),
  -- case 2 (in_progress): 2 done / 5 open
  (8,  'd0000000-0000-4000-8000-000000009102'::uuid, 'clearance_checklist', 'completed'),
  (9,  'd0000000-0000-4000-8000-000000009102'::uuid, 'asset_return',        'pending'),
  (10, 'd0000000-0000-4000-8000-000000009102'::uuid, 'access_removal',      'pending'),
  (11, 'd0000000-0000-4000-8000-000000009102'::uuid, 'ppe_return',          'pending'),
  (12, 'd0000000-0000-4000-8000-000000009102'::uuid, 'exit_interview',      'completed'),
  (13, 'd0000000-0000-4000-8000-000000009102'::uuid, 'final_pay_review',    'pending'),
  (14, 'd0000000-0000-4000-8000-000000009102'::uuid, 'final_documents',     'pending'),
  -- case 3 (ready_for_exit): 6 done / 1 open (non-blocking)
  (15, 'd0000000-0000-4000-8000-000000009103'::uuid, 'clearance_checklist', 'completed'),
  (16, 'd0000000-0000-4000-8000-000000009103'::uuid, 'asset_return',        'completed'),
  (17, 'd0000000-0000-4000-8000-000000009103'::uuid, 'access_removal',      'completed'),
  (18, 'd0000000-0000-4000-8000-000000009103'::uuid, 'ppe_return',          'completed'),
  (19, 'd0000000-0000-4000-8000-000000009103'::uuid, 'exit_interview',      'completed'),
  (20, 'd0000000-0000-4000-8000-000000009103'::uuid, 'final_pay_review',    'completed'),
  (21, 'd0000000-0000-4000-8000-000000009103'::uuid, 'final_documents',     'pending'),
  -- case 4 (blocked): 2 done / 5 open, incl. blocked asset_return + access_removal
  (22, 'd0000000-0000-4000-8000-000000009104'::uuid, 'clearance_checklist', 'completed'),
  (23, 'd0000000-0000-4000-8000-000000009104'::uuid, 'asset_return',        'blocked'),
  (24, 'd0000000-0000-4000-8000-000000009104'::uuid, 'access_removal',      'blocked'),
  (25, 'd0000000-0000-4000-8000-000000009104'::uuid, 'ppe_return',          'pending'),
  (26, 'd0000000-0000-4000-8000-000000009104'::uuid, 'exit_interview',      'completed'),
  (27, 'd0000000-0000-4000-8000-000000009104'::uuid, 'final_pay_review',    'pending'),
  (28, 'd0000000-0000-4000-8000-000000009104'::uuid, 'final_documents',     'pending'),
  -- case 5 (paused): 1 done / 6 open
  (29, 'd0000000-0000-4000-8000-000000009105'::uuid, 'clearance_checklist', 'pending'),
  (30, 'd0000000-0000-4000-8000-000000009105'::uuid, 'asset_return',        'pending'),
  (31, 'd0000000-0000-4000-8000-000000009105'::uuid, 'access_removal',      'pending'),
  (32, 'd0000000-0000-4000-8000-000000009105'::uuid, 'ppe_return',          'pending'),
  (33, 'd0000000-0000-4000-8000-000000009105'::uuid, 'exit_interview',      'pending'),
  (34, 'd0000000-0000-4000-8000-000000009105'::uuid, 'final_pay_review',    'pending'),
  (35, 'd0000000-0000-4000-8000-000000009105'::uuid, 'final_documents',     'completed'),
  -- case 6 (completed): all done
  (36, 'd0000000-0000-4000-8000-000000009106'::uuid, 'clearance_checklist', 'completed'),
  (37, 'd0000000-0000-4000-8000-000000009106'::uuid, 'asset_return',        'completed'),
  (38, 'd0000000-0000-4000-8000-000000009106'::uuid, 'access_removal',      'completed'),
  (39, 'd0000000-0000-4000-8000-000000009106'::uuid, 'ppe_return',          'completed'),
  (40, 'd0000000-0000-4000-8000-000000009106'::uuid, 'exit_interview',      'completed'),
  (41, 'd0000000-0000-4000-8000-000000009106'::uuid, 'final_pay_review',    'completed'),
  (42, 'd0000000-0000-4000-8000-000000009106'::uuid, 'final_documents',     'completed'),
  -- case 7 (cancelled): 2 done / 5 skipped
  (43, 'd0000000-0000-4000-8000-000000009107'::uuid, 'clearance_checklist', 'completed'),
  (44, 'd0000000-0000-4000-8000-000000009107'::uuid, 'asset_return',        'skipped'),
  (45, 'd0000000-0000-4000-8000-000000009107'::uuid, 'access_removal',      'skipped'),
  (46, 'd0000000-0000-4000-8000-000000009107'::uuid, 'ppe_return',          'skipped'),
  (47, 'd0000000-0000-4000-8000-000000009107'::uuid, 'exit_interview',      'completed'),
  (48, 'd0000000-0000-4000-8000-000000009107'::uuid, 'final_pay_review',    'skipped'),
  (49, 'd0000000-0000-4000-8000-000000009107'::uuid, 'final_documents',     'skipped')
)
insert into public.hr_offboarding_tasks
  (id, case_id, task_key, task_title, owner_role, module_key, status, is_blocking, sort_order, completed_at)
select
  ('d1000000-0000-4000-8000-' || lpad((100000 + r.seq)::text, 12, '0'))::uuid,
  r.case_id, r.task_key, t.task_title, t.owner_role, t.module_key, r.status, t.is_blocking, t.sort_order,
  case when r.status = 'completed' then now() - interval '2 day' else null end
from rows r join tpl t on t.task_key = r.task_key
on conflict (id) do nothing;

-- ── handoffs (3 standard cross-module handoffs per case) ────────────────────────
with rows(seq, case_id, handoff_key, target_module, handoff_type, status) as (values
  (1,  'd0000000-0000-4000-8000-000000009101'::uuid, 'it_access_removal', 'it',      'access_removal', 'pending'),
  (2,  'd0000000-0000-4000-8000-000000009101'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'pending'),
  (3,  'd0000000-0000-4000-8000-000000009101'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'delivered'),
  (4,  'd0000000-0000-4000-8000-000000009102'::uuid, 'it_access_removal', 'it',      'access_removal', 'pending'),
  (5,  'd0000000-0000-4000-8000-000000009102'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'delivered'),
  (6,  'd0000000-0000-4000-8000-000000009102'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'pending'),
  (7,  'd0000000-0000-4000-8000-000000009103'::uuid, 'it_access_removal', 'it',      'access_removal', 'delivered'),
  (8,  'd0000000-0000-4000-8000-000000009103'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'delivered'),
  (9,  'd0000000-0000-4000-8000-000000009103'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'delivered'),
  (10, 'd0000000-0000-4000-8000-000000009104'::uuid, 'it_access_removal', 'it',      'access_removal', 'pending'),
  (11, 'd0000000-0000-4000-8000-000000009104'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'pending'),
  (12, 'd0000000-0000-4000-8000-000000009104'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'pending'),
  (13, 'd0000000-0000-4000-8000-000000009105'::uuid, 'it_access_removal', 'it',      'access_removal', 'pending'),
  (14, 'd0000000-0000-4000-8000-000000009105'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'pending'),
  (15, 'd0000000-0000-4000-8000-000000009105'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'pending'),
  (16, 'd0000000-0000-4000-8000-000000009106'::uuid, 'it_access_removal', 'it',      'access_removal', 'delivered'),
  (17, 'd0000000-0000-4000-8000-000000009106'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'delivered'),
  (18, 'd0000000-0000-4000-8000-000000009106'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'delivered'),
  (19, 'd0000000-0000-4000-8000-000000009107'::uuid, 'it_access_removal', 'it',      'access_removal', 'cancelled'),
  (20, 'd0000000-0000-4000-8000-000000009107'::uuid, 'finance_final_pay', 'finance', 'final_pay',      'cancelled'),
  (21, 'd0000000-0000-4000-8000-000000009107'::uuid, 'hse_ppe_return',    'hse',     'ppe_return',     'cancelled')
)
insert into public.hr_offboarding_handoffs (id, case_id, handoff_key, target_module, handoff_type, status)
select ('d2000000-0000-4000-8000-' || lpad((200000 + seq)::text, 12, '0'))::uuid, case_id, handoff_key, target_module, handoff_type, status
from rows
on conflict (id) do nothing;

-- ── blockers (only on the blocked/paused/at-risk cases) ─────────────────────────
with hr_owner as (
  select id from public.app_users
  where status = 'active' and role in ('hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin')
  order by created_at limit 1
)
insert into public.hr_offboarding_blockers (id, case_id, blocker_key, title, blocking_module, severity, status, owner_id, due_at)
select v.id, v.case_id, v.blocker_key, v.title, v.blocking_module, v.severity, 'open', (select id from hr_owner), v.due_at
from (values
  ('d3000000-0000-4000-8000-000000009301'::uuid, 'd0000000-0000-4000-8000-000000009104'::uuid, 'asset_not_returned', 'Company laptop not yet returned',              'it', 'critical', now() - interval '1 day'),
  ('d3000000-0000-4000-8000-000000009302'::uuid, 'd0000000-0000-4000-8000-000000009104'::uuid, 'badge_not_returned', 'Access badge not surrendered',                  'it', 'high',     now()),
  ('d3000000-0000-4000-8000-000000009303'::uuid, 'd0000000-0000-4000-8000-000000009105'::uuid, 'client_confirmation','Awaiting client contract-end confirmation',     'hr', 'medium',   now() + interval '4 day'),
  ('d3000000-0000-4000-8000-000000009304'::uuid, 'd0000000-0000-4000-8000-000000009102'::uuid, 'it_sla_risk',        'IT provisioning ticket nearing SLA breach',     'it', 'low',      now() + interval '2 day')
) as v(id, case_id, blocker_key, title, blocking_module, severity, due_at)
on conflict (id) do nothing;
