-- ============================================================================
-- Atomic Workflow Creation — foundation schema (audit finding #3, migration 1/N)
-- Build plan: netlify/functions/lib/workflow/SUBMIT_TX_BUILD.md
-- Design rationale: netlify/functions/lib/workflow/SUBMIT_TX_DESIGN.md
-- ============================================================================
-- PURE SCHEMA (no functions) — the low-risk foundation the primitive + typed
-- wrappers build on. Operator-applied; idempotent. After applying:
--   NOTIFY pgrst, 'reload schema';
--
--   wf_internal (schema)            — private, NOT exposed via PostgREST; the
--                                     workflow-creation primitive + helpers live
--                                     here. service_role gets usage; per-function
--                                     execute grants land with those functions.
--   workflow_request_receipts       — client-request idempotency ledger. The
--                                     mutation RPCs claim (advisory lock) then
--                                     upsert a row keyed by request_key; a retry
--                                     with the same request_hash returns the
--                                     stored result (exactly-once across a lost
--                                     HTTP response). Replaces the ad-hoc
--                                     module_mutation_runs guard for start paths.
--   workflow_instances.supersedes_workflow_id — a resubmission links to the prior
--                                     (terminal) instance it superseded.
--
-- The notification-delivery durability track (retry columns + status expansion +
-- (notification_id,channel) unique + the scheduled worker) is a SEPARATE migration
-- with its own data-migration preflight — not bundled here.
-- ============================================================================

-- ── wf_internal private schema ────────────────────────────────────────────────
create schema if not exists wf_internal;
-- PostgREST exposes only `public` (+ configured schemas); wf_internal is therefore
-- unreachable via the API. service_role (backend only) may use it.
grant usage on schema wf_internal to service_role;
revoke usage on schema wf_internal from public;

-- ── workflow_request_receipts — request-key idempotency ledger ────────────────
create table if not exists wf_internal.workflow_request_receipts (
  request_key   text primary key,          -- org|actor|operation_family|client-key (built by the RPC)
  request_hash  text not null,             -- md5 over a canonical jsonb of all behaviorally-relevant inputs (computed in-RPC; md5 is a pg_catalog builtin — non-adversarial idempotency fingerprint, not a security primitive)
  operation     text not null,             -- submit | create_and_start | start_bound | start_template
  module_key    text not null,
  source_id     text,                      -- business/source record id (text — source ids vary)
  workflow_id   uuid references public.workflow_instances(id),
  result        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_request_receipts_wf_idx
  on wf_internal.workflow_request_receipts(workflow_id);
alter table wf_internal.workflow_request_receipts enable row level security;
-- No policies: service_role bypasses RLS; the private schema is off the API surface.
-- BUT RLS-bypass is not GRANT-bypass: the migration-211 helpers run SECURITY INVOKER (as
-- the calling `service_role`), and wf_internal is a NEW schema NOT covered by the standard
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`. Without explicit table privs
-- those helpers fail with "permission denied for table workflow_request_receipts". Grant
-- them here, and set default privileges so the 211+ helper tables inherit the grant.
grant select, insert, update, delete on wf_internal.workflow_request_receipts to service_role;
alter default privileges in schema wf_internal grant select, insert, update, delete on tables to service_role;
alter default privileges in schema wf_internal grant usage, select on sequences to service_role;

-- ── workflow_instances.supersedes_workflow_id ─────────────────────────────────
alter table public.workflow_instances
  add column if not exists supersedes_workflow_id uuid references public.workflow_instances(id);
create index if not exists workflow_instances_supersedes_idx
  on public.workflow_instances(supersedes_workflow_id) where supersedes_workflow_id is not null;

-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- NEXT (migration 211): wf_internal._claim_request, _resolve_and_validate_assignee,
-- _enqueue_notification, _create_instance (the primitive). Then 212 + wiring: the
-- first vertical slice (payroll-run submit) proving the Shape-A pattern end-to-end.
