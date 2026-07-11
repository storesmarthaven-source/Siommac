-- ============================================================================
-- Seed: Finance Payroll — default pay groups (Monthly / Weekly / Fortnightly /
-- Semi-Monthly). Idempotent. Lets the New Run wizard offer pay groups out of
-- the box; assign employees via the pay-groups API/UI.
-- ============================================================================

insert into public.finance_pay_groups (code, name, frequency, default_pay_day, default_cutoff_offset_days)
values
  ('MTH', 'Monthly Staff',      'monthly',      25, 3),   -- pay on the 25th, cutoff 3 days prior
  ('WK',  'Weekly Wages',       'weekly',       5,  1),   -- pay Friday (5), cutoff 1 day prior
  ('FTN', 'Fortnightly',        'fortnightly',  5,  1),
  ('SEMI','Semi-Monthly',       'semi_monthly', 15, 2)
on conflict (code) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
