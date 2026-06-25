-- ============================================================================
-- 20260629000000_expose_module_mutation_runs.sql
-- ----------------------------------------------------------------------------
-- FIX: module-mutation idempotency was silently broken because
-- public.module_mutation_runs was absent from PostgREST's schema cache on the
-- remote project. The table's only creating migration
-- (20260622000000_erp_module_adapter_core.sql) was never applied here and was
-- omitted from the curated apply-pending-migrations bundle — so every probe of
-- the table returned HTTP 404 / PGRST205 ("Could not find the table
-- 'public.module_mutation_runs' in the schema cache").
--
-- With no ledger table, startMutationRun / markMutationRunStage /
-- completeMutationRun all failed; their errors were swallowed, so the dedup
-- short-circuit in runModuleMutation() (which only fires on a status='completed'
-- row) never triggered and duplicate records were created for identical /
-- retried requests.
--
-- This migration is IDEMPOTENT and SELF-HEALING: it (re)creates the table if
-- absent, (re)asserts RLS + policy + indexes, GRANTs the backend service role,
-- and reloads PostgREST. Safe to run repeatedly, and correct whether or not
-- 20260622000000 was previously applied. Run in the Supabase SQL editor.
-- ============================================================================

-- ── Table (canonical definition, mirrors 20260622000000) ─────────────────────
create table if not exists public.module_mutation_runs (
  id               uuid primary key default gen_random_uuid(),

  idempotency_key  text not null unique,

  module           text not null,
  operation        text not null,
  entity_type      text not null,
  entity_id        text,
  entity_ref       text,

  actor_user_id    text references public.app_users(id),

  status text not null default 'started'
    check (status in (
      'started','record_written','event_emitted',
      'workflow_created','handoffs_created','completed','failed'
    )),

  stage            text not null default 'started',

  request_payload  jsonb not null default '{}'::jsonb,
  result_payload   jsonb not null default '{}'::jsonb,
  error            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

-- ── RLS (service role bypasses; this internal ledger is not browser-exposed) ──
alter table public.module_mutation_runs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'module_mutation_runs'
      and policyname = 'admins_read_module_mutation_runs'
  ) then
    create policy "admins_read_module_mutation_runs"
      on public.module_mutation_runs for select using (true);
  end if;
end $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists module_mutation_runs_module_idx
  on public.module_mutation_runs(module, entity_type, entity_id, created_at desc);
create index if not exists module_mutation_runs_actor_idx
  on public.module_mutation_runs(actor_user_id, created_at desc);
create index if not exists module_mutation_runs_status_idx
  on public.module_mutation_runs(status, created_at desc);
create index if not exists module_mutation_runs_idem_idx
  on public.module_mutation_runs(idempotency_key);

-- ── Grants ───────────────────────────────────────────────────────────────────
-- The ONLY consumer is the backend service-role client
-- (netlify/functions/lib/db.ts → sb). Granting service_role explicitly
-- guarantees PostgREST exposes the table and accepts writes even where Supabase
-- default privileges did not cover it. Deliberately NOT granted to
-- anon/authenticated: ERP data is backend-only (no direct browser reads), and
-- this run ledger must never be reachable through the public Data API.
grant all on public.module_mutation_runs to service_role;

-- ── Reload PostgREST so the table is visible to the API immediately ──────────
notify pgrst, 'reload schema';

-- ── Verification (uncomment to confirm after applying) ───────────────────────
-- select 'module_mutation_runs exposed' as check, count(*) as rows
--   from public.module_mutation_runs;
