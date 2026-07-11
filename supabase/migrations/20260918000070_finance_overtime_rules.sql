-- ============================================================================
-- Finance Payroll — Overtime rule engine (Wave 4b)
-- Effective-dated, configurable OT multipliers by event type (T&T: public
-- holiday, rest day, callout, night shift). An OT entry's ot_type resolves to
-- the active rule's multiplier + minimum billable hours; if ot_type is null the
-- entry's own multiplier is used (legacy behaviour).
-- Single-tenant: NO organization_id. app_users.id is TEXT.
-- ============================================================================

create table if not exists public.finance_overtime_rules (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  event_type     text not null
                   check (event_type in ('regular_overtime','public_holiday','rest_day','callout','night_shift')),
  multiplier     numeric(5,2) not null check (multiplier > 0),
  minimum_hours  numeric(6,2),            -- e.g. callouts bill a 3h minimum
  active         boolean not null default true,
  effective_from date not null,
  effective_to   date,
  created_by     text references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists finance_overtime_rules_type_idx
  on public.finance_overtime_rules(event_type, active);
alter table public.finance_overtime_rules enable row level security;
grant select, insert, update, delete on public.finance_overtime_rules to service_role;

-- Structured event type on OT entries (nullable; app-validated). When set, payroll
-- resolves the multiplier from the active rule for that type + work_date.
alter table public.hr_overtime_entries
  add column if not exists ot_type text;

-- After applying, run: NOTIFY pgrst, 'reload schema';
