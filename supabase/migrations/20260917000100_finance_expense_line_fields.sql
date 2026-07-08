-- ============================================================================
-- Finance Expenses — extend cost-entry lines + claim header (Wave 2B §14 gaps)
-- ============================================================================
-- Adds the per-line fields required by the §14 wizard spec to finance_cost_entries,
-- and adds purpose / department_id to finance_expense_claims.
--
-- Operator-applied after 20260806000000_finance_expense_claims.sql.
-- After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Extend finance_cost_entries with per-line fields ────────────────────────

alter table public.finance_cost_entries
  add column if not exists expense_date       date,
  add column if not exists category           text,
  add column if not exists project            text,
  add column if not exists tax_amount         numeric(15,2) not null default 0,
  add column if not exists merchant           text,
  add column if not exists receipt_required   boolean not null default false;

-- ── 2. Extend finance_expense_claims with header fields ────────────────────────

alter table public.finance_expense_claims
  add column if not exists purpose       text,
  add column if not exists department_id text;

-- ── 3. Service-role grants (idempotent — columns added above) ─────────────────

grant select, insert, update, delete
  on public.finance_cost_entries to service_role;

grant select, insert, update, delete
  on public.finance_expense_claims to service_role;

-- After applying: NOTIFY pgrst, 'reload schema';
