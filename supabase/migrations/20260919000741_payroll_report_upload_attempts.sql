-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 2/6: upload-attempt ledger
-- ============================================================================
-- Durable record of every Storage upload attempt, written BEFORE the object is
-- uploaded (register_upload_attempt_tx). This makes an "uploaded-but-not-yet-
-- committed" object discoverable without listing the whole bucket, so a worker
-- that crashes between upload and complete_tx leaves a reclaimable orphan.
--
-- The path is attempt-specific and immutable:
--   payroll-report-artifacts/<job_id>/<claim_token>/<sha256>.<ext>
-- so a displaced worker's late upload lands on its OWN path and never clobbers
-- the winner's committed object. The orphan reconciler removes uncommitted paths
-- during a 24h quarantine; committed rows are never removed.
-- Contract: §6 / §6A.
-- ============================================================================

create table if not exists public.payroll_report_upload_attempts (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null
                   references public.payroll_report_jobs(id) on delete cascade,
  claim_token      uuid not null,
  storage_path     text not null,
  -- Known before upload (the path embeds the content hash), so both are NOT NULL.
  sha256           text not null,
  byte_size        bigint not null,
  committed_at     timestamptz,
  last_cleanup_at  timestamptz,
  cleanup_attempts integer not null default 0,
  created_at       timestamptz not null default now()
);

-- One ledger row per (job, claim attempt); a re-registration of the same attempt
-- is idempotent (handled in register_upload_attempt_tx).
create unique index if not exists payroll_report_upload_attempts_job_token_idx
  on public.payroll_report_upload_attempts (job_id, claim_token);
-- No two attempts may ever record the same Storage path.
create unique index if not exists payroll_report_upload_attempts_path_idx
  on public.payroll_report_upload_attempts (storage_path);
-- Orphan reconciler scan: uncommitted rows, oldest first.
create index if not exists payroll_report_upload_attempts_orphan_idx
  on public.payroll_report_upload_attempts (committed_at, created_at);

alter table public.payroll_report_upload_attempts enable row level security;
revoke all on public.payroll_report_upload_attempts
  from public, anon, authenticated;
-- INSERT (register) + UPDATE (mark committed / bump cleanup) + DELETE (quarantine
-- expiry) + SELECT, all via service_role RPCs / reconciler.
grant select, insert, update, delete
  on public.payroll_report_upload_attempts to service_role;

comment on table public.payroll_report_upload_attempts is
  'Payroll Reports Center (F-12) upload-attempt ledger. Written BEFORE Storage '
  'upload so uncommitted objects are discoverable without a bucket list; drives '
  'the orphan reconciler (24h quarantine). service_role only.';
