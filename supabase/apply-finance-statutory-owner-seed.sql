-- =============================================================================
-- Finance owns the Statutory Configuration page.
--
-- Finance Manager is responsible for finance: the finance_manager role already carries
-- finance.statutory.view / .manage / .approve in the permission catalogue (permissions.ts)
-- and the workflow binding routes statutory approval to finance_manager. This seed makes
-- the DEMO DATA reflect that — a stable Finance Manager persona owns the active statutory
-- version instead of the System Admin placeholder.
--
-- Segregation of duties (mirrors the runtime `assertDifferentApprover` guard): the version
-- is OWNED by the Finance Manager (maker) but APPROVED/ACTIVATED by a distinct senior
-- authority (the superadmin, checker) — creator ≠ approver.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor, or run
-- `node scripts/apply-finance-statutory-owner-seed.mjs`.
--
-- NOTE: this creates the app_users row (with auth_email set). To provision login, run
-- `node supabase/recreate-auth-users.js` — it creates a Supabase Auth account for any
-- app_user that has an auth_email but no auth_id (default password ChangeMe123!) and
-- leaves already-linked users untouched. Do NOT also add her to create-first-users.sql —
-- that would mint a second row under a different id and clash with USR-FINMGR.
-- =============================================================================
begin;

-- 1) Stable Finance Manager persona.
insert into public.app_users
  (id, username, full_name, first_name, last_name, role, status, auth_email, email, employee_number, position)
values
  ('USR-FINMGR', 'finance.manager', 'Camille Rampersad', 'Camille', 'Rampersad',
   'finance_manager', 'active', 'finance.manager@siomac.internal', 'finance.manager@siomac.com',
   'EMP-FIN01', 'Finance Manager')
on conflict (id) do update set
  full_name       = excluded.full_name,
  first_name      = excluded.first_name,
  last_name       = excluded.last_name,
  role            = excluded.role,
  status          = 'active',
  employee_number = excluded.employee_number,
  position        = excluded.position;

-- 2) Active TT statutory version → owned by the Finance Manager (maker); approved &
--    activated by a distinct senior authority (checker). Clears the System Admin owner.
update public.finance_statutory_versions v
set created_by   = 'USR-FINMGR',
    approved_by  = (select id from public.app_users where role = 'superadmin' order by created_at limit 1),
    activated_by = (select id from public.app_users where role = 'superadmin' order by created_at limit 1)
where v.jurisdiction = 'TT' and v.is_active = true;

commit;
