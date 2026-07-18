# SIOMAC Finance Wave 2B — Full Technical Implementation

> **Status:** authoritative build spec for the Wave 2B per-page deepening (the 6 old Finance pages →
> Aurora `.hrfin`). The user-authored standard is reproduced verbatim in §1–§20. **§0 (Reconciliation)
> was added by the orchestrator after verifying the spec against the live tree on 2026-07-08 and
> OVERRIDES the spec body wherever they conflict.** Read §0 first — it is the No-Band-Aids gate.

---

## 0. RECONCILIATION — read FIRST (No-Band-Aids gate, verified 2026-07-08)

The spec below was authored against the architecture description, not the live code. These corrections
are mandatory and override the spec body on conflict.

### 0.1 Phase 0 ALREADY EXISTS — consume, do not rebuild (built by Agent C this session)
- `netlify/functions/lib/finance/lookups.ts` + `routes/financeLookups.ts` (**mounted** in `api.ts`) +
  `src/api/finance/lookups.ts` — `resolveEmployees`, `useEmployeeNames`, and pickers for
  employees / approved-payroll-runs / authorities / budget-categories.
- **Cost-centre picker is the EXISTING** `finance/pickers/cost-centres` route (fixed this session to query
  `finance_cost_centers`, not `hr_cost_centers`). Do NOT add a second cost-centre endpoint.
- `src/components/sections/Finance/_shared/EmployeeCell.tsx`, `_shared/pickers.tsx`, `_shared/reports.tsx`.
- `netlify/functions/lib/finance/attachments.ts` + `bridges.ts` (backend, idempotent, content-keyed).
- `src/api/finance/keys.ts` — 6 module-root query-key families already added.
- Migration `20260917000040_finance_2b_foundation.sql` — `finance_expense_attachments`,
  `finance_remittance_attachments`, `finance_reimbursement_handoffs` (**per-entity, NO tenant_id**).

### 0.2 Phase 0 GAPS to close BEFORE the page fleet (orchestrator owns these)
- `src/api/finance/attachments.ts` + `src/api/finance/bridges.ts` — FE hooks (MISSING).
- `_shared/financeEvents.ts` (+ notification/ticket helpers) — the shared mutation-backbone helper (§8.5);
  all 6 pages depend on it, so it is built ONCE in Phase 0, never per-page.
- Any additional per-entity attachment tables (disbursement/budget/payroll support) and the
  run→disbursement / run→remittance bridge tables + their perm keys — follow the EXISTING per-entity
  pattern from `20260917000040`, **no tenant_id**.

### 0.3 Stack corrections (override the spec body)
1. **POST-only, never GET.** Every route is a POST Hono handler reading `body.args ?? body`. The spec's
   `GET /finance/lookups/*` is wrong — the real routes are POST (`/lookups/resolve-employees`,
   `/lookups/employees`, `/lookups/approved-payroll-runs`, `/lookups/authorities`,
   `/lookups/budget-categories`).
2. **NO `tenant_id`.** 0 migrations use it; SIOMAC is single-tenant. Drop `tenant_id` from every spec
   table. Do NOT create the generic `finance_attachments` / `finance_bridge_requests` tables — they would
   fork the per-entity tables already shipped. Extend the per-entity pattern instead.
3. **Audit store is `hr_audit_log` via `writeHrAudit`** (synchronous, awaited before the mutation returns).
   `audit_logs` is the async app_events mirror — never assert it right after a mutation. There is no
   `writeFinanceAudit`.
4. **Backend file names differ:** spec `lib/finance/payroll.ts` → real `payrollRuns.ts` (+ `payrollReports.ts`,
   `payrollPayslips.ts`, `payrollExports.ts`, `payrollStatutory.ts`, `payrollComponents.ts`);
   spec `lib/finance/statutory.ts` → real `statutoryConfig.ts`. `remittances/disbursements/expenses/budgets/bankAccounts.ts` match.
5. **`app_users.id` is TEXT** — all user FKs (`created_by`, `uploaded_by`, `employee_id`, `actor_id`) are
   `text references public.app_users(id)`, never uuid.
