-- ============================================================================
-- HR Onboarding — demo seed (populates the Command Center dashboard + cases table)
-- ============================================================================
-- Separate from scripts/e2e/suites/hrAttendance.mjs-style suites (which create +
-- tear down their own tagged rows per run). This is a standing, idempotent demo
-- dataset so the Onboarding Command Center renders populated for manual review
-- instead of showing every card's empty state.
--
-- Employees are picked dynamically via a ranked CTE over active, non-superadmin
-- app_users (not hardcoded usr-IDs) so this runs against whatever roster exists.
-- Package keys match the real seeded packages (20260714000003): standard_employee,
-- safety_critical_employee, contractor_worker, supervisor_manager, office_admin.
--
-- Idempotent: fixed uuids + on conflict (id) do nothing. Safe to re-run.
-- Needs 6+ active non-superadmin app_users and at least one HR-tier user to exist;
-- if the roster is thinner, the joins simply seed fewer rows. Pure DML (no new
-- tables/columns) — no PostgREST schema-cache reload needed after applying.
-- ============================================================================

-- ── cases ─────────────────────────────────────────────────────────────────────
with employees as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users
  where status = 'active' and role <> 'superadmin'
),
hr_owner as (
  select id, row_number() over (order by created_at) as rn from public.app_users
  where status = 'active' and role in ('hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin')
)
insert into public.hr_onboarding_cases
  (id, case_no, employee_id, worker_type, package_key, status, owner_id, due_at, started_by, started_at)
select
  v.id, v.case_no, e.id, v.worker_type, v.package_key, v.status,
  (select id from hr_owner where rn = v.owner_rn),
  v.due_at, (select id from hr_owner where rn = 1), v.started_at
from (values
  ('e0000000-0000-4000-8000-000000009101'::uuid, 'ONB-2026-DEMO01', 1, 'employee',           'standard_employee',         'in_progress',          1, (current_date + 3),  now() - interval '6 day'),
  ('e0000000-0000-4000-8000-000000009102'::uuid, 'ONB-2026-DEMO02', 2, 'employee',           'office_admin',              'in_progress',          1, (current_date + 8),  now() - interval '2 day'),
  ('e0000000-0000-4000-8000-000000009103'::uuid, 'ONB-2026-DEMO03', 3, 'employee',           'safety_critical_employee', 'blocked',              2, (current_date - 1),  now() - interval '11 day'),
  ('e0000000-0000-4000-8000-000000009104'::uuid, 'ONB-2026-DEMO04', 4, 'contractor_worker',  'contractor_worker',        'blocked',              2, (current_date + 1),  now() - interval '9 day'),
  ('e0000000-0000-4000-8000-000000009105'::uuid, 'ONB-2026-DEMO05', 5, 'employee',           'supervisor_manager',       'ready_for_activation', 1, (current_date + 2),  now() - interval '13 day'),
  ('e0000000-0000-4000-8000-000000009106'::uuid, 'ONB-2026-DEMO06', 6, 'employee',           'standard_employee',        'completed',            1, (current_date - 5),  now() - interval '20 day')
) as v(id, case_no, rn, worker_type, package_key, status, owner_rn, due_at, started_at)
join employees e on e.rn = v.rn
on conflict (id) do nothing;

