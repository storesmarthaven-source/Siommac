-- Fix: grant workflow.tasks.* to hr_manager, finance_manager, finance_staff
--
-- Root cause: migration 20260919000600 creates a 2-step pay-policy approval
-- workflow with hr_manager (step 1) and finance_manager (step 2) as task actors.
-- But the central workflow permissions seed (20260704000002) only covers the
-- generic roles (employee/manager/admin/superadmin). Both domain roles AND
-- finance_staff (which submits policies) need workflow task capabilities.
--
-- The /workflow-engine/decide endpoint gates on workflow.tasks.approve/return/reject.
-- Without these, hr_manager gets 403 when trying to approve the HR review step.
--
-- Source migration 20260919000600 was corrected in-place on the branch.
-- This file applies only the missing grants to the already-running live database.
-- It is idempotent (on conflict do nothing).
--
-- Run once (Supabase Dashboard SQL Editor):

insert into public.role_permissions (role_name, permission) values
  ('hr_manager','workflow.my_tasks.view'),
  ('hr_manager','workflow.tasks.approve'),
  ('hr_manager','workflow.tasks.return'),
  ('hr_manager','workflow.tasks.reject'),
  ('hr_manager','workflow.view'),
  ('finance_manager','workflow.my_tasks.view'),
  ('finance_manager','workflow.tasks.approve'),
  ('finance_manager','workflow.tasks.return'),
  ('finance_manager','workflow.tasks.reject'),
  ('finance_manager','workflow.view'),
  ('finance_staff','workflow.my_tasks.view'),
  ('finance_staff','workflow.submit'),
  ('finance_staff','workflow.tasks.approve'),
  ('finance_staff','workflow.tasks.return'),
  ('finance_staff','workflow.tasks.reject'),
  ('finance_staff','workflow.view')
on conflict do nothing;

notify pgrst, 'reload schema';