6. **Permissions: reuse-first.** ~100 finance keys already exist and gate the current routes. Do NOT
   mass-rename them to the spec's granular set (dual-authority churn). Reuse an existing key for an existing
   action; add a NEW granular key ONLY for a genuinely new action (e.g. `warning.resolve`,
   `bankFile.download`, `bankAccounts.deactivate`, `receipt.upload`, `handoff.createReimbursement`,
   `bulkUpsert`, `nisClass.delete/import`). The DB `role_permissions` table is the RUNTIME authority — a
   key enforced by a route but not granted there **403s**. Page agents **report** new keys; the orchestrator
   catalogues them (BE `permissions.ts` + FE `src/lib/permissions.ts` + `permissionMeta.ts`) and writes ONE
   `role_permissions` grants migration.
7. **Mutation backbone wraps the REAL primitives.** `financeEvents.ts` composes the existing
   `emitAppEvent` + `writeHrAudit` + notification/ticket/workflow-task/handoff primitives (and
   `runModuleMutation` where it already fits). It is not a new parallel system and must not be ceremony.
8. **`dev:netlify` serves compiled `dist/`.** Agents gate on `npm run typecheck:frontend` +
   `npm run build:backend` only; they do NOT run E2E (operator applies migrations + restarts). Suites are
   extended, not executed, by agents.
9. **E2E `fails(r, msg)` takes an AWAITED response:** `const r = await api(...); fails(r); expect(r.status===403,...)`.
   Never `await fails(api(...))`. Copy negative-path patterns from `scripts/e2e/suites/communications.mjs`.

### 0.4 Ownership model (the A/B/C recipe that worked)
Each page agent owns ONLY: its `<Page>Overview.tsx` + prefixed new components (`Stat*`/`Rem*`/`Disb*`/
`Exp*`/`Bud*`/`Pay*`) + its backend `lib` + `route` + `src/api` + its `scripts/e2e/suites/finance<Module>.mjs`.
**Nobody edits** `permissions.ts` (BE/FE), `permissionMeta.ts`, `api.ts`, `keys.ts`, `module.ts`,
`FinanceSection.tsx`, `finance.css`, or the Phase-0 `_shared/*` files — they CONSUME and REPORT. The
orchestrator integrates all shared-file changes centrally, writes the grants migration, mounts anything new,
and runs the full gate.

---

## 1. Target outcome
Wave 2B converts these six old Finance pages into the Aurora `.hrfin` system:
`PayrollOverview.tsx`, `StatutoryConfigOverview.tsx`, `RemittancesOverview.tsx`,
`DisbursementsOverview.tsx`, `ExpensesOverview.tsx`, `BudgetsOverview.tsx`.
Out of scope: `MyPayslipsOverview.tsx`.

Wave 2B must NOT rebuild shared UI primitives. It consumes the Wave 2A / Phase-0 shared components:
HrfinTable · Drawer (rich, `panelClass="hrfin"`) · EntityPicker · RowActionMenu · WizardStepper ·
HrfinWizardModal · LineItemEditor · KpiCard · TrendArea · HorizontalBars · DonutRing · InsightBanner ·
RailCard · AttachmentsPanel · CommentsPanel · TimelinePanel · AuditPanel · EmployeeCell · the finance pickers.

Core defects to fix (from the audit): no Aurora shell, flat registers, no drawers, free-text UUID FKs,
raw employee IDs, placeholder reports, missing cross-module side effects.

## 2. Folder and file structure
**Shared finance files** — mostly EXIST (see §0.1). Remaining to create: `src/api/finance/attachments.ts`,
`src/api/finance/bridges.ts`, `_shared/financeEvents.ts` (+ `financeNotifications.ts`, `financeTickets.ts`).
Already present: `lib/finance/lookups.ts`, `routes/financeLookups.ts`, `lib/finance/attachments.ts`,
`lib/finance/bridges.ts`, `src/api/finance/lookups.ts`, `src/api/finance/keys.ts`,
`_shared/EmployeeCell.tsx`, `_shared/pickers.tsx`, `_shared/reports.tsx`.

