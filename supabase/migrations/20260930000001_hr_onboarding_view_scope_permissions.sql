-- Migration: 20260930000001_hr_onboarding_view_scope_permissions.sql
--
-- Grants the onboarding read-SCOPE ladder introduced for the Onboarding Command Centre,
-- Work Queue and Manager Insights:
--
--   hr.onboarding.view_team — widen onboarding reads to the accountable team/department
--   hr.onboarding.view_all  — widen onboarding reads to every case in the organisation
--
-- Base `hr.onboarding.view` is UNCHANGED and continues to mean own/assigned/participant
-- rows only ("My Work"). The two keys above are additive scope widening that is applied
-- SERVER-SIDE in the onboarding read models. The frontend must never request all cases
-- and hide unauthorised rows after the fact.
--
-- Deliberate role split (approved 2026-08-02):
--   admin       — both keys
--   hr_manager  — both keys
--   hr_staff    — NEITHER (stays on My Work under base `hr.onboarding.view`)
--   manager     — NEITHER (holds only base `hr.onboarding.view` today)
--   superadmin  — not listed: it is allow-all in code and derives from PERMISSION_KEYS.
--
-- The keys are added to BOTH catalogues in code (src/lib/permissions.ts and
-- netlify/functions/lib/permissions.ts) plus src/lib/permissionMeta.ts. WITHOUT the
-- role_permissions rows below every call still 403s for admin/hr_manager, because
-- requirePermission resolves capabilities via loadRolePermissions() which reads THIS
-- table, not the static catalogue. That failure is invisible when testing as superadmin.
--
-- NOTE: ROLE_CACHE_TTL_MS is 30s — after applying, wait for the cache to expire (or
-- restart the dev server) before retesting, or a freshly granted role still reads 403.
--
-- PENDING OPERATOR ACTION — never self-apply.

insert into public.role_permissions (role_name, permission)
values
  -- hr.onboarding.view_team
  ('admin',      'hr.onboarding.view_team'),
  ('hr_manager', 'hr.onboarding.view_team'),
  -- hr.onboarding.view_all
  ('admin',      'hr.onboarding.view_all'),
  ('hr_manager', 'hr.onboarding.view_all')
on conflict do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION SQL — run AFTER applying. Each query states its expected result.
-- ─────────────────────────────────────────────────────────────────────────────

-- V1. The four intended grants exist. EXPECT exactly 4 rows.
--     admin/view_all, admin/view_team, hr_manager/view_all, hr_manager/view_team
select role_name, permission
from public.role_permissions
where permission in ('hr.onboarding.view_team', 'hr.onboarding.view_all')
order by role_name, permission;

-- V2. NEGATIVE — the scope keys must NOT have leaked to hr_staff, manager or employee.
--     EXPECT 0 rows. A row here is a privilege-escalation defect, not a nit.
select role_name, permission
from public.role_permissions
where permission in ('hr.onboarding.view_team', 'hr.onboarding.view_all')
  and role_name not in ('admin', 'hr_manager')
order by role_name, permission;

-- V3. Base scope is untouched — hr_staff still holds `view` and therefore My Work.
--     EXPECT 1 row: hr_staff | hr.onboarding.view
select role_name, permission
from public.role_permissions
where role_name = 'hr_staff'
  and permission = 'hr.onboarding.view';

-- V4. No duplicate rows were introduced by a re-run (the migration is idempotent).
--     EXPECT 0 rows.
select role_name, permission, count(*)
from public.role_permissions
where permission in ('hr.onboarding.view_team', 'hr.onboarding.view_all')
group by role_name, permission
having count(*) > 1;
