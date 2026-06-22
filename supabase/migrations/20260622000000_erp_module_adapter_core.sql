-- ── Step 16: Module mutation run tracking ────────────────────────────────────
-- Provides idempotency, failure recovery, and cross-stage observability for
-- every cross-cutting mutation that touches record + event + workflow + handoff.
-- Each runModuleMutation() call writes one row here; the status column advances
-- through: started → record_written → event_emitted → workflow_created →
-- handoffs_created → completed (or failed at any point).

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

alter table public.module_mutation_runs enable row level security;

-- Admins can read all runs for diagnostics
create policy "admins_read_module_mutation_runs"
  on public.module_mutation_runs for select
  using (true);

create index if not exists module_mutation_runs_module_idx
  on public.module_mutation_runs(module, entity_type, entity_id, created_at desc);

create index if not exists module_mutation_runs_actor_idx
  on public.module_mutation_runs(actor_user_id, created_at desc);

create index if not exists module_mutation_runs_status_idx
  on public.module_mutation_runs(status, created_at desc);

create index if not exists module_mutation_runs_idem_idx
  on public.module_mutation_runs(idempotency_key);
