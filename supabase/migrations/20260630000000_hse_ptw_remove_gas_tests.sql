-- ============================================================================
-- HSE Permit-to-Work — Remove Gas Testing
-- ============================================================================
-- Gas testing has been removed from PTW entirely (flow, sub-register, templates).
-- This migration drops the gas-test sub-register table and the requires_gas_test
-- flag from every PTW table that carried it.
--
-- Notes:
--   • hse_permits.status is free-text (no enum), so the now-unused
--     'gas_test_pending' value needs no schema change — it simply won't be set.
--   • Existing permit metadata keys (gas_test_planned / gas_test_note) are left
--     in place; they are inert jsonb and harmless. New permits no longer write them.
--   • Idempotent: drop ... if exists, so the migration is safe to re-run.
-- ============================================================================

-- 1. Drop the gas-test sub-register table (cascades indexes + RLS).
drop table if exists public.hse_permit_gas_tests cascade;

-- 2. Drop the requires_gas_test flag everywhere it lived.
alter table public.hse_permits            drop column if exists requires_gas_test;
alter table public.hse_permit_templates   drop column if exists requires_gas_test;
alter table public.hse_permit_type_config drop column if exists requires_gas_test;