**Pages to rebuild:** the six `*Overview.tsx` above.
**Backends to extend:** `lib/finance/{payrollRuns,statutoryConfig,remittances,disbursements,expenses,budgets,bankAccounts}.ts`
(note the reconciled names in §0.3.4).
**API hooks to extend:** `src/api/finance/{payroll,statutory,remittances,disbursements,expenses,budgets,bankAccounts}.ts`.

## 3. Shared backend foundation (EXISTS — extend only per §0.1/§0.2)

### 3.1 Finance lookups — `lib/finance/lookups.ts` (+ `routes/financeLookups.ts`)
Types (reconciled to TEXT ids): `EmployeeLookup { id; employeeNo|null; displayName; departmentName|null;
jobTitle|null; status }`, `CostCentreLookup { id; code; name; departmentId?; departmentName?; active }`,
`ApprovedPayrollRunLookup { id; runCode; name; periodLabel; payGroup; status; payDate|null; netPayroll }`,
`AuthorityLookup { id; code; name; type; active }`, `BudgetCategoryLookup { id; code; name; active }`.
Functions: `resolveEmployees(ids[])`, `listEmployees`, `listCostCentres` (via the existing pickers route),
`listApprovedPayrollRuns`, `listAuthorities`, `listBudgetCategories`.
Routes (**POST**): `/lookups/resolve-employees`, `/lookups/employees`, `/lookups/approved-payroll-runs`,
`/lookups/authorities`, `/lookups/budget-categories`; cost-centres via `/pickers/cost-centres`.

### 3.2 Frontend lookup hooks — `src/api/finance/lookups.ts` (EXISTS)
`useEmployeePicker`, `useEmployeeNames`, `useCostCentrePicker`, `useApprovedRunPicker`, `useAuthorityPicker`,
`useBudgetCategoryPicker`, keyed by `financeLookupKeys`.

### 3.3 `<EmployeeCell/>` — `_shared/EmployeeCell.tsx` (EXISTS)
Resolves an employee id to name + number (+ department); loading skeleton; unresolved fallback shows the id.
**Rule:** no payroll/statutory/disbursement/expense/budget surface may show a raw employee UUID.

## 4. Shared pickers — `_shared/pickers.tsx` (EXISTS)
`EmployeePicker`, `CostCentrePicker`, `ApprovedPayrollRunPicker`, `AuthorityPicker`, `BudgetCategoryPicker`.
Each supports: search, keyboard nav, loading, empty, selected preview, clear, disabled, error, required
validation. **Forbidden:** any free-text input for `payrollRunId` / `employeeId` / `costCentreId` /
`budgetCategoryId`; no raw-UUID helper text.

## 5. Shared reports — `_shared/reports.tsx` (EXISTS as ReportPanel; extend per page)
Report selector + param form + preview table + CSV export + loading/empty/error + last-generated timestamp.
Reports to wire per module:
- **Payroll:** payroll_run_summary, payroll_inputs, payroll_warnings, payslip_status, payroll_exports
- **Statutory:** statutory_version_summary, nis_class_summary, pay_component_map, statutory_approval_history
- **Remittances:** remittance_summary, remittance_lines, authority_filing_status
- **Disbursements:** disbursement_summary, bank_file_status, bank_account_readiness
- **Expenses:** expense_claim_summary, expense_policy_exceptions, reimbursement_summary, missing_receipts
- **Budgets:** budget_variance, budget_summary, budget_actuals (Budgets Reports is currently a placeholder — wire the real ones)

## 6. Attachments — `lib/finance/attachments.ts` + `src/api/finance/attachments.ts`
Backend EXISTS; **FE hooks missing (build in Phase 0).** Reconciled: **per-entity tables, NO tenant_id, TEXT
`uploaded_by`.** `20260917000040` shipped `finance_expense_attachments` + `finance_remittance_attachments`;
add per-entity tables for disbursement/budget/payroll support in the same pattern (do NOT build the generic
`finance_attachments`). Functions: `createFinanceAttachmentUpload`, `completeFinanceAttachmentUpload`,
`listFinanceAttachments`, `getFinanceAttachmentSignedUrl`, delete. Routes (**POST**, except signed-url GET-free):
`/attachments/upload-url`, `/attachments/complete`, `/attachments/list`, `/attachments/signed-url`,
`/attachments/delete`. Uses the `finance-receipts` private bucket + presigned upload (reuse `lib/upload.ts`).
Attachment types: expense_receipt, remittance_filing_receipt, bank_file_support, budget_support, payroll_support.

