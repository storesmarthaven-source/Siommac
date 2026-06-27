-- ============================================================================
-- HR Onboarding — seed the 5 packages from the former code constant (Phase 4)
-- ============================================================================
-- Faithful migration of lib/hr/onboardingPackages.ts (now DELETED) into the DB
-- template tables. Idempotent (on conflict do nothing) — safe to re-run, and it
-- will NOT clobber packages later edited via the package editor. is_blocking /
-- requires_evidence are seeded false to preserve the exact current behaviour (the
-- code constant had no gating concept); mark them via the editor when desired.
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.hr_onboarding_packages (package_key, package_name, description, worker_types, default_owner_role, status) values
  ('standard_employee',        'Standard Employee',     'Best for ordinary employees',                          '["employee"]'::jsonb,                       'hr', 'active'),
  ('safety_critical_employee', 'Safety-Critical Employee','Adds induction, PTW/JSA, competency, medical',        '["employee"]'::jsonb,                       'hr', 'active'),
  ('contractor_worker',        'Contractor Worker',     'No payroll; strong access and HSE gate',                '["contractor","contractor_worker"]'::jsonb, 'hr', 'active'),
  ('supervisor_manager',       'Supervisor / Manager',  'Adds approval rights and management policy pack',       '["employee"]'::jsonb,                       'hr', 'active'),
  ('office_admin',             'Office / Admin',        'Standard office onboarding',                           '["employee"]'::jsonb,                       'hr', 'active')
on conflict (package_key) do nothing;

-- ── standard_employee ───────────────────────────────────────────────────────────
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('site_induction','Site induction','hse','hse',110),
  ('ppe_requirements','PPE requirements','hse','hse',120),
  ('hse_briefing','HSE briefing','hse','hse',130),
  ('training_matrix','Training matrix assignment','training','training',140),
  ('competency_requirements','Competency requirements','training','training',150),
  ('statutory_review','Statutory readiness review','payroll','payroll',160),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',170),
  ('payroll_gate','Payroll gate','payroll','payroll',180)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'standard_employee'
on conflict (package_id, task_key) do nothing;

-- ── safety_critical_employee ──────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('site_induction','Site induction','hse','hse',110),
  ('ppe_requirements','PPE requirements','hse','hse',120),
  ('hse_briefing','HSE briefing','hse','hse',130),
  ('medical_clearance','Medical / fitness clearance','hse','hse',140),
  ('training_matrix','Training matrix assignment','training','training',150),
  ('competency_requirements','Competency requirements','training','training',160),
  ('safety_competency','Safety-critical competency sign-off','training','training',170),
  ('statutory_review','Statutory readiness review','payroll','payroll',180),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',190),
  ('payroll_gate','Payroll gate','payroll','payroll',200)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'safety_critical_employee'
on conflict (package_id, task_key) do nothing;

-- ── contractor_worker ─────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm contractor profile','hr',null,10),
  ('document_collection','Collect contractor documents','hr',null,20),
  ('site_induction','Site induction','hse','hse',30),
  ('ppe_requirements','PPE requirements','hse','hse',40),
  ('hse_briefing','HSE briefing','hse','hse',50),
  ('contractor_readiness','Contractor HSE readiness','hse','hse',60),
  ('application_access','Grant limited access','it',null,70)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'contractor_worker'
on conflict (package_id, task_key) do nothing;

-- ── supervisor_manager ────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('leadership_orientation','Leadership orientation','hr',null,110),
  ('site_induction','Site induction','hse','hse',120),
  ('ppe_requirements','PPE requirements','hse','hse',130),
  ('hse_briefing','HSE briefing','hse','hse',140),
  ('training_matrix','Training matrix assignment','training','training',150),
  ('competency_requirements','Competency requirements','training','training',160),
  ('statutory_review','Statutory readiness review','payroll','payroll',170),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',180),
  ('payroll_gate','Payroll gate','payroll','payroll',190)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'supervisor_manager'
on conflict (package_id, task_key) do nothing;

-- ── office_admin ──────────────────────────────────────────────────────────────--
insert into public.hr_onboarding_task_templates (package_id, task_key, task_title, owner_role, module_key, sort_order)
select p.id, t.task_key, t.task_title, t.owner_role, t.module_key, t.sort_order
from public.hr_onboarding_packages p cross join (values
  ('profile_confirmation','Confirm employee profile','hr',null,10),
  ('document_collection','Collect contract & documents','hr',null,20),
  ('emergency_contact','Confirm emergency contact','hr',null,30),
  ('welcome','Welcome the new hire','supervisor',null,40),
  ('schedule_confirmation','Confirm schedule','supervisor',null,50),
  ('first_week_checkin','First-week check-in','supervisor',null,60),
  ('account_invite','Send account invite','it',null,70),
  ('mfa_setup','MFA / passkey setup','it',null,80),
  ('application_access','Grant application access','it',null,90),
  ('equipment_request','Equipment request','it',null,100),
  ('office_induction','Office induction','hse','hse',110),
  ('statutory_review','Statutory readiness review','payroll','payroll',120),
  ('pay_group_handoff','Pay group handoff','payroll','payroll',130),
  ('payroll_gate','Payroll gate','payroll','payroll',140)
) as t(task_key, task_title, owner_role, module_key, sort_order)
where p.package_key = 'office_admin'
on conflict (package_id, task_key) do nothing;

-- ── handoff templates ─────────────────────────────────────────────────────────--
insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, h.handoff_key, h.target_module, h.handoff_type, h.sort_order
from public.hr_onboarding_packages p cross join (values
  ('onboarding_induction','hse','onboarding_induction',10),
  ('onboarding_training','training','onboarding_training',20),
  ('onboarding_payroll','payroll','onboarding_payroll',30)
) as h(handoff_key, target_module, handoff_type, sort_order)
where p.package_key in ('standard_employee','safety_critical_employee','supervisor_manager')
on conflict (package_id, handoff_key) do nothing;

insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, 'onboarding_contractor_readiness','hse','onboarding_contractor_readiness',10
from public.hr_onboarding_packages p where p.package_key = 'contractor_worker'
on conflict (package_id, handoff_key) do nothing;

insert into public.hr_onboarding_handoff_templates (package_id, handoff_key, target_module, handoff_type, sort_order)
select p.id, 'onboarding_payroll','payroll','onboarding_payroll',10
from public.hr_onboarding_packages p where p.package_key = 'office_admin'
on conflict (package_id, handoff_key) do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
