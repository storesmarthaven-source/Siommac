# SIOMAC Finance — Wave 2B Build Spec (deepen the 6 existing pages into Aurora)

> Authoritative, **reconciled**, file-chunked build plan for Wave 2B. Rolls the Codex "SIOMAC
> Finance Wave 2B — Enterprise Build Spec" (2026-07-07) into the actual repo. The honest per-control
> audit that drove it is `docs/FINANCE_WAVE2B_FEATURE_AUDIT.md` (the "why"); THIS doc is the
> buildable plan — it reconciles Codex against the code already shipped and breaks it into per-file
> chunks. Governing rules: `CLAUDE.md` **No-Band-Aids** + **Feature-Completeness** + **Testing
> Standard**. Sibling: `docs/FINANCE_WAVE2_BUILD_SPEC.md` (Wave 2A — AP + Overview).

---

## 0. Scope, sequencing & the hard dependency on Wave 2A

**In scope — deepen these 6 old-design pages into the Aurora `.hrfin` system:**
`PayrollOverview.tsx`, `StatutoryConfigOverview.tsx`, `RemittancesOverview.tsx`,
`DisbursementsOverview.tsx`, `ExpensesOverview.tsx`, `BudgetsOverview.tsx`.
**Out of core scope this wave:** ESS `MyPayslipsOverview.tsx`.

**Backends already exist — keep and EXTEND, do not rebuild:** `netlify/functions/lib/finance/{payroll,
statutory,remittances,disbursements,expenses,budgets,bankAccounts}.ts` + hooks `src/api/finance/*`.
SoD (`assertDifferentApprover`) and central-workflow approvals are already wired.

**⛔ HARD DEPENDENCY — 2B consumes Wave 2A's shared `.hrfin` layer.** Wave 2A is building the shared
components 2B needs: `EntityPicker`, `RowActionMenu`, the rich `Drawer` + its panels (attachments /
comments / audit / timeline), `HrfinTable` enhancements (facet filter, row ⋮, bulk), `LineItemEditor`,
`WizardStepper`. **Do NOT start 2B page builds until 2A's shared layer has landed and committed** —
2B reuses those `@ui` exports (No-Band-Aids: reuse over duplication). Phase 0 below gates on it.

---

## 1. Reconciliation — Codex spec vs our stack (READ FIRST — the No-Band-Aids gate)

### 1.1 Component-name map — Codex invented names → what actually exists
| Codex name(s) | Reality | Owner |
|---|---|---|
| `HrfinDetailDrawer` + `HrfinDrawerTabs` | `@ui` `Drawer` (`rich`, `panelClass="hrfin"`) + panel primitives | exists; 2A extends |
| `HrfinTableToolbar` / `HrfinStatusFilter` / `HrfinAdvancedFilterPanel` / `HrfinBulkActionBar` / `HrfinRowActionMenu` / `HrfinPagination` | `HrfinTable` (already has tabs/search/`filters[]`/pager) + 2A's `RowActionMenu` + advanced-filter panel | 2A |
| `Finance{PayrollRun,CostCentre,Employee,Authority,BudgetCategory,BankAccount}Picker` (6) | ONE generic `EntityPicker` (search + async), parameterised per entity | 2A builds; 2B parameterises |
| `HrfinKpiCard` / `HrfinTrendArea` / `HrfinHorizontalBars` / `HrfinDonutRing` / `HrfinVarianceBars` / `HrfinInsightBanner` / `HrfinRailCard` | `KpiCard` / `TrendArea` / `HorizontalBars` / `DonutRing` / `InsightBanner` / `RailCard` (VarianceBars = `HorizontalBars` with ± tone) | exists |
| `HrfinTimeline` / `HrfinAuditTrail` / `HrfinAttachmentsPanel` / `HrfinCommentsPanel` | 2A's Drawer panels | 2A |
| `HrfinWizardModal` / stepper | `HrfinWizardModal` + 2A's `WizardStepper` | exists / 2A |
| `finance_audit_events` | `app_events` + `audit_logs` (backbone) — **do NOT fork** | n/a |

### 1.2 Reuse, don't fork. 2A owns the shared component layer. 2B imports from `@ui`. Any "shared
component to build first" in the Codex spec that 2A is already building is **not** rebuilt here.

