-- Crew Payroll — CP3 role grants (spec §14.8). The role_permissions table is the runtime
-- source of truth for role→permission (the static catalogue in permissions.ts is a fallback).
-- Grant the crew keys to finance_manager (the payroll authority). Preparer≠approver is
-- preserved by the existing policy-activation SoD; movement/assignment mutations are audited.
-- Broader operational distribution (crewing ops / marine logistics roles) is a later config step.

insert into public.role_permissions (role_name, permission) values
  ('finance_manager', 'finance.payroll.crew.assignments.manage'),
  ('finance_manager', 'finance.payroll.crew.movements.record'),
  ('finance_manager', 'finance.payroll.crew.movements.correct'),
  ('finance_manager', 'finance.payroll.crew.evidence.view')
on conflict (role_name, permission) do nothing;
