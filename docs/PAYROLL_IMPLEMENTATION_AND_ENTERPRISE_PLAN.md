# SIOMAC Payroll — Current Implementation & Enterprise Build Plan (Trinidad & Tobago)

> Purpose: a complete, code-grounded snapshot of what payroll is TODAY (backend + frontend +
> data model + cross-module ties), plus a T&T-specific enterprise gap plan derived from the
> TTPay feature set. Feed this to Codex to scope the next build waves. Every claim below is
> against the real code — file paths are relative to repo root.
>
> **Golden rule (already honored in code):** SIOMAC *calculates, validates, authorizes, executes*.
> All rates/thresholds are **data**, never hardcoded — read from the live statutory version at
> calculate time. Keep that invariant.

---

## 0. TL;DR — maturity

| Area | State |
|---|---|
| T&T PAYE / NIS / Health Surcharge calculators | ✅ Built, pure, unit-tested |
| Payroll run lifecycle (draft→export) + maker-checker via central workflow | ✅ Built |
| Statutory config (versioned rates, NIS earnings classes) | ✅ Built (see `STATUTORY_*` docs) |
| Employee statutory profiles + NIS verification (HR→Finance handoff) | ✅ Built |
| Pay components + recurring employee pay items | ✅ Built |
| Payslip records + employee self-service + notifications | ✅ Records only — **no PDF, no email** |
| Remittance derivation (PAYE/NIS/HS) + disbursement bridge | ✅ Built |
| GL / accounting journal posting | ❌ Missing (GL tables exist, no payroll journal) |
| Multiple pay cycles (weekly/fortnightly/bi-monthly) | ⚠️ Fields exist, calc is monthly-centric |
| Time clock / timesheet-driven hours, worksheet override | ⚠️ Approved OT only; hourly hours + override missing |
| Loans / salary advances (amortized) | ❌ Only flat recurring deductions |
| Statutory forms (NI184/NI187/TD4), ACH bank files, back pay | ❌ Missing |
| Legacy `payroll.ts` module (localStorage-era) | ⚠️ Still present, to retire |

---

## 1. Backend — where everything lives

All under `netlify/functions/`.

### 1.1 Calculation engine (pure, no DB, no hardcoded rates)
`lib/finance/payrollStatutory.ts` — the T&T statutory math. Unit tests in
`tests/unit/payrollStatutory.test.ts`.

- `computeNis({ weeklyInsurable, classes, weeksInPeriod, nisApplicable })` → `{ employee, employer, classNo }`.
  Finds the NIS **earnings class** by weekly insurable band (last class is open-ended), multiplies the
  class's weekly employee/employer contribution by weeks in period.
- `computeHealthSurcharge({ monthlyIncome, threshold, weeklyHigh, weeklyLow, weeksInPeriod })` → number.
  Threshold test → high or low weekly rate × weeks.
- `computePaye({ chargeableIncome, personalAllowance, band1Ceiling, band1Rate, band2Rate })` → number.
  **Monthly** calc: personal allowance and band-1 ceiling are ANNUAL in the DB, divided by 12; band 1 up
  to the monthly ceiling, band 2 on the remainder; floored at 0.
- `computeRunLine(...)` — the orchestrator. **§12 order (T&T-correct):**
  1. Gross = base + taxable allowances + approved OT (+ non-taxable allowances for gross display)
  2. NIS on weekly insurable = `taxableGross / weeksInPeriod`
  3. Health Surcharge on monthly gross
  4. Chargeable = `taxableGross − (annualPersonalAllowance/12) − preTaxPension` — **NIS/HS are NOT
     deducted before PAYE in T&T** (this is a common bug; the code is right)
  5. PAYE on chargeable
  6. Voluntary deductions
  7. Net = gross − nisEmployee − HS − PAYE − voluntary

### 1.2 Run lifecycle (state machine)
`lib/finance/payrollRuns.ts` (~1.6k LOC). Status flow:

```
draft ──lockInputs──▶ input_locked ──calculate──▶ calculated
  ▲                                                   │ submitRun
  │ reopenRun (locked only, reason required)          ▼
  └── locked ◀──lockRun── approved ◀──workflow──── pending_approval
                                    (reject → calculated)         │
      locked ──export──▶ exported (terminal; cannot reopen)       │
                                                                  ▼
                                         central workflow: finance_payroll_approval
```

