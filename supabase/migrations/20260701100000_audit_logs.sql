-- ============================================================================
-- Global audit_logs table — §2 backbone ("write audit_logs" on every event).
--
-- emitAppEvent() (netlify/functions/lib/appEvents.ts) has always tried to write
-- an audit_logs row, but NO migration ever created the table — so the global
-- audit trail silently failed app-wide ("Could not find the table
-- 'public.audit_logs' in the schema cache"). This creates it to match the exact
-- insert shape: { action, table_name, record_id, user_id, changes, created_at }.
--
-- record_id is TEXT (it stores a human ref like 'INSP-2026-0001', not a uuid).
-- user_id is TEXT (app_users.id is TEXT).
--
-- After applying, reload the PostgREST schema cache so the API sees it:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.audit_logs (
  id          uuid    primary key default gen_random_uuid(),
  action      text    not null,                                   -- eventType, e.g. 'hse.inspection.created'
  table_name  text,                                               -- sourceEntityType, e.g. 'inspection'
  record_id   text,                                               -- sourceEntityId / ref
  user_id     text    references public.app_users(id) on delete set null,
  changes     jsonb   not null default '{}'::jsonb,               -- event payload
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_record_idx
  on public.audit_logs(table_name, record_id);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs(created_at desc);

create index if not exists audit_logs_user_idx
  on public.audit_logs(user_id)
  where user_id is not null;

alter table public.audit_logs enable row level security;
