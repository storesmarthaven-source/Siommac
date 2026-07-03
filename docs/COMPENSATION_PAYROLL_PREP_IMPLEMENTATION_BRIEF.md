# SIOMAC — HR Compensation + Finance Payroll (incl. NIS Continuity) — Build Spec

Authoritative build spec for Codex. HR owns **compensation inputs + overtime + NIS *capture***; Finance owns
**pay-component catalogue + statutory config (NIS/PAYE/Health Surcharge) + NIS *verification* + payroll
runs → calculate → approve → lock → payslips → export**. Jurisdiction **Trinidad & Tobago, TTD**.
GREENFIELD — do NOT reuse legacy `routes/payroll.ts` / `payroll_*` tables / `payroll.*` perms.
Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` + `CLAUDE.md` first. **§0 wins on any conflict.**

```
HR                                  Finance
├─ Compensation Inputs              ├─ Payroll Setup (pay-component catalogue)
│   (hr_employee_pay_items)         ├─ Statutory Configuration (NIS / PAYE / Health Surcharge)
├─ Overtime (submit/approve)        ├─ NIS Continuity VERIFICATION
└─ NIS/statutory profile CAPTURE    └─ Payroll Processing (runs → calc → approve → lock → payslips → export)
```

---

## 0. Verified corrections (checked against the codebase — these WIN on conflict)
1. **Finance roles don't exist → create FIRST.** `finance_staff`/`finance_manager` are NOT in `public.roles`;
   `role_permissions.role_name` has an implicit dependency on role existence, and roles are **flat / non-
   hierarchical** (no inheritance). Migration `20260802000000_finance_roles.sql` inserts both roles AND gives
   each a COMPLETE standalone grant set (employee baseline + finance keys). Grant to NO role that isn't in
   `public.roles`. Valid roles: employee, manager, hr_staff, hr_manager, hse_staff, admin, superadmin, + new
   finance_staff/finance_manager. **There is no `supervisor` role.** (Verified: `roles`(name unique, label,
   description, is_system) and `role_permissions`(role_name, permission PK) match
   `supabase/migrations/20260714000013_module_staff_roles.sql`.)
2. **Fabric/collaboration rail is DEFERRED.** Do NOT create `module_registry`, `module_event_routes`,
   Message Center threads/tables, Ticket tables, or Tickets/Messages/Activity tabs. Build plain `.obx-*`
   functional pages ([[collaboration-rail-deferred]]); the rail retro-wires later (config, not rebuild).
3. **Workflow is NOT deferred.** Central engine only, via **`public.module_workflow_bindings`** (not
   `workflow_bindings`). Each workflow = `workflow_templates` row + **published `workflow_template_versions`
   v1** (engine throws with no published version) + binding + registered adapter. Start via
   `startWorkflowForRecord` (verified: `netlify/functions/lib/workflow/service.ts:214`). No second approval
   authority; the adapter sets source-record status on completion.
4. **Conventions:** `role_permissions` col is `role_name` (not `role`); `writeHrAudit` param is
   `previousState` (not `oldState`); `workflow_id` is a `uuid` FK → `workflow_instances`; body =
   `(c.get('body') as Record<string,unknown>).args ?? {}`; envelope `c.json({success,data})` /
   `{success:false,message}` with HTTP code `200`. `app_users.id` is TEXT. `finance_cost_centers` exists
   (Org Structure) — `finance_payroll_run_lines.cost_center_id → finance_cost_centers` is valid. `nextRef`
   prefixes free: `PAY` (runs), `PSL` (payslips), `PIT`/`OVT` optional.
5. **Migration numbering.** Current max is `20260801000000`. Use **`20260802000000+`**; run
   `ls supabase/migrations/ | sort | tail -1` before finalizing. Each ends with
   `-- After applying, run: NOTIFY pgrst, 'reload schema';`.
6. **Every new table:** RLS enabled + `service_role` grants + `set_updated_at` trigger where mutable.

## 1. Ownership
| Function | Owner | Tables | Permissions |
|---|---|---|---|
| Base salary / hourly rate | HR via Transfers | `app_users.monthly_salary/hourly_rate/pay_basis` | existing `hr.transfers.*` |
| Allowances / deductions | **HR Compensation** | `hr_employee_pay_items` | `hr.compensation.*` |
| Overtime | **HR / Manager** | `hr_overtime_entries` | `hr.overtime.*` |
| **NIS/statutory profile — capture** | **HR** | `hr_employee_statutory_profiles` | `hr.employee.statutory.*` |
| **NIS/statutory profile — verify** | **Finance** | (same table, verify fields) | `finance.payroll.nis.*` |
| Pay components | **Finance** | `finance_pay_components` | `finance.payroll.components.*` |
| NIS / PAYE / Health Surcharge rates | **Finance** | `finance_statutory_versions`, `finance_nis_classes` | `finance.statutory.*` |
| Payroll runs / payslips / export | **Finance** | `finance_payroll_runs`, `_run_inputs`, `_run_lines`, `_payslips`, `_exports`, `_run_warnings` | `finance.payroll.*` |
| Bank disbursement | out of scope | — | — |

**HR captures NIS data; Finance verifies applicability + controls the statutory treatment. HR can never edit
NIS rates or mark a profile verified.**

## 2. Migration order (reconciled — NIS continuity integrated). Confirm `tail -1` first; each `NOTIFY pgrst`.
```
20260802000000_finance_roles.sql
20260802000001_finance_pay_components.sql            (+ seed)
20260802000002_finance_statutory_config.sql          (versions + nis_classes, + seed CURRENT TT schedule, flagged -- VERIFY vs NIBTT/BIR)
20260802000003_hr_compensation_inputs.sql            (hr_employee_pay_items)
20260802000004_hr_overtime_inputs.sql                (hr_overtime_entries)
20260802000005_employee_statutory_profiles.sql       (hr_employee_statutory_profiles — NIS continuity)   ← NEW
20260802000006_compensation_payroll_permissions.sql  (ALL keys incl. hr.employee.statutory.* + finance.payroll.nis.*)
20260802000007_workflow_finance_statutory_binding.sql
20260802000008_workflow_hr_compensation_binding.sql
20260802000009_workflow_hr_overtime_binding.sql
20260802000010_workflow_finance_nis_profile_verification.sql                                             ← NEW
20260802000011_finance_payroll_runs.sql              (runs + run_inputs + run_lines[+NIS snapshot cols] + payslips + exports + run_warnings)
20260802000012_workflow_finance_payroll_binding.sql
20260802000013_legacy_payroll_deprecation.sql
```

## 3. Phase 0 — Finance roles (`20260802000000`)
```sql
insert into public.roles (name, label, description, is_system) values
  ('finance_staff','Finance Staff','Finance execution: payroll prep, statutory review, finance ops.',true),
  ('finance_manager','Finance Manager','Finance approval: statutory config, payroll approve/lock/export.',true)
