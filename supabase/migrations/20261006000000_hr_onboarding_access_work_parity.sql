-- HR Onboarding — restore Access/IT work to the seeded packages (design parity).
--
-- THE GAP
-- `accountPreflight` decides whether a package provisions an account from
--   plan.tasks.some(t => t.moduleKey === 'access' || t.moduleKey === 'it')
--   || plan.handoffs.some(h => h.targetModule === 'access' || h.targetModule === 'it')
-- The seed (20260714000003) gave the IT tasks `owner_role = 'it'` but left `module_key`
-- NULL, and shipped no access handoff at all. So every active package reported
-- `required: false` even while listing "Grant application access" as work — account
-- provisioning was silently inert, `proposedWorkEmail` was always null, and the
-- "Configure the onboarding work-email domain before provisioning." blocker was
-- unreachable. Verified against the canonical Package Management mockup, which shows
-- a "Provision application access" task (Before start · Access → IT / Admin Queue) and
-- an "IT / Access Setup" handoff on the standard package.
--
-- The seed migration is corrected AT SOURCE so a fresh environment is right. This
-- migration exists because that seed is `on conflict do nothing` and already applied —
-- re-running it cannot repair rows that exist. It is a data correction for deployed
-- environments, not a shim over a broken source.
--
-- SAFETY: the UPDATE is narrowed to rows that still match the ORIGINAL seeded shape
-- (module_key IS NULL and owner_role = 'it' and a known seeded task_key). A package the
-- customer has since edited through the package editor — different owner, different
-- module, renamed task — is left exactly as it is. Packages that genuinely provision no
-- account are untouched because they carry none of these task keys.

update public.hr_onboarding_task_templates t
set module_key = 'it'
from public.hr_onboarding_packages p
where t.package_id = p.id
  and t.module_key is null
  and t.owner_role = 'it'
  and t.task_key in ('account_invite','mfa_setup','application_access','equipment_request')
  and p.package_key in ('standard_employee','safety_critical_employee','supervisor_manager','office_admin','contractor_worker');

-- The IT / Access Setup handoff from the approved design. contractor_worker included:
-- contractors get temporary, sponsor-owned access, which is still a provisioned account.
insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, 'onboarding_it_access', 'it', 'onboarding_it_access', 5
from public.hr_onboarding_packages p
where p.package_key in ('standard_employee','safety_critical_employee','supervisor_manager','office_admin','contractor_worker')
on conflict (package_id, handoff_key) do nothing;

-- Verification (operator):
-- 1. Every active package now reports access work:
--    select p.package_key,
--           count(*) filter (where t.module_key in ('access','it')) as access_tasks,
--           (select count(*) from public.hr_onboarding_handoff_templates h
--             where h.package_id = p.id and h.target_module in ('access','it')) as access_handoffs
--    from public.hr_onboarding_packages p
--    left join public.hr_onboarding_task_templates t on t.package_id = p.id
--    where p.status = 'active' group by p.id, p.package_key order by 1;
-- 2. hr/onboarding/account-preflight for any of these packages → required = true.
-- 3. With hr_onboarding.work_email_domain UNSET → ready = false and blockers contains
--    'Configure the onboarding work-email domain before provisioning.',
--    and proposedWorkEmail is null (never a silently generated address).
-- After applying:  NOTIFY pgrst, 'reload schema';
