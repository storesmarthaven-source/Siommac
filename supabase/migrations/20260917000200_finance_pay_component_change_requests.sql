-- ============================================================================
-- Finance Pay Components — change-request envelope table
-- ============================================================================
-- Each create/update/retire action on a pay component is deferred through this
-- table until a DIFFERENT finance_manager approves it (segregation of duties).
-- The adapter (financePayComponentAdapter.ts) applies the change on approval.
--
-- change_type: 'create'  → component_id is null; payload carries all fields.
--              'update'  → component_id set; payload carries the delta only.
--              'retire'  → component_id set; payload is {}.
--
-- status lifecycle: pending_approval → approved | rejected
-- Approved rows are terminal (the adapter has written the live component row).
-- Rejected rows are terminal (no change was applied).
-- ============================================================================

create table public.finance_pay_component_change_requests (
  id           uuid        primary key default gen_random_uuid(),
  change_type  text        not null check (change_type in ('create','update','retire')),
  component_id uuid        null references public.finance_pay_components(id),
  payload      jsonb       not null,
  status       text        not null check (status in ('pending_approval','approved','rejected'))
                           default 'pending_approval',
  created_by   text        references public.app_users(id),
  approved_by  text        references public.app_users(id),
  workflow_id  uuid        null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- updated_at trigger
create trigger trg_finance_pay_component_change_requests_updated_at
  before update on public.finance_pay_component_change_requests
  for each row execute function public.set_updated_at();

-- RLS (service_role manages these rows; anon/authed never touch them directly)
alter table public.finance_pay_component_change_requests enable row level security;

-- Deny all by default; only service_role (bypasses RLS) and the Netlify
-- function's service-role client read/write these rows.
create policy "deny all for anon" on public.finance_pay_component_change_requests
  as restrictive for all to anon using (false);

-- service_role grants (used by the Netlify function)
grant select, insert, update, delete
  on public.finance_pay_component_change_requests to service_role;

-- After applying: NOTIFY pgrst, 'reload schema';