Key functions: `createPayrollRun`, `lockInputs`, `calculateRun`, `submitRun`, `approveRun` (adapter-only),
`rejectRun`, `lockRun`, `reopenRun`, `resolveRunWarning`, `getEmployeePopulationPreview`,
`downloadRunExport`, `notifyPayslipEmployees`, plus list/get for runs/inputs/lines/warnings/audit.

- **`lockInputs`** snapshots, per active employee (`app_users.status='active'`, `pay_basis` set):
  base pay (monthly_salary or hourly_rate), all approved+active `hr_employee_pay_items` effective in the
  period (resolved against `finance_pay_components` for kind/is_taxable/reduces_chargeable), and approved
  `hr_overtime_entries` in the period. Writes `finance_payroll_run_inputs`.
- **`calculateRun`** aggregates inputs per employee, runs `computeRunLine`, snapshots NIS
  (`nis_number_masked`, `nis_status`, `nis_class_no`, opening YTD), rolls up run totals, emits **NIS
  warnings** (missing number / unverified / class-not-found / continuity) gated by policy settings.
- **Maker-checker:** `submitRun` starts the central workflow (`finance_payroll_approval`); `approveRun`
  enforces **segregation of duties** (`assertDifferentApprover`, creator ≠ approver) and is reachable
  **only** via the workflow adapter, not a direct route.
- Every transition writes `hr_audit_log` (submodule `finance_payroll`) + emits an `app_events` row +
  notifications + handoffs. Compensating rollback on workflow/backbone failure (no partial state).

### 1.3 Supporting backend modules (`lib/finance/`)
- `statutoryConfig.ts` — versioned statutory rates + NIS earnings classes; `getActiveStatutoryVersion('TT')`,
  `listNisClasses(versionId)`, `assertDifferentApprover`. Version DTO fields: `payePersonalAllowance`,
  `payeBand1Ceiling`, `payeBand1Rate`, `payeBand2Rate`, `hsMonthlyThreshold`, `hsWeeklyHigh`, `hsWeeklyLow`,
  `nisMonthyCeiling`, `nisRatePercent`. NIS class: `classNo`, `weeklyMin`, `weeklyMax`,
  `assumedAverageWeekly`, `employeeWeekly`, `employerWeekly`, `classZWeekly`.
- `lib/hr/statutoryProfileCore.ts` — employee statutory profile: `nisNumber`, `nisStatus`
  (`pending_verification|verified|not_available|not_applicable|exempt`), `nisApplicable`,
  `previousEmployerName/EndDate`, `openingYtdInsurableEarnings`, `openingYtd{Nis}Employee/Employer`,
  `openingBalanceAsOf`. This is the HR→Finance NIS bridge (verification queue).
- `payrollComponents.ts` — pay component catalogue (earnings/deductions, taxable, statutory,
  reduces_chargeable) + change requests with maker-checker.
- `payrollPayslips.ts` — `finance_payslips` records: `generatePayslips` (locked runs, idempotent per
  run+employee, notifies employees), `getMyPayslips`, `getPayslip` (ownership-gated), `signedPayslipUrl`
  (Supabase `payslips` bucket, 1h, audited). **`file_path` is currently always null → no PDF yet.**
- `payrollExports.ts` — `exportRun(runId, format)` for `csv|json|xlsx|pdf` (CSV/JSON implemented, artifact
  rows in `finance_payroll_exports`). Not bank-specific ACH files.
- `payrollReports.ts` — 18 report keys: `register`, `payslip_register`, `net_pay_summary`,
  `employer_nis_summary`, `nis_remittance`, `paye_summary`, `hs_summary`, `cost_by_department`,
  `cost_by_cost_center`, `export_audit`, `nis_continuity`, `missing_nis_number`, `unverified_nis`,
  `new_employee_nis_onboarding`, `nis_opening_balance`, `nis_exceptions`.