-- ── tasks (spread across overdue / due-today / due-this-week / future / done) ──
with rows(seq, case_id, task_key, task_title, owner_role, module_key, status, is_blocking, requires_evidence, priority, due_offset, completed_offset) as (values
  -- case 1 (in_progress): mixed open/completed, one due today
  (1,  'e0000000-0000-4000-8000-000000009101'::uuid, 'profile_confirmation', 'Confirm employee profile',        'hr', 'hr',         'completed', false, false, 'normal', null,  -4),
  (2,  'e0000000-0000-4000-8000-000000009101'::uuid, 'document_collection',  'Collect contract & documents',    'hr', 'hr',         'open',      false, true,  'normal', 0,     null),
  (3,  'e0000000-0000-4000-8000-000000009101'::uuid, 'account_invite',       'Send account invite',             'it', 'it',         'open',      false, false, 'normal', 2,     null),
  (4,  'e0000000-0000-4000-8000-000000009101'::uuid, 'equipment_request',    'Equipment request',               'it', 'it',         'open',      false, false, 'low',    5,     null),
  -- case 2 (in_progress): one overdue evidence task
  (5,  'e0000000-0000-4000-8000-000000009102'::uuid, 'profile_confirmation', 'Confirm employee profile',        'hr', 'hr',         'completed', false, false, 'normal', null,  -2),
  (6,  'e0000000-0000-4000-8000-000000009102'::uuid, 'document_collection',  'Collect contract & documents',    'hr', 'hr',         'open',      false, true,  'high',   -2,    null),
  (7,  'e0000000-0000-4000-8000-000000009102'::uuid, 'welcome',              'Welcome the new hire',            'supervisor', 'supervisor', 'open', false, false, 'normal', 1,   null),
  -- case 3 (blocked): induction blocking, one overdue
  (8,  'e0000000-0000-4000-8000-000000009103'::uuid, 'profile_confirmation', 'Confirm employee profile',        'hr', 'hr',         'completed', false, false, 'normal', null,  -10),
  (9,  'e0000000-0000-4000-8000-000000009103'::uuid, 'site_induction',       'Site induction',                  'hse', 'hse',       'blocked',   true,  true,  'critical', -1,  null),
  (10, 'e0000000-0000-4000-8000-000000009103'::uuid, 'ppe_requirements',     'PPE requirements',                'hse', 'hse',       'open',      false, true,  'high',   0,     null),
  -- case 4 (blocked contractor): access blocking
  (11, 'e0000000-0000-4000-8000-000000009104'::uuid, 'document_collection',  'Collect contract & documents',    'hr', 'hr',         'completed', false, true,  'normal', null,  -6),
  (12, 'e0000000-0000-4000-8000-000000009104'::uuid, 'application_access',   'Grant application access',        'it', 'it',         'blocked',   true,  false, 'high',   0,     null),
  (13, 'e0000000-0000-4000-8000-000000009104'::uuid, 'mfa_setup',            'MFA / passkey setup',             'it', 'it',         'open',      false, false, 'normal', 3,     null),
  -- case 5 (ready_for_activation): everything done
  (14, 'e0000000-0000-4000-8000-000000009105'::uuid, 'profile_confirmation', 'Confirm employee profile',        'hr', 'hr',         'completed', false, false, 'normal', null,  -12),
  (15, 'e0000000-0000-4000-8000-000000009105'::uuid, 'document_collection',  'Collect contract & documents',    'hr', 'hr',         'completed', false, true,  'normal', null,  -10),
  (16, 'e0000000-0000-4000-8000-000000009105'::uuid, 'account_invite',       'Send account invite',             'it', 'it',         'completed', false, false, 'normal', null,  -3),
  -- case 6 (completed): all done
  (17, 'e0000000-0000-4000-8000-000000009106'::uuid, 'profile_confirmation', 'Confirm employee profile',        'hr', 'hr',         'completed', false, false, 'normal', null,  -19),
  (18, 'e0000000-0000-4000-8000-000000009106'::uuid, 'document_collection',  'Collect contract & documents',    'hr', 'hr',         'completed', false, true,  'normal', null,  -17),
  (19, 'e0000000-0000-4000-8000-000000009106'::uuid, 'welcome',              'Welcome the new hire',            'supervisor', 'supervisor', 'completed', false, false, 'normal', null, -5)
)
insert into public.hr_onboarding_tasks
  (id, case_id, task_key, task_title, owner_role, module_key, status, is_blocking, requires_evidence, priority, due_at, completed_at)
select
  ('e1000000-0000-4000-8000-' || lpad((100000 + r.seq)::text, 12, '0'))::uuid,
  r.case_id, r.task_key, r.task_title, r.owner_role, r.module_key, r.status, r.is_blocking, r.requires_evidence, r.priority,
  case when r.due_offset is not null then (now() + (r.due_offset || ' day')::interval) else null end,
  case when r.completed_offset is not null then (now() + (r.completed_offset || ' day')::interval) else null end
from rows r
on conflict (id) do nothing;

-- ── blockers (on the two blocked cases) ─────────────────────────────────────────
with hr_owner as (
  select id, row_number() over (order by created_at) as rn from public.app_users
  where status = 'active' and role in ('hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin')
)
insert into public.hr_onboarding_blockers
  (id, case_id, task_id, blocker_key, blocker_title, blocking_module, severity, status, owner_id, due_at)
select v.id, v.case_id, v.task_id, v.blocker_key, v.blocker_title, v.blocking_module, v.severity, v.status,
  (select id from hr_owner where rn = v.owner_rn), v.due_at
