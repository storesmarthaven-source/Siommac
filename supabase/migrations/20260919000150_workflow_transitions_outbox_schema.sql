-- ============================================================================
-- Central Workflow Engine — atomic decisions: transition/outbox/receipt schema
-- (enterprise-hardening finding #2 — decisions non-transactional / race-prone)
-- ============================================================================
-- Foundation for the transactional-outbox decision path (design:
-- netlify/functions/lib/workflow/DECIDE_TX_DESIGN.md). This migration is PURE
-- SCHEMA (tables + columns + indexes + RLS) — no functions. Operator-applied;
-- idempotent; after applying run: NOTIFY pgrst, 'reload schema';
--
--   workflow_transitions      — the BUSINESS transition: identity + status +
--                               input_hash (semantic idempotency) + result.
--   workflow_outbox           — the DELIVERY queue for a transition, with fenced
--                               leases (lease_token) + backoff.
--   workflow_source_receipts  — per-transition proof that a module's source
--                               mutation committed (exactly-once observable
--                               effects; finalize refuses without it).
--   workflow_instances.active_transition_id — the concurrency gate: non-null ⇒
--                               instance is mid-transition, new commands refused.
--   workflow_decisions(task_id) partial unique — idempotency backstop.
--
-- All new tables: RLS enabled, no policies → only the backend service-role key
-- (which bypasses RLS) reads/writes them. Matches workflow_decisions/handoffs.
-- ============================================================================

-- ── workflow_transitions — the business transition (identity + status) ────────
create table if not exists public.workflow_transitions (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflow_instances(id) on delete cascade,
  task_id       uuid references public.workflow_tasks(id),
  -- record_only = decision recorded but the step still has open siblings, so no
  -- delivery is needed (instance stays in_progress, NOT gated). The other kinds
  -- carry a delivery job (resolve advance/complete, or finalize a terminal state).
  kind          text not null check (kind in (
                  'record_only','resolve_approved_step','finalize_returned','finalize_rejected','cancel')),
  decision      text check (decision in ('approved','returned','rejected','cancelled')),
  actor_id      text references public.app_users(id),
  input_hash    text not null,
  status        text not null default 'pending' check (status in (
                  'pending','processing','completed','failed','dead_letter')),
  result        jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
-- Exactly ONE transition per decided task — the uniform semantic-idempotency key
-- (input_hash + result live here; a retry returns result, a different payload →
-- 409). Cancel transitions have no task (null task_id) and are unconstrained.
create unique index if not exists workflow_transitions_task_uidx
  on public.workflow_transitions(task_id) where task_id is not null;
create index if not exists workflow_transitions_workflow_idx on public.workflow_transitions(workflow_id);
create index if not exists workflow_transitions_status_idx on public.workflow_transitions(status);
alter table public.workflow_transitions enable row level security;

-- ── workflow_instances.active_transition_id — the concurrency gate ────────────
-- Non-null ⇒ a decision has been atomically recorded but its TS side-effects have
-- not finished; every competing command refuses (409) except the finalize that
-- owns this transition. Cleared by workflow_finalize_transition_tx. (FK added
-- after workflow_transitions exists — circular ref is fine, both are nullable.)
alter table public.workflow_instances
  add column if not exists active_transition_id uuid references public.workflow_transitions(id);
create index if not exists workflow_instances_active_transition_idx
  on public.workflow_instances(active_transition_id) where active_transition_id is not null;

-- ── workflow_outbox — the delivery queue (fenced leases + backoff) ────────────
create table if not exists public.workflow_outbox (
  id               uuid primary key default gen_random_uuid(),
  transition_id    uuid not null references public.workflow_transitions(id) on delete cascade,
  status           text not null default 'pending' check (status in (
                     'pending','processing','completed','failed','dead_letter')),
  attempts         int  not null default 0,
  max_attempts     int  not null default 8,
  next_attempt_at  timestamptz not null default now(),
  lease_token      uuid,               -- fencing token: set on claim, required by finalize/fail
  lease_expires_at timestamptz,        -- a claim past this is reclaimable by the recovery worker
  locked_by        text,
  last_error       text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);
create unique index if not exists workflow_outbox_transition_uidx on public.workflow_outbox(transition_id);
create index if not exists workflow_outbox_claim_idx on public.workflow_outbox(status, next_attempt_at);
alter table public.workflow_outbox enable row level security;

-- ── workflow_source_receipts — proof the module source mutation committed ─────
-- A multi-write source adapter (e.g. payroll: source UPDATE + audit + event + GL)
-- writes this receipt inside its own module RPC, keyed by transition_id. On retry
-- the module RPC returns the stored result and writes nothing; finalize verifies
-- the receipt exists before marking the workflow terminal. Together: at-least-once
-- processing with exactly-once observable database effects.
create table if not exists public.workflow_source_receipts (
  transition_id uuid primary key references public.workflow_transitions(id) on delete cascade,
  module_key    text not null,
  source_id     text not null,
  input_hash    text not null,
  result        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_source_receipts_source_idx
  on public.workflow_source_receipts(module_key, source_id);
alter table public.workflow_source_receipts enable row level security;

-- ── workflow_decisions idempotency backstop ───────────────────────────────────
-- One decision row per task. task_id stays nullable (task-less decisions such as
-- cancel/admin_override exist), so a PARTIAL unique index is the correct backstop.
-- Guard first: a pre-existing duplicate is real corruption from the old
-- non-atomic path and must be surfaced, not silently indexed around.
do $$
declare d int;
begin
  select count(*) into d from (
    select task_id from public.workflow_decisions
    where task_id is not null group by task_id having count(*) > 1
  ) dup;
  if d > 0 then
    raise exception 'workflow_decisions has % task_id(s) with duplicate decision rows — clean these before enforcing the idempotency index', d;
  end if;
end $$;
create unique index if not exists workflow_decisions_task_uidx
  on public.workflow_decisions(task_id) where task_id is not null;

-- After applying:  NOTIFY pgrst, 'reload schema';