## 7. Cross-module bridges — `lib/finance/bridges.ts` + `src/api/finance/bridges.ts`
Backend EXISTS (`createDisbursementFromRun`, `createRemittanceFromRun`, `createReimbursementHandoff`,
unique-key guarded); **FE hooks missing (build in Phase 0).** Reconciled: NO `tenant_id`; the idempotency
table is the per-entity `finance_reimbursement_handoffs` pattern — add analogous guard tables/columns for the
run→disbursement and run→remittance bridges (unique content key), NOT a generic `finance_bridge_requests`.
Idempotency keys: `run:${runId}:disbursement`, `run:${runId}:authority:${authorityId}:remittance`,
`claim:${claimId}:reimbursement`. Every bridge: create-or-reuse business record → insert the guard row →
emit app_event → write hr_audit_log → create notification → create handoff → optional Message Center thread →
return `reusedExisting`.

## 8. Message Center / notifications / tickets / workflow integration

### 8.1 Integration matrix (source event → app_event · notification · message · ticket · handoff)
- Payroll payslips generated → `finance.payroll.payslips.generated` · Employees + Payroll Admin · optional ESS thread · — · ESS payslip-ready
- Payroll warning overdue → `finance.payroll.warning.overdue` · Payroll Admin + Run Owner · payroll ops thread · **ticket** · warning task
- Payroll run locked → `finance.payroll.run.locked` · Finance Payroll Lead · run thread · — · disbursement/remittance eligible
- Payroll run → disbursement → `finance.payroll.bridge.disbursement.created` · Payment Ops · handoff thread · — · Disbursement
- Payroll run → remittance → `finance.payroll.bridge.remittance.created` · Compliance Ops · handoff thread · — · Remittance
- Remittance filed → `finance.remittance.filed` · Finance Lead · authority filing thread · — · authority filing record
- Remittance overdue → `finance.remittance.overdue` · Finance Lead + Compliance · escalation thread · **ticket** · compliance task
- Disbursement bank file ready → `finance.disbursement.bank_file.ready` · Payment Operator · execution thread · — · bank file action
- Disbursement line blocked → `finance.disbursement.line.blocked` · Payroll + HR Admin · bank issue thread · **ticket** · bank account correction
- Expense missing receipt → `finance.expense.receipt.missing` · Claimant + Manager · claim thread · **ticket** · receipt follow-up
- Expense approved reimbursable → `finance.expense.approved.reimbursable` · Finance Payments · reimbursement thread · — · reimbursement handoff
- Budget variance breached → `finance.budget.variance.threshold_breached` · Cost-centre Owner + Finance Lead · budget review thread · optional · budget review task
- Statutory version approved → `finance.statutory.version.approved` · Payroll Admin · config thread · — · payroll config update
- NIS verification rejected → `finance.statutory.nis.rejected` · HR + Payroll Admin · compliance thread · **ticket** · employee data correction

### 8.2–8.4 Payloads
`FinanceNotificationPayload { module; eventType; title; body; severity; recipientUserIds[]; recipientRoleKeys?;
entityType; entityId; actionUrl; metadata }`.
`FinanceMessageThreadPayload { sourceModule; sourceEntityType; sourceEntityId; subject; participantUserIds[];
participantRoleKeys?; initialMessage; metadata{ appEventId; auditLogId; workflowTaskId?; handoffId? } }`.
`FinanceTicketPayload { sourceModule; sourceEntityType; sourceEntityId; title; description; priority; category;
assigneeRoleKey; dueAt?; metadata }`.

### 8.5 Shared side-effect helper — `_shared/financeEvents.ts` (build in Phase 0)
`emitFinanceMutationBackbone({ actorUserId, module, entityType, entityId, eventType, auditAction, summary,
metadata?, workflow?, notifications?, messageThread?, ticket?, handoff? })` → composes, in order: emitAppEvent
→ writeHrAudit → workflow task (if req) → notifications → message thread (if req) → ticket (if req) →
handoff (if req). **Wraps the real primitives (§0.3.7); TEXT user ids; no tenant_id.**

