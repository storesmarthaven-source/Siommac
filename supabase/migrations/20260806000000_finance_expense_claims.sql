-- ============================================================================
-- Finance Expenses — finance_expense_claims table + finance_cost_entries extension
-- ============================================================================
-- Creates finance_expense_claims (expense capture, approval, reimbursement).
-- ALTERs finance_cost_entries at SOURCE to add expense_claim_id FK.
--
-- Lifecycle: draft → submitted → approved → reimbursed (also rejected, cancelled)
-- SoD: claimant (creator) ≠ approver — enforced in the adapter.
-- Receipts: stored in a private Supabase Storage bucket 'finance-receipts'.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Expense claims table ───────────────────────────────────────────────────

create table if not exists public.finance_expense_claims (
  id              uuid        primary key default gen_random_uuid(),
  claim_no        text        not null unique,
  claimant_id     text        not null references public.app_users(id) on delete restrict,
  title           text        not null,
  expense_date    date        not null,
  category        text        not null,
  total_amount    numeric(15,2) not null,
  currency        text        not null default 'TTD',
  status          text        not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected','reimbursed','cancelled')),
  receipt_path    text,
  reimbursable    boolean     not null default true,
  reimbursed_at   timestamptz,
  approved_by     text        references public.app_users(id) on delete set null,
  created_by      text        references public.app_users(id) on delete set null,
  cancel_reason   text,
  reject_reason   text,
  workflow_id     uuid,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- index for claimant lookups
create index if not exists fec_claimant_idx
  on public.finance_expense_claims(claimant_id);

-- index for status filtering
create index if not exists fec_status_idx
  on public.finance_expense_claims(status);

-- updated_at trigger
create or replace function public.set_finance_expense_claims_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fec_updated_at on public.finance_expense_claims;
create trigger trg_fec_updated_at
  before update on public.finance_expense_claims
  for each row execute function public.set_finance_expense_claims_updated_at();

-- RLS
alter table public.finance_expense_claims enable row level security;

-- service_role bypass (functions use the service-role client)
create policy "service_role_bypass_finance_expense_claims"
  on public.finance_expense_claims
  using (auth.role() = 'service_role');

-- ── 2. Extend finance_cost_entries at SOURCE — add expense_claim_id FK ────────

alter table public.finance_cost_entries
  add column if not exists expense_claim_id uuid
    references public.finance_expense_claims(id) on delete cascade;

create index if not exists fce_claim_idx
  on public.finance_cost_entries(expense_claim_id)
  where expense_claim_id is not null;

-- service_role policy on finance_cost_entries (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'finance_cost_entries'
      and policyname = 'service_role_bypass_finance_cost_entries'
  ) then
    execute $p$
      create policy "service_role_bypass_finance_cost_entries"
        on public.finance_cost_entries
        using (auth.role() = 'service_role')
    $p$;
  end if;
end;
$$;

-- ── 3. Service-role grants ────────────────────────────────────────────────────

grant select, insert, update, delete
  on public.finance_expense_claims to service_role;

grant select, insert, update, delete
  on public.finance_cost_entries to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