on conflict (name) do update set label=excluded.label, description=excluded.description, is_system=excluded.is_system;

-- flat roles: seed the employee baseline into each, THEN add finance keys (in the permissions migration)
insert into public.role_permissions (role_name, permission)
  select 'finance_staff', permission from public.role_permissions where role_name='employee' on conflict do nothing;
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', permission from public.role_permissions where role_name='employee' on conflict do nothing;
```

## 4. Phase 1 — Finance foundation
### 4.1 `finance_pay_components` (Finance-owned catalogue)
```sql
create table if not exists public.finance_pay_components (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kind text not null check (kind in ('earning','deduction')),
  is_statutory boolean not null default false,
  is_taxable boolean not null default true,
  reduces_chargeable boolean not null default false,
  gl_account_code text,
  cost_allocation_required boolean not null default false,
  is_active boolean not null default true,
  created_by text references public.app_users(id) on delete set null,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_pay_components_active_idx on public.finance_pay_components(is_active);
create index if not exists finance_pay_components_kind_idx   on public.finance_pay_components(kind);
alter table public.finance_pay_components enable row level security;
grant select, insert, update, delete on public.finance_pay_components to service_role;
drop trigger if exists trg_finance_pay_components_updated_at on public.finance_pay_components;
create trigger trg_finance_pay_components_updated_at before update on public.finance_pay_components
  for each row execute function public.set_updated_at();
```
**Seed:** basic, housing_allowance, travel_allowance, meal_allowance, overtime (earnings, taxable);
nis_employee, paye, health_surcharge (deductions, statutory, non-taxable); loan, union_dues, salary_advance
(deductions); pension (deduction, `reduces_chargeable=true`). `on conflict (code) do update`.

### 4.2 `finance_statutory_versions` + `finance_nis_classes`
```sql
create table if not exists public.finance_statutory_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  label text not null,
  jurisdiction text not null default 'TT' check (jurisdiction in ('TT')),
  currency text not null default 'TTD' check (currency in ('TTD')),
  paye_personal_allowance numeric(12,2) not null,
  paye_band1_ceiling numeric(12,2) not null,
  paye_band1_rate numeric(8,4) not null,
  paye_band2_rate numeric(8,4) not null,
  hs_monthly_threshold numeric(12,2) not null,
  hs_weekly_high numeric(12,2) not null,
  hs_weekly_low numeric(12,2) not null,
  nis_monthly_ceiling numeric(12,2),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','active','retired')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  is_active boolean not null default false,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  activated_by text references public.app_users(id) on delete set null,
  activated_at timestamptz,
  retired_by text references public.app_users(id) on delete set null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(effective_from, jurisdiction)
);
create index if not exists finance_statutory_versions_effective_idx on public.finance_statutory_versions(effective_from desc);
create index if not exists finance_statutory_versions_status_idx    on public.finance_statutory_versions(status);
create index if not exists finance_statutory_versions_active_idx    on public.finance_statutory_versions(is_active);
alter table public.finance_statutory_versions enable row level security;
grant select, insert, update, delete on public.finance_statutory_versions to service_role;
drop trigger if exists trg_finance_statutory_versions_updated_at on public.finance_statutory_versions;
create trigger trg_finance_statutory_versions_updated_at before update on public.finance_statutory_versions
  for each row execute function public.set_updated_at();

