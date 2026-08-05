-- HR Onboarding Insights is an oversight surface, not an HR staff work queue.
-- The approved information architecture assigns it to HR managers/admins while HR staff
-- retain the operational Command Centre and Work Queue. Remove the historical staff grant;
-- manager/admin/superadmin grants remain unchanged.
--
-- COLUMN NAMES: this file previously used role / permission_key. The live table is
-- public.role_permissions(role_name, permission), so the DELETE aborted and the
-- verification queries errored. Corrected 2026-08-04 against the live schema.
--
-- PENDING OPERATOR ACTION — apply through the normal Supabase migration workflow, then
-- reload PostgREST and allow the role-permission cache to refresh.

delete from public.role_permissions
where role_name = 'hr_staff'
  and permission = 'hr.onboarding.reports.view';

-- Verification: must return zero rows.
select role_name, permission
from public.role_permissions
where role_name = 'hr_staff'
  and permission = 'hr.onboarding.reports.view';

-- Verification: oversight roles must remain granted.
select role_name, permission
from public.role_permissions
where role_name in ('admin', 'hr_manager')
  and permission = 'hr.onboarding.reports.view'
order by role_name;
