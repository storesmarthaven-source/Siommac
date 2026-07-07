# SIOMAC Finance — Wave 2B Feature Audit (for Codex)

Honest, per-control audit of the **6 existing Finance pages** to be deepened into the Aurora `.hrfin`
language. Same purpose + shape as `docs/FINANCE_FEATURE_AUDIT.md` (which covered AP/Overview): turn
every basic dialog / free-text FK / dead control / thin report into a real enterprise feature. Nothing
padded — if it's a placeholder, a raw UUID box, or shows raw employee IDs, it says so.

Feed this to Codex to produce the per-page enterprise build spec (like the AP one), then we build to it.

**Pages (all still old-design):**
`PayrollOverview.tsx`, `StatutoryConfigOverview.tsx`, `RemittancesOverview.tsx`,
`DisbursementsOverview.tsx`, `ExpensesOverview.tsx`, `BudgetsOverview.tsx`
(+ ESS `MyPayslipsOverview.tsx`, out of this wave's core scope).

**Backends (all real, keep):** `netlify/functions/lib/finance/{payroll,statutory,remittances,disbursements,expenses,budgets,bankAccounts}.ts`
· hooks `src/api/finance/*` · SoD via `assertDifferentApprover` · central workflow on approvals.

**State legend:** ✅ real · 🟡 basic (works but minimal) · 🧩 free-text FK (should be a picker) ·
🔢 raw ID shown (UUID where a name belongs) · 🚫 dead/placeholder (no handler / never renders data) ·
➖ missing (expected, absent).

---

## 0. Global findings — apply to ALL 6 pages (Codex: spec these once, uniformly)

1. **Design: none are Aurora.** Every page is the old `class="hr-offboarding fin-page"` + `PageHeader` +
   static `obx-repstats` + `obx-viewswitch` + `obx-table`. Target: the `.hrfin` system (HrfinPageHeader,
   KPI strip, QuickActionStrip, HrfinTable with tabs/search/filter/pager, RailCard rails, TrendArea/
   HorizontalBars/DonutRing, InsightBanner, HrfinPill, Drawer `panelClass="hrfin"`) — matching AP/Overview.
2. **Registers are flat.** No search, no status/facet filter, no pagination, no column sort, no row ⋮,
   no bulk actions, no CSV export on any of the 6 register tables. Target: real HrfinTable registers.
3. **No detail drawers.** Only Payroll has a master-detail (inline); the other 5 have **no way to open a
   record** to see its lines / timeline / audit / linked docs. Target: a detail Drawer per entity
   (summary + lines + approvals/timeline + audit + related records), like the AP bill drawer.
4. **Free-text UUID inputs for FK'd entities (the recurring sin).** Cost centre (Expenses, Budgets),
   payroll run (Remittances, Disbursements), employee (Disbursements bank accts) are all **typed UUIDs**.
   Target: **pickers** — cost-centre picker (HR Org `hr.cost_centers.*` is real), approved-run picker
   (`usePayrollRuns`), employee picker.
5. **Raw employee IDs on screen.** Payroll run-lines / warnings / payslips and Statutory NIS-verify show
   `employeeId` UUIDs. Target: resolve to employee name + number (join in the service, or an employee
   name-lookup endpoint).
6. **Thin / placeholder reports.** Report surfaces are raw table dumps with no filters/export; **Budgets
   "Reports" is a literal placeholder text block** (🚫). Target: real report picker + params + export,
   or fold into the analytics rail.
7. **No side rail, no charts, no KPI drill.** Static `obx-repstat` counts only. Target: KPI cards with
   sparkline + drill-through, an analytics card (trend/variance/mix), and a rail (deadlines/activity/insight).
8. **Backbone wiring (CLAUDE.md Feature-Completeness).** Confirm each mutation raises a **toast** (most
   do) AND emits app_events + audit_logs AND, where the rule requires, creates **notifications /
   messages / tickets / workflow tasks / handoffs into other modules** (see per-page cross-module targets).
   Several cross-module handoffs are implied but not surfaced (payslip-ready → ESS notify; expense
   approved → reimbursement handoff; disbursement → bank; remittance → authority filing).

---

## 1. Payroll (`PayrollOverview.tsx`)

Deepest page — full run lifecycle. Backend is rich; the UI under-uses it.

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static counts → KPI cards (runs, in-progress, locked, net) with trend + drill |
| Runs table | 🟡 | no search/filter/pager; row click → inline detail (OK) but no drawer. Add period/status filter, pager |
| **New pay run** form | 🟡 | month + frequency only. Target: preview of employees/inputs it will consume, statutory version shown, warnings pre-check, weeks-in-period |
| Lifecycle actions (lock-inputs→calculate→submit→lock→export→payslips→reopen) | ✅ | genuinely wired via `openActionModal` + workflow. Keep. Add: **inputs review/edit before lock** (currently no inputs surface at all — `listInputs` exists, unused ➖) |
| Run-lines tab | 🔢 | shows raw `employeeId`; no per-line drill, no search, no totals row. Resolve names; add drill to employee payslip |
| Warnings tab | 🟡➖ | read-only; **no resolve action** though `warning.resolved` exists. Add resolve/acknowledge with note; severity filter |
| Payslips tab | ✅ | list + open signed URL (good). Add bulk download, "regenerate", per-employee filter |
| Exports tab | 🟡 | list only; no download link for the export file (payslips have signed-url; exports don't ➖). Add download |
| Reports surface | 🟡 | report + run selects → raw table. Add date-range, export CSV/XLSX, employee filter |
| Inputs (`listInputs`) | ➖ | endpoint exists, **no UI**. Add an Inputs tab (what the run consumed: pay items, overtime, statutory) |
| Cross-module | ➖ | on lock/payslip-generate → **notify employees (ESS "payslip ready")**; on approval → workflow task (has it); handoff to Disbursement + Remittance is manual (user copies run) — add "Create disbursement/remittance from this run" action |

**Verdict:** lifecycle is real; the depth gaps are raw employee IDs, no inputs surface, non-actionable
warnings, no export downloads, and no cross-module "create disbursement/remittance from run" bridge.

---

## 2. Statutory Configuration (`StatutoryConfigOverview.tsx`)

Strongest of the six. Comprehensive rate-version form, NIS classes, pay components, NIS verify.

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static → KPI cards |
| Rate-versions table | 🟡 | no search/filter/pager; no **detail drawer** (can't see the full rate breakdown / linked runs / audit) |
| **New rate version** form | ✅ | comprehensive (PAYE bands, HS, NIS ceiling) with validation. Keep; move into Aurora wizard |
| Version lifecycle (submit/approve/reject/activate/retire) | ✅ | wired + workflow + SoD. Keep |
| NIS classes editor | ✅🟡 | upsert works (draft-only). **No delete/reorder**; no bulk import of a class table. Add remove + CSV import |
| Pay components | ✅ | create/retire wired. Add edit, search, kind filter |
| NIS verification | 🔢 | works (verify/reject) but shows raw employee IDs + dual camel/snake field guards (contract smell). Resolve names; fix DTO |
| **Approval History** | 🟡 | raw `listReports` dump (Object.keys columns). Target: real approval timeline (who/when/decision) per version |
| Version detail drawer | ➖ | none. Add: full rates, NIS class table, linked payroll runs, approval history, audit |

**Verdict:** functionally the most complete; needs Aurora + a version drawer + real approval-history +
name resolution + NIS class delete/import.

---

## 3. Remittances (`RemittancesOverview.tsx`)

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static → KPI cards (add outstanding-dues sparkline, overdue count) |
| Register table | 🟡 | no search/filter/pager; per-row lifecycle buttons OK. Add authority/status filter, pager, row → drawer |
| **Compute & Create** | 🧩 | **payroll run = free-text UUID box.** Target: **approved-run picker** (`usePayrollRuns` → locked/approved), authority select (has it), due date, then computed-totals preview (has it) → create + optional submit |
| Mark-paid dialog | ✅ | date + authority ref (decent). Keep, Aurora-ify |
| Mark-filed dialog | 🟡 | confirm-only; filed date + ref are backend-supported but **not collected** in the UI. Add filed date + receipt ref fields |
| Lifecycle (submit/approve/return/cancel) | ✅ | wired + SoD. Keep |
| Reports surface | 🟡 | raw table, no filters/export. Add period/authority filter + export |
| Detail drawer | ➖ | none; **can't view remittance lines** (`useRemittanceLines` exists, unused). Add drawer: totals, per-employee lines, timeline, filing docs |
| Cross-module | ➖ | on paid/filed → handoff/record to authority; on create → derived-from-run link back to Payroll |

**Verdict:** the free-text run UUID and the missing lines drawer are the headline gaps; mark-filed under-collects.

---

## 4. Disbursements (`DisbursementsOverview.tsx`)

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static → KPI cards |
| Register table | 🟡 | no search/filter/pager. Add; row → drawer |
| **Compute & Create** | 🧩 | **payroll run = free-text UUID box**; good missing-bank-account guard. Target: approved-run picker; keep the guard |
| Lifecycle (submit/approve/return/generate-file/mark-paid/cancel) | ✅ | wired + SoD |
| **Generate bank file** | 🟡➖ | mutation runs; UI shows only "File ready" text — **no download** of the EFT/CSV file (unlike payslips' signed-url). Add download |
| **Bank Accounts** surface | 🚫 | **the account list never renders** — it's a permanent `EmptyState`; no `bankAccounts/list` hook is used. Add/verify a list endpoint + render accounts. **`deactivateMut` is imported then `void`-reserved → dead** (no row deactivate). Wire it |
| Bank account form | 🧩 | employee = free-text ID; account number stored masked (good). Target: employee picker; validation |
| Reports surface | 🟡 | raw table, no filters/export |
| Detail drawer | ➖ | none; can't see the per-employee disbursement lines / bank file / status timeline |

**Verdict:** two real defects — the **Bank Accounts list never shows** (+ dead deactivate) and the
**bank file has no download**. Plus the free-text run UUID and no drawer.

---

## 5. Expenses (`ExpensesOverview.tsx`)

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static → KPI cards |
| Register table | 🟡 | no search/filter/pager. Add; row → drawer |
| **New Claim** form | 🟡🧩➖ | multi-line allocation editor (good!) BUT **cost centre = free-text UUID** per line, and **no receipt/attachment upload** (page promises "receipts"; none exists). Target: **cost-centre picker** per line, **attachment upload** (reuse HR-Documents pattern), per-category policy hints, currency |
| Lifecycle (submit/approve/reject/reimburse/cancel) | ✅ | wired + SoD; reject requires reason (good) |
| Mark-reimbursed | 🟡 | confirm-only. Target: capture payment method + reference + date (like AP record-payment) and hand off to Disbursement/GL |
| Reports surface | 🟡 | raw table, no filters/export |
| Detail drawer | ➖ | none; can't view a claim's allocation lines, attachments, approval history, audit |
| Cross-module | ➖ | approved+reimbursable → **reimbursement handoff** (to a disbursement/pay run) is described but not wired |

**Verdict:** the claim wizard is the closest to "real" but has a free-text cost centre, **no attachments**,
and a confirm-only reimburse; no drawer.

---

## 6. Budgets (`BudgetsOverview.tsx`)

| Control | State | Notes / enterprise target |
|---|---|---|
| Stat row (4) | 🟡 | static → KPI cards (budgeted/actual/variance with a bar) |
| Year filter | ✅ | works |
| Budget-lines table | 🟡 | no search/filter/pager; Edit/Del inline (OK) |
| **Set/Update budget** form | 🧩 | **cost centre = free-text UUID** ("Paste the UUID from HR"); **category = free-text** (should be a known list/picker); single line at a time. Target: cost-centre picker, category picker, **multi-line bulk budget entry** per cost centre, copy-last-year |
| Delete | 🟡 | plain `dialog.confirm`. Fine; move to ActionModal for consistency |
| Variance surface | 🟡➖ | table only — **no chart**, no drill from a variance row to the underlying cost entries. Add budget-vs-actual bars + drill |
| **Reports surface** | 🚫 | **placeholder text block** ("Reports are generated via the API… Available reports: budget_variance, budget_summary") — completely dead. Wire the real reports |
| Detail drawer | ➖ | none; can't open a budget line to see its actuals composition |

**Verdict:** free-text cost centre + category, a **dead Reports tab**, and a chart-less variance view are
the gaps; the upsert should become a multi-line budget entry.

---

## 7. Backend gaps behind the UI (so Codex specs the right endpoints)

- **Cost-centre / employee / run pickers:** the pages need list endpoints wired for pickers — cost
  centres exist (`hr.cost_centers.*` via HR Org), `usePayrollRuns` exists; **employee name-lookup** for
  resolving IDs and an **employee picker** source must be confirmed/added.
- **Employee-name resolution:** payroll run-lines/warnings/payslips and NIS-verify should return employee
  **name + number**, not just `employeeId` (join in the service or add a batch name-lookup).
- **Disbursements — bank accounts list:** confirm/add `bankAccounts/list` (+ deactivate wiring); the UI
  currently never lists accounts.
- **Disbursements — bank file download:** add a signed-URL/download for the generated EFT file (mirror
  `payslips/signed-url`).
- **Payroll — inputs surface + warning resolve:** `listInputs` exists (no UI); add a warning-resolve
  mutation (the `resolved` flag has no writer surfaced).
- **Payroll — export download:** exports list has no file download link.
- **Budgets — reports:** `budget_variance` / `budget_summary` exist but are not wired (placeholder tab).
- **Expenses — attachments:** no receipt/attachment table/endpoints surfaced; add (reuse HR-Documents
  storage pattern). Mark-reimbursed should accept method/reference/date.
- **Cross-module handoffs:** payslip-ready → ESS notification; expense approved+reimbursable →
  reimbursement handoff; "create disbursement/remittance from a run" bridges.
- **Export (CSV/XLSX):** every register + report should export (none do today).

---

## 8. Prioritised punch-list (Codex → build order)

1. **Kill the free-text FKs** — cost-centre picker (Expenses, Budgets), approved-run picker (Remittances,
   Disbursements), employee picker (Disbursements bank, NIS). *(the recurring sin — highest impact)*
2. **Fix the dead controls** — Budgets **Reports** (wire real reports), Disbursements **Bank Accounts list**
   + **deactivate** + **bank-file download**.
3. **Add detail drawers** — Remittance (lines), Expense (lines + attachments), Disbursement (lines + file),
   Statutory version (rates + NIS + history), Budget line (actuals) — all with timeline + audit.
4. **Expenses attachments** + real **mark-reimbursed** (method/ref/date + reimbursement handoff).
5. **Resolve employee IDs → names** across Payroll + NIS.
6. **Registers → real HrfinTable** (search + status/facet filter + pager + row ⋮ + CSV export) on all 6.
7. **Payroll depth** — Inputs tab, warning resolve, export/payslip downloads, "create disbursement/
   remittance from run".
8. **Budgets** — multi-line budget entry + variance chart + drill to cost entries.
9. **Aurora shell everywhere** — HrfinPageHeader + KPI strip (drill) + analytics card + rail
   (deadlines/activity/insight) per page.
10. **Cross-module backbone** — notifications (payslip-ready), handoffs (reimbursement, run→disbursement/
    remittance), and confirm app_events/audit_logs on every mutation.

---

> Build rule (same as AP): every dialog gets its **full** field set + inline validation + **pickers not
> free-text**; every wizard multi-step with the domain's real editors + attachments; every register real
> filter/pager/export; every mutation ties into toast + events + audit + workflow + the **other modules**
> it touches. No placeholder tabs, no raw UUIDs, no dead buttons. Reconcile against
> `docs/FINANCE_WAVE2_BUILD_SPEC.md` conventions (Aurora `.hrfin`, SoD, compensating rollback).