create table if not exists public.finance_nis_classes (
  id uuid primary key default gen_random_uuid(),
  statutory_version_id uuid not null references public.finance_statutory_versions(id) on delete cascade,
  class_no int not null,
  weekly_min numeric(12,2) not null,
  weekly_max numeric(12,2),
  employee_weekly numeric(12,2) not null,
  employer_weekly numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique(statutory_version_id, class_no)
);
create index if not exists finance_nis_classes_version_idx on public.finance_nis_classes(statutory_version_id);
create index if not exists finance_nis_classes_range_idx   on public.finance_nis_classes(statutory_version_id, weekly_min, weekly_max);
alter table public.finance_nis_classes enable row level security;
grant select, insert, update, delete on public.finance_nis_classes to service_role;
```
**Statutory lifecycle:** `draft → pending_approval → approved → active → retired`. Only
`finance.statutory.manage` edits drafts; only `finance.statutory.approve` approves; **creator ≠ final
approver**; only approved can activate; **one active version per jurisdiction/effective window**; a version
used by a run can't be deleted; **rates never hardcoded in TS** — calc uses only effective-dated tables and
stamps `statutory_version_id` on the run.

## 5. Phase 2 — HR Compensation inputs (`hr_employee_pay_items`)
```sql
create table if not exists public.hr_employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  item_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  component_id uuid not null references public.finance_pay_components(id) on delete restrict,
  amount numeric(12,2),
  percent numeric(5,2),
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','pending_approval','active','rejected','retired')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  is_active boolean not null default false,
  note text,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  retired_by text references public.app_users(id) on delete set null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employee_pay_items_amount_or_percent_check
    check ((amount is not null and percent is null) or (amount is null and percent is not null)),
  constraint hr_employee_pay_items_effective_check check (effective_to is null or effective_to >= effective_from)
);
create index if not exists hr_employee_pay_items_employee_idx  on public.hr_employee_pay_items(employee_id, is_active);
create index if not exists hr_employee_pay_items_component_idx on public.hr_employee_pay_items(component_id);
create index if not exists hr_employee_pay_items_status_idx    on public.hr_employee_pay_items(status);
alter table public.hr_employee_pay_items enable row level security;
grant select, insert, update, delete on public.hr_employee_pay_items to service_role;
drop trigger if exists trg_hr_employee_pay_items_updated_at on public.hr_employee_pay_items;
create trigger trg_hr_employee_pay_items_updated_at before update on public.hr_employee_pay_items
  for each row execute function public.set_updated_at();
