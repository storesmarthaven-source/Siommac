-- ============================================================================
-- Finance Accounts Payable — vendors, bills, bill lines, payments.
-- Lifecycle: bill draft → submitted → approved → partially_paid|paid
--            (also rejected, void). SoD: creator ≠ approver (enforced in the service).
-- References General Ledger accounts by gl_account_code (text, no FK — GL is a
-- separate module; stays decoupled per docs/HR_FINANCE_DESIGN_SPEC.md §7.4).
--
-- Conventions mirror 20260806000000_finance_expense_claims.sql: numeric(15,2)
-- money, service_role bypass policy + grants, updated_at trigger, idempotent seed.
-- Operator-applied. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Vendors ────────────────────────────────────────────────────────────────
create table if not exists public.finance_ap_vendors (
  id                      uuid        primary key default gen_random_uuid(),
  vendor_no               text        not null unique,
  name                    text        not null,
  registration_no         text,
  contact_name            text,
  contact_email           text,
  contact_phone           text,
  payment_terms_days      integer     not null default 30,
  default_gl_account_code text,
  status                  text        not null default 'active'
                          check (status in ('active', 'inactive')),
  metadata                jsonb       not null default '{}'::jsonb,
  created_by              text        references public.app_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz
);

create index if not exists fap_vendors_status_idx on public.finance_ap_vendors(status);

-- ── 2. Bills ──────────────────────────────────────────────────────────────────
create table if not exists public.finance_ap_bills (
  id              uuid          primary key default gen_random_uuid(),
  bill_no         text          not null unique,
  vendor_id       uuid          not null references public.finance_ap_vendors(id) on delete restrict,
  bill_date       date          not null,
  due_date        date,
  description     text,
  total_amount    numeric(15,2) not null default 0,
  paid_amount     numeric(15,2) not null default 0,
  currency        text          not null default 'TTD',
  status          text          not null default 'draft'
                  check (status in ('draft', 'submitted', 'approved', 'partially_paid', 'paid', 'rejected', 'void')),
  gl_account_code text,
  approved_by     text          references public.app_users(id) on delete set null,
  created_by      text          references public.app_users(id) on delete set null,
  reject_reason   text,
  void_reason     text,
  workflow_id     uuid,
  metadata        jsonb         not null default '{}'::jsonb,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz
);

create index if not exists fap_bills_status_idx    on public.finance_ap_bills(status);
create index if not exists fap_bills_vendor_idx    on public.finance_ap_bills(vendor_id);
create index if not exists fap_bills_due_idx        on public.finance_ap_bills(due_date) where due_date is not null;
create index if not exists fap_bills_bill_date_idx  on public.finance_ap_bills(bill_date);

-- ── 3. Bill lines ─────────────────────────────────────────────────────────────
create table if not exists public.finance_ap_bill_lines (
  id              uuid          primary key default gen_random_uuid(),
  bill_id         uuid          not null references public.finance_ap_bills(id) on delete cascade,
  line_no         integer       not null default 1,
  description     text          not null,
  amount          numeric(15,2) not null default 0,
  gl_account_code text,
  cost_center_id  uuid,
  created_at      timestamptz   not null default now()
);

create index if not exists fap_bill_lines_bill_idx on public.finance_ap_bill_lines(bill_id);

-- ── 4. Payments ───────────────────────────────────────────────────────────────
create table if not exists public.finance_ap_payments (
  id          uuid          primary key default gen_random_uuid(),
  bill_id     uuid          not null references public.finance_ap_bills(id) on delete cascade,
  amount      numeric(15,2) not null,
  method      text          not null default 'eft'
              check (method in ('eft', 'cheque', 'cash', 'card')),
  paid_at     timestamptz   not null default now(),
  reference   text,
  created_by  text          references public.app_users(id) on delete set null,
  created_at  timestamptz   not null default now()
);

create index if not exists fap_payments_bill_idx on public.finance_ap_payments(bill_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
create or replace function public.set_fap_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fap_vendors_updated_at on public.finance_ap_vendors;
create trigger trg_fap_vendors_updated_at before update on public.finance_ap_vendors
  for each row execute function public.set_fap_updated_at();
drop trigger if exists trg_fap_bills_updated_at on public.finance_ap_bills;
create trigger trg_fap_bills_updated_at before update on public.finance_ap_bills
  for each row execute function public.set_fap_updated_at();

-- ── RLS + service-role grants ────────────────────────────────────────────────
alter table public.finance_ap_vendors    enable row level security;
alter table public.finance_ap_bills       enable row level security;
alter table public.finance_ap_bill_lines  enable row level security;
alter table public.finance_ap_payments    enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_ap_vendors' and policyname = 'service_role_bypass_fap_vendors') then
    execute 'create policy "service_role_bypass_fap_vendors" on public.finance_ap_vendors using (auth.role() = ''service_role'')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_ap_bills' and policyname = 'service_role_bypass_fap_bills') then
    execute 'create policy "service_role_bypass_fap_bills" on public.finance_ap_bills using (auth.role() = ''service_role'')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_ap_bill_lines' and policyname = 'service_role_bypass_fap_bill_lines') then
    execute 'create policy "service_role_bypass_fap_bill_lines" on public.finance_ap_bill_lines using (auth.role() = ''service_role'')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_ap_payments' and policyname = 'service_role_bypass_fap_payments') then
    execute 'create policy "service_role_bypass_fap_payments" on public.finance_ap_payments using (auth.role() = ''service_role'')';
  end if;
