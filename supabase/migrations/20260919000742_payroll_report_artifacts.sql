-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 3/6: generated artifacts
-- ============================================================================
-- One immutable, checksummed artifact per succeeded job (unique(job_id)). The
-- base row is APPEND-ONLY, enforced by the GRANT (no blanket UPDATE), following
-- the finance_payroll_finding_activity precedent. The ONLY mutable fields are the
-- purge-saga columns, exposed through a COLUMN-LEVEL update grant so the purge
-- worker can drive active → purging → purged (and record purge_error) but nothing
-- can ever rewrite the artifact's identity, checksum, retention, or auth gates.
--
-- Authorization mirrors the job: two independent, server-derived booleans.
-- Download enforces every stored requirement; history omits rows missing any.
-- Contract: §6 / §6B (purge saga with crash recovery).
-- ============================================================================

create table if not exists public.payroll_report_artifacts (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null
                         references public.payroll_report_jobs(id) on delete cascade,
  storage_path           text not null,
  content_type           text not null,
  byte_size              bigint not null,
  sha256                 text not null,
  scope                  jsonb not null,
  scope_id               text not null,
  row_count              integer not null default 0,
  retention_class        text not null,
  retention_expires_at   timestamptz not null,
  -- Server-derived record/output authorization (§5C), copied from the job.
  requires_view_all      boolean not null,
  requires_export        boolean not null,
  -- preview is never persisted — file formats only.
  format                 text not null
                         check (format in ('xlsx', 'csv', 'pdf', 'zip')),
  created_by             text references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  -- ── Purge saga (worker-owned; the ONLY mutable columns) ──────────────────
  purge_state            text not null default 'active'
                         check (purge_state in ('active', 'purging', 'purged')),
  purged_at              timestamptz,
  purge_token            uuid,
  purge_lease_expires_at timestamptz,
  purge_attempts         integer not null default 0,
  purge_error            jsonb
);

-- Exactly one artifact per job.
create unique index if not exists payroll_report_artifacts_job_idx
  on public.payroll_report_artifacts (job_id);
-- Retention / purge claim scan: due-for-purge, active or stranded-purging.
create index if not exists payroll_report_artifacts_purge_idx
  on public.payroll_report_artifacts (purge_state, retention_expires_at, purge_lease_expires_at);
-- History keyset (created_at desc, id).
create index if not exists payroll_report_artifacts_history_idx
  on public.payroll_report_artifacts (created_at desc, id);

alter table public.payroll_report_artifacts enable row level security;
revoke all on public.payroll_report_artifacts from public, anon, authenticated;
-- Append-only base: SELECT + INSERT + DELETE (retention/sweeper), NO table-level
-- UPDATE. DELETE stays so the sweeper + job CASCADE can clean up.
grant select, insert, delete on public.payroll_report_artifacts to service_role;
-- Column-level UPDATE grant for the purge worker (active → purging → purged,
-- lease/token/attempts/error). NOTE: on this Supabase project service_role holds
-- blanket table privileges, so this column grant does not by itself constrain
-- service_role (same as every table here); base-column immutability is enforced
-- by RPC discipline (no route/RPC ever rewrites identity/checksum/retention/auth).
-- The grant IS the real boundary for anon/authenticated (both fully revoked above)
-- and is contract-mandated defense-in-depth. An immutability trigger was avoided
-- deliberately: it would block the created_by ON DELETE SET NULL cascade.
grant update (
  purge_state,
  purged_at,
  purge_token,
  purge_lease_expires_at,
  purge_attempts,
  purge_error
) on public.payroll_report_artifacts to service_role;

comment on table public.payroll_report_artifacts is
  'Payroll Reports Center (F-12) generated file artifacts. Append-only base '
  '(RPC-discipline enforced; anon/authenticated fully revoked; column UPDATE '
  'grant scoped to the purge-saga columns). One per job; downloads gate on '
  'requires_view_all/requires_export. service_role only.';
