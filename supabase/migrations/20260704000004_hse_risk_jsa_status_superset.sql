-- Align Risk/JSA status CHECK constraints with the shared transition map.
--
-- Root cause: hseRiskJsa.ts drives all three entity types (hazard / assessment /
-- jsa) through ONE shared STATUS_TRANSITIONS map via applyTransition() + the
-- legacy /review endpoint. That map is a superset across the three entities, but
-- the per-entity DB CHECK constraints were narrower than it — so a map-allowed
-- transition could still be rejected by the database with
-- "violates check constraint <table>_status_check".
--
-- Concretely this broke the legacy review "return" outcome: under_review→returned
-- is allowed by the map, but hse_hazards_status_check did not list 'returned'.
-- hse_hazards was also missing 'active' (set by the activate endpoint), so a
-- fresh rebuild from migrations could not activate a hazard.
--
-- Fix: recreate all three constraints as the full superset of statuses the shared
-- transition map can produce, so any map-reachable status is also DB-valid. This
-- is a strict widening of the existing allowed sets — every existing row stays
-- valid — and it removes the whole class of map-vs-constraint drift, not just the
-- one instance. Idempotent: drop-if-exists then recreate the named constraint.
--
-- Run manually, then (constraint-only change, but keep the convention):
--   NOTIFY pgrst, 'reload schema';

-- Canonical superset (matches STATUS_TRANSITIONS in netlify/functions/routes/hseRiskJsa.ts):
--   draft · registered · assessment_required · controls_required
--   submitted · under_review · hse_review
--   changes_requested · returned · rejected
--   approved · monitoring · active · expired · closed · archived

alter table public.hse_hazards drop constraint if exists hse_hazards_status_check;
alter table public.hse_hazards add constraint hse_hazards_status_check
  check (status in (
    'draft','registered','assessment_required','controls_required',
    'submitted','under_review','hse_review',
    'changes_requested','returned','rejected',
    'approved','monitoring','active','expired','closed','archived'
  ));

alter table public.hse_risk_assessments drop constraint if exists hse_risk_assessments_status_check;
alter table public.hse_risk_assessments add constraint hse_risk_assessments_status_check
  check (status in (
    'draft','registered','assessment_required','controls_required',
    'submitted','under_review','hse_review',
    'changes_requested','returned','rejected',
    'approved','monitoring','active','expired','closed','archived'
  ));

alter table public.hse_jsa drop constraint if exists hse_jsa_status_check;
alter table public.hse_jsa add constraint hse_jsa_status_check
  check (status in (
    'draft','registered','assessment_required','controls_required',
    'submitted','under_review','hse_review',
    'changes_requested','returned','rejected',
    'approved','monitoring','active','expired','closed','archived'
  ));