```
**Rules:** base salary/rate stays on `app_users`; HR can't create pay components, only use **active** Finance
ones; pay items require approval; effective-dated; **cannot backdate into a locked/exported period**; items
used by an exported run can't be deleted (**retire, never hard-delete**).

## 6. Phase 2 — HR Overtime (`hr_overtime_entries`)
```sql
create table if not exists public.hr_overtime_entries (
  id uuid primary key default gen_random_uuid(),
  overtime_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  work_date date not null,
  hours numeric(8,2) not null check (hours > 0),
  multiplier numeric(5,2) not null default 1.5 check (multiplier > 0),
  reason text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','paid','cancelled')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  payroll_run_id uuid,
  payroll_run_line_id uuid,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_overtime_entries_employee_idx    on public.hr_overtime_entries(employee_id, work_date);
create index if not exists hr_overtime_entries_status_idx      on public.hr_overtime_entries(status);
create index if not exists hr_overtime_entries_payroll_run_idx on public.hr_overtime_entries(payroll_run_id);
alter table public.hr_overtime_entries enable row level security;
grant select, insert, update, delete on public.hr_overtime_entries to service_role;
drop trigger if exists trg_hr_overtime_entries_updated_at on public.hr_overtime_entries;
create trigger trg_hr_overtime_entries_updated_at before update on public.hr_overtime_entries
  for each row execute function public.set_updated_at();
```
**Rules:** employee submits own OT; manager/HR approve by scope; rejected OT never enters payroll; approved OT
can; paid OT immutable; OT linked to a locked/exported run is immutable.

## 7. Phase 2.5 — NIS Continuity / Employee Statutory Profile (`hr_employee_statutory_profiles`)
Captures NIS continuity when an employee joins from another company. **HR captures; Finance verifies.**
```sql
create table if not exists public.hr_employee_statutory_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.app_users(id) on delete cascade,
  jurisdiction text not null default 'TT' check (jurisdiction in ('TT')),
  currency text not null default 'TTD' check (currency in ('TTD')),
  nis_number text,
  nis_status text not null default 'pending_verification'
    check (nis_status in ('pending_verification','verified','not_available','not_applicable','exempt')),
  nis_applicable boolean not null default true,
  previous_employer_name text,
  previous_employer_end_date date,
  opening_ytd_insurable_earnings numeric(12,2) not null default 0,
  opening_ytd_nis_employee numeric(12,2) not null default 0,
  opening_ytd_nis_employer numeric(12,2) not null default 0,
  opening_balance_as_of date,
  verified_by text references public.app_users(id) on delete set null,
  verified_at timestamptz,
  verification_note text,
  created_by text references public.app_users(id) on delete set null,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, jurisdiction)
);
create index if not exists hr_employee_statutory_profiles_employee_idx   on public.hr_employee_statutory_profiles(employee_id);
create index if not exists hr_employee_statutory_profiles_nis_status_idx on public.hr_employee_statutory_profiles(nis_status);
alter table public.hr_employee_statutory_profiles enable row level security;
grant select, insert, update, delete on public.hr_employee_statutory_profiles to service_role;
drop trigger if exists trg_hr_employee_statutory_profiles_updated_at on public.hr_employee_statutory_profiles;
create trigger trg_hr_employee_statutory_profiles_updated_at before update on public.hr_employee_statutory_profiles
  for each row execute function public.set_updated_at();
```
**Employee Master / Onboarding — add a "Statutory Profile" section** (fields: NIS number, status, applicable,
previous employer name + end date, opening YTD insurable/employee-NIS/employer-NIS, opening balance as-of,
verification note). **HR enters; HR cannot mark verified. Finance Staff reviews; Finance Manager verifies.**
**Verification workflow** `finance_nis_profile_verification` (module_key `finance_payroll`, trigger
`finance.nis.profile.submitted`): HR submits → Finance Staff reviews → Finance Manager verifies → status
`verified` → payroll calculates without the NIS-pending warning. Published version + `module_workflow_bindings`.

## 8. Phase 3 — Finance Payroll
### 8.1 `finance_payroll_runs` (with input-lock + reopen controls)
```sql
create table if not exists public.finance_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  run_no text unique not null,
  period_month date unique not null,
  pay_frequency text not null default 'monthly',
  status text not null default 'draft' check (status in
    ('draft','input_locked','calculated','pending_approval','returned','approved','locked','exported','cancelled')),
  statutory_version_id uuid not null references public.finance_statutory_versions(id) on delete restrict,
  weeks_in_period numeric(6,3) not null default 4.333,
  employee_count int not null default 0,
  gross_total numeric(14,2) not null default 0,
  deduction_total numeric(14,2) not null default 0,
  net_total numeric(14,2) not null default 0,
  nis_employer_total numeric(14,2) not null default 0,
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  input_locked_by text references public.app_users(id) on delete set null,
  input_locked_at timestamptz,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  locked_by text references public.app_users(id) on delete set null,
  locked_at timestamptz,
  reopened_by text references public.app_users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_payroll_runs_period_idx  on public.finance_payroll_runs(period_month);
