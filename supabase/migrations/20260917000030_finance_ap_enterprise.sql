-- ============================================================================
-- Finance AP — Wave-2 enterprise extension (additive)
-- Adds columns to applied tables + 6 new satellite tables.
-- DO NOT EDIT: applies on top of 20260917000010_finance_accounts_payable.sql.
-- Operator-applied; the service does NOT run this. After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Extend finance_ap_vendors ─────────────────────────────────────────────
alter table public.finance_ap_vendors
  add column if not exists default_currency         text        not null default 'TTD',
  add column if not exists default_cost_center_id   uuid,
  add column if not exists preferred_payment_method text;

-- Drop old status check and replace with the extended enum
do $$
begin
  begin
    alter table public.finance_ap_vendors drop constraint if exists finance_ap_vendors_status_check;
  exception when others then null;
  end;
  begin
    alter table public.finance_ap_vendors
      add constraint finance_ap_vendors_status_check
      check (status in ('active', 'inactive', 'on_hold'));
  exception when duplicate_object then null;
  end;
end;
$$;

-- ── 2. Extend finance_ap_bills ───────────────────────────────────────────────
alter table public.finance_ap_bills
  add column if not exists vendor_invoice_no    text,
  add column if not exists reference            text,
  add column if not exists subtotal_amount      numeric(15,2) not null default 0,
  add column if not exists tax_amount           numeric(15,2) not null default 0,
  add column if not exists tax_included         boolean       not null default false,
  add column if not exists withholding_tax_code text,
  add column if not exists payment_terms_days   integer;

create index if not exists fap_bills_vendor_invoice_idx
  on public.finance_ap_bills(vendor_id, vendor_invoice_no)
  where vendor_invoice_no is not null;

-- ── 3. Extend finance_ap_bill_lines ─────────────────────────────────────────
alter table public.finance_ap_bill_lines
  add column if not exists quantity   numeric(15,4) not null default 1,
  add column if not exists unit_price numeric(15,2) not null default 0,
  add column if not exists tax_code   text,
  add column if not exists project_id uuid;

-- ── 4. Extend finance_ap_payments ───────────────────────────────────────────

-- Drop old method check; replace with the extended enum.
-- payment_run_id is added after finance_ap_payment_runs is created below.
do $$
begin
  begin
    alter table public.finance_ap_payments drop constraint if exists finance_ap_payments_method_check;
  exception when others then null;
  end;
  begin
    alter table public.finance_ap_payments
      add constraint finance_ap_payments_method_check
      check (method in ('eft', 'ach', 'wire', 'cheque', 'cash', 'card'));
  exception when duplicate_object then null;
  end;
end;
$$;

alter table public.finance_ap_payments
  add column if not exists memo              text,
  add column if not exists source_account_id uuid;   -- company bank account (no FK — bank accounts module is separate)

