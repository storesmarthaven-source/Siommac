-- ============================================================================
-- HR Leave & Absence — seed leave types
-- ============================================================================
-- Standard leave types covering the most common employment policies.
-- All entries are idempotent (on conflict do nothing).
-- ============================================================================

insert into public.hr_leave_types (code, label, paid, unit, requires_attachment, requires_approval, accrual_rate, accrual_cadence, max_carryover, applies_to_scope, color, is_active)
values
  ('annual',      'Annual Leave',      true,  'days', false, true,  20,   'annual',  10,   'all',             '#4CAF50', true),
  ('sick',        'Sick Leave',        true,  'days', false, true,  10,   'annual',  0,    'all',             '#F44336', true),
  ('unpaid',      'Unpaid Leave',      false, 'days', false, true,  null, 'none',    null, 'all',             '#9E9E9E', true),
  ('maternity',   'Maternity Leave',   true,  'days', false, true,  90,   'none',    null, 'employment_type', '#E91E63', true),
  ('paternity',   'Paternity Leave',   true,  'days', false, true,  5,    'none',    null, 'employment_type', '#2196F3', true),
  ('bereavement', 'Bereavement Leave', true,  'days', true,  true,  3,    'none',    null, 'all',             '#795548', true)
on conflict (code) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';
