# SIOMAC — HR & Finance Implementation Spec (v3, build-ready)

> **Finance scope superseded.** Accounts Payable, Budgeting, and full-accounting surfaces are out of scope as of 2026-07-18. Retain this file for historical UI context only; follow `docs/module-contracts/FINANCE_PRODUCT_SCOPE.md`.

**Supersedes v2.** This is the authoritative page-by-page build document. It adopts the approved 5-page
visual blueprint (Finance Overview, Accounts Payable, Accounts Receivable, General Ledger, Fixed Assets —
see the mockup images) as the UI source of truth, and grounds it in how this codebase actually works so
build agents can implement without guessing.

## 0. Locked decisions
- **Theme:** **Aurora** (light, indigo) is the canonical `.hrfin` token set (the base shown in every mockup).
  The other 7 themes (Obsidian, Meridian, Slate, Graphite, Canvas, Pulse, Folio) remain swappable by
  overriding the same CSS variables — no layout change.
- **Scope:** new/rebuilt HR + Finance pages only. Finance = **Overview, AP, AR, GL, Fixed Assets** (deepen
  the 6 existing Finance pages later). HR = **Contracts** + **Disciplinary & Grievance** (+ config). Do NOT
  touch the Onboarding Overview / Wizard.
- **No band-aids** (CLAUDE.md): every mutation writes the business record → `emitAppEvent` → `writeHrAudit`
  → workflow (if required) → notifications; real empty/loading/error states, never mock fallbacks.

---

## 1. Grounding — how this codebase works (read before "routes")
- **Navigation is section-event, not a URL router.** The blueprint's `/finance/...` paths map to **section
  ids** dispatched via `window` event `siomac:section`; `FinanceSection.tsx` / `HRSection.tsx` swap the page.

  | Blueprint route | Section id | API base | Perm root |
  |---|---|---|---|
  | /finance/overview | `s-finance-overview` | `finance/overview/*` | `finance.overview` |
  | /finance/accounts-payable | `s-finance-payables` | `finance/ap/*` | `finance.ap` |
  | /finance/accounts-receivable | `s-finance-receivables` | `finance/ar/*` | `finance.ar` |
  | /finance/general-ledger | `s-finance-gl` | `finance/gl/*` | `finance.gl` |
  | /finance/fixed-assets | `s-finance-assets` | `finance/assets/*` | `finance.assets` |
  | /hr/contracts | `s-hr-contracts` | `hr/contracts/*` | `hr.contracts` |
  | /hr/disciplinary | `s-hr-disciplinary` | `hr/disciplinary/*` | `hr.disciplinary` |

- **Backend = thin route → service.** `routes/<file>.ts` validates (`zv`/`z`), gates (`requirePermission`),
  reads `body.args`, delegates to `lib/<area>/<module>.ts`; the service emits `emitAppEvent` + `writeHrAudit`
  (from `lib/hr/employeeCore`), runs `startWorkflowForRecord` for approvals, enforces SoD via
  `assertDifferentApprover`, and does compensating rollback on satellite-insert failure. Mirror
  `routes/financeExpenses.ts` + `lib/finance/expenses.ts`. Money is `numeric(15,2)`, currency default `'TTD'`.
- **FE reads** via TanStack Query + `apiPost('<area>/<path>', args)` (envelope auto-wraps `{ args }`).
- The prototype `design-preview/index.html` is the interactive reference for the *shell + rail + calendar +
  task-planner* interactions; the 5 mockup images are the reference for *density, analytics richness, and the
  domain rail cards*. The real build uses `@ui` primitives under the scoped `.hrfin` class.

---

