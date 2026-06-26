-- ============================================================================
-- Drop hse_create_incident_tx — the per-family transactional create RPC added in
-- 20260712000000. Decision reversed: the strict-mutation-backbone big-bang is
-- deferred (see netlify/functions/lib/MUTATION_BACKBONE_PLAN.md — the cost/risk is
-- disproportionate to a rare, recoverable failure mode, and provisionEmployee can
-- never be a single DB tx because it calls Supabase Auth). Nothing references this
-- function; removing it so no dead DB object is left behind.
--
-- Operator-applied. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

drop function if exists public.hse_create_incident_tx(jsonb, jsonb, jsonb, jsonb);
