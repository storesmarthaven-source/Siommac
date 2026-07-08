-- ============================================================================
-- SIOMAC ERP — WAVE 2B PENDING MIGRATIONS, COMPILED (generated 2026-07-08)
--
-- One-shot operator script: the 6 migrations added after the last apply batch,
-- for the Wave 2B per-page fleet + Phase-0. Verified against the live DB by
-- real-select probe (5 genuinely unapplied; 000100 is add-column-if-not-exists so
-- safe to re-run). Apply ONCE in the Supabase SQL editor — it self-runs NOTIFY at end.
--
-- Faithful concatenation of the individual migration files (unchanged bodies), in
-- filename order. All statements are idempotent EXCEPT the create policy calls in
-- 000060 — those tables are currently absent, so first apply is clean; do not re-run.
-- Wrapped in one transaction (all-or-nothing).
--
-- Files (supabase/migrations/ — tracked source of truth):
--   1. 20260917000060_finance_2b_attachment_tables.sql
--   2. 20260917000070_finance_2b_phase0_grants.sql
--   3. 20260917000080_finance_remittances_filing_fields.sql
--   4. 20260917000100_finance_expense_line_fields.sql
--   5. 20260917000110_finance_payroll_run_scheduling.sql
--   6. 20260917000120_finance_2b_page_grants.sql
-- ============================================================================

begin;

-- ============================================================================
-- (1/6)  20260917000060_finance_2b_attachment_tables.sql
-- ============================================================================

-- ============================================================================
-- Finance Wave 2B — per-entity attachment tables (disbursement / budget / payroll)
-- ============================================================================
-- Creates:
--   finance_disbursement_attachments  (bank-file support docs per disbursement)
--   finance_budget_attachments        (budget support docs per budget line)
--   finance_payroll_attachments       (payroll support docs per run)
--
-- Pattern is identical to finance_expense_attachments and
-- finance_remittance_attachments shipped in 20260917000040.
--
-- All tables:
--   • Primary key: uuid (gen_random_uuid)
--   • FK to the parent entity (NOT NULL, ON DELETE CASCADE)
--   • uploaded_by: TEXT references public.app_users(id) — TEXT, not uuid
--   • No tenant_id — SIOMAC is single-tenant
--   • RLS enabled; only the service_role client (Netlify Lambda) has access
--   • created_at timestamptz (immutable rows — no updated_at trigger needed)
--
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. finance_disbursement_attachments ──────────────────────────────────────
-- Bank-file proof, payment confirmation letters, or any supporting document
-- attached to a disbursement record.

create table if not exists public.finance_disbursement_attachments (
  id               uuid         primary key default gen_random_uuid(),
  disbursement_id  uuid         not null
                   references public.finance_disbursements(id) on delete cascade,
  file_name        text         not null check (char_length(file_name) <= 255),
  file_size        integer      check (file_size > 0),    -- bytes; null = unknown
  content_type     text,
  storage_path     text         not null,                 -- relative path in finance-receipts bucket
  uploaded_by      text         references public.app_users(id) on delete set null,
  created_at       timestamptz  not null default now()
);

create index if not exists fda_disbursement_idx
  on public.finance_disbursement_attachments(disbursement_id);

alter table public.finance_disbursement_attachments enable row level security;

create policy "service_role_bypass_finance_disbursement_attachments"
  on public.finance_disbursement_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_disbursement_attachments to service_role;

-- ── 2. finance_budget_attachments ────────────────────────────────────────────
-- Budget approval documents, cost justification attachments, actuals supporting
-- evidence attached to a budget line.

create table if not exists public.finance_budget_attachments (
  id              uuid         primary key default gen_random_uuid(),
  budget_line_id  uuid         not null
                  references public.finance_budget_lines(id) on delete cascade,
  file_name       text         not null check (char_length(file_name) <= 255),
  file_size       integer      check (file_size > 0),
  content_type    text,
  storage_path    text         not null,
  uploaded_by     text         references public.app_users(id) on delete set null,
  created_at      timestamptz  not null default now()
);

create index if not exists fba_budget_line_idx
  on public.finance_budget_attachments(budget_line_id);

alter table public.finance_budget_attachments enable row level security;

create policy "service_role_bypass_finance_budget_attachments"
  on public.finance_budget_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_budget_attachments to service_role;

-- ── 3. finance_payroll_attachments ───────────────────────────────────────────
-- Board resolutions, payroll approval evidence, statutory calculation schedules,
-- or any supporting document attached to a payroll run.

