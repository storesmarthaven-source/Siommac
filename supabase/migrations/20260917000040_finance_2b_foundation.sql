-- ============================================================================
-- Finance Wave 2B Foundation — shared attachment tables + reimbursement handoffs
-- ============================================================================
-- Creates:
--   storage bucket  finance-receipts          (private; used by all Finance attachments)
--   table           finance_expense_attachments     (multi-doc support per claim)
--   table           finance_remittance_attachments  (filing slips, payment confirmations)
--   table           finance_reimbursement_handoffs  (idempotency bridge per expense claim)
--
-- The existing finance_expense_claims.receipt_path column is left in place (single-
-- receipt fast-path); finance_expense_attachments is the multi-doc store that sits
-- alongside it.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Finance-receipts storage bucket (private) ─────────────────────────────
-- Used for expense receipts, remittance confirmation slips, and general Finance
-- file attachments. Created idempotently so re-running this migration is safe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-receipts',
  'finance-receipts',
  false,
  10485760,   -- 10 MB hard limit
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- ── 2. finance_expense_attachments ───────────────────────────────────────────
-- Multi-attachment store for expense claims. Each row is one file.
-- Supports receipts, supporting documents, approval confirmation PDFs, etc.

create table if not exists public.finance_expense_attachments (
  id             uuid         primary key default gen_random_uuid(),
  claim_id       uuid         not null
                 references public.finance_expense_claims(id) on delete cascade,
  file_name      text         not null check (char_length(file_name) <= 255),
  file_size      integer      check (file_size > 0),    -- bytes; null = unknown
  content_type   text,
  storage_path   text         not null,                 -- relative path in finance-receipts bucket
  uploaded_by    text         references public.app_users(id) on delete set null,
  created_at     timestamptz  not null default now()
);

create index if not exists fea_claim_idx
  on public.finance_expense_attachments(claim_id);

alter table public.finance_expense_attachments enable row level security;

-- service_role bypass (all access flows through the Netlify service-role client)
create policy "service_role_bypass_finance_expense_attachments"
  on public.finance_expense_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_expense_attachments to service_role;

-- ── 3. finance_remittance_attachments ────────────────────────────────────────
-- Filing confirmation slips, BIR/NIBTT payment receipts, supporting schedules.

create table if not exists public.finance_remittance_attachments (
  id               uuid         primary key default gen_random_uuid(),
  remittance_id    uuid         not null
                   references public.finance_remittances(id) on delete cascade,
  file_name        text         not null check (char_length(file_name) <= 255),
  file_size        integer      check (file_size > 0),
  content_type     text,
  storage_path     text         not null,
  uploaded_by      text         references public.app_users(id) on delete set null,
  created_at       timestamptz  not null default now()
);

create index if not exists fra_remittance_idx
  on public.finance_remittance_attachments(remittance_id);

alter table public.finance_remittance_attachments enable row level security;

create policy "service_role_bypass_finance_remittance_attachments"
  on public.finance_remittance_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_remittance_attachments to service_role;

-- ── 4. finance_reimbursement_handoffs ────────────────────────────────────────
-- Bridge table: tracks the cross-module handoff (Expenses → Payroll or Finance-AP)
-- that triggers reimbursement processing for an approved expense claim.
--
-- The UNIQUE constraint on expense_claim_id makes createReimbursementHandoff()
-- idempotent — a duplicate call catches the conflict and returns the existing row
-- rather than creating a second handoff for the same claim.

create table if not exists public.finance_reimbursement_handoffs (
  id                uuid         primary key default gen_random_uuid(),
  expense_claim_id  uuid         not null
                    references public.finance_expense_claims(id) on delete cascade,
  -- TEXT (not uuid) — handoff_outbox.id is 'hox-<ulid>'
  handoff_id        text         not null,
  -- Optional back-reference to the payroll run that initiated the reimbursement
  payroll_run_id    uuid,
  -- Mirrors handoff_outbox status for quick querying without a join
  status            text         not null default 'pending'
                    check (status in ('pending', 'processing', 'completed', 'failed', 'manual_review')),
  error_message     text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz,
  -- Idempotency: at most one active handoff record per claim
  unique (expense_claim_id)
);

create index if not exists frh_status_idx
  on public.finance_reimbursement_handoffs(status)
  where status in ('pending', 'failed');

-- updated_at trigger
create or replace function public.set_finance_reimbursement_handoffs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_frh_updated_at on public.finance_reimbursement_handoffs;
create trigger trg_frh_updated_at
  before update on public.finance_reimbursement_handoffs
  for each row execute function public.set_finance_reimbursement_handoffs_updated_at();

alter table public.finance_reimbursement_handoffs enable row level security;

create policy "service_role_bypass_finance_reimbursement_handoffs"
  on public.finance_reimbursement_handoffs
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_reimbursement_handoffs to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