## 9. Permissions (reuse-first per §0.3.6; agents REPORT, orchestrator catalogues + grants)
The spec's full granular key set (Payroll §9.1, Statutory §9.2, Remittances §9.3, Disbursements §9.4,
Expenses §9.5, Budgets §9.6) is the TARGET vocabulary. Apply reuse-first: keep the existing key for an
existing action; introduce a granular key only for a new action. Newly-needed keys include (non-exhaustive):
`finance.payroll.warning.resolve`, `finance.payroll.payslip.bulkDownload`, `finance.payroll.export.download`,
`finance.payroll.bridge.createDisbursement`, `finance.payroll.bridge.createRemittance`,
`finance.statutory.nisClass.delete`, `finance.statutory.nisClass.import`,
`finance.remittances.markFiled`, `finance.remittances.receipt.upload`,
`finance.disbursements.bankFile.download`, `finance.disbursements.bankAccounts.deactivate`,
`finance.expenses.receipt.upload`, `finance.expenses.handoff.createReimbursement`,
`finance.budgets.bulkUpsert`, `finance.budgets.copyLastYear`. Every new key → BE+FE catalogue + permissionMeta
+ `role_permissions` grants migration + drift-guard passes.

## 10. Query keys — `src/api/finance/keys.ts` (extend; orchestrator-owned file)
Per-module families with detail/lines/inputs/warnings/payslips/exports/reports/actuals/variance/bankAccounts/
bankFiles/receipts as listed in the spec. Agents REPORT any missing factory; the orchestrator adds it.

## 11. Statutory Configuration (BUILD FIRST — strongest backend)
Shell: `HrfinPageHeader` + `QuickActionStrip` + KPI strip + main grid (AnalyticsRow + HrfinTable + Drawer) +
rail (RailCard + InsightBanner + ActivityFeed).
KPI cards (with drill): Active version, Draft versions, Pay components, NIS classes, Verification queue,
Pending approvals. Tabs: Rate Versions · NIS Classes · Pay Components · NIS Verification · Reports.
Rate-versions table: Version(+status pill), Effective date, Status, Owner (EmployeeCell), Linked payroll runs
(count+drill), Approval state, RowActionMenu — with search/sort/filter/pager.
Drawer tabs: Summary · PAYE Bands · NIS Classes · Health Surcharge · Pay Components · Linked Payroll Runs ·
Approval History · Timeline · Audit.
Dialogs: New Rate Version wizard (6 steps: metadata → PAYE bands → health surcharge → NIS ceiling/classes →
component mappings → review/submit); NIS Class add/edit (code, description, lower/upper limit, employee/employer
rate, effective date); NIS CSV import (validate duplicate code / overlapping bands / missing rate / invalid
percent / invalid date); Pay Component create/edit (code, name, kind, taxable, NIS/PAYE/HS applicable, effective/retire).
Backend additions: `deleteNisClass`, `importNisClasses`, `getRateVersionDetail`, `updatePayComponent`, `getApprovalTimeline`.

## 12. Remittances
KPI cards: Outstanding dues, Overdue filings, Paid MTD, Filed MTD, Authority liability, Blocked filings.
Tabs: Remittances · Lines · Payments · Filings · Authorities · Reports.
Register: Remittance no.(+status), Authority (cell), Period, Due date (deadline cell), Amount (money), Status,
Source payroll run (link → Payroll drawer), RowActionMenu.
Compute & Create wizard (5 steps): ApprovedPayrollRunPicker → AuthorityPicker → computed-totals preview →
due date + filing settings → review. (Kill the free-text run UUID.)
Drawer tabs: Summary · Lines · Authority Filing · Payments · Approvals · Timeline · Audit · Related Payroll Run · Attachments.
Mark-Filed dialog (full): filed date, filing reference, receipt reference, filing method, receipt attachment, notes.
Backend: `markFiled(...)`, `createRemittanceFromRun(...)`. Side effects: filed → app_event + audit + notify
compliance lead + filing thread; ticket only if overdue/missing receipt.