create index if not exists finance_payroll_runs_status_idx  on public.finance_payroll_runs(status);
create index if not exists finance_payroll_runs_workflow_idx on public.finance_payroll_runs(workflow_id) where workflow_id is not null;
alter table public.finance_payroll_runs enable row level security;
grant select, insert, update, delete on public.finance_payroll_runs to service_role;
drop trigger if exists trg_finance_payroll_runs_updated_at on public.finance_payroll_runs;
create trigger trg_finance_payroll_runs_updated_at before update on public.finance_payroll_runs
  for each row execute function public.set_updated_at();
```
### 8.2 `finance_payroll_run_inputs` (frozen HR/FI snapshot before calc)
```sql
create table if not exists public.finance_payroll_run_inputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id text not null references public.app_users(id) on delete restrict,
  source_type text not null check (source_type in ('base_pay','pay_item','overtime','timesheet')),
  source_id text, component_code text, label text,
  amount numeric(12,2), quantity numeric(12,4), rate numeric(12,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists finance_payroll_run_inputs_run_idx      on public.finance_payroll_run_inputs(run_id);
create index if not exists finance_payroll_run_inputs_employee_idx on public.finance_payroll_run_inputs(employee_id);
alter table public.finance_payroll_run_inputs enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_inputs to service_role;
```
### 8.3 `finance_payroll_run_lines` (calculated results + NIS snapshot)
```sql
create table if not exists public.finance_payroll_run_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id text not null references public.app_users(id) on delete restrict,
  base numeric(12,2) not null default 0,
  taxable_gross numeric(12,2) not null default 0,
  gross numeric(12,2) not null default 0,
  nis_employee numeric(12,2) not null default 0,
  nis_employer numeric(12,2) not null default 0,
  health_surcharge numeric(12,2) not null default 0,
  chargeable_income numeric(12,2) not null default 0,
  paye numeric(12,2) not null default 0,
  voluntary_deductions numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  department_id text,
  cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
  -- NIS continuity snapshot (immutable audit of what was used at run time):
  nis_number_masked text,
  nis_status text,
  nis_class_no int,
  opening_ytd_nis_employee numeric(12,2) not null default 0,
  opening_ytd_nis_employer numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id, employee_id)
);
create index if not exists finance_payroll_run_lines_run_idx        on public.finance_payroll_run_lines(run_id);
create index if not exists finance_payroll_run_lines_employee_idx   on public.finance_payroll_run_lines(employee_id);
create index if not exists finance_payroll_run_lines_cost_center_idx on public.finance_payroll_run_lines(cost_center_id);
alter table public.finance_payroll_run_lines enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_lines to service_role;
drop trigger if exists trg_finance_payroll_run_lines_updated_at on public.finance_payroll_run_lines;
create trigger trg_finance_payroll_run_lines_updated_at before update on public.finance_payroll_run_lines
  for each row execute function public.set_updated_at();
