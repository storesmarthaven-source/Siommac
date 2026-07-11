-- ============================================================================
-- Seed: Finance Payroll — default T&T overtime rules. Idempotent.
-- Typical T&T rates: overtime 1.5×, public holiday 2×, rest day (Sunday) 2×,
-- callout 1.5× with a 3-hour minimum, night shift 1.25×. Operators can re-map.
-- ============================================================================

insert into public.finance_overtime_rules (code, event_type, multiplier, minimum_hours, effective_from)
values
  ('OT-REG',     'regular_overtime', 1.50, null, '2000-01-01'),
  ('OT-HOLIDAY', 'public_holiday',   2.00, null, '2000-01-01'),
  ('OT-RESTDAY', 'rest_day',         2.00, null, '2000-01-01'),
  ('OT-CALLOUT', 'callout',          1.50, 3.00, '2000-01-01'),
  ('OT-NIGHT',   'night_shift',      1.25, null, '2000-01-01')
on conflict (code) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