## 13. Disbursements
Tabs: Disbursements · Lines · Bank Accounts · Bank Files · Payments · Reports.
KPI cards: Pending, Approved, Generated bank files, Paid MTD, Missing bank accounts, Failed lines.
Compute & Create wizard (5 steps): ApprovedPayrollRunPicker → bank-readiness preview → totals preview →
payment settings → review. Keep the missing-bank-account guard.
Bank Accounts tab (FIX the dead list): EmployeeCell, bank name, masked account no, routing/IFSC, default,
verification status, last updated, actions (edit / set default / **deactivate** (wire it) / view audit).
Bank Files tab: file name, disbursement, format, generated by, generated at, line count, status, **download**.
Drawer tabs: Summary · Lines · Bank File · Bank Accounts · Approvals · Payments · Timeline · Audit · Related Payroll Run.
Backend: `listBankAccounts`, `deactivateBankAccount`, `listDisbursementLines`, `getBankFileSignedUrl`,
`createDisbursementFromRun`. Bank-file download route returns a signed URL; emits
`finance.disbursement.bank_file.downloaded` + audit.

## 14. Expenses
Tabs: Claims · Expense Lines · Receipts · Approvals · Reimbursements · Reports.
KPI cards: Open claims, Pending approvals, Reimbursable amount, Reimbursed MTD, Policy exceptions, Missing receipts.
New Claim wizard (5 steps): header (claimant, date, currency, purpose, department, default cost centre, notes)
→ lines (date, category, **CostCentrePicker**, project, amount, tax, merchant, description, receipt-required,
policy hint) → receipts (**upload**, match to line, missing reason, preview, validation) → policy check
(category limit, missing receipt, duplicate candidate, date window, inactive cost centre, approval route) →
review (save draft / submit / cancel).
Drawer tabs: Summary · Expense Lines · Receipts · Approvals · Reimbursement · Comments · Timeline · Audit.
Mark-Reimbursed dialog (full): payment method, reference, date, paid amount, source disbursement, notes.
Backend: `getExpenseClaimDetail`, `uploadExpenseReceipt`, `deleteExpenseReceipt`, `runExpensePolicyCheck`,
`markReimbursed`, `createReimbursementHandoff`. Side effects: approved+reimbursable → reimbursement handoff;
missing receipt → notify + optional ticket; reimbursed → app_event + audit + notify claimant.

## 15. Budgets
Tabs: Budget Lines · Variance · Actuals · Reports · Imports.
KPI cards: Total budget, Actual spend, Variance, Over-budget lines, Remaining budget, Reports ready.
Budget-vs-Actual chart: HorizontalBars (budget / actual / variance); click bar → budget-line drawer.
Budget-line table: line, cost centre, category, period, budget, actual, variance amount, variance %, status, actions.
Bulk Budget Entry wizard (6 steps): fiscal year+period → **CostCentrePicker** → **BudgetCategoryPicker** →
multi-line entry (category, period, amount, notes, owner) → review vs prior year → submit.
Copy-Last-Year dialog: source/target FY, cost-centre scope, category scope, adjustment %, rounding rule, review.
Drawer tabs: Summary · Actuals Composition · Variance Trend · Related Transactions · Approvals · Timeline · Audit.
Backend: `bulkUpsertBudgetLines`, `copyLastYearBudget`, `getBudgetLineActuals`, `getBudgetVarianceDrill`.
Wire the real `budget_variance` / `budget_summary` reports (kill the placeholder tab). Related-transaction
sources: AP bills, Payroll runs, Expense claims, Cost entries (GL deferred until GL ships).

