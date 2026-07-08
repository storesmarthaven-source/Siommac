-- ============================================================================
-- Finance General Ledger — Chart of Accounts, Journals, Journal Lines
-- ============================================================================
-- Defines the GL foundation that AP/AR/Fixed-Assets reference.
-- Contract: finance_gl_accounts(code text unique) exposed via POST /api/finance/gl/accounts/list.
-- Other modules MUST store gl_account_code TEXT (no FK) and source their picker
-- from that endpoint. Do NOT hard-FK this table.
--
-- Lifecycle: draft → posted (immutable) → reversed (creates a reversing journal).
-- Rule: a posted journal must balance — sum(debit) == sum(credit), ≥2 lines,
--       each line debit XOR credit (not both non-zero).
-- Human ref: JE-<YYYY>-<NNNN> generated via increment_ref_counter RPC.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Chart of Accounts ─────────────────────────────────────────────────────

create table if not exists public.finance_gl_accounts (
  id              uuid        primary key default gen_random_uuid(),
  code            text        not null unique,          -- e.g. '1000', '1000.01'
  name            text        not null,
  type            text        not null
                  check (type in ('asset','liability','equity','revenue','expense')),
  subtype         text,                                 -- e.g. 'current_asset', 'fixed_asset'
  parent_code     text,                                 -- soft ref to code (no FK — tree is advisory)
  normal_balance  text        not null default 'debit'
                  check (normal_balance in ('debit','credit')),
  is_active       boolean     not null default true,
  description     text,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- index for type/active lookups (pickers)
create index if not exists fga_type_active_idx
  on public.finance_gl_accounts(type, is_active);

-- index for parent hierarchy traversal
create index if not exists fga_parent_code_idx
  on public.finance_gl_accounts(parent_code)
  where parent_code is not null;

-- updated_at trigger
create or replace function public.set_finance_gl_accounts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fga_updated_at on public.finance_gl_accounts;
create trigger trg_fga_updated_at
  before update on public.finance_gl_accounts
  for each row execute function public.set_finance_gl_accounts_updated_at();

-- RLS
alter table public.finance_gl_accounts enable row level security;

create policy "service_role_bypass_finance_gl_accounts"
  on public.finance_gl_accounts
  using (auth.role() = 'service_role');

-- ── 2. Journal headers ────────────────────────────────────────────────────────

create table if not exists public.finance_gl_journals (
  id              uuid        primary key default gen_random_uuid(),
  journal_no      text        not null unique,          -- JE-2026-0001
  entry_date      date        not null,
  memo            text,
  status          text        not null default 'draft'
                  check (status in ('draft','posted','reversed')),
  source_module   text        not null default 'manual',  -- 'manual','finance_ap','finance_ar',…
  source_ref      text,                                   -- e.g. AP invoice number
  posted_at       timestamptz,
  posted_by       text        references public.app_users(id) on delete set null,
  reversed_at     timestamptz,
  reversal_of     uuid        references public.finance_gl_journals(id) on delete set null,
  created_by      text        references public.app_users(id) on delete set null,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- index for status + date ordering
create index if not exists fgj_status_date_idx
  on public.finance_gl_journals(status, entry_date desc);

create index if not exists fgj_source_module_idx
  on public.finance_gl_journals(source_module);

-- updated_at trigger
create or replace function public.set_finance_gl_journals_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fgj_updated_at on public.finance_gl_journals;
create trigger trg_fgj_updated_at
  before update on public.finance_gl_journals
  for each row execute function public.set_finance_gl_journals_updated_at();

-- RLS
alter table public.finance_gl_journals enable row level security;

create policy "service_role_bypass_finance_gl_journals"
  on public.finance_gl_journals
  using (auth.role() = 'service_role');

-- ── 3. Journal Lines ──────────────────────────────────────────────────────────

create table if not exists public.finance_gl_journal_lines (
  id              uuid        primary key default gen_random_uuid(),
  journal_id      uuid        not null references public.finance_gl_journals(id) on delete cascade,
  line_no         integer     not null,
  account_code    text        not null,                -- soft ref to finance_gl_accounts(code)
  debit           numeric(15,2) not null default 0,
  credit          numeric(15,2) not null default 0,
  description     text,
  cost_center_id  uuid,                               -- soft ref to finance_cost_centers(id)
  created_at      timestamptz not null default now(),
  -- Constraint: at least one of debit/credit must be non-zero but not both.
  constraint gl_line_debit_xor_credit check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  ),
  -- Each line number is unique within a journal.
  constraint gl_line_unique_line_no unique (journal_id, line_no)
);

-- index for journal → lines (used in balance check + trial balance)
create index if not exists fgjl_journal_idx
  on public.finance_gl_journal_lines(journal_id);

-- index for account-based trial balance aggregation
create index if not exists fgjl_account_code_idx
  on public.finance_gl_journal_lines(account_code);

-- RLS
alter table public.finance_gl_journal_lines enable row level security;

create policy "service_role_bypass_finance_gl_journal_lines"
  on public.finance_gl_journal_lines
  using (auth.role() = 'service_role');

-- ── 4. Service-role grants ────────────────────────────────────────────────────

grant select, insert, update, delete
  on public.finance_gl_accounts to service_role;

grant select, insert, update, delete
  on public.finance_gl_journals to service_role;

grant select, insert, update, delete
  on public.finance_gl_journal_lines to service_role;

-- ── 5. Realistic Chart of Accounts seed ──────────────────────────────────────
-- ASSET accounts (normal balance: debit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('1000', 'Cash and Cash Equivalents',  'asset', 'current_asset',  null,   'debit', 'Petty cash, current accounts, and bank deposits'),
  ('1010', 'Petty Cash',                 'asset', 'current_asset',  '1000', 'debit', 'On-hand petty cash float'),
  ('1020', 'Bank — Main Operating',      'asset', 'current_asset',  '1000', 'debit', 'Primary operating bank account'),
  ('1030', 'Bank — Payroll',             'asset', 'current_asset',  '1000', 'debit', 'Dedicated payroll funding account'),
  ('1100', 'Accounts Receivable',        'asset', 'current_asset',  null,   'debit', 'Amounts owed by customers and clients'),
  ('1110', 'Trade Receivables',          'asset', 'current_asset',  '1100', 'debit', 'Standard trade debtor balances'),
  ('1120', 'Allowance for Doubtful Accounts', 'asset', 'current_asset', '1100', 'credit', 'Contra-asset: estimated uncollectable trade debts'),
  ('1200', 'Prepaid Expenses',           'asset', 'current_asset',  null,   'debit', 'Expenses paid in advance (insurance, rent, subscriptions)'),
  ('1300', 'Inventory',                  'asset', 'current_asset',  null,   'debit', 'Goods and materials held for sale or use'),
  ('1400', 'Other Current Assets',       'asset', 'current_asset',  null,   'debit', 'Miscellaneous short-term assets'),
  ('1500', 'Property, Plant & Equipment','asset', 'fixed_asset',    null,   'debit', 'Tangible fixed assets at cost'),
  ('1510', 'Land',                       'asset', 'fixed_asset',    '1500', 'debit', 'Land held at cost (not depreciated)'),
  ('1520', 'Buildings',                  'asset', 'fixed_asset',    '1500', 'debit', 'Office and operational buildings at cost'),
  ('1530', 'Plant & Machinery',          'asset', 'fixed_asset',    '1500', 'debit', 'Manufacturing and production equipment'),
  ('1540', 'Vehicles',                   'asset', 'fixed_asset',    '1500', 'debit', 'Company vehicles and fleet'),
  ('1550', 'Computer Equipment',         'asset', 'fixed_asset',    '1500', 'debit', 'Servers, laptops, and IT hardware'),
  ('1590', 'Accumulated Depreciation',   'asset', 'fixed_asset',    '1500', 'credit','Contra-asset: accumulated depreciation on PP&E'),
  ('1600', 'Intangible Assets',          'asset', 'intangible',     null,   'debit', 'Goodwill, licences, and other intangible assets'),
  ('1700', 'Long-term Investments',      'asset', 'investment',     null,   'debit', 'Non-current investments and equity stakes')
on conflict (code) do nothing;

-- LIABILITY accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('2000', 'Accounts Payable',           'liability', 'current_liability', null,   'credit', 'Amounts owed to suppliers and vendors'),
  ('2010', 'Trade Payables',             'liability', 'current_liability', '2000', 'credit', 'Standard trade creditor balances'),
  ('2100', 'Accrued Liabilities',        'liability', 'current_liability', null,   'credit', 'Expenses incurred but not yet invoiced'),
  ('2110', 'Accrued Salaries & Wages',   'liability', 'current_liability', '2100', 'credit', 'Payroll accruals at period end'),
  ('2200', 'Short-term Borrowings',      'liability', 'current_liability', null,   'credit', 'Bank overdrafts and current portion of loans'),
  ('2300', 'Tax Liabilities',            'liability', 'current_liability', null,   'credit', 'NIS, PAYE, and VAT payable'),
  ('2310', 'PAYE Payable',               'liability', 'current_liability', '2300', 'credit', 'Income tax withheld from employees'),
  ('2320', 'NIS Payable',                'liability', 'current_liability', '2300', 'credit', 'National Insurance contributions payable'),
  ('2330', 'VAT Payable',                'liability', 'current_liability', '2300', 'credit', 'Value-Added Tax collected from customers'),
  ('2400', 'Deferred Revenue',           'liability', 'current_liability', null,   'credit', 'Advance payments and unearned income'),
  ('2500', 'Other Current Liabilities',  'liability', 'current_liability', null,   'credit', 'Miscellaneous short-term obligations'),
  ('2600', 'Long-term Loans',            'liability', 'non_current_liability', null, 'credit', 'Non-current bank loans and bonds'),
  ('2700', 'Deferred Tax Liabilities',   'liability', 'non_current_liability', null, 'credit', 'Timing differences in tax recognition'),
  ('2800', 'Other Long-term Liabilities','liability', 'non_current_liability', null, 'credit', 'Pension obligations and other non-current liabilities')
on conflict (code) do nothing;

-- EQUITY accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('3000', 'Shareholders Equity',        'equity', 'capital',    null,   'credit', 'Total owners equity'),
  ('3100', 'Share Capital',              'equity', 'capital',    '3000', 'credit', 'Issued and paid-up share capital'),
  ('3200', 'Retained Earnings',          'equity', 'retained',   '3000', 'credit', 'Cumulative retained profits'),
  ('3300', 'Current Year Profit/Loss',   'equity', 'retained',   '3000', 'credit', 'Profit or loss for the current period'),
  ('3400', 'Revaluation Reserve',        'equity', 'reserve',    '3000', 'credit', 'Unrealised gains on asset revaluation'),
  ('3500', 'General Reserve',            'equity', 'reserve',    '3000', 'credit', 'General-purpose reserve retained from profits')
on conflict (code) do nothing;

-- REVENUE accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('4000', 'Revenue',                    'revenue', 'operating',  null,   'credit', 'Total operating revenue'),
  ('4100', 'Product Sales',              'revenue', 'operating',  '4000', 'credit', 'Revenue from product sales'),
  ('4200', 'Service Revenue',            'revenue', 'operating',  '4000', 'credit', 'Revenue from services rendered'),
  ('4300', 'Project Revenue',            'revenue', 'operating',  '4000', 'credit', 'Revenue from contracted projects'),
  ('4400', 'Rental Income',              'revenue', 'other',      '4000', 'credit', 'Income from asset rentals'),
  ('4500', 'Interest Income',            'revenue', 'other',      '4000', 'credit', 'Interest earned on deposits and investments'),
  ('4600', 'Other Income',               'revenue', 'other',      '4000', 'credit', 'Miscellaneous non-operating income')
on conflict (code) do nothing;

-- EXPENSE accounts (normal balance: debit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('5000', 'Operating Expenses',         'expense', 'operating',  null,   'debit', 'Total direct operating costs'),
  ('5100', 'Cost of Goods Sold',         'expense', 'cost_of_sales', '5000', 'debit', 'Direct costs attributable to goods sold'),
  ('5110', 'Raw Materials',              'expense', 'cost_of_sales', '5100', 'debit', 'Materials consumed in production'),
  ('5120', 'Direct Labour',              'expense', 'cost_of_sales', '5100', 'debit', 'Wages of production and field staff'),
  ('5200', 'Salaries & Wages',           'expense', 'payroll',    '5000', 'debit', 'All staff remuneration (non-production)'),
  ('5210', 'Statutory Contributions',    'expense', 'payroll',    '5200', 'debit', 'Employer NIS and other statutory costs'),
  ('5220', 'Staff Benefits',             'expense', 'payroll',    '5200', 'debit', 'Health insurance, pension, and other benefits'),
  ('5300', 'Rent & Occupancy',           'expense', 'overhead',   '5000', 'debit', 'Office rent, utilities, and facilities'),
  ('5400', 'Travel & Entertainment',     'expense', 'overhead',   '5000', 'debit', 'Business travel, meals, and accommodation'),
  ('5500', 'Professional Services',      'expense', 'overhead',   '5000', 'debit', 'Legal, audit, consulting, and advisory fees'),
  ('5600', 'Depreciation & Amortisation','expense', 'non_cash',   '5000', 'debit', 'Periodic depreciation of PP&E and amortisation of intangibles'),
  ('5700', 'Insurance',                  'expense', 'overhead',   '5000', 'debit', 'General, liability, and asset insurance premiums'),
  ('5800', 'Marketing & Advertising',    'expense', 'overhead',   '5000', 'debit', 'Sales and marketing expenditure'),
  ('5900', 'IT & Technology',            'expense', 'overhead',   '5000', 'debit', 'Software licences, SaaS subscriptions, and IT support'),
  ('5950', 'Bank Charges & Interest',    'expense', 'finance',    '5000', 'debit', 'Bank fees, interest on overdrafts and loans'),
  ('5990', 'Other Expenses',             'expense', 'overhead',   '5000', 'debit', 'Miscellaneous operating costs not elsewhere classified')
on conflict (code) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';
