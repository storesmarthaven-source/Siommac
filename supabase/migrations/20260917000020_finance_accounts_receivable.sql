-- ============================================================================
-- Finance — Accounts Receivable (AR)
-- ============================================================================
-- Tables: finance_ar_customers, finance_ar_invoices, finance_ar_invoice_lines,
--         finance_ar_receipts
--
-- Lifecycle: draft → sent → partially_paid | paid (overdue via sweep, void)
-- Receipts reduce the outstanding balance and flip the invoice status.
-- GL accounts stored as text (no FK — decoupled from GL module).
-- Human refs: ARC-YYYY-NNNN (customers), INV-YYYY-NNNN (invoices), RCT-YYYY-NNNN (receipts)
--
-- Operator-applied. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Customers ──────────────────────────────────────────────────────────────

create table if not exists public.finance_ar_customers (
  id                    uuid          primary key default gen_random_uuid(),
  customer_no           text          not null unique,
  name                  text          not null,
  registration_no       text,
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  payment_terms_days    integer       not null default 30,
  credit_limit          numeric(15,2) not null default 0,
  default_gl_account_code text,
  status                text          not null default 'active'
                        check (status in ('active','inactive')),
  metadata              jsonb         not null default '{}'::jsonb,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz
);

create index if not exists far_cust_status_idx
  on public.finance_ar_customers(status);

create index if not exists far_cust_name_idx
  on public.finance_ar_customers(name);

create or replace function public.set_finance_ar_customers_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_farc_updated_at on public.finance_ar_customers;
create trigger trg_farc_updated_at
  before update on public.finance_ar_customers
  for each row execute function public.set_finance_ar_customers_updated_at();

alter table public.finance_ar_customers enable row level security;

create policy "service_role_bypass_finance_ar_customers"
  on public.finance_ar_customers
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_ar_customers to service_role;

-- ── 2. Invoices ───────────────────────────────────────────────────────────────

create table if not exists public.finance_ar_invoices (
  id                uuid          primary key default gen_random_uuid(),
  invoice_no        text          not null unique,
  customer_id       uuid          not null references public.finance_ar_customers(id) on delete restrict,
  issue_date        date          not null,
  due_date          date          not null,
  description       text,
  total_amount      numeric(15,2) not null,
  paid_amount       numeric(15,2) not null default 0,
  currency          text          not null default 'TTD',
  status            text          not null default 'draft'
                    check (status in ('draft','sent','partially_paid','paid','overdue','void')),
  gl_account_code   text,
  work_order_ref    text,
  void_reason       text,
  created_by        text          references public.app_users(id) on delete set null,
  metadata          jsonb         not null default '{}'::jsonb,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz
);

create index if not exists fari_customer_idx
  on public.finance_ar_invoices(customer_id);

create index if not exists fari_status_idx
  on public.finance_ar_invoices(status);

create index if not exists fari_due_date_idx
  on public.finance_ar_invoices(due_date);

create or replace function public.set_finance_ar_invoices_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fari_updated_at on public.finance_ar_invoices;
create trigger trg_fari_updated_at
  before update on public.finance_ar_invoices
  for each row execute function public.set_finance_ar_invoices_updated_at();

alter table public.finance_ar_invoices enable row level security;

create policy "service_role_bypass_finance_ar_invoices"
  on public.finance_ar_invoices
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_ar_invoices to service_role;

-- ── 3. Invoice Lines ──────────────────────────────────────────────────────────

create table if not exists public.finance_ar_invoice_lines (
  id              uuid          primary key default gen_random_uuid(),
  invoice_id      uuid          not null references public.finance_ar_invoices(id) on delete cascade,
  description     text          not null,
  quantity        numeric       not null default 1,
  unit_price      numeric(15,2) not null,
  amount          numeric(15,2) not null,
  gl_account_code text,
  sort_order      integer       not null default 0,
  created_at      timestamptz   not null default now()
);

create index if not exists faril_invoice_idx
  on public.finance_ar_invoice_lines(invoice_id);

alter table public.finance_ar_invoice_lines enable row level security;

create policy "service_role_bypass_finance_ar_invoice_lines"
  on public.finance_ar_invoice_lines
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_ar_invoice_lines to service_role;

-- ── 4. Receipts ───────────────────────────────────────────────────────────────

create table if not exists public.finance_ar_receipts (
  id          uuid          primary key default gen_random_uuid(),
  receipt_no  text          not null unique,
  invoice_id  uuid          not null references public.finance_ar_invoices(id) on delete restrict,
  amount      numeric(15,2) not null,
  method      text          not null default 'bank_transfer'
              check (method in ('bank_transfer','cheque','cash','card','online','other')),
  received_at date          not null,
  reference   text,
  created_by  text          references public.app_users(id) on delete set null,
  created_at  timestamptz   not null default now()
);

create index if not exists farr_invoice_idx
  on public.finance_ar_receipts(invoice_id);

create index if not exists farr_received_at_idx
  on public.finance_ar_receipts(received_at);

alter table public.finance_ar_receipts enable row level security;

create policy "service_role_bypass_finance_ar_receipts"
  on public.finance_ar_receipts
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_ar_receipts to service_role;

-- ── 5. Idempotent seed — customers + invoices + lines ─────────────────────────

-- Pick real app_users for created_by. We need at least one finance manager or admin.
-- Seed 3 customers
insert into public.finance_ar_customers
  (customer_no, name, registration_no, contact_name, contact_email, contact_phone,
   payment_terms_days, credit_limit, default_gl_account_code, status)