## 16. Payroll (BUILD LAST — deepest)
Tabs: Runs · Run Lines · Inputs · Warnings · Payslips · Exports · Reports.
KPI cards: Total runs, In-progress, Locked, Net payroll, Warnings, Payslips generated.
New Run wizard (6 steps): period/frequency (pay group, month, frequency, pay date, cut-off, weeks) →
employee-population preview (included/excluded/new hires/terminations/missing bank/missing statutory) →
inputs preview (overtime/allowances/bonuses/deductions/leave/retro) → statutory-version preview
(PAYE/NIS/HS versions, component mappings) → pre-check warnings → review (create draft / create+lock inputs).
Drawer tabs: Summary · Run Lines · Inputs · Warnings · Payslips · Exports · Approvals · Timeline · Audit · Related.
Run Lines: **EmployeeCell**, gross, deductions, employer contributions, net, status, actions (view payslip /
employee profile / line audit). Inputs tab (NEW — `listInputs` exists, no UI): EmployeeCell, input type,
source, amount/hours, effective date, status, created by, actions (edit-before-lock / exclude / view source).
Warnings tab: severity, type, EmployeeCell, message, source, status, created at, resolved by, actions
(**resolve** / acknowledge / create ticket / open profile). Warning-resolve route
`/finance/payroll/warnings/resolve` → app_event `finance.payroll.warning.resolved` + audit + notify owner +
ticket closure. Payslips tab: open signed URL, download, **bulk download**, regenerate, notify employees.
Exports tab: **download** signed URL, regenerate, copy id, view audit. Payroll bridges (on locked/approved
run): Create disbursement from run · Create remittance from run (idempotent + full backbone).

## 17. Exact mutation backbone
Every mutation: assert permission → run the action → `emitFinanceMutationBackbone(...)` (§8.5) → success toast;
on error → error toast + `emitAppEvent({ type: '<event>.failed', severity:'warning', metadata:{ error } })` →
rethrow. Compensating rollback on satellite-insert failure (no swallowed errors). SoD via `assertDifferentApprover`.

## 18. E2E (extend the existing suites; agents do NOT run them)
Per page assert: authorized list passes · unauthorized rejected (correct code) · search/filter/pager · drawer
detail shape · create dialog mutation · approval enforces SoD · app_event written · **hr_audit_log** written ·
notification where required · ticket where required · handoff where required · CSV export returns a file.
Page-specific gates as listed in the spec §18 (rate version lifecycle + NIS import/delete; approved-run picker
returns locked runs + compute-from-run + lines + mark-filed; bank-accounts list renders + deactivate +
bank-file download; claim with cost-centre picker + receipt upload + policy check + reimburse + handoff; bulk
upsert + copy-last-year + variance + reports; run wizard + inputs + warning resolve + payslip bulk download +
run bridges + payslip-ready notifications).

## 19. Build order
- **Phase 0 (orchestrator, FIRST):** close the §0.2 gaps — FE attachment/bridge hooks, `financeEvents.ts`
  backbone helper, any per-entity attachment/bridge tables + perm keys; catalogue Phase-0 keys + grants
  migration. Extend `financeLookups` E2E.
- **Phase 1 Statutory → 2 Remittances → 3 Disbursements → 4 Expenses → 5 Budgets → 6 Payroll**, each: Aurora
  shell + KPI strip + real HrfinTable + drawer + full dialogs/wizards + real reports + charts + attachments +
  cross-module backbone + extend E2E + commit. (Pages are disjoint; may run in parallel once Phase 0 lands.)
- **Final:** orchestrator integrates reported perm keys → grants migration → `typecheck:frontend` +
  `build:backend` + full finance E2E + drift guard; operator migration notes; checkpoint commit.

## 20. Final acceptance checklist (a page is NOT done unless ALL true)
Uses `.hrfin` Aurora shell · no old `hr-offboarding`/`obx-*` classes · no free-text FKs · no raw employee
UUIDs · all FK fields use pickers · all employee fields use EmployeeCell · register has
search/filter/sort/pager/export · register has row action menu · register has empty/loading/error states ·
every row opens a detail drawer · drawer has the required tabs, populated · every top button opens a real
dialog/wizard · every dialog has the full field set + inline validation · every mutation raises a toast ·
emits app_event · writes hr_audit_log · every approval enforces SoD · required notifications created ·
required Message Center threads created · required tickets created · required handoffs created · reports are
real (not placeholder) · CSV export works · attachments use the shared signed-URL flow · cross-module bridge is
idempotent · E2E asserts the side effects.