- `remittances.ts` — `computeRemittanceFromRun` derives PAYE (BIR), NIS employee+employer (NIBTT), and
  Health Surcharge totals from `finance_payroll_run_lines`; authorities `paye_bir | nis_nibtt |
  health_surcharge`; unique `(payroll_run_id, authority)`.
- `bridges.ts` — cross-record automation: `createDisbursementFromRun` (net-pay disbursement, unique per
  run), `createRemittanceFromRun` (per authority), `createReimbursementHandoff`.
- `workflow/financePayrollAdapter.ts` — binds the run to the central workflow engine (approval), syncs
  status back on completion.
- Policy via `settings/resolveSetting.ts`, module `finance_payroll`:
  `require_verified_nis_for_payroll`, `warn_missing_nis_number`, `block_missing_nis_for_new_employee`,
  `require_approved_timesheet_for_hourly`, `warn_missing_timesheet_for_salary`.

### 1.4 Endpoints (`routes/financePayroll.ts`, mounted under `/api/finance`)
POST-only, `body.args ?? {}`, each behind `requirePermission`:

| Endpoint | Permission |
|---|---|
| `/payroll/runs/{list,get,population-preview}` | `finance.payroll.view_all` |
| `/payroll/runs/{create,lock-inputs,calculate,submit}` | `finance.payroll.run.manage` |
| `/payroll/runs/{approve,reject}` | `finance.payroll.approve` |
| `/payroll/runs/{lock,reopen}` | `finance.payroll.lock` |
| `/payroll/runs/export`, `/payroll/exports/download` | `finance.payroll.export` |
| `/payroll/{inputs,run-lines,warnings,runs/audit,exports}/list` | `finance.payroll.view_all` |
| `/payroll/warnings/resolve` | `finance.payroll.run.manage` |
| `/payroll/payslips/{notify,generate,list}` | `finance.payroll.view_all` (+ `run.manage` for notify) |
| `/payroll/payslips/{my,get,signed-url}` | `finance.payroll.view_own` |
| `/payroll/reports/{run,list}` | `finance.payroll.reports.view` |

> **Legacy:** `routes/payroll.ts` (`/listHourlyRates`, `/getPayroll`, `/getPayrollConstants`,
> `/getMyPayslips`, `/updateEmployeePayroll`, …) is the pre-backbone payroll module. It still powers some
> ESS/manager views. Plan a **build-new → delete-legacy** retirement; do not extend it.

---

## 2. Data model (payroll-owned tables)

- `finance_payroll_runs` — run header. Cols: `run_no`, `period_month`, `pay_frequency`, `status`,
  `statutory_version_id`, `weeks_in_period`, `pay_group`, `pay_date`, `cut_off_date`, `employee_count`,
  `gross_total`, `deduction_total`, `net_total`, `nis_employer_total`, `workflow_id`,
  `input_locked_by/at`, `created_by`, `approved_by`, `locked_by/at`, `reopened_by/at`, `reopen_reason`,
  `exported_at`. Unique on `period_month` (blocks dup runs). Scheduling fields added in
  `..._finance_payroll_run_scheduling.sql`.
- `finance_payroll_run_inputs` — pre-calc snapshot: `source_type` (`base_pay|pay_item|overtime`),
  `source_id`, `component_code`, `label`, `amount`, `quantity`, `rate`, `metadata`.
- `finance_payroll_run_lines` — per-employee result: `base`, `taxable_gross`, `gross`, `nis_employee`,
  `nis_employer`, `health_surcharge`, `chargeable_income`, `paye`, `voluntary_deductions`, `net`,
  `breakdown` (jsonb), `department_id`, `cost_center_id` (**currently null**), `nis_number_masked`,
  `nis_status`, `nis_class_no`, `opening_ytd_nis_employee/employer`.
- `finance_payroll_run_warnings` — `warning_type`, `severity` (`info|warning|blocker`), `message`,
  `resolved`, `resolved_by/at`.
- `finance_payslips` — `payslip_no`, `run_id`, `run_line_id`, `employee_id`, `file_path` (null today),
  `generated_by/at`, `metadata`.