values
  ('ARC-2026-0001', 'Atlantic Petroleum Ltd', 'REG-APL-001', 'Marcus Antoine', 'marcus@atlanticpetro.tt', '+1-868-555-0201', 30,  500000.00, '1100', 'active'),
  ('ARC-2026-0002', 'Caribbean Industrial Services', 'REG-CIS-002', 'Sandra Ramsaran', 'sramsaran@cis.tt', '+1-868-555-0302', 45, 250000.00, '1100', 'active'),
  ('ARC-2026-0003', 'Trident Engineering & Supply', 'REG-TES-003', 'Joel Beharry', 'jbeharry@trident-eng.tt', '+1-868-555-0403', 60, 150000.00, '1100', 'inactive')
on conflict (customer_no) do nothing;

-- Seed 3 invoices against the first 2 customers (using a subquery for created_by)
with
  cust1 as (select id from public.finance_ar_customers where customer_no = 'ARC-2026-0001' limit 1),
  cust2 as (select id from public.finance_ar_customers where customer_no = 'ARC-2026-0002' limit 1),
  actor as (select id from public.app_users where role in ('admin','superadmin','finance_manager') limit 1)
insert into public.finance_ar_invoices
  (invoice_no, customer_id, issue_date, due_date, description, total_amount, paid_amount, currency, status, gl_account_code, created_by)
select * from (
  select
    'INV-2026-0001' as invoice_no,
    cust1.id        as customer_id,
    '2026-07-01'::date as issue_date,
    '2026-07-31'::date as due_date,
    'Environmental compliance survey — Q3 2026' as description,
    85000.00 as total_amount,
    0.00     as paid_amount,
    'TTD'    as currency,
    'sent'   as status,
    '4000'   as gl_account_code,
    actor.id as created_by
  from cust1, actor

  union all

  select
    'INV-2026-0002',
    cust1.id,
    '2026-06-15'::date,
    '2026-07-15'::date,
    'HSE training delivery — June 2026',
    42500.00, 42500.00, 'TTD', 'paid', '4000', actor.id
  from cust1, actor

  union all

  select
    'INV-2026-0003',
    cust2.id,
    '2026-07-05'::date,
    '2026-08-04'::date,
    'Inspection services — offshore platform Alpha',
    120000.00, 60000.00, 'TTD', 'partially_paid', '4000', actor.id
  from cust2, actor
) v
on conflict (invoice_no) do nothing;

-- Seed invoice lines for each invoice
with
  inv1 as (select id from public.finance_ar_invoices where invoice_no = 'INV-2026-0001' limit 1),
  inv2 as (select id from public.finance_ar_invoices where invoice_no = 'INV-2026-0002' limit 1),
  inv3 as (select id from public.finance_ar_invoices where invoice_no = 'INV-2026-0003' limit 1)
insert into public.finance_ar_invoice_lines
  (invoice_id, description, quantity, unit_price, amount, gl_account_code, sort_order)
select v.invoice_id, v.description, v.quantity, v.unit_price, v.amount, v.gl_account_code, v.sort_order
from (
  select inv1.id as invoice_id, 'Site survey — Phase 1',    1,     50000.00, 50000.00, '4000', 1 from inv1
  union all
  select inv1.id, 'Report preparation & review',             1,     25000.00, 25000.00, '4000', 2 from inv1
  union all
  select inv1.id, 'Travel & accommodation expenses',         1,     10000.00, 10000.00, '4100', 3 from inv1
  union all
  select inv2.id, 'Safety officer training — 5 sessions',   5,      8000.00, 40000.00, '4000', 1 from inv2
  union all
  select inv2.id, 'Training materials',                      1,      2500.00,  2500.00, '4100', 2 from inv2
  union all
  select inv3.id, 'Offshore inspection — days 1-5',          5,     12000.00, 60000.00, '4000', 1 from inv3
  union all
  select inv3.id, 'Offshore inspection — days 6-10',         5,     12000.00, 60000.00, '4000', 2 from inv3
) v(invoice_id, description, quantity, unit_price, amount, gl_account_code, sort_order)
where v.invoice_id is not null;

-- Seed one receipt for the paid invoice and one partial receipt for the partially_paid invoice
with
  inv2 as (select id from public.finance_ar_invoices where invoice_no = 'INV-2026-0002' limit 1),
  inv3 as (select id from public.finance_ar_invoices where invoice_no = 'INV-2026-0003' limit 1),
  actor as (select id from public.app_users where role in ('admin','superadmin','finance_manager') limit 1)
insert into public.finance_ar_receipts
  (receipt_no, invoice_id, amount, method, received_at, reference, created_by)
select v.receipt_no, v.invoice_id, v.amount, v.method, v.received_at, v.reference, actor.id
from (
  select 'RCT-2026-0001' as receipt_no, inv2.id as invoice_id, 42500.00 as amount, 'bank_transfer' as method, '2026-07-14'::date as received_at, 'BNK-REF-001' as reference from inv2
  union all
  select 'RCT-2026-0002', inv3.id, 60000.00, 'bank_transfer', '2026-07-20'::date, 'BNK-REF-002' from inv3
) v(receipt_no, invoice_id, amount, method, received_at, reference), actor
where v.invoice_id is not null
on conflict (receipt_no) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';
