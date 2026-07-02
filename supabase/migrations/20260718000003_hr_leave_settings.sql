-- ============================================================================
-- HR Leave & Absence — settings catalog entries
-- ============================================================================
-- Seeds settings_catalog with module policy entries for hr_leave.
-- These are resolved by resolveSettingValue() with the catalog as source.
-- Idempotent (on conflict do update to keep defaults current).
-- ============================================================================

insert into public.settings_catalog
  (setting_key, module_key, setting_class, label, description, data_type, default_value,
   allowed_values, min_value, max_value, scope, requires_permission,
   is_critical, is_audited, can_reduce_strictness, can_suppress_required_delivery)
values
  ('hr_leave.enabled',
   'hr_leave', 'module_policy',
   'Leave Module Enabled', 'Master switch for the HR leave module.',
   'boolean', 'true'::jsonb,
   null, null, null, array['global']::text[], 'hr.settings.manage',
   false, true, true, false),

  ('hr_leave.accrual_cadence',
   'hr_leave', 'module_policy',
   'Default Accrual Cadence', 'Default accrual cadence applied when a leave type does not override it.',
   'select', '"annual"'::jsonb,
   '["none","monthly","annual"]'::jsonb, null, null, array['global']::text[], 'hr.settings.manage',
   false, true, true, false),

  ('hr_leave.default_carryover_cap',
   'hr_leave', 'module_policy',
   'Default Carryover Cap (days)', 'Maximum days that carry over to the next year when a leave type does not override it.',
   'number', '10'::jsonb,
   null, 0, 365, array['global']::text[], 'hr.settings.manage',
   false, true, true, false),

  ('hr_leave.min_notice_days',
   'hr_leave', 'module_policy',
   'Minimum Notice (days)', 'Minimum calendar days of advance notice required when submitting a leave request.',
   'number', '1'::jsonb,
   null, 0, 90, array['global']::text[], 'hr.settings.manage',
   false, true, true, false),

  ('hr_leave.allow_negative_balance',
   'hr_leave', 'module_policy',
   'Allow Negative Balance', 'Allow employees to submit leave requests that would put their balance below zero.',
   'boolean', 'false'::jsonb,
   null, null, null, array['global']::text[], 'hr.settings.manage',
   false, true, true, false),

  ('hr_leave.blackout_dates',
   'hr_leave', 'module_policy',
   'Blackout Dates', 'Comma-separated date ranges (YYYY-MM-DD:YYYY-MM-DD) during which leave requests are blocked.',
   'string', '""'::jsonb,
   null, null, null, array['global']::text[], 'hr.settings.manage',
   false, true, true, false)

on conflict (setting_key) do update
  set label = excluded.label,
      description = excluded.description,
      default_value = excluded.default_value,
      updated_at = now();

-- After applying: NOTIFY pgrst, 'reload schema';
