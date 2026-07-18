# SIOMAC Finance — Feature Functionality Audit (for Codex)

> **Historical only.** Accounts Payable and the combined Finance Overview were retired on 2026-07-18. Do not implement this audit. Current authority: `docs/module-contracts/FINANCE_PRODUCT_SCOPE.md`.

Honest, per-control audit of the two built Aurora pages (Finance Overview + Accounts Payable). Goal:
turn every stub / navigate-only / basic dialog into a real enterprise feature. Nothing here is padded —
if it only navigates or only toasts, it says so.

**State legend:** ✅ real action · 🔀 navigate-only (switches section/tab; fine as a *link*, wrong if the
label implies an action) · 🟡 basic (works but minimal) · ❌ dead (no handler / toast-only / points nowhere).

Files: `src/components/sections/Finance/FinanceOverview.tsx`, `PayablesOverview.tsx`,
service `netlify/functions/lib/finance/{overview,accountsPayable}.ts`, hooks `src/api/finance/*`.

---

## 1. Finance Overview

| Control | Current | State | Enterprise target |
|---|---|---|---|
| Quick: **Review approvals** | → nav to Payables | 🔀 | OK as deep-link; ideally opens an **approvals inbox** (all modules) with inline approve |
| Quick: **Run payroll** | → nav to Payroll | 🔀 | OK |
| Quick: **Record payment** | → nav to Payables | 🔀 *(mislabel)* | Should open a **record-payment dialog** (pick bill/vendor → amount/method/ref), not just navigate |
| Quick: **New vendor** | → nav to Payables | 🔀 *(mislabel + dead end)* | Should open the **vendor create form** (which doesn't exist yet anywhere) |
| Quick: **Export** | `toast('Export queued')` | ❌ dead | Real export (CSV/XLSX) of the dashboard data, audited (`*.export` event) |
| Alert banner: **View details / Review now** | both → Payables | 🔀 | Distinct targets; "View details" → a drill/report |
| **KPI cards** (Spend/Approvals/Variance/Cash) | static | 🟡 no drill | Click → filtered register (spec §6.3 drill-through); real 6-mo sparkline series for all four (only Spend has one) |
| **Spend-vs-budget** chart | static SVG | 🟡 | Hover tooltips, period toggle (MTD/Monthly), real forecast segment |
| **Cost centres** list | real data | ✅ | link → report |
| Approvals table: **row click** | → nav to module | 🔀 | Open the record drawer/inline |
| Approvals table: **"Approve"/"Send"** button | → nav to module | ❌ *(mislabel — does NOT approve)* | **Approve/reject in place** via each module's approve mutation (needs a cross-module approve action) |
| Approvals table: **"Open"** | → nav to module | 🔀 | OK |
| Approvals table | single tab, static rows, no search/filter/pager | 🟡 | Real queue: paginate, filter by type/age/amount |
| Today's focus / deadlines / donut / activity links | → nav | 🔀 | OK as links; deadlines/activity rows should be clickable to the record |

**Verdict:** Export is dead; the table "Approve" button is the worst offender (says Approve, only navigates);
"Record payment" + "New vendor" quick actions mislead; KPIs don't drill; chart is static.

---

## 2. Accounts Payable

| Control | Current | State | Enterprise target |
|---|---|---|---|
| Quick: **New bill** | opens wizard | ✅ (but wizard is basic — see below) | — |
| Quick: **Approve** | `setTab('bills')` | ❌ *(does nothing meaningful)* | Open a **bulk-approve queue** of submitted bills (select → approve, SoD-guarded) |
| Quick: **Record payment** | `openPay(open[0])` | 🟡 *(arbitrary first bill)* | Let the user **pick the bill/vendor**; ideally a **payment run builder** |
| Quick: **New vendor** | `setTab('vendors')` | ❌ *(no form exists)* | Open a **vendor create/edit form** — `createVendor` + `useCreateVendor` already exist, **no UI wired** |
| Quick: **Export** | `exportBills` (CSV) | ✅ | keep; add XLSX + audit event |
| Tabs Bills/Vendors/Payments | switch data | ✅ | add an **Aging** tab (mockup has 4) |
| **Search** | server filter | ✅ | — |
| Toolbar **"Status"** button | no `onClick` | ❌ dead | Real status facet filter |
| Toolbar **"Filters"** button | no `onClick` | ❌ dead | Advanced filter panel (vendor, date, amount, GL) |
| Row **⋮ (more)** menu | `stopPropagation`, no menu | ❌ dead | Row action menu (view / approve / pay / void / duplicate) |
| Bills row click | opens drawer | ✅ | — |
| Vendors / Payments rows | not clickable | 🟡 | Vendor detail (statement, bills, aging); payment detail |
| **Pager** | server pagination | ✅ | — |
| **Bill drawer** fields / lines / payments | real data | ✅ | — |
| Drawer: **Submit / Approve / Reject / Record payment / Void** | real mutations (Approve/Reject/Void via enterprise **ActionModal** w/ SoD) | ✅ | keep — this part is genuinely wired |
| Drawer missing | — | 🟡 | **timeline/audit trail, approval history, attachments (bill scan), comments, edit-draft, vendor link, per-line GL/cost-centre/tax** |
| **New-bill wizard** (3 steps) | vendor+dates → ONE line (GL = free text) → review | 🟡 **basic (user's complaint)** | **Multi-line editor** (add/remove, qty×price), **GL account picker**, cost centre, tax/VAT, currency, terms auto-fill from vendor, **attachment upload**, **duplicate detection**, inline validation, submit-for-approval on create |
| **Record-payment modal** (1 step) | amount only; **method hardcoded `eft`** | 🟡 basic | **method select** (eft/cheque/cash/card — backend already supports), **reference**, **payment date**, remaining-balance preview, over-payment guard message |
| Rail: **"Review & run payment"** | `openPay(open[0])` | 🟡/❌ | Not a payment run — build a real **payment-run** (select approved bills → batch → EFT/ACH file → mark paid) |
| Rail: vendors/deadlines/activity | display + nav links | 🔀 | rows clickable to the record; "View all" → real sub-view |
| Duplicate-bill-risk banner | **omitted** (no detection) | ❌ missing | Real duplicate detection (same vendor + invoice_no/amount) → banner |
| **Import** action | **dropped** (mockup had it) | ❌ missing | Bill import wizard (reuse Employee-Import pattern) |

**Verdict:** the **drawer lifecycle actions are real** (approve/reject/void via ActionModal + SoD — the good
part). Everything else flagged ❌/🟡: New-vendor has no form, Approve quick action is a no-op, toolbar
Status/Filters + row ⋮ are dead, and both **New-bill** and **Record-payment** dialogs are minimal.

---

## 3. Backend gaps behind the UI (so Codex builds the right endpoints)
- `finance_ap` service: `createVendor` exists, **no update/get vendor detail**; **no bill EDIT** (can't amend a
  draft); **no attachments** table; **no payment-run/batch** entity; **no duplicate detection**; `recordPayment`
  accepts `method`/`reference` but the **UI only sends `amount`**.
- Overview: no **cross-module approve** endpoint (the approvals queue can only navigate, not approve in place).
- KPI drill-through: list endpoints exist (`/ap/bills/list` with `status`/`search`), but Overview KPIs don't
  pass filters through to a register.
- Aging drill: `/ap/aging` returns buckets only — no "bills in this bucket" list link.

---

## 4. Prioritised punch-list to reach enterprise-grade (today)
1. **New-bill wizard → real**: multi-line editor, GL picker, cost centre, tax, attachment, duplicate check, terms auto-fill. *(biggest complaint)*
2. **Vendor create/edit form** (wire the existing `useCreateVendor`; add update). Kills the dead "New vendor".
3. **Record-payment dialog → real**: method + reference + date + balance preview (backend already supports).
4. **Kill dead controls**: Overview **Export** (make real), AP toolbar **Status/Filters** (real facets), AP **Approve** quick action (bulk-approve queue), row **⋮ menu**.
5. **Fix mislabels**: Overview table "Approve" must approve in place (or relabel "Open"); "Record payment"/"New vendor" quick actions open dialogs, not navigate.
6. **Drawer depth**: timeline/audit, approval history, attachments, comments, edit-draft.
7. **Payment run**: real batch (select bills → EFT file → mark paid) behind "Review & run payment".
8. **KPI + aging drill-through** to filtered registers.
9. Restore **Import** + **duplicate-bill banner**.

> Note: the same audit lens applies to every remaining page (AR/GL/Assets/HR) and the 6 Wave-2 pages — build
> real multi-field dialogs + real row/bulk actions from the start, not navigate-only stubs.