end;
$$;

grant select, insert, update, delete on public.finance_ap_vendors    to service_role;
grant select, insert, update, delete on public.finance_ap_bills       to service_role;
grant select, insert, update, delete on public.finance_ap_bill_lines  to service_role;
grant select, insert, update, delete on public.finance_ap_payments    to service_role;

-- ── Seed: vendors + bills so the page renders populated ───────────────────────
insert into public.finance_ap_vendors (vendor_no, name, registration_no, contact_email, payment_terms_days, default_gl_account_code, created_by)
values
  ('APV-0012', 'Atlantic Supplies',   'RC-88231', 'ap@atlanticsupplies.tt',  30, '5100', (select id from public.app_users order by created_at limit 1)),
  ('APV-0007', 'Trinidad Cement',     'RC-11902', 'billing@tcl.co.tt',       30, '5100', (select id from public.app_users order by created_at limit 1)),
  ('APV-0021', 'Caribbean Fuels',     'RC-44518', 'accounts@caribfuels.tt',  45, '5200', (select id from public.app_users order by created_at limit 1)),
  ('APV-0018', 'Southern Steel',      'RC-77120', 'ar@southernsteel.tt',     30, '5100', (select id from public.app_users order by created_at limit 1)),
  ('APV-0031', 'Island Logistics',    'RC-33240', 'finance@islandlog.tt',    30, '5300', (select id from public.app_users order by created_at limit 1)),
  ('APV-0026', 'Massy Distribution',  'RC-55631', 'ap@massy.co.tt',          30, '5100', (select id from public.app_users order by created_at limit 1))
on conflict (vendor_no) do nothing;

-- Bills reference the seeded vendors; created_by = first real app_user.
insert into public.finance_ap_bills (bill_no, vendor_id, bill_date, due_date, description, total_amount, paid_amount, status, gl_account_code, approved_by, created_by)
select b.bill_no, v.id, b.bill_date::date, b.due_date::date, b.description, b.total_amount, b.paid_amount, b.status, b.gl_account_code, b.approved_by, b.created_by
from (values
  ('AP-0231', 'Atlantic Supplies',  (current_date - 9),  (current_date + 5),  'Bulk cement and delivery',       12400.00, 0,        'approved',       '5100', (select id from public.app_users order by created_at limit 1), (select id from public.app_users order by created_at limit 1)),
  ('AP-0230', 'Trinidad Cement',    (current_date - 13), (current_date - 1),  'Cement supply — June',            8900.00, 0,        'approved',       '5100', (select id from public.app_users order by created_at limit 1), (select id from public.app_users order by created_at limit 1)),
  ('AP-0229', 'Caribbean Fuels',    (current_date - 6),  (current_date + 8),  'Fuel — fleet, June',             22150.00, 0,        'submitted',      '5200', null,                                                          (select id from public.app_users order by created_at limit 1)),
  ('AP-0228', 'Island Logistics',   (current_date - 20), (current_date - 5),  'Freight and handling',            5600.00, 5600.00,  'paid',           '5300', (select id from public.app_users order by created_at limit 1), (select id from public.app_users order by created_at limit 1)),
  ('AP-0227', 'Atlantic Supplies',  (current_date - 4),  (current_date + 12), 'Site materials',                  3280.00, 0,        'draft',          '5100', null,                                                          (select id from public.app_users order by created_at limit 1)),
  ('AP-0226', 'Massy Distribution', (current_date - 17), (current_date - 2),  'Office and site consumables',    17940.00, 0,        'approved',       '5100', (select id from public.app_users order by created_at limit 1), (select id from public.app_users order by created_at limit 1)),
  ('AP-0225', 'Southern Steel',     (current_date - 23), (current_date - 9),  'Structural steel',                9420.00, 0,        'approved',       '5100', (select id from public.app_users order by created_at limit 1), (select id from public.app_users order by created_at limit 1)),
  ('AP-0224', 'Caribbean Fuels',    (current_date - 8),  (current_date + 4),  'Diesel — generators',             2150.00, 0,        'submitted',      '5200', null,                                                          (select id from public.app_users order by created_at limit 1))
) as b(bill_no, vendor_name, bill_date, due_date, description, total_amount, paid_amount, status, gl_account_code, approved_by, created_by)
join public.finance_ap_vendors v on v.name = b.vendor_name
on conflict (bill_no) do nothing;

-- One line per seeded bill (line-sum == total, matching the service's invariant).
insert into public.finance_ap_bill_lines (bill_id, line_no, description, amount, gl_account_code)
select bi.id, 1, coalesce(bi.description, 'Bill amount'), bi.total_amount, bi.gl_account_code
from public.finance_ap_bills bi
where not exists (select 1 from public.finance_ap_bill_lines l where l.bill_id = bi.id);

-- Payment for the paid bill.
insert into public.finance_ap_payments (bill_id, amount, method, reference, created_by)
select bi.id, bi.total_amount, 'eft', 'PMT-SEED-' || bi.bill_no, (select id from public.app_users order by created_at limit 1)
from public.finance_ap_bills bi
where bi.status = 'paid'
  and not exists (select 1 from public.finance_ap_payments p where p.bill_id = bi.id);

-- After applying, run: NOTIFY pgrst, 'reload schema';
