-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 1/6: durable report job queue
-- ============================================================================
-- Backs worker-generated file exports (xlsx/csv/pdf/zip). Preview reports never
-- create a job (they compute inline). A job is claimed by the generation worker
-- with a fencing claim_token + lease (see 20260919000744 RPCs), modelled on the
-- workflow-outbox claim pattern.
--
-- Authorization is stored as two INDEPENDENT, server-derived booleans
-- (requires_view_all / requires_export) — never a single mutually-exclusive
-- class, never client-supplied. The route derives them from report_key + format.
--
-- FK note: `artifact_id → payroll_report_artifacts(id) ON DELETE SET NULL` is
-- added later (20260919000743) to break the jobs↔artifacts cycle.
-- Contract: docs/module-contracts/PAYROLL_REPORTS_DELIVERY_CONTRACT.md §6.
-- ============================================================================

create table if not exists public.payroll_report_jobs (
  id                uuid primary key default gen_random_uuid(),
  report_key        text not null,
  params            jsonb not null,
  format            text not null
                    check (format in ('xlsx', 'csv', 'pdf', 'zip')),
  scope             jsonb not null,
  scope_id          text not null,
  -- Enqueuer. Nullable + ON DELETE SET NULL so deleting a user never blocks
  -- (evidence-table lesson); the enqueue RPC validates the actor is active.
  requested_by      text references public.app_users(id) on delete set null,
  request_hash      text not null,
  idempotency_key   text not null,
  -- Server-derived record/output authorization (§5C). The client cannot supply.
  requires_view_all boolean not null,
  requires_export   boolean not null,
  state             text not null default 'queued'
                    check (state in ('queued', 'running', 'succeeded', 'failed')),
  attempts          integer not null default 0,
  max_attempts      integer not null default 3,
  claim_token       uuid,
  lease_expires_at  timestamptz,
  error             jsonb,
  -- artifact_id added in 20260919000743 (deferred to break the FK cycle).
  started_at        timestamptz,
  completed_at      timestamptz,
  failed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Idempotent enqueue: one job per (enqueuer, idempotency key). Divergent content
-- on the same key → 409 (enforced in enqueue_tx before this constraint is hit).
create unique index if not exists payroll_report_jobs_idem_idx
  on public.payroll_report_jobs (requested_by, idempotency_key);

-- Worker claim scan: queued, or running with an expired lease.
create index if not exists payroll_report_jobs_claim_idx
  on public.payroll_report_jobs (state, lease_expires_at);

create trigger payroll_report_jobs_touch
  before update on public.payroll_report_jobs
  for each row execute function public.set_updated_at();

alter table public.payroll_report_jobs enable row level security;
revoke all on public.payroll_report_jobs from public, anon, authenticated;
-- Server-side only: every read/write goes through service_role RPCs / routes.
grant select, insert, update, delete on public.payroll_report_jobs to service_role;

comment on table public.payroll_report_jobs is
  'Payroll Reports Center (F-12) durable job queue for worker-generated file '
  'exports. Claimed with a fencing claim_token + lease; requires_view_all / '
  'requires_export are server-derived, never client-supplied. service_role only.';