create table if not exists public.finance_payroll_attachments (
  id          uuid         primary key default gen_random_uuid(),
  run_id      uuid         not null
              references public.finance_payroll_runs(id) on delete cascade,
  file_name   text         not null check (char_length(file_name) <= 255),
  file_size   integer      check (file_size > 0),
  content_type text,
  storage_path text        not null,
  uploaded_by  text        references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists fpa_run_idx
  on public.finance_payroll_attachments(run_id);

alter table public.finance_payroll_attachments enable row level security;

create policy "service_role_bypass_finance_payroll_attachments"
  on public.finance_payroll_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_payroll_attachments to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (2/6)  20260917000070_finance_2b_phase0_grants.sql
-- ============================================================================

-- ============================================================================
-- 20260917000070_finance_2b_phase0_grants.sql
--
-- role_permissions grants for the 3 NEW permission keys introduced by the
-- Wave 2B Phase-0 attachments + bridges routes. Mirrors the static
-- ROLE_PERMISSIONS map exactly (BE + FE catalogues + permissionMeta already
-- carry these keys).
--
-- Root cause reminder: role_permissions is the RUNTIME authority
-- (loadRolePermissions falls back to the static map ONLY for a role with zero
-- rows). Every affected role already has rows, so a route-enforced key that is
-- not granted here 403s. superadmin needs no rows (allow-all in code).
--
-- Grant model (mirrors the sibling finance.expenses.*/finance.remittances.*
-- holders):
--   finance.expenses.receipt.upload             → finance_staff, finance_manager
--   finance.remittances.receipt.upload          → finance_staff, finance_manager, admin
--   finance.expenses.handoff.create_reimbursement → finance_manager
-- (admin holds no finance.expenses.* keys, so the expense keys are not granted
--  to admin — consistent with the existing catalogue.)
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- (role grants are also cached in-process for 30s — no server restart needed)
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('finance_staff',   'finance.expenses.receipt.upload'),
  ('finance_staff',   'finance.remittances.receipt.upload'),
  ('finance_manager', 'finance.expenses.receipt.upload'),
  ('finance_manager', 'finance.remittances.receipt.upload'),
  ('finance_manager', 'finance.expenses.handoff.create_reimbursement'),
  ('admin',           'finance.remittances.receipt.upload')
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (3/6)  20260917000080_finance_remittances_filing_fields.sql
-- ============================================================================

-- ============================================================================
-- Finance Wave 2B — Remittances filing-detail columns (§12 Aurora rebuild)
-- ============================================================================
-- Adds three columns to finance_remittances to support the full Mark-Filed
-- dialog: filing method, receipt reference from the authority, and freeform
-- notes. These complement the existing authority_reference column (general
-- filing ref) and filed_date.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.finance_remittances
  add column if not exists filing_method     text,      -- online_portal | in_person | courier | eft
  add column if not exists receipt_reference text,      -- receipt no. issued by the authority
  add column if not exists filed_notes       text;      -- free-form notes about the filing

-- ============================================================================
-- (4/6)  20260917000100_finance_expense_line_fields.sql
-- ============================================================================

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

-- ============================================================================
-- (5/6)  20260917000110_finance_payroll_run_scheduling.sql
-- ============================================================================

-- ============================================================================
-- Finance Payroll — Run Scheduling Fields (Wave 2B §20 Gap 7)
-- Adds pay_group, pay_date, cut_off_date to finance_payroll_runs.
-- ============================================================================

alter table public.finance_payroll_runs
  add column if not exists pay_group     text,           -- e.g. 'general','executive','contract'
  add column if not exists pay_date      date,           -- date employees are paid
  add column if not exists cut_off_date  date;           -- changes after this date not included

comment on column public.finance_payroll_runs.pay_group    is 'Employee group label for this run (e.g. general, executive, contract). Free text; no FK.';
comment on column public.finance_payroll_runs.pay_date     is 'Actual date employees receive payment. May differ from period end.';
comment on column public.finance_payroll_runs.cut_off_date is 'Changes (overtime, pay items, etc.) after this date are excluded from the run.';

-- ============================================================================
-- (6/6)  20260917000120_finance_2b_page_grants.sql
-- ============================================================================

-- ============================================================================
-- 20260917000120_finance_2b_page_grants.sql
--
-- role_permissions grants for the 8 NEW permission keys introduced by the
-- Wave 2B per-page fleet (Statutory / Remittances / Disbursements / Budgets).
-- BE + FE catalogues + permissionMeta already carry these keys.
--
-- role_permissions is the RUNTIME authority for BOTH backend enforcement AND
-- frontend can() (the FE loads the user's resolved permissions from the server,
-- which reads this table — the static ROLE_PERMISSIONS maps are fallback/docs).
-- A route-enforced key ungranted here 403s.
--
-- All 8 are manage/approve-level actions. finance_staff is view-only for
-- budgets/statutory/disbursements and lacks the approve-level siblings, so the
-- keys go to finance_manager + admin only (consistent with the existing
-- finance.budgets.manage / finance.disbursement.approve / finance.remittances.approve
-- / finance.statutory.manage holders). superadmin needs no rows (allow-all in code).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('finance_manager', 'finance.statutory.nis_class.delete'),
  ('finance_manager', 'finance.statutory.nis_class.import'),
  ('finance_manager', 'finance.remittances.mark_filed'),
  ('finance_manager', 'finance.budgets.bulk_upsert'),
  ('finance_manager', 'finance.budgets.copy_last_year'),
  ('finance_manager', 'finance.budgets.attachments.upload'),
  ('finance_manager', 'finance.budgets.attachments.delete'),
  ('finance_manager', 'finance.disbursement.bank_file.download'),
  ('admin',           'finance.statutory.nis_class.delete'),
  ('admin',           'finance.statutory.nis_class.import'),
  ('admin',           'finance.remittances.mark_filed'),
  ('admin',           'finance.budgets.bulk_upsert'),
  ('admin',           'finance.budgets.copy_last_year'),
  ('admin',           'finance.budgets.attachments.upload'),
  ('admin',           'finance.budgets.attachments.delete'),
  ('admin',           'finance.disbursement.bank_file.download')
on conflict do nothing;

-- Clean up orphaned camelCase budget grants from 20260807000001 (a latent F5
-- deviation; the keys were never catalogued/enforced until Wave 2B, which
-- standardised them to snake_case above). These rows grant keys that no longer
-- exist in the catalogue — harmless but tidy to remove.
delete from public.role_permissions
where permission in ('finance.budgets.bulkUpsert', 'finance.budgets.copyLastYear');

-- After applying, run: NOTIFY pgrst, 'reload schema';

commit;

-- Reload PostgREST schema cache so the new tables/columns are queryable immediately.
notify pgrst, 'reload schema';