-- ── 5. Vendor bank accounts ──────────────────────────────────────────────────
create table if not exists public.finance_ap_vendor_bank_accounts (
  id             uuid        primary key default gen_random_uuid(),
  vendor_id      uuid        not null references public.finance_ap_vendors(id) on delete cascade,
  bank_name      text        not null,
  account_name   text        not null,
  account_number text        not null,
  routing_code   text,                          -- sort code / ACH routing
  iban           text,
  swift          text,
  currency       text        not null default 'TTD',
  is_default     boolean     not null default false,
  status         text        not null default 'active'
                 check (status in ('active', 'inactive')),
  created_by     text        references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

create index if not exists fap_vba_vendor_idx on public.finance_ap_vendor_bank_accounts(vendor_id);

-- Only one default bank account per vendor
create unique index if not exists fap_vba_default_idx
  on public.finance_ap_vendor_bank_accounts(vendor_id)
  where is_default = true;

-- ── 6. Bill attachments ──────────────────────────────────────────────────────
create table if not exists public.finance_ap_bill_attachments (
  id               uuid        primary key default gen_random_uuid(),
  bill_id          uuid        not null references public.finance_ap_bills(id) on delete cascade,
  file_name        text        not null,
  file_size        integer,
  content_type     text,
  storage_path     text        not null,         -- relative path in Supabase Storage
  public_url       text,
  attachment_hash  text,                          -- SHA-256 for duplicate detection
  uploaded_by      text        references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists fap_attachments_bill_idx  on public.finance_ap_bill_attachments(bill_id);
create index if not exists fap_attachments_hash_idx  on public.finance_ap_bill_attachments(attachment_hash) where attachment_hash is not null;

-- ── 7. Payment runs ──────────────────────────────────────────────────────────
create table if not exists public.finance_ap_payment_runs (
  id               uuid          primary key default gen_random_uuid(),
  run_no           text          not null unique,
  status           text          not null default 'draft'
                   check (status in ('draft', 'pending', 'processing', 'complete', 'void')),
  payment_method   text          not null default 'eft'
                   check (payment_method in ('eft', 'ach', 'wire', 'cheque', 'cash', 'card')),
  pay_date         date          not null,
  total_amount     numeric(15,2) not null default 0,
  currency         text          not null default 'TTD',
  notes            text,
  source_account_id uuid,                        -- company bank account (no FK)
  created_by       text          references public.app_users(id) on delete set null,
  processed_by     text          references public.app_users(id) on delete set null,
  voided_by        text          references public.app_users(id) on delete set null,
  void_reason      text,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz
);

create index if not exists fap_runs_status_idx on public.finance_ap_payment_runs(status);

-- Now add payment_run_id to payments (safe to do after table exists)
alter table public.finance_ap_payments
  add column if not exists payment_run_id uuid
    references public.finance_ap_payment_runs(id) on delete set null;

create index if not exists fap_payments_run_idx on public.finance_ap_payments(payment_run_id) where payment_run_id is not null;

-- ── 8. Payment run items ─────────────────────────────────────────────────────
create table if not exists public.finance_ap_payment_run_items (
  id        uuid          primary key default gen_random_uuid(),
  run_id    uuid          not null references public.finance_ap_payment_runs(id) on delete cascade,
  bill_id   uuid          not null references public.finance_ap_bills(id) on delete restrict,
  amount    numeric(15,2) not null,
  status    text          not null default 'pending'
            check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz  not null default now(),
  unique (run_id, bill_id)
);

create index if not exists fap_run_items_run_idx  on public.finance_ap_payment_run_items(run_id);
create index if not exists fap_run_items_bill_idx on public.finance_ap_payment_run_items(bill_id);

-- ── 9. Duplicate reviews ─────────────────────────────────────────────────────
create table if not exists public.finance_ap_duplicate_reviews (
  id                  uuid        primary key default gen_random_uuid(),
  original_bill_id    uuid        not null references public.finance_ap_bills(id) on delete cascade,
  duplicate_bill_id   uuid        references public.finance_ap_bills(id) on delete set null,
  match_type          text        not null
                      check (match_type in ('exact_invoice', 'amount_date', 'similar_invoice', 'attachment_hash')),
  confidence          text        not null default 'medium'
                      check (confidence in ('high', 'medium', 'low')),
  status              text        not null default 'pending'
                      check (status in ('pending', 'resolved_duplicate', 'resolved_distinct')),
  resolution_note     text,
  resolved_by         text        references public.app_users(id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists fap_dup_reviews_original_idx on public.finance_ap_duplicate_reviews(original_bill_id);
create index if not exists fap_dup_reviews_status_idx   on public.finance_ap_duplicate_reviews(status);

-- ── 10. AP comments ─────────────────────────────────────────────────────────
-- No platform-level generic comments table exists (grep confirmed ticket_comments
-- and hse_inspection_comments are module-specific). Creating finance_ap_comments.
create table if not exists public.finance_ap_comments (
  id          uuid        primary key default gen_random_uuid(),
  bill_id     uuid        not null references public.finance_ap_bills(id) on delete cascade,
  body        text        not null check (length(trim(body)) > 0),
  author_id   text        not null references public.app_users(id) on delete restrict,
  is_internal boolean     not null default false,   -- internal = finance-only note
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists fap_comments_bill_idx on public.finance_ap_comments(bill_id);

-- ── 11. updated_at triggers (new tables only) ────────────────────────────────
-- Reuse the set_fap_updated_at() function created in the base migration.

drop trigger if exists trg_fap_vba_updated_at on public.finance_ap_vendor_bank_accounts;
create trigger trg_fap_vba_updated_at
  before update on public.finance_ap_vendor_bank_accounts
  for each row execute function public.set_fap_updated_at();

drop trigger if exists trg_fap_runs_updated_at on public.finance_ap_payment_runs;
create trigger trg_fap_runs_updated_at
  before update on public.finance_ap_payment_runs
  for each row execute function public.set_fap_updated_at();

drop trigger if exists trg_fap_comments_updated_at on public.finance_ap_comments;
create trigger trg_fap_comments_updated_at
  before update on public.finance_ap_comments
  for each row execute function public.set_fap_updated_at();

-- ── 12. RLS ──────────────────────────────────────────────────────────────────
alter table public.finance_ap_vendor_bank_accounts enable row level security;
alter table public.finance_ap_bill_attachments     enable row level security;
alter table public.finance_ap_payment_runs         enable row level security;
alter table public.finance_ap_payment_run_items    enable row level security;
alter table public.finance_ap_duplicate_reviews    enable row level security;
alter table public.finance_ap_comments             enable row level security;

do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'finance_ap_vendor_bank_accounts',
    'finance_ap_bill_attachments',
    'finance_ap_payment_runs',
    'finance_ap_payment_run_items',
    'finance_ap_duplicate_reviews',
    'finance_ap_comments'
  ] loop
    p := 'service_role_bypass_' || replace(t, 'finance_ap_', 'fap_');
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = p
    ) then
      execute format(
        'create policy %I on public.%I using (auth.role() = ''service_role'')',
        p, t
      );
    end if;
  end loop;
end;
$$;

-- ── 13. Grants ───────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.finance_ap_vendor_bank_accounts to service_role;
grant select, insert, update, delete on public.finance_ap_bill_attachments      to service_role;
grant select, insert, update, delete on public.finance_ap_payment_runs          to service_role;
grant select, insert, update, delete on public.finance_ap_payment_run_items     to service_role;
grant select, insert, update, delete on public.finance_ap_duplicate_reviews     to service_role;
grant select, insert, update, delete on public.finance_ap_comments              to service_role;

-- ── 14. Idempotent seed: backfill subtotal_amount for existing bills ──────────
-- subtotal_amount invariant = sum of bill lines; for existing bills, set to total_amount
-- (they were created before this column existed and tax tracking wasn't recorded).
update public.finance_ap_bills
set subtotal_amount = total_amount
where subtotal_amount = 0 and total_amount > 0;

-- Seed a default bank account for the Atlantic Supplies vendor
insert into public.finance_ap_vendor_bank_accounts (vendor_id, bank_name, account_name, account_number, is_default, created_by)
select v.id, 'Republic Bank', 'Atlantic Supplies Ltd', '****4521', true,
       (select id from public.app_users order by created_at limit 1)
from public.finance_ap_vendors v
where v.name = 'Atlantic Supplies'
  and not exists (select 1 from public.finance_ap_vendor_bank_accounts ba where ba.vendor_id = v.id);

-- Seed payment runs table (one draft run so the page renders populated)
insert into public.finance_ap_payment_runs (run_no, status, payment_method, pay_date, total_amount, currency, notes, created_by)
values (
  'PRUN-2026-0001', 'draft', 'eft', (current_date + 3), 0, 'TTD',
  'July payment batch — approved bills due this week',
  (select id from public.app_users order by created_at limit 1)
)
on conflict (run_no) do nothing;

-- The seeded run_no above is hand-written — sync the reference counter so a
-- runtime nextRef('PRUN') can never collide with the seed.
insert into public.reference_counters (prefix, year, next_number)
values ('PRUN', 2026, 2)
on conflict (prefix, year) do update
  set next_number = greatest(public.reference_counters.next_number, excluded.next_number);

-- After applying run: NOTIFY pgrst, 'reload schema';