### 1.3 Employee identity — ONE resolver, service-side. Add `resolveEmployees(ids[])` (finance lib) +
`useEmployeeNames` hook + `<EmployeeCell>` display. Names/number/department come from `app_users`
(+ HR fields). Every surface with raw ids (payroll lines/warnings/payslips, NIS verify, bank accounts,
reports) uses the one resolver. Do NOT patch names per-component.

### 1.4 Reports — wire the EXISTING reports contract + `exportCsv`; don't build a per-page report engine.
`/payroll/reports/*`, `/statutory/reports/*`, and Budgets `budget_variance`/`budget_summary` already
exist. Budgets' "dead Reports tab" = wire the existing reports. CSV via the existing `exportCsv` util
(`CsvColumn = {header, value:(row)=>...}`). XLSX deferred.

### 1.5 Attachments — reuse the presigned-upload + storage-bucket pattern (HR Documents / avatars;
private → signed URLs). Receipts (Expenses) + filing receipts (Remittances) are metadata rows pointing
at stored objects. No bespoke uploader.

### 1.6 Cross-module bridges — idempotent + content-keyed. "Create disbursement/remittance from run"
and "reimbursement handoff" derive their key from `runId(+authority)` / `claimId` with a **unique
constraint**, so a double-click/retry cannot duplicate. (No-Band-Aids: content-derived idempotency.)

### 1.7 Drop the "GL/accounting picker" from 2B — GL isn't built; these are payroll-centric pages.
Cost-centre picker (real, HR Org `hr.cost_centers.*`) yes; a GL-account FK here would be a fake FK.

### 1.8 Permissions + live E2E are hard gates. New actions (warning-resolve, bank-file-download,
bridges, attachments, bulk, report-export) get keys in BOTH `permissions.ts` catalogues (exact-match
drift-guard) + `permissionMeta` + role bundles. Every page **extends** `scripts/e2e/suites/finance*.mjs`
asserting real side-effects (app_events/audit_logs/notifications/handoffs). Test cadence: full E2E once
at the end (`CLAUDE.md`).

---

## 2. Phase 0 — shared foundation (build once, reuse across all 6)

Depends on 2A's shared layer. This chunk adds the 2B-specific shared pieces on top.

| File | N/E | What |
|---|---|---|
| `src/ui/hrfin/EntityPicker.tsx` | (2A) | generic async search+select — **reuse**; do not recreate |
| `netlify/functions/lib/finance/lookups.ts` | N | `resolveEmployees(ids[])` (→ app_users name/no/dept) + list endpoints: `employees`, `cost-centres` (reuse HR Org `hr.cost_centers`), `approved-payroll-runs` (locked/approved/exported), `authorities` (static), `budget-categories` (config/distinct) |
| `netlify/functions/routes/financeLookups.ts` + mount in `api.ts` | N/E | thin routes `finance/lookups/*` |
| `src/api/finance/lookups.ts` | N | `useEmployeeNames`, `useCostCentrePicker`, `useApprovedRunPicker`, `useAuthorityPicker`, `useBudgetCategoryPicker` |
| `src/components/sections/Finance/_shared/EmployeeCell.tsx` | N | name + number (+ dept) display from the resolver; skeleton while loading |
| `src/components/sections/Finance/_shared/pickers.tsx` | N | thin wrappers binding `EntityPicker` to each finance lookup hook |
| `src/components/sections/Finance/_shared/reports.tsx` | N | shared report-surface (selector + params + preview + `exportCsv`) over the existing reports endpoints |
| `netlify/functions/lib/finance/attachments.ts` | N | presigned-upload + metadata rows (reuse storage pattern) — used by Expenses receipts + Remittance filing docs |
| `netlify/functions/lib/finance/bridges.ts` | N | idempotent `createDisbursementFromRun`, `createRemittanceFromRun`, `createReimbursementHandoff` (unique-key guarded, emit handoff/app_events/audit) |
| `src/api/finance/keys.ts` | (2A) | reuse `financeQueryKeys`; extend with 2B roots |
| perms (both `permissions.ts` + `permissionMeta.ts`) | E | add 2B new-action keys + role bundles |
| `scripts/e2e/suites/financeLookups.mjs` | N | lookups return shape + auth |

---

## 3. Per-page chunks