## 2. Design tokens — canonical `.hrfin` (Aurora base)
```css
.hrfin{
  --cv:#f6f7fb; --sf:#ffffff; --hd:#081225; --bd:#e3e7ef; --rw:#edf0f5;
  --tx:#071126; --mt:#667085; --sub:#98a2b3;
  --ac:#4f46e5; --ac2:#6366f1; --acs:#eef0ff; --aco:#ffffff;
  --ok-bg:#dcfae6; --ok-tx:#067647; --bad-bg:#fee4e2; --bad-tx:#b42318;
  --wn-bg:#fef0c7; --wn-tx:#93370d; --nu-bg:#e0f2fe; --nu-tx:#026aa2; --dr-bg:#ede9fe; --dr-tx:#5925dc;
  --nf:'Inter',system-ui,sans-serif; --hf:'Inter',system-ui,sans-serif;
  --radius-card:14px; --radius-control:9px; --gap:16px; --shadow-soft:0 1px 2px rgba(16,24,40,.04);
}
```
Theme swap = override these vars on `.hrfin` (Obsidian etc. from the prototype's theme table). Subtle
gradient on the primary button + `--shadow-soft` are intentional in this language (scoped to `.hrfin`, so no
bleed into HSE/existing pages). Status tones use the `bg/tx` pairs; never a local colour switch.

---

## 3. App shell + layout system (all pages share it)
```
Topbar (dark) → [ Sidebar 220px | Page canvas (padding 24/28) ]
Page canvas = PageHeader → QuickActionStrip → KpiGrid(4) → MainPageGrid
MainPageGrid = [ PrimaryContent (AnalyticsBand → InsightBanner? → RegisterTable) | RightRail(cards) ]
```
```css
.hrfin-shell{min-height:100vh;background:var(--cv);color:var(--tx)}
.hrfin-topbar{height:48px;background:#081225;color:#f8fafc}
.hrfin-body{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:calc(100vh - 48px)}
.hrfin-sidebar{background:#fff;border-right:1px solid var(--bd)}
.hrfin-main{padding:24px 28px 40px;background:var(--cv)}
.hrfin-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
```
Per-page main grids (from the mockups): Overview `1.55fr 300px 330px`; AP `1fr 330px` (analytics inner
`1.65fr 360px`); AR `1fr 360px` (analytics `1.55fr 360px`, insight row `1fr 1fr 1fr`); GL `1fr ~340px`;
Assets `1fr ~330px` (analytics `~1.6fr 1fr`). The GL mockup shows a product-style top bar with search — for
consistency **use the same HR/Finance shell**; content below the shell is unchanged.

---

## 4. Component library (build once in `src/ui` under `.hrfin`, reuse everywhere)
`HrfinShell · TopBar · FinanceSidebar · PageHeader · QuickActionStrip/QuickActionButton · KpiCard ·
Sparkline · MiniBarChart · ProgressMeter · ChartCard · TrendAreaChart · ComboBarLineChart ·
HorizontalBarMetricList · DonutProgress · InsightBanner · RightRailCard · ActivityList · DeadlineList ·
TaskPlanner (week-strip + checkable tasks) · RegisterTabs · RegisterToolbar · RegisterTable · StatusPill ·
InlineActionButton · Pagination · DetailDrawer · Wizard · ActionModal`.

Key prop shapes (TS):
```ts
PageHeader { icon; title; subtitle; chips?: {label; tone?:'neutral'|'success'|'warning'|'danger'; icon?}[] }
QuickAction { label; icon; variant?:'primary'|'secondary'; badge?:number|string; onClick }
KpiCard { label; value; delta?; deltaTone?:'positive'|'negative'|'neutral'; support?; footer?; badge?;
          visual?:'sparkline'|'miniBars'|'progress'|'none'; data?:number[] }
ChartCard { title; subtitle?; actions?; children; footer? }
RegisterColumn<T> { key; label; align?:'left'|'right'|'center'; width?; render?(row):Node }
RegisterTable<T> { tabs; activeTab; searchPlaceholder; columns; rows; total; page; pageSize }
StatusPill { label; tone:'ok'|'bad'|'wn'|'nu'|'dr' }
```
Charts are **SVG** (not canvas), token-coloured, with `<title>/<desc>` + loading/empty states.

---

## 5. Canonical shared CSS (cards / buttons / kpi / table / pills)
```css
.hrfin-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--radius-card);box-shadow:var(--shadow-soft)}
.hrfin-card-pad{padding:16px}
.hrfin-btn{height:38px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;border-radius:var(--radius-control);border:1px solid var(--bd);background:#fff;color:var(--tx);font-size:13px;font-weight:600}
.hrfin-btn-primary{background:linear-gradient(180deg,var(--ac2),var(--ac));border-color:var(--ac);color:var(--aco)}
.hrfin-kpi{min-height:116px;padding:16px}
.hrfin-kpi-value{margin-top:8px;font-size:28px;line-height:1;letter-spacing:-.03em;font-weight:750;font-family:var(--nf)}
.hrfin-table{width:100%;border-collapse:collapse;font-size:13px}
.hrfin-table th{height:38px;text-align:left;color:var(--mt);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--rw)}
.hrfin-table td{height:46px;border-bottom:1px solid var(--rw);color:var(--tx)}
.hrfin-pill{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:700}
.hrfin-pill-ok{background:var(--ok-bg);color:var(--ok-tx)} .hrfin-pill-bad{background:var(--bad-bg);color:var(--bad-tx)}
.hrfin-pill-wn{background:var(--wn-bg);color:var(--wn-tx)} .hrfin-pill-nu{background:var(--nu-bg);color:var(--nu-tx)} .hrfin-pill-dr{background:var(--dr-bg);color:var(--dr-tx)}
```

---

## 6. Cross-cutting standards (apply to every page)
### 6.1 RBAC (keys are source of truth; role tiers map at integration)
Tiers: **Emp** · **F.Staff** · **F.Mgr** · **HR.Staff** · **HR.Mgr** · **Admin/Super**. Pattern
`<area>.<x>.view/manage/approve` (GL: `.post`; Disciplinary adds `.hear`, `.evidence.view`). View→staff+,
create/edit→staff+, approve/post/void/dispose→manager+, **SoD: creator ≠ approver** (`assertDifferentApprover`).
Disciplinary view is **restricted** (participants + HR.Mgr + Admin; evidence behind `hr.disciplinary.evidence.view`).
New keys → `permissions.ts` + role blocks + `permissionMeta.ts` (drift-guard enforced).

### 6.2 State machines (server-enforced; illegal transition → 422)
- **AP bill:** draft →(submit; fields ok + line-sum==total)→ pending_approval →(approve; approver≠creator)→
  approved →(record_payment; 0<amt≤balance)→ partially_paid|paid; reject(reason); void(Admin/F.Mgr, reason).
- **AR invoice:** draft → sent → partially_paid|paid; overdue(sweep); void(reason). Receipts allocate across invoices.
- **GL journal:** draft →(post; **debits==credits, ≥2 lines**, period open)→ posted(immutable)→ reversed(reversing entry). Period lock blocks posting unless Admin reopens.
- **Fixed asset:** active →(run depreciation; **idempotent per period**)→ fully_depreciated; active/fully →
  disposal_requested → approved → disposed (NBV→0/adjusted, gain/loss). transfer custodian/location.
- **Contract:** draft → pending_signature → active → {expired(sweep)|terminated(reason)|superseded(renew via parent)|cancelled}. activate guard = all required signatories signed.
- **Disciplinary case:** open → investigation → hearing_scheduled → outcome_recorded → appeal_window → closed. **Grievance:** raised → acknowledged → investigation → hearing → resolved → (appeal) → closed.

### 6.3 KPI formulas (a number means the same thing everywhere)
Total payable/receivable = Σ unpaid balance of {approved/sent, partially_paid}. Overdue = same where
`due<today`. Due this week = unpaid, due∈[today,+7d]. On-time% = paid-on/before-due ÷ paid-in-period (90d).
DSO = (Σ AR balance ÷ credit sales in period) × days. Budget variance = actual−budget (favourable when
negative spend variance). NBV = cost−accumulated_depreciation. Depreciation charge (straight-line) =
(cost−salvage)/useful_life_months. Avg resolution = mean(closed−opened). Every KPI drills to its filtered register.

### 6.4 States & responsive & import/export & settings
- Every surface defines **empty / loading (skeleton, gate `isLoading&&!data`) / error (retry, no raw exception)
  / permission-denied / partial**. Never `?? 0`.
- Responsive: ≥1200 rail beside content; 900–1199 rail below; <900 single col, quick-actions→overflow menu,
  table horizontal scroll w/ pinned first col, KPI 2×2.
- Import/export: export = current filtered view, audited egress (`*.export` event). Import (AP bills, GL
  accounts, vendors/customers, assets): reuse the **Employee-Import wizard** (upload→map→validate row-level→
  dedupe by ref→failed-row review→commit).
- Config → **Settings catalog** where possible (fiscal periods/lock, numbering, approval thresholds, payment
  terms, GL mapping, tax codes, depreciation methods, contract templates+clause library, disciplinary
  categories/retention); dedicated editor only for rich grids (clause library, GL mapping).

### 6.5 Drawer affordances (every detail drawer)
header(title·status·actions) · field grid · tabs (Overview / Line items / Timeline / Documents / Comments /
Approvals) · **audit trail** · **approval history** · **attachments (upload+viewer)** · **related records** ·
lifecycle buttons **permission- & state-locked** (hidden or disabled-with-reason).

### 6.6 Acceptance checklist (definition of done, per page)
☐ section id renders ☐ `.hrfin` language ☐ KPIs = real data w/ §6.3 formulas ☐ 5 states (§6.4) ☐ table
search/filter/sort/paginate/export ☐ drawer w/ affordances (§6.5) ☐ wizard creates a real record ☐ every
action enforces permission+SoD+state guard ☐ audit row ☐ app_event ☐ workflow/notifications where required
☐ responsive ☐ keyboard+SR ☐ **E2E suite green** (endpoints, lifecycle, access, SoD, side-effects).

---

## 7. Page blueprints
> Exact layouts, rail cards, KPI+chart mapping, columns, and copy are in the 5 approved mockups + the pasted
> blueprint. Below is the build-ready distillation + the two HR pages (same system). Seed data = the mockup
> values. Every KPI card lists its **visual**; every chart lists its **type**.

### 7.1 Finance Overview — `s-finance-overview` · grid `1.55fr 300px 330px`
Header chips: `9 approvals waiting`, `6 overdue`(warn). **Alert banner** (overdue+approvals → View details / Review now).
Quick actions: **Review approvals·[9]**(primary) · Run payroll · Record payment · New vendor · Export · More.
KPIs: Spend MTD(sparkline) · Pending approvals(sparkline) · Budget variance(status) · Cash out/runway(miniBars).
Main col: **Spend-vs-budget** (TrendArea, spend solid + budget dotted, forecast footer) → **Approvals needing
action** table (Type·Ref·Vendor/Customer·Amount·Requested by·Age·Approve/Reject|Send/Decline).
Middle col: **Top cost centres by burn** (HorizontalBarMetricList) + **Today's focus** card.
Right rail: **Upcoming deadlines** (DeadlineList) + **Period close progress** (DonutProgress 72%, legend
Completed/In-progress/Not-started + checklist link) + **Recent activity**.
Data: `['finance','overview']` (aggregate over AP/AR/expenses/budgets/disbursements/payroll). Read-only.

### 7.2 Accounts Payable — `s-finance-payables` · grid `1fr 330px`, analytics `1.65fr 360px`
Chips: 9 approvals waiting · 2 overdue(warn). Quick actions: **New bill**(primary) · Approve·[6] · Record
payment · New vendor · Import · Export · More.
KPIs: Total payable(sparkline,Δ) · Overdue(red sparkline) · Due this week(miniBars) · On-time rate(progress).
Analytics: **Payables vs payments** (TrendArea, MTD/By-week toggle, net footer) + **Aging by bucket**
(HorizontalAgingBars; Current/1-30 indigo, 31-60 amber, 60+ red).
**Duplicate-bill-risk InsightBanner** between analytics and table (dismissible).
Register tabs Bills/Vendors/Payments/Aging; cols ☐·Bill·Vendor·Due·Amount·Approver·Status·⋯. Pills ok/bad/wn/nu.
Right rail: **Payment run this week** (value + run date + method + Review&Run) · **Vendors needing attention**
(exceptions) · **Upcoming deadlines** · **Recent activity**.
Data: `['finance','ap','bills'|'aging'|'vendors'|'payments'|'kpis']`. Mutations: createBill, submitBill,
approveBill(SoD), rejectBill, recordPayment, voidBill. Wizard: Vendor→Header→Lines(GL picker)→Attachments→Review.

### 7.3 Accounts Receivable — `s-finance-receivables` · grid `1fr 360px`, analytics `1.55fr 360px`, insight `1fr 1fr 1fr`
Chips: 96 open · 11 overdue(warn) · 52 customers. Quick actions: **New invoice**(primary) · Send·[5] · Record
receipt · New customer · Export · More.
KPIs: Total receivable(sparkline) · Overdue(sparkline) · DSO(miniBars) · Collected MTD(progress vs target).
Analytics: **Invoiced vs collected** (TrendArea) + **Aging summary** (HorizontalAgingBars, incl. 61-90 & 90+ red, Total row).
Insight row (3): **Top overdue customers** (red bars) · **Credit hold review** (list+reasons) · **Receipts to allocate** (unapplied).
Register tabs Invoices/Customers/Receipts/Aging; cols Invoice·Customer·Due·Amount·Balance·Days overdue·Status·⋯.
Right rail: **Collections follow-up queue** (Customer·Amount·Due·Status·Priority) · **Upcoming deadlines** · **Recent activity**.
Data: `['finance','ar','invoices'|'aging'|'customers'|'receipts']`. Mutations: createInvoice, sendInvoice,
recordReceipt, allocateReceipt, placeCreditHold, releaseCreditHold, voidInvoice.

### 7.4 General Ledger — `s-finance-gl` · grid `1fr ~340px`
Chips: 214 active accounts · 5 unposted(warn) · Period: June 2026. Quick actions: **New journal**(primary) ·
Post·[3] · New account · Export TB.
KPIs: Active accounts(sparkline) · Unposted journals(status) · Period(status) · Trial balance = Balanced(status ✓).
Main: **P&L trend Revenue vs expense** (ComboBarLineChart: revenue bars + expense bars + net line; MTD summary
panel revenue/expense/net w/ YoY) → **unbalanced-journal InsightBanner** (JE-0328 out of balance) → Journals
register (tabs Journals/Chart of accounts/Trial balance; cols Journal·Memo·Date·Debit·Credit·Status·Approver·⋯).
Right rail: **Period close readiness** (DonutProgress 72%, legend, tasks remaining, checklist) · **Unposted
journals needing review** (JE·reason·amount) · **Upcoming deadlines** · **Recent activity**.
Chart of accounts tab = tree by type/parent. Wizard = balanced-lines editor (live Dr/Cr totals, blocks until balanced).
Data: `['finance','gl','journals'|'trial-balance'|'accounts']`. Mutations: createJournal, submitJournal,
postJournal, reverseJournal, createAccount, lockPeriod, reopenPeriod. GL exposes `finance/gl/accounts/list`
(AP/AR/Assets reference `gl_account_code` text — no hard FK).

### 7.5 Fixed Assets — `s-finance-assets` · grid `1fr ~330px`, analytics `~1.6fr 1fr`
Chips: 182 assets · $42,000 disposals YTD · 3 disposals pending(warn). Quick actions: **New asset**(primary) ·
Run depreciation · Dispose·[2] · Export.
KPIs: Total cost(sparkline) · Net book value(progress 67%) · Depreciation this period(miniBars) · Disposals YTD(miniBars).
Analytics: **NBV vs depreciation forecast** (TrendArea, actual solid → dotted forecast + green forecast line;
footer strip NBV now / forecast NBV / total forecast deprec.) + **Asset category mix by NBV**
(HorizontalBarMetricList — chosen over donut so labels+amounts read).
Register tabs Register/Depreciation/Disposals; cols Asset·Name·Category·Cost·NBV·Custodian·Status·Last depr.·⋯.
Right rail: **Depreciation run planner** (run date + assets in run + amount + Run button + history) · **Upcoming
asset operations** (physical count / insurance / warranty) · **Disposals pipeline** (pending approval / in
valuation) · **Recent activity**.
Data: `['finance','assets','register'|'depreciation'|'disposals'|'kpis']`. Mutations: createAsset,
runDepreciation, requestDisposal, approveDisposal, completeDisposal, transferAsset, updateCustodian.

### 7.6 HR Contracts — `s-hr-contracts` (same system; migration already committed)
Chips: 214 active · 7 pending signature(warn) · 5 expiring ≤90d. Quick actions: **New contract**(primary) ·
Issue·[3] · New template · Export. KPIs: Active · Pending signature · Expiring ≤90d · On probation(progress).
Analytics: **Expiries by month** (bar) + **Contract type mix** (donut). Register tabs Contracts/Templates;
cols Contract·Employee(avatar)·Type·Term·Renewal·Status. Right rail: **Expiring soon** · **Pending signatures**
· **Upcoming deadlines** (probation reviews) · **Recent activity**. Drawer: rendered body + **signatory tracker**
+ renewal chain. Wizard: Template→Employee→Terms→Clauses→Review. Mutations: issue, activate(SoD), renew,
terminate. Features: clause library, template versioning, renewal reminders, comparison view, e-sign status.

### 7.7 HR Disciplinary & Grievance — `s-hr-disciplinary` (restricted, §6.1)
Chips: 8 open · 2 hearings this week(warn) · Restricted access. Quick actions: **New case**(primary) · Schedule
hearing · Record outcome·[2] · Export. KPIs: Open cases · Hearings this week · Active sanctions · Avg resolution(progress).
Analytics: **Cases by category/status** (bar) + **Case trend** (area). Register tabs Disciplinary/Grievances;
cols Case·Employee(masked)·Category·Stage·Next hearing·Status. Right rail: **Upcoming hearings** · **Overdue
cases** · **Recent activity**. Drawer: timeline · parties · hearings · sanctions · appeals · **confidential
evidence**(gated) · comments. Mutations: scheduleHearing, recordOutcome/applySanction, appeal, close.

---

## 8. Backend per page (mirror `lib/finance/expenses.ts`)
Each Finance page: `routes/finance<Area>.ts` (thin) → `lib/finance/<area>.ts` (service w/ DTOs+toDto,
CRUD+lifecycle, emitAppEvent+writeHrAudit, workflow on approve/post, SoD, compensating rollback, `nextRef`).
Migrations mirror `20260806000000_finance_expense_claims.sql` (numeric money, service_role policy+grant,
updated_at trigger, idempotent seed matching the mockup rows). GL migration owns `finance_gl_accounts`
(the cross-module contract). Contracts backend builds on the committed `20260915000000` schema. Every module
ships `scripts/e2e/suites/<name>.mjs` per §6.6. Permission keys per §6.1 added to catalogue + roles + meta.

## 9. Build order (locked)
1. `.hrfin` tokens (Aurora) + scoped sheet. 2. Shell + Sidebar + TopBar. 3. PageHeader + QuickActionStrip.
4. KpiCard (+ Sparkline/MiniBarChart/ProgressMeter). 5. ChartCard + TrendAreaChart + ComboBarLineChart +
HorizontalBarMetricList + DonutProgress. 6. RightRailCard + ActivityList + DeadlineList + TaskPlanner.
7. RegisterTabs + RegisterToolbar + RegisterTable + StatusPill + Pagination. 8. **Finance Overview** →
9. **Accounts Payable** → **stop & review as the reference standard** → 10. AR → 11. GL → 12. Fixed Assets →
13. Contracts → 14. Disciplinary. 15. DetailDrawer. 16. Wizards. 17. Lifecycle mutations + backends.
18. Audit/app-events + workflows. 19. E2E suites. 20. Responsive polish. Ship each page only when §6.6 is green.

## 10. Open questions (owner/Codex)
Auto-approve threshold defaults · TTD-only vs multi-currency v1 · real e-signature vs status-only v1 ·
disciplinary retention period + override role · tax/VAT (T&T VAT now or placeholder).