```
### 8.4 `finance_payslips` — payslip privacy
```sql
create table if not exists public.finance_payslips (
  id uuid primary key default gen_random_uuid(),
  payslip_no text unique not null,
  run_id uuid not null references public.finance_payroll_runs(id) on delete cascade,
  run_line_id uuid not null references public.finance_payroll_run_lines(id) on delete cascade,
  employee_id text not null references public.app_users(id) on delete restrict,
  file_path text,
  generated_at timestamptz not null default now(),
  generated_by text references public.app_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique(run_id, employee_id)
);
create index if not exists finance_payslips_employee_idx on public.finance_payslips(employee_id);
create index if not exists finance_payslips_run_idx      on public.finance_payslips(run_id);
alter table public.finance_payslips enable row level security;
grant select, insert, update, delete on public.finance_payslips to service_role;
```
**Privacy:** employee sees only own; manager cannot see subordinate by default; HR cannot see payslips unless
explicitly granted; signed URLs expire; read/download audited; bulk export Finance-only.
### 8.5 `finance_payroll_exports`
```sql
create table if not exists public.finance_payroll_exports (
  id uuid primary key default gen_random_uuid(),
  export_no text unique not null,
  run_id uuid not null references public.finance_payroll_runs(id) on delete cascade,
  format text not null check (format in ('csv','xlsx','pdf','json')),
  file_path text not null, checksum text,
  generated_by text references public.app_users(id) on delete set null,
  generated_at timestamptz not null default now(),
  is_current boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists finance_payroll_exports_run_idx on public.finance_payroll_exports(run_id);
alter table public.finance_payroll_exports enable row level security;
grant select, insert, update, delete on public.finance_payroll_exports to service_role;
```
**Export:** only locked runs export; creates an artifact; re-export = new version (old `is_current=false`);
audited; does NOT disburse.
### 8.6 `finance_payroll_run_warnings` (NIS + input exceptions)
```sql
create table if not exists public.finance_payroll_run_warnings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id text references public.app_users(id) on delete cascade,
  warning_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','blocker')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_by text references public.app_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists finance_payroll_run_warnings_run_idx      on public.finance_payroll_run_warnings(run_id);
create index if not exists finance_payroll_run_warnings_employee_idx on public.finance_payroll_run_warnings(employee_id);
alter table public.finance_payroll_run_warnings enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_warnings to service_role;
```
**Warning types:** `missing_nis_number, nis_pending_verification, nis_not_applicable, nis_class_not_found,
previous_employer_data_missing, opening_balance_missing`.

## 9. Permissions — catalogue ALL keys in `netlify/functions/lib/permissions.ts`, `src/lib/permissions.ts`, `src/lib/permissionMeta.ts`, + DB grants
- **HR compensation:** `hr.compensation.{view,manage,approve,reports.view,reports.export}`
- **HR overtime:** `hr.overtime.{view,submit,approve,manage,reports.view,reports.export}`
- **HR statutory capture:** `hr.employee.statutory.{view,capture}`
- **Finance payroll:** `finance.payroll.{view_own,view_all,run.manage,approve,lock,export,reports.view,reports.export,components.view,components.manage}`
- **Finance NIS verify:** `finance.payroll.nis.{view,verify,manage}`
- **Finance statutory:** `finance.statutory.{view,manage,approve,reports.view,reports.export}`

**Grants:** employee → `finance.payroll.view_own`, `hr.overtime.submit`. manager → `hr.overtime.{view,approve,
reports.view}`. hr_staff → `hr.compensation.{view,manage}`, `hr.overtime.{view,manage,reports.view}`,
`hr.employee.statutory.{view,capture}`. hr_manager → all hr.compensation.* + hr.overtime.* +
`hr.employee.statutory.{view,capture}` (+ optional read-only `finance.payroll.view_all`). finance_staff →
`finance.payroll.{view_all,run.manage,components.view,reports.view}`, `finance.payroll.nis.view`,
`finance.statutory.view`. finance_manager → all finance.payroll.* + finance.payroll.nis.* + finance.statutory.*.
admin/superadmin → all. **Grant only after roles exist (§3); never to a non-existent role.** Drift-guard
`tests/unit/permissions.sync.test.ts` fails on any miscatalogued key.

## 10. Segregation of duties (server-side)
Statutory creator ≠ final approver; payroll run creator ≠ final approver (unless explicit admin override);
run creator can't export without `finance.payroll.export`; finance_staff prepares but can't approve/lock/
export; HR can't manage statutory or lock/export payroll; **HR can't verify NIS** (only Finance); manager
can't view subordinate payslip by default; employee sees own only. Helper:
```ts
export function assertDifferentApprover({ actorId, createdBy, action }:
  { actorId: string; createdBy?: string | null; action: string }) {
  if (actorId === createdBy) throw new Error(`Segregation of duties violation: creator cannot ${action}.`);
}
```

## 11. Workflows (5 — all via central engine + `module_workflow_bindings` + published version + adapter)
| Workflow | module_key | trigger_event | Adapter |
|---|---|---|---|
| hr_compensation_change_approval | hr_compensation | hr.compensation.item.submitted | hrCompensationAdapter.ts |
| hr_overtime_approval | hr_overtime | hr.overtime.submitted | hrOvertimeAdapter.ts |
| finance_statutory_approval | finance_statutory | finance.statutory.version.submitted | financeStatutoryAdapter.ts |
| **finance_nis_profile_verification** | finance_payroll | finance.nis.profile.submitted | financeNisProfileAdapter.ts |
| finance_payroll_approval | finance_payroll | finance.payroll.run.submitted | financePayrollAdapter.ts |

Adapters (`netlify/functions/lib/workflow/adapters/*.ts`): load source record, guard idempotency, set
approved/rejected/returned, `writeHrAudit` with `previousState`, emit event, no second approval state.

## 12. T&T statutory calculation — pure calculators in `netlify/functions/lib/finance/payrollStatutory.ts` (jest unit-tested)
**Order (per run line):** Gross (base + taxable allowances + approved OT) → **NIS** employee/employer (weekly
insurable → `finance_nis_classes` × weeks; skip if not applicable; employer share tracked not deducted) →
**Health Surcharge** (threshold → weekly high/low × weeks) → **Chargeable income** (taxable gross − monthly
personal allowance − approved pre-tax items; **NIS/HS NOT subtracted before PAYE in T&T**) → **PAYE**
(band1 to ceiling, band2 above; floor 0) → **voluntary deductions** → **Net**. Rates ONLY from the effective-
dated version; run stamps `statutory_version_id`. `computeNis` / `computeHealthSurcharge` / `computePaye`
per the reference signatures; unit-test a known gross → exact NIS/HS/PAYE/net.

## 13. Payroll run flow (+ NIS checks before each line)
create (resolve active statutory version, `draft`) → **lock inputs** (snapshot base pay + active-approved pay
items + approved OT + approved timesheets → `finance_payroll_run_inputs`, `input_locked`) → **calculate**
(read inputs + statutory tables → write `run_lines` incl. NIS snapshot → roll totals, `calculated`) →
**submit** (`startWorkflowForRecord`, `pending_approval`) → **approve** (adapter, `approved`) → **lock**
(lines immutable, payslips generatable, `locked`) → **export** (artifact, `exported`). Before each line:
```ts
const p = await loadEmployeeStatutoryProfile({ employeeId: emp.id, jurisdiction: 'TT' });
const nisApplicable = p?.nisApplicable !== false && emp.nis_applicable !== false;
if (nisApplicable && !p?.nisNumber)          addPayrollWarning({ type:'missing_nis_number', severity:'warning' });
if (nisApplicable && p?.nisStatus !== 'verified')
  addPayrollWarning({ type:'nis_pending_verification', severity: policy.blockUnverifiedNis ? 'blocker':'warning' });
const nis = computeNis({ weeklyInsurable, classes, weeksInPeriod: run.weeks_in_period, nisApplicable });
```
**Policy settings** (settings catalog): `finance_payroll.require_verified_nis_for_payroll=false`,
`finance_payroll.warn_missing_nis_number=true`, `finance_payroll.block_missing_nis_for_new_employee=false`,
`finance_payroll.require_approved_timesheet_for_hourly=true`, `finance_payroll.warn_missing_timesheet_for_salary=true`.

## 14. Attendance integration
Consume **approved** timesheets only (never raw punches). Hourly with no approved timesheet → block/exclude
per policy; salary with none → continue + warn. Approved OT may come from HR Overtime or Attendance timesheets
per policy.

## 15. Backend files
HR: `lib/hr/{compensationCore,compensationQueries,compensationMutations,overtimeCore,overtimeQueries,
overtimeMutations,statutoryProfileCore,statutoryProfileMutations}.ts`, `routes/{hrCompensation,hrOvertime,
hrStatutoryProfile}.ts`. Finance: `lib/finance/{payrollComponents,statutoryConfig,payrollStatutory,
payrollRuns,payrollPayslips,payrollExports,payrollReports,nisProfileVerification}.ts`,
`routes/{financeStatutory,financePayroll}.ts`.

## 16. API routes (POST, envelope per §0.4)
HR Compensation `/api/hr/compensation/pay-items/{list,get,create,submit,approve,reject,retire}` +
`/reports/{list,run,export}`. HR Overtime `/api/hr/overtime/{list,get,submit,approve,reject,cancel}` +
`/reports/*`. HR Statutory `/api/hr/employee-statutory/{get,capture,submit}`. Finance Statutory
`/api/finance/statutory/versions/{list,get,create,update,submit,approve,reject,activate,retire}`,
`/nis-classes/{list,upsert}`, `/reports/*`. Finance NIS verify
`/api/finance/payroll/nis/{list,get,verify,reject}`. Finance Payroll
`/api/finance/payroll/runs/{list,get,create,lock-inputs,calculate,submit,lock,reopen,export}`,
`/run-lines/list`, `/inputs/list`, `/warnings/list`, `/payslips/{my,get,generate,signed-url}`,
`/components/{list,create,update,retire}`, `/reports/*`.

## 17. Frontend (functional-first `.obx-*` — NO Tickets/Messages/Activity tabs)
- `HR/CompensationOverview.tsx` (Pay Items · Pending Approval · Component Viewer · Reports)
- `HR/OvertimeOverview.tsx` (My Overtime · Team Approval · Payroll Status · Reports)
- Statutory Profile section inside Employee Master / Onboarding (capture; Finance verifies)
- `Finance/StatutoryConfigOverview.tsx` (Versions · NIS Classes · PAYE · Health Surcharge · Approval History · Reports)
- `Finance/PayrollOverview.tsx` (Runs · Run Detail · Run Inputs · Run Lines · Warnings · Payslips · Exports · Reports)

**Nav** (establish the Finance section shell): HR `s-hr-compensation` (fa-scale-balanced),
`s-hr-overtime` (fa-clock); Finance `s-finance-statutory` (fa-file-shield), `s-finance-payroll`
(fa-money-check-dollar). Loading: `placeholderData` + `loading={isLoading && !data}`. Self-scope server-side:
`finance.payroll.view_own` / payslip routes return only the caller's own line.

## 18. Reports
HR Comp: Pay Item / Allowance / Deduction registers, Change History, Locked-Period Rejection. HR OT:
Submitted/Approved/Rejected/Paid, by Department, by Employee. HR statutory: Employees Missing Statutory
Profile, New Hires Pending NIS, NIS Capture Completion. Finance Statutory: Version / NIS-class / PAYE / HS
history, Approval Audit. Finance Payroll: Register, Payslip Register, Net-Pay Summary, Employer-NIS Summary,
NIS Remittance, PAYE Summary, HS Summary, Cost by Department, Cost by Cost-Center, Variance, Export Audit,
**NIS Continuity Register, Missing-NIS-Number, Unverified-NIS Profiles, New-Employee NIS Onboarding,
NIS Opening-Balance, Payroll NIS Exceptions**.

## 19. E2E (`scripts/e2e/suites/`): `financeStatutory.mjs`, `hrCompensation.mjs`, `hrOvertime.mjs`, `hrStatutoryProfile.mjs`, `financePayroll.mjs`
Cover: finance roles exist; statutory draft→approve with creator≠approver; HR can't manage statutory; pay item
references a finance component, submits to workflow, backdate-into-locked rejected, HR can't create a
component; OT submit→approve, rejected excluded, paid immutable; **NIS capture by HR, verify by Finance, HR
can't verify**; payroll create→lock-inputs→calculate (assert exact NIS/HS/PAYE/net + NIS snapshot on line)→
submit→approve→lock→payslip (employee sees own only, manager can't see subordinate)→export artifact + re-export
versions; missing/unverified NIS raises a `run_warning`; legacy payroll unused. §2 side-effects
(app_events + hr_audit_log + handoffs) asserted via service-role client; cleanup via `h.TAG`.

## 20. Verification gate
`typecheck:frontend` + `typecheck:backend` + `build:backend` clean; `npm test` (incl. drift-guard + statutory
calculator unit tests) + `npx vitest run` green; all 5 E2E suites green (after migrations + `NOTIFY pgrst`);
229 frontend tests remain green. Verify: published workflow versions + active bindings for all 5; finance
roles exist before grants; RLS + `set_updated_at` + service_role grants on every new table; legacy
`payrollRouter` unmounted and no legacy `payroll_*` table read; no `payroll.*` legacy perms used. Report the
operator-apply migration list.

## 21. Legacy reconciliation (`20260802000013`)
Unmount `payrollRouter` from `netlify/functions/api.ts`; quarantine `routes/payroll.ts`; repoint old Payroll
UI nav; grep `payroll_runs|payroll_run_lines|payroll_adjustments|payroll_approvals|payroll_remittances|
payroll.*` and confirm new code reads no legacy table. **No dual payroll.**

## 22. Definition of done
finance_staff/finance_manager exist (no 23503); HR owns compensation inputs + overtime + NIS capture; Finance
owns pay components + statutory config + **NIS verification** + payroll runs/lock/payslips/export; statutory
rates gated to Finance Mgr/Admin (HR cannot manage or verify NIS); payroll consumes approved HR inputs +
Finance statutory version; all approvals via central engine (published versions + `module_workflow_bindings`);
creator/approver segregation enforced; input freeze + locked/exported immutability; **NIS profile captured by
HR, verified by Finance, payroll warns/blocks on missing/unverified NIS per policy, run line snapshots NIS
status/class/employee/employer + opening balances, previous-employment continuity reportable**; payslip
privacy enforced (employee-own only); exports artifacted/versioned; legacy payroll removed; functional-first
UI nav-wired; no Message/Ticket rail yet; all E2E + full gate green; migration list reported. No band-aids:
no nonexistent-role grants, no hardcoded statutory/NIS rates, no second approval authority, no legacy reuse.