from (values
  ('e3000000-0000-4000-8000-000000009301'::uuid, 'e0000000-0000-4000-8000-000000009103'::uuid,
   ('e1000000-0000-4000-8000-'||lpad('100009','12','0'))::uuid,
   'induction_pending', 'Site induction not yet completed', 'hse', 'critical', 'active', 1, now() - interval '1 day'),
  ('e3000000-0000-4000-8000-000000009302'::uuid, 'e0000000-0000-4000-8000-000000009103'::uuid, null,
   'medical_clearance', 'Medical clearance outstanding', 'hse', 'high', 'waiting_on_owner', 1, now()),
  ('e3000000-0000-4000-8000-000000009303'::uuid, 'e0000000-0000-4000-8000-000000009104'::uuid,
   ('e1000000-0000-4000-8000-'||lpad('100012','12','0'))::uuid,
   'access_not_granted', 'Application access not yet granted', 'it', 'high', 'active', 2, now()),
  ('e3000000-0000-4000-8000-000000009304'::uuid, 'e0000000-0000-4000-8000-000000009104'::uuid, null,
   'background_check', 'Contractor background check pending', 'hr', 'medium', 'acknowledged', 1, now() + interval '2 day')
) as v(id, case_id, task_id, blocker_key, blocker_title, blocking_module, severity, status, owner_rn, due_at)
on conflict (id) do nothing;

-- ── handoffs (incl. one failed, for the Failed Handoffs KPI) ────────────────────
with rows(seq, case_id, handoff_key, target_module, handoff_type, status, failure_reason) as (values
  (1, 'e0000000-0000-4000-8000-000000009101'::uuid, 'it_account_provisioning', 'it', 'account_provisioning', 'delivered', null),
  (2, 'e0000000-0000-4000-8000-000000009102'::uuid, 'it_account_provisioning', 'it', 'account_provisioning', 'pending',   null),
  (3, 'e0000000-0000-4000-8000-000000009103'::uuid, 'hse_induction_booking',   'hse', 'induction_booking',    'failed',    'No available induction slot before start date'),
  (4, 'e0000000-0000-4000-8000-000000009104'::uuid, 'it_account_provisioning', 'it', 'account_provisioning', 'pending',   null),
  (5, 'e0000000-0000-4000-8000-000000009105'::uuid, 'it_account_provisioning', 'it', 'account_provisioning', 'delivered', null),
  (6, 'e0000000-0000-4000-8000-000000009106'::uuid, 'it_account_provisioning', 'it', 'account_provisioning', 'delivered', null)
)
insert into public.hr_onboarding_handoffs (id, case_id, handoff_key, target_module, handoff_type, status, failure_reason)
select ('e2000000-0000-4000-8000-' || lpad((200000 + seq)::text, 12, '0'))::uuid, case_id, handoff_key, target_module, handoff_type, status, failure_reason
from rows
on conflict (id) do nothing;

-- ── recent activity (hr_audit_log, submodule_key = 'onboarding') ────────────────
with hr_owner as (
  select id, row_number() over (order by created_at) as rn from public.app_users
  where status = 'active' and role in ('hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin')
)
insert into public.hr_audit_log (id, submodule_key, record_id, actor_id, action, created_at)
select v.id, 'onboarding', v.record_id, (select id from hr_owner where rn = v.owner_rn), v.action, now() + (v.hours_ago || ' hour')::interval
from (values
  ('e4000000-0000-4000-8000-000000009401'::uuid, 'e0000000-0000-4000-8000-000000009101'::text, 1, 'hr.onboarding.task_added',        -1),
  ('e4000000-0000-4000-8000-000000009402'::uuid, 'e0000000-0000-4000-8000-000000009105'::text, 1, 'hr.onboarding.ready_for_activation', -3),
  ('e4000000-0000-4000-8000-000000009403'::uuid, 'e0000000-0000-4000-8000-000000009103'::text, 2, 'hr.onboarding.task_blocked',       -5),
  ('e4000000-0000-4000-8000-000000009404'::uuid, 'e0000000-0000-4000-8000-000000009106'::text, 1, 'hr.onboarding.completed',          -30),
  ('e4000000-0000-4000-8000-000000009405'::uuid, 'e0000000-0000-4000-8000-000000009104'::text, 2, 'hr.onboarding.blocker_owner_notified', -26),
  ('e4000000-0000-4000-8000-000000009406'::uuid, 'e0000000-0000-4000-8000-000000009102'::text, 1, 'hr.onboarding.task_added',         -48),
  ('e4000000-0000-4000-8000-000000009407'::uuid, 'e0000000-0000-4000-8000-000000009101'::text, 1, 'hr.onboarding.task_added',         -50)
) as v(id, record_id, owner_rn, action, hours_ago)
on conflict (id) do nothing;
