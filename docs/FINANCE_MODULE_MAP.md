# Finance Module Map — scope, reuse, and build sequence

For planning / Codex. Mirrors `docs/HR_MODULE_MAP.md`. States, per Finance sub-module: what already
EXISTS (do not rebuild), what to REUSE, what is genuinely NEW, rough size, dependencies, and a phased
order. **Active scope only — no legacy `payroll.ts` / HourlyRates / deprecated APIs.**

Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` first for conventions every module follows (envelope
`{success,data}`, `body.args`, `requirePermission(c,key)`, camelCase DTO, `app_users.id` is TEXT,
mutation side-effects order event→audit, central workflow, no URL router, E2E suite required, test
cadence). Finance adds one more: **segregation of duties (SoD)** — creator ≠ approver, enforced in the
adapter via `assertDifferentApprover` (already used by statutory + payroll approvals).

---

## 0. Already built (do NOT rebuild)

Finance today = the **payroll-processing + statutory slice**, full-stack and E2E-covered:

- **Statutory Configuration** — `finance_statutory_versions` + `finance_nis_classes`. Rate-version
  lifecycle: create/update/submit/**approve**/**activate**/reject/retire (one-active-per-jurisdiction),
  NIS classes upsert/list, reports. Central-workflow approval (`finance_statutory_approval` binding) +
  SoD. Routes `/statutory/*`. Nav: **Statutory Configuration**.
- **Pay Components** — `finance_pay_components` catalogue CRUD (earning/deduction defs). Routes
  `/payroll/components/*`.
- **Payroll** — `finance_payroll_runs` + `_run_lines` + `_run_inputs` + `_run_warnings` + `finance_payslips`
  + `finance_payroll_exports`. Full run lifecycle: create → lock-inputs → calculate → submit → **approve**
  → **lock** → **payslips generate** → **export** (+ reopen), warnings, run-lines, payslips
  (list/get/my/signed-url), inputs, exports, reports. Workflow `finance_payroll_approval` + SoD. Nav:
  **Payroll**.
- **NIS Profile Verification** — cross-module: HR captures (`hr.employee.statutory.capture`) → Finance
  verifies (`finance.payroll.nis.{view,verify}`). Routes `/payroll/nis/*` + workflow
  `finance_nis_profile_verification`.

**Finance foundation to build ON (reuse, don't reinvent):**

| Capability | What exists | Reuse for |
|---|---|---|
| **Finance roles + SoD** | `finance_staff` / `finance_manager` roles; `assertDifferentApprover` | every finance approval chain |
| **Central workflow engine** | `workflow_templates/versions/bindings`, adapters, maker-checker | remittance approval, expense approval, journal posting approval, AP payment approval |
| **Cost centres** | `finance_cost_centers` — **already built + wired via HR Organization** (`hr.cost_centers.*`) | expense allocation, budgets, GL dimensions (REUSE, don't recreate) |
| **Statutory reference** | `finance_statutory_versions` (PAYE/NIS rates) | remittance calc, tax |
| **Payroll outputs** | run lines, payslips, deductions, exports | remittances, bank disbursement, GL posting |
| **Handoff bus + finance receiver** | `handoff_outbox` + `lib/receivers/financeReceiver.ts` + `emitAppEvent` | cross-module (HR→Finance, Finance→bank/authority) |
| **Reports contract** | `/statutory/reports/*`, `/payroll/reports/*` (catalog→run→export) | every finance module's reporting |
| **Widget board** | v2 widget library (see `SIOMAC_ENTERPRISE_WIDGET_SYSTEM_IMPLEMENTATION.md`) | finance dashboards |
| **Audit** | `writeHrAudit`-style audit (throws) + `app_events` | every mutation |

**Skeleton tables that exist but are NOT built into a module yet** (from
`20260621100003_erp_hr_payroll_finance_ops_core.sql`): `finance_cost_entries`, `finance_budget_lines`.
(`finance_cost_centers` is already wired via HR Org.) These are the cheapest greenfield starts because
the table shells exist.

---

## The pending Finance modules — reuse / new / size / priority

**Size:** S (days) · M (~1 week) · L (multi-week). **Priority:** A (do first) … D (last).

### Tier A — extend the payroll pipeline (highest leverage, reuses the built payroll+statutory+workflow)

#### F1 — Statutory Remittances & Filing  ·  **Size M · Priority A**
- **Reuse (very high):** locked payroll runs → PAYE/NIS deduction totals; `finance_statutory_versions`
  for rates; central workflow for remittance approval; reports contract; SoD.
- **New:** `finance_remittances` table (period, authority, PAYE/NIS totals, status
  draft→submitted→approved→paid→filed), remittance calc from run lines, filing/receipt tracking, a
  Remittances page + approval. (Legacy `payroll_remittances` in `routes/payroll.ts` is a reference only —
  greenfield in active finance.)
- **Why next:** directly continues the just-completed Payroll Phase 3; closes the deductions→authority
  loop; smallest new surface for the most business value.

#### F2 — Payroll Bank Disbursement / Bank File  ·  **Size M · Priority A/B**
- **Reuse (high):** locked/approved payroll run + payslips (net pay) + exports; workflow for disbursement
  sign-off.
- **New:** `finance_disbursements` (+ bank file format e.g. ACH/EFT), employee bank details source,
  disbursement status, generate + download bank file, mark-paid.
- **Depends on:** F-nothing hard; complements F1.

#### F3 — Payslip Distribution & ESS  ·  **Size S–M · Priority B**
- **Reuse (very high):** payslips `/my` + `signed-url` already exist; notifications; ESS surface.
- **New:** employee self-service payslip page + "payslip ready" notifications on payroll lock; download
  history. Mostly a frontend + notification wiring pass.

### Tier B — cost & budget (skeleton tables already exist)

#### F4 — Expenses / Cost Entries  ·  **Size M–L · Priority B**
- **Reuse (high):** `finance_cost_entries` shell + `finance_cost_centers` (built) + central workflow
  (expense approval) + documents (receipts, via HR document pattern) + handoff to payroll for reimbursements.
- **New:** expense capture (claim → category → cost centre → attachment), approval workflow,
  reimbursement path, cost-centre allocation, expense reports.

#### F5 — Budgeting & Budget-vs-Actual  ·  **Size M · Priority B/C**
- **Reuse (high):** `finance_budget_lines` shell + cost centres + cost entries (F4) + payroll actuals.
- **New:** budget setup per cost centre/period, variance calc vs actual (cost entries + payroll), budget
  reports + widgets. **Depends on F4** for actuals granularity.

### Tier C — accounting core (greenfield, foundational, larger — only if SIOMAC scope is full accounting)

#### F6 — General Ledger + Chart of Accounts  ·  **Size L · Priority C**
- **Reuse (medium):** cost centres as a GL dimension; workflow for journal approval; payroll/expenses as
  posting sources.
- **New:** chart of accounts, journal entries, posting rules, period close. **Backbone** for F7/F8/F11.
- **Note:** large greenfield; only build if Finance is meant to be a full accounting ERP (see Open Question).

#### F7 — Accounts Payable (AP)  ·  **Size L · Priority C** — vendors, bills, payment runs. Posts to GL (F6).
#### F8 — Accounts Receivable (AR)  ·  **Size L · Priority C** — customers, invoices, receipts. Posts to GL (F6).
#### F9 — Cash & Bank Management  ·  **Size M–L · Priority C** — bank accounts, transactions, reconciliation.
#### F10 — Fixed Assets  ·  **Size L · Priority C** — asset register + depreciation.
  **Clarify ownership:** `ops_assets` skeleton exists under Operations — decide Finance vs Ops before building.
#### F11 — Financial Reporting  ·  **Size M · Priority C/D** — trial balance, P&L, balance sheet, cash flow.
  **Depends on F6 (GL).**
#### F12 — Tax Management (VAT/GST)  ·  **Size M · Priority C** — jurisdiction-dependent; may fold into F1/F6.

### Tier D — last

#### F13 — Finance Analytics Dashboard  ·  **Size M · Priority D**
- **Reuse (high):** widget board + reports. **New:** cross-finance KPIs (payroll cost trend, remittance
  status, expense/budget variance, approvals). Build LAST, after the modules above emit data.

---

## Recommended sequence

**Immediate next (Tier A):** **F1 — Statutory Remittances & Filing.** It reuses the most (locked payroll
runs + statutory rates + workflow + SoD + reports), is well-scoped (M), and closes the payroll→authority
loop that Payroll Phase 3 opened. Then **F2 (bank disbursement)** and **F3 (payslip ESS)** to complete
the payroll-to-employee/authority pipeline.

**Then (Tier B):** **F4 Expenses → F5 Budgeting** (skeleton tables exist; reuse cost centres + workflow).

**Only if full-accounting scope is confirmed (Tier C):** **F6 GL** first (backbone), then AP/AR/Cash/
Assets/Reporting/Tax.

**Last:** **F13 Finance Analytics.**

**Rule for every item:** follow `ONBOARDING_IMPLEMENTATION_REFERENCE.md` conventions, reuse the Finance
foundation table above, enforce SoD on approvals via `assertDifferentApprover`, add the module's E2E suite
(`scripts/e2e/suites/finance<Module>.mjs`) per the testing standard, ship UI functional-first, and land
permission + workflow-binding migrations with the module (grant column is `permission`, NOT
`permission_key` — see the payroll grant migrations for the correct pattern).

---

## Open scope question (confirm before Tier C)

**Is SIOMAC Finance intended to be:**
- **(a) Payroll/statutory-centric, HR-adjacent finance** — remittances, disbursement, expenses, budgets
  (Tiers A–B + Analytics). Smaller, continues the current thread, high certainty. **← current build implies this.**
- **(b) A full accounting ERP** — GL, AP, AR, Cash, Assets, Reporting, Tax (Tiers A–C). Much larger; GL
  (F6) becomes the backbone everything posts to.

The spec is the authority. Tiers A–B are safe to plan/build regardless; Tier C should be confirmed against
the SIOMAC ERP spec before Codex scopes it, because GL changes the data model everything else posts into.