- `finance_payroll_exports` — `export_no`, `run_id`, `format`, `file_path`, `generated_by/at`, `metadata`.
- Statutory: `finance_statutory_versions`, `finance_nis_classes`, `finance_pay_components`,
  `finance_pay_component_change_requests`.
- HR side: `hr_employee_statutory_profiles`, `hr_employee_pay_items`, `hr_overtime_entries`.
- `app_users` payroll fields (`..._add_payroll_fields_to_app_users.sql`): `pay_basis`
  (`salary|hourly`), `monthly_salary`, `hourly_rate`, `department_id`, `start_date`, `end_date`, `status`.
- Downstream: `finance_remittances`, `finance_disbursements`, `finance_general_ledger` (GL exists but
  **no payroll journal writes**).

Migrations: `..._finance_pay_components.sql`, `..._finance_statutory_config.sql`,
`..._employee_statutory_profiles.sql`, `..._finance_payroll_runs.sql`, `..._finance_payslips_exports.sql`,
`..._workflow_finance_payroll_binding.sql`, `..._finance_payroll_run_scheduling.sql`, `..._finance_remittances*.sql`,
`..._finance_disbursements*.sql`, `..._finance_general_ledger.sql`.

---

## 3. Frontend — where everything lives

`src/api/finance/payroll.ts` (TanStack Query hooks): `usePayrollRuns`, `usePayrollRun`, `useRunLines`,
`useRunWarnings`, `useRunPayslips`, `useRunExports`, `useRunInputs`, `useNisProfiles`, `useRunAuditLog`,
`usePopulationPreview`, `usePayrollMutation`, `useResolveWarning`, `useExportDownload`.

`src/components/sections/Finance/`:
- `PayrollOverview.tsx` — the runs register + KPIs.
- `PayNewRunWizard.tsx` — create run (period, frequency, pay group, population preview).
- `PayRunDrawer.tsx` — run detail: lines, warnings, payslips, exports, audit; lifecycle actions.
- `PayWarningResolveDialog.tsx`, `PayBridgeDialog.tsx` (disbursement/remittance bridge), `MyPayslipsOverview.tsx`
  (employee self-service), `StatutoryConfigOverview.tsx` / `StatutoryDashboard.tsx` (rates/NIS config).

Payslip self-service uses `/payroll/payslips/my` + `/signed-url`; MyPayslips renders records but can't
download a PDF yet (no `file_path`).

---

## 4. Cross-module wiring (the "ties")

| Tie | How it works today |
|---|---|
| **NIS (statutory config)** | Run resolves `getActiveStatutoryVersion('TT')` at create; `calculateRun` reads `finance_nis_classes` for that version and matches each employee's weekly insurable to a class. Rates are versioned data, never hardcoded. |
| **NIS (employee profile / HR→Finance)** | `hr_employee_statutory_profiles` carries NIS number/status/applicability + opening YTD. HR captures it (onboarding); Finance **verifies** it (`nisProfileVerification.ts`, its own workflow binding). Payroll snapshots the verified profile onto each line and raises blockers/warnings if unverified/missing (policy-gated). |
| **Payslips** | `generatePayslips` runs on locked runs → `finance_payslips` (1 per run line) → notifies each employee → self-service view. **Missing: PDF render + email delivery + password protection.** |
| **Remittances (BIR/NIBTT)** | `computeRemittanceFromRun` / `createRemittanceFromRun` derive PAYE, NIS (EE+ER), Health Surcharge totals per authority into `finance_remittances` for filing/payment. |
| **Disbursements (net pay)** | `createDisbursementFromRun` creates the net-pay disbursement (bank payout) — the seam where **ACH bank files** (RBL/FCB/RBC/SCOTIA) will attach. |
| **Central workflow engine** | `finance_payroll_approval` binding + `financePayrollAdapter`; approval is engine-driven with server-side SoD. |
| **Attendance / overtime** | `hr_overtime_entries` (approved) flow into inputs. Hourly *hours* from timesheets are **not** yet wired (hourly base = flat `hourly_rate`). |
| **HR employee master** | `app_users` is the employee record (pay_basis, salary/rate, dept, dates). Pay items = `hr_employee_pay_items`. |
| **Settings/governance** | Payroll policy resolved from the settings catalog (`finance_payroll.*`). |
| **Events / audit / notifications** | Every mutation → `app_events` + `hr_audit_log` + notifications + handoffs (per §2 backbone). |
| **GL / accounting journal** | ❌ Not wired. `finance_general_ledger` exists but payroll posts no journal entries. |

