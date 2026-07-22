-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 4/6: jobs.artifact_id (deferred FK)
-- ============================================================================
-- Added AFTER payroll_report_artifacts exists to break the jobs↔artifacts FK
-- cycle. ON DELETE SET NULL (not CASCADE): the E2E cleanup deletes the JOB, which
-- CASCADEs to upload_attempts + artifacts; a SET NULL here means that cascade is
-- not itself a cycle. complete_tx sets this to the created artifact's id.
-- Contract: §6 "Migration rules".
-- ============================================================================

alter table public.payroll_report_jobs
  add column if not exists artifact_id uuid
  references public.payroll_report_artifacts(id) on delete set null;
