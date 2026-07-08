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
