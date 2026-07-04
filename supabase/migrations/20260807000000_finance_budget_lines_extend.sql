-- ============================================================================
-- Finance Budgeting — extend finance_budget_lines at source
-- ============================================================================
-- The skeleton table finance_budget_lines (cost_center_id, fiscal_year, category,
-- budgeted, actual, currency, timestamps) was created in
-- 20260621100003_erp_hr_payroll_finance_ops_core.sql.
-- This migration ALTERS it at source to add the columns a real module needs,
-- adds an updated_at trigger, a unique constraint, RLS service_role bypass,
-- and service_role grants.
--
-- Columns added:
--   • label text          — human-readable budget line label
--   • notes text          — optional narrative / justification
--   • created_by text FK  → app_users(id)
--
-- The `actual` column is NOT used for live actuals — the backend aggregates
-- finance_cost_entries.amount at query time.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Add new columns ────────────────────────────────────────────────────────

alter table public.finance_budget_lines
  add column if not exists label      text,
  add column if not exists notes      text,
  add column if not exists created_by text references public.app_users(id) on delete set null;

-- ── 2. updated_at trigger (idempotent) ────────────────────────────────────────

create or replace function public.set_finance_budget_lines_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fbl_updated_at on public.finance_budget_lines;
create trigger trg_fbl_updated_at
  before update on public.finance_budget_lines
  for each row execute function public.set_finance_budget_lines_updated_at();

-- ── 3. Unique constraint on (cost_center_id, fiscal_year, category) ───────────

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finance_budget_lines'::regclass
      and conname  = 'fbl_cc_year_category_uniq'
  ) then
    alter table public.finance_budget_lines
      add constraint fbl_cc_year_category_uniq
        unique (cost_center_id, fiscal_year, category);
  end if;
end;
$$;

-- ── 4. RLS: service_role bypass (idempotent) ──────────────────────────────────
-- RLS is already enabled by the skeleton migration.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'finance_budget_lines'
      and policyname = 'service_role_bypass_finance_budget_lines'
  ) then
    execute $p$
      create policy "service_role_bypass_finance_budget_lines"
        on public.finance_budget_lines
        using (auth.role() = 'service_role')
    $p$;
  end if;
end;
$$;

-- ── 5. Service-role grants ────────────────────────────────────────────────────

grant select, insert, update, delete
  on public.finance_budget_lines to service_role;

-- finance_cost_centers and finance_cost_entries are READ-ONLY for this module.
-- Prior migrations already grant service_role on cost_entries; these are idempotent.
grant select on public.finance_cost_centers to service_role;
grant select on public.finance_cost_entries  to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
