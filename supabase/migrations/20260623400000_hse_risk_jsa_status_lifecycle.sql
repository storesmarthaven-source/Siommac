-- Extend Risk/JSA status CHECK constraints for the full approval lifecycle.
--
-- The distinct workflow endpoints (approve / reject / request-changes / activate
-- / close / archive) need statuses the original CHECKs didn't allow:
--   changes_requested · rejected · closed
-- Add them to hse_hazards, hse_risk_assessments and hse_jsa as a superset of the
-- existing values (no existing row becomes invalid). Idempotent: drop-if-exists
-- then recreate the named constraint.

alter table public.hse_hazards drop constraint if exists hse_hazards_status_check;
alter table public.hse_hazards add constraint hse_hazards_status_check
  check (status in (
    'draft','registered','assessment_required','controls_required','under_review',
    'approved','monitoring','archived','changes_requested','rejected','closed'
  ));

alter table public.hse_risk_assessments drop constraint if exists hse_risk_assessments_status_check;
alter table public.hse_risk_assessments add constraint hse_risk_assessments_status_check
  check (status in (
    'draft','submitted','under_review','returned','approved','active','expired',
    'archived','changes_requested','rejected','closed'
  ));

alter table public.hse_jsa drop constraint if exists hse_jsa_status_check;
alter table public.hse_jsa add constraint hse_jsa_status_check
  check (status in (
    'draft','submitted','hse_review','returned','approved','active','expired',
    'archived','changes_requested','rejected','closed'
  ));