Each page = Aurora shell + register (HrfinTable) + detail Drawer + real dialogs/wizards (pickers, no
free-text) + cross-module wiring + extended E2E. Reused endpoints are noted; **➕ = net-new backend**.
Reference `FINANCE_WAVE2B_FEATURE_AUDIT.md` + the Codex spec for exhaustive field lists.

### 3.1 Statutory Configuration *(build first — strongest backend, lowest risk template)*
- Reuse: versions CRUD+lifecycle, NIS classes upsert/list, pay components, `useNisProfiles`, reports.
- ➕: `deleteNisClass`, `importNisClasses` (CSV), `getRateVersionDetail`, approval-timeline (from workflow/audit), pay-component edit; clean the NIS-verify DTO (drop camel/snake dual-guard).
- Drawer (rate version): Summary · PAYE bands · NIS classes · Health surcharge · Pay components · Linked payroll runs · Approval history · Audit.
- Dialogs: New rate version (existing, Aurora-ise) · NIS class add/edit (+delete) · NIS class CSV import · pay component create/edit · NIS verify (name-resolved).
- Files: `StatutoryConfigOverview.tsx` (rebuild) + `lib/finance/statutory.ts` (➕) + route + `api/finance/statutory.ts` + E2E.

### 3.2 Remittances
- Reuse: list/get/**lines** (`useRemittanceLines`, currently unused)/compute/create/submit/approve/mark-paid/mark-filed/cancel/reports.
- ➕: mark-filed collects filed-date + receipt ref + attachment; filing-receipt attachment; run→remittance bridge (§2).
- Kill free-text run UUID → **approved-run picker**.
- Drawer: Summary · Lines (name-resolved) · Authority filing · Payments · Approvals · Timeline · Audit · Related payroll run.
- Wizard (Compute & create): run picker → authority → computed-totals preview → due date/filing → review.
- Files: `RemittancesOverview.tsx` (rebuild) + `lib/finance/remittances.ts` (➕) + route + hooks + E2E.

### 3.3 Disbursements
- Reuse: list/compute/create/submit/approve/generate-file/mark-paid/cancel/reports; bank `upsert`/`deactivate`.
- ➕: **`bankAccounts/list`** (the surface never renders today), **bank-file signed-URL download** (mirror payslips), disbursement lines endpoint; run→disbursement bridge.
- Kill free-text run UUID → run picker; bank-account form employee free-text → **employee picker**; wire the dead `deactivate`.
- Drawer: Summary · Lines (name-resolved, bank + net) · Bank file · Approvals · Payments · Timeline · Audit · Related run.
- Register gains a real **Bank accounts** tab.
- Files: `DisbursementsOverview.tsx` (rebuild) + `lib/finance/{disbursements,bankAccounts}.ts` (➕) + routes + hooks + E2E.

### 3.4 Expenses
- Reuse: claims list/create(multi-line allocation)/submit/approve/reject/mark-reimbursed/cancel/reports.
- ➕: **receipt attachments** (§1.5) + missing-receipt policy check; real mark-reimbursed (method/date/ref/amount/source) + reimbursement handoff (§2); claim-detail endpoint.
- Kill free-text cost-centre per line → **cost-centre picker**.
- Wizard (New claim): header → lines (picker + tax/project) → **receipts** → policy check → review.
- Drawer: Summary · Expense lines · Receipts · Approvals · Reimbursement · Comments · Timeline · Audit.
- Files: `ExpensesOverview.tsx` (rebuild) + `lib/finance/expenses.ts` (➕) + route + hooks + E2E.

### 3.5 Budgets
- Reuse: budgets list/upsert/delete, variance, reports (`budget_variance`/`budget_summary`).
- ➕: `bulkUpsertBudgetLines`, `copyLastYearBudget`, `getBudgetLineActuals` (drill), wire the reports (dead tab).
- Kill free-text cost-centre + category → **pickers**; single-line upsert → **multi-line bulk entry**.
- Variance surface gains a **budget-vs-actual chart** + drill from a row to source (cost entries / payroll / expenses / AP).
- Drawer (budget line): Summary · Actuals composition · Variance trend · Related transactions · Timeline · Audit.
- Files: `BudgetsOverview.tsx` (rebuild) + `lib/finance/budgets.ts` (➕) + route + hooks + E2E.

### 3.6 Payroll *(build last — deepest; benefits from every shared piece being proven)*
- Reuse: runs CRUD+lifecycle (lock-inputs/calculate/submit/lock/reopen/export — genuinely wired, keep), run-lines, warnings, payslips (gen/list/signed-url), exports, reports, `listInputs` (exists, no UI).
- ➕: warning **resolve/acknowledge** mutation (the `resolved` flag has no writer); export-file **signed-URL download**; bulk payslip download; run→disbursement + run→remittance **bridges** (§2); ESS **payslip-ready notification** on generate.
- Name-resolve employee ids in lines/warnings/payslips.
- Drawer (run): Summary · Run lines (EmployeeCell) · **Inputs** (new) · Warnings (resolvable) · Payslips · Exports (download) · Approvals · Timeline · Audit · Related.
- Wizard (New run): period/frequency → employee-population preview → inputs preview → statutory-version preview → pre-check warnings → review.
- Files: `PayrollOverview.tsx` (rebuild) + `lib/finance/payroll.ts` (➕) + routes + hooks + E2E.

---

## 4. Cross-cutting (every page)

1. **Aurora shell:** `<div class="hrfin">` → `HrfinPageHeader` + `QuickActionStrip` + KPI strip (`KpiCard`,
   drill-through) + analytics card + `HrfinTable` register + rail (`RailCard`/`DeadlineList`/`ActivityFeed`/
   `InsightBanner`). Replace `hr-offboarding fin-page`/`PageHeader`/`obx-*`.
2. **Registers:** search + status/facet filter + period filter + pager + column sort + row ⋮ (2A's menu)
   + bulk actions where relevant + CSV export + empty/loading/error. No flat tables.
3. **Drawers:** every entity opens a `Drawer rich panelClass="hrfin"` with the tabs listed per page.
4. **Backbone per mutation (Spec §2):** business row → `emitAppEvent` → `writeHrAudit` → workflow task on
   approval → **toast** → notifications/handoffs where required. SoD via `assertDifferentApprover`,
   surfaced inline. Compensating rollback; never swallow errors.
5. **No raw UUIDs / no free-text FKs** anywhere — pickers + `<EmployeeCell>`.
6. **Loading standard:** instant-from-cache (`placeholderData` + hover prefetch) + `@ui` Skeleton/
   TableSkeleton on cold path; never a fake 0 (memory `loading-state-standard`).
7. **E2E per page:** extend `scripts/e2e/suites/finance<Module>.mjs` — every endpoint, authorized +
   unauthorized (provision a real role user), response shape, and side-effect assertions.

---

## 5. Build order (reconciled with Wave 2A)

**Phase 0** — wait for 2A's shared layer to land, then build §2 (lookups + resolver + pickers + reports
helper + attachments + bridges + perms). **Then per page:** Statutory → Remittances → Disbursements →
Expenses → Budgets → **Payroll last**. Per page: Aurora shell → register → drawer → wizards/dialogs
(real pickers) → cross-module wiring → extend E2E → `typecheck:frontend` + `build:backend` → **commit**.
**Final:** cross-module notifications/handoffs verified end-to-end → full E2E green → operator migration
handoff (any ➕ tables: attachments, bridge idempotency keys, filing-receipt) → checkpoint commit.

---

## 6. Acceptance gate (per page, before "done")

No free-text FK; no raw employee UUID; register has search/filter/pager/export; entity has a detail
drawer with its tabs; every dialog full-field + inline validation + pickers; every mutation → toast +
app_events + audit_logs + workflow/notify/handoff where required; reports real (no placeholder);
cross-module bridge idempotent; E2E asserts the side-effects. Specifically: **Disbursements bank-accounts
list renders + deactivate works + bank file downloads; Budgets Reports tab is live + variance charts;
Payroll warnings resolve + inputs surface + export downloads + run bridges; Expenses receipts upload;
Remittances run-picker + lines drawer + filed-date/ref.**

## 7. Open decisions / deferrals
- XLSX export deferred → CSV first. · ESS MyPayslips out of this wave. · Comments reuse a platform
  table if one exists (grep first) else `finance_*_comments`. · Budget→GL drill limited to built sources
  (cost entries / payroll / expenses / AP) until GL ships. · Bank/EFT file format = standard CSV +
  mark-manual; real bank integration later.
