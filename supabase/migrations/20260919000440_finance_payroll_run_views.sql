-- 20260919000440_finance_payroll_run_views.sql
-- Saved filter views for the Payroll Runs Register (spec §15.2). A view stores a validated
-- PayrollRunListRequest filter set (never cached payroll values). Personal views belong to their owner;
-- team views are visible to everyone with payroll view access and managed only by run managers.
-- Read/write flows through the authenticated Netlify API (service_role); RLS denies anon/authenticated.

create table if not exists public.finance_payroll_run_views (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null references public.app_users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  scope       text not null default 'personal' check (scope in ('personal', 'team')),
  -- Validated PayrollRunViewFilters (search/states/runTypes/payGroupIds/period/sort). NEVER run rows.
  filters     jsonb not null default '{}'::jsonb,
  created_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A user cannot save two views with the same name at the same scope.
  unique (owner_id, scope, name)
);

create index if not exists finance_payroll_run_views_owner_idx on public.finance_payroll_run_views(owner_id);
create index if not exists finance_payroll_run_views_scope_idx on public.finance_payroll_run_views(scope) where scope = 'team';

-- updated_at trigger (drop-first so re-apply is idempotent).
drop trigger if exists finance_payroll_run_views_set_updated_at on public.finance_payroll_run_views;
create trigger finance_payroll_run_views_set_updated_at
  before update on public.finance_payroll_run_views
  for each row execute function public.set_updated_at();

alter table public.finance_payroll_run_views enable row level security;

revoke all on public.finance_payroll_run_views from public;
revoke all on public.finance_payroll_run_views from anon;
revoke all on public.finance_payroll_run_views from authenticated;
grant select, insert, update, delete on public.finance_payroll_run_views to service_role;

comment on table public.finance_payroll_run_views is
  'Saved filter views for the payroll runs register (spec §15.2). filters = validated PayrollRunViewFilters; never cached payroll values. Personal = owner-only; team = shared, managed by run managers. Accessed via authenticated Netlify API only.';