---

## 5. Enterprise gap plan (TTPay features → SIOMAC, T&T-specific)

Legend: ✅ have · ⚠️ partial · ❌ missing. Non-payroll TTPay items (leave, disciplinary, recruitment,
training, applicant, PDF attachments, birthday events) are **out of payroll scope** — they belong to HR
modules and are noted only where they feed payroll.

### Payroll-relevant features

| TTPay feature | SIOMAC now | Gap / build note (T&T) |
|---|---|---|
| **Multiple pay cycles** (weekly/fortnightly/monthly/bi-monthly) | ⚠️ `pay_frequency` + `weeks_in_period` + `pay_group` fields exist; `lockInputs` pulls ALL active employees regardless of frequency; PAYE is monthly-annualized | Filter population by `pay_group`/frequency; make PAYE period-correct for weekly/fortnightly (annualize by pay periods, not ÷12); pro-rate personal allowance & band ceiling per cycle; NIS is already weekly-native. |
| **Automated PAYE / NIS / Health Surcharge** | ✅ built, versioned, unit-tested, T&T-correct | Keep. Add year-boundary handling for cross-year runs. |
| **Detailed employee pay profiles** | ✅ pay_basis, salary/rate, statutory profile, pay items | Add banking (see ACH), tax code exemptions, secondary employment flag. |
| **User-definable recurring deductions** | ✅ pay components + `hr_employee_pay_items` (amount or %) | Add per-employee caps, priority/ordering, and net-floor protection. |
| **Salary advance & loan management** | ❌ only flat recurring deductions | New: loan/advance records with principal, schedule, running balance, auto-deduct per cycle until cleared, early-settlement, interest optional. Emits pay item each run. |
| **Time clock integration (CSV/ASCII import)** | ❌ | New importer → `hr_attendance`/timesheet; map to hours for hourly + OT. |
| **Timesheet calculations (auto OT on holidays/rest days/callouts)** | ⚠️ approved OT entries consumed; no rule engine | Rule engine for T&T: public-holiday (double time), rest-day, callout minimums; feed OT amounts into inputs. Security-company use case. |
| **Worksheet override** (per-run per-employee earning/deduction override) | ❌ | Editable worksheet on `input_locked`/`calculated` runs writing override input rows + audit; recalc respects overrides. |
| **ACH bank file export** (RBL/FCB/RBC/SCOTIA) | ⚠️ net-pay disbursement bridge exists; no bank file formats | Per-bank ACH/direct-deposit file generators off `finance_disbursements` + employee bank accounts (`finance_employee_bank_accounts` exists). |
| **Flexible payslip distribution** (print + email, password-protected) | ⚠️ records + in-app self-service only | Payslip **PDF renderer** → `payslips` bucket → `file_path`; email delivery with password (e.g. NIS/DOB); bulk + resend; T&T payslip layout (PAYE/NIS/HS/net + YTD). |
| **Statutory forms** (NI184, NI187, TD4) | ⚠️ remittance/summary reports exist | Generate the actual NIBTT (NI184 contribution schedule, NI187) + BIR **TD4** (BIR-approved layout) outputs, PDF + data file. |
| **Automated year-end TD4** | ❌ | Annual TD4 per employee + TD4 Summary + GL reconciliation report from all locked runs in the tax year. |
| **Payroll variation reports** (estimate vs actual) | ⚠️ register/net summaries; prev-run comparison exists in analysis DTO | Dedicated variation report: this run vs prior run per employee/component, headcount & statutory deltas. |
| **Accounting journal (GL)** | ❌ | Post per-run journal to `finance_general_ledger` (debit wages/ER-NIS/HS expense; credit net-pay clearing, PAYE/NIS/HS payable); configurable GL mapping per component/department; balanced entry, reversible on reopen. |
| **Back pay processing** | ❌ | Retro run type that recomputes prior periods on rate/data changes and pays the delta in the current run (taxed per current period). |
| **Project / cost allocation** | ⚠️ `department_id`/`cost_center_id` on lines are null; dept/cost reports exist | Populate from `app_users`/pay items; add project splits for billing/reimbursement; cost-by-project report. |
| **Multi-format export** (Excel/PDF) | ⚠️ CSV/JSON done; xlsx/pdf stubbed | Implement xlsx + pdf renderers for exports and reports. |
| **50+ standardized reports** | ⚠️ 18 report keys | Expand: earnings analysis, deductions register, workman-comp, timesheet analysis, bank transfer list, statutory schedules, headcount, YTD by employee. |
| **Complete employee & payroll history** | ⚠️ per-run history + audit log | Employee payroll timeline view (all runs, YTD, statutory history) + run-to-run traversal. |
| **Migration from existing payroll** | ⚠️ opening YTD NIS supported on profiles | Importer for opening balances (YTD PAYE/NIS/HS, insurable earnings, loan balances) + historical run stubs. |
| **Audit logs** (name/bank/earning changes) | ✅ `hr_audit_log` on every mutation | Extend coverage to bank-account + statutory-profile edits if not already. |
| **Audit comparison reports** | ❌ | Diff two runs/periods for audit. |
| **Multi-user auth + access control** | ✅ permission catalogue (`finance.payroll.*`) + role scoping | Keep; add field-level masking (NIS/bank) per role, already masked on lines. |

### Explicitly out of payroll scope (HR modules — note the payroll feed)
Leave management (feeds unpaid-leave deductions & accrual), disciplinary, employee requests (job letters),
training history, PDF attachments, job-applicant management, birthday/event notifications, SAP timesheet
(an integration variant of the CSV importer). Build these in HR; payroll only consumes the outputs (e.g.
unpaid-leave days → a deduction input; timesheet → hours).

---

## 6. Recommended build waves for Codex (each is a vertical slice, fully wired + E2E)

Respect the platform rules (`CLAUDE.md`): every mutation emits `app_events` + `hr_audit_log`
(+ notifications/handoffs where rules require), sensitive changes go through the **central workflow**
with SoD, permission keys are added to the catalogue in one coordinated commit (4-file cascade), and each
module ships a live E2E suite (`scripts/e2e/suites/`). No hardcoded rates — read the statutory version.

1. **Payslip PDF + distribution** — renderer → `payslips` bucket → `file_path`; email w/ password;
   bulk/resend; T&T payslip layout with YTD. (Unblocks the biggest user-visible gap.)
2. **GL / accounting journal** — per-run balanced journal to `finance_general_ledger`, configurable
   component→account mapping, reversal on reopen; GL reconciliation report.
3. **Multiple pay cycles done right** — pay-group population filter + period-correct PAYE
   (weekly/fortnightly/bi-monthly annualization + pro-rated allowance/ceiling).
4. **Worksheet override + hourly hours from timesheets** — override editor; time-clock CSV importer;
   T&T OT rule engine (holiday/rest-day/callout).
5. **Loans & salary advances** — amortized balances auto-deducting each cycle.
6. **ACH bank files** — per-bank direct-deposit exports off disbursements + employee bank accounts.
7. **Statutory forms & year-end** — NI184/NI187, BIR TD4 + TD4 Summary, back pay, variation & audit-
   comparison reports; expand the report catalogue toward the 50+ set.

---

## 7. T&T correctness notes (do not regress)
- NIS is a **weekly earnings-class** contribution (EE ⅓ / ER ⅔), matched by weekly insurable earnings;
  the open-ended top class catches high earners; Class Z = reduced rate over pensionable age.
- Health Surcharge is a two-tier weekly amount by a monthly-income threshold.
- PAYE: personal allowance + band-1 ceiling are **annual** figures; compute monthly (or per pay period);
  **NIS and Health Surcharge are NOT deducted before PAYE** in T&T.
- Statutory rates change by legislation → always driven by the **active statutory version** (see
  `docs/STATUTORY_*` + `reference-nis-schedule-2026`), never constants.
- Currency is **TTD**; round to 2 dp at each step (the engine does).
