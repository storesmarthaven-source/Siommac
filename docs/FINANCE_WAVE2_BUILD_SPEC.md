# SIOMAC Finance — Wave 2 Build Spec (AP + Overview enterprise completion)

> Authoritative, **reconciled**, file-chunked build plan for Wave 2. Rolls the user's
> "SIOMAC Finance — Enterprise Functionality Build Spec" (2026-07-07, scope: Finance
> Overview + Accounts Payable) into the actual repo. The user's raw narrative spec is
> preserved verbatim at `docs/FINANCE_AP_OVERVIEW_ENTERPRISE_SPEC.md` (the **target
> contract**); THIS doc is the **buildable plan** — it reconciles that contract against
> the code already shipped and breaks it into per-file task chunks in the user's build order.
>
> Governing rules: `CLAUDE.md` **No-Band-Aids** + **Feature-Completeness** (no dead controls,
> every mutation ties into toast/events/audit/workflow/notifications/handoffs) + **Testing
> Standard** (live E2E asserts side-effects). Cautionary record: `docs/FINANCE_FEATURE_AUDIT.md`.

---

## 0. Wave 2 shape & sequencing

Wave 2 has **two tracks**; do **2A first** (it's the user's active demand — "complete this module
today"), then 2B:

- **Wave 2A — AP + Overview enterprise completion (this doc).** Upgrade the two already-built
  Aurora pages (`FinanceOverview.tsx`, `PayablesOverview.tsx`) from shallow dashboards into the
  enterprise workflows in the target contract. 14 chunks (§2), build order per contract §26.
- **Wave 2B — deepen the 6 existing Finance pages** (Payroll, Budgets, Expenses, Remittances,
  Disbursements, Statutory) into the `.hrfin`/Aurora language. Tracked separately (task #17);
  the same audit lens + Feature-Completeness gate applies.

**Still after Wave 2** ("1,2,3,4"): Accounts Receivable → General Ledger → Fixed Assets → HR
Contracts + Disciplinary. Unchanged. (AR migration `20260917000020` + GL `20260917000000` remain
reusable/seeded orphans; do not apply until their module is built.)

`docs/FINANCE_FEATURE_AUDIT.md` is now **superseded by this doc** for the AP/Overview scope — it
stays as the "why" (the honest catalogue of what was dead/basic).

---

## 1. Reconciliation — target contract vs current repo (READ FIRST — this is the No-Band-Aids gate)

The contract was written against an idealised schema. Building it literally would fork our data
model and the audit backbone. These are the binding corrections; **the contract's names defer to
these where they conflict.**

### 1.1 Table-name map — keep `finance_ap_*`, do NOT create the contract's alternate names
| Contract (§21) | Reality | Action |
|---|---|---|
| `finance_vendors` | **`finance_ap_vendors`** (applied) | keep ours; contract name is an alias |
| `finance_vendor_bank_accounts` | — | **NET-NEW** `finance_ap_vendor_bank_accounts` |
| `finance_ap_bills` | exists (applied) | **ALTER** (add columns, §1.3) |
| `finance_ap_bill_lines` | exists (applied) | **ALTER** (add columns, §1.3) |
| `finance_ap_bill_attachments` | — | **NET-NEW** |
| `finance_ap_payments` | exists (applied) | **ALTER** (method enum + columns, §1.3) |
| `finance_ap_payment_runs` | — | **NET-NEW** |
| `finance_ap_payment_run_items` | — | **NET-NEW** |
| `finance_ap_duplicate_reviews` | — | **NET-NEW** |
| `finance_comments` | — | **NET-NEW** `finance_ap_comments` — BUT first grep for a platform comments/notes table and **reuse** it if one exists (Collaboration fabric ≈90% built; see memory `collaboration-rail-deferred`). Prefer reuse. |
| `finance_audit_events` | **`app_events` + `audit_logs`** (platform backbone) | **DO NOT CREATE.** Forking the audit store is a dual-system band-aid. The contract's §22 event names become the `emitAppEvent` type + `writeHrAudit` action strings. |

### 1.2 Do NOT fork the backbone — map every "audit event" onto the real one
Every mutation already goes through `emitAppEvent(...)` (→ `app_events`) + `writeHrAudit(...)`
(→ `audit_logs`) — see `netlify/functions/lib/finance/accountsPayable.ts` and `lib/hr/employeeCore`.
Contract §22 event strings (`finance.bill.approved`, `finance.payment.recorded`, …) are the
`event_type`/action values, **not** a new table. Contract §22 `FinanceAuditMetadata` (before/after/
reason/ip/ua) maps to the existing audit payload — add `before`/`after` diffs where a mutation edits
an existing row (edit-draft, vendor update, void).

### 1.3 Column additions to the three applied tables (additive forward migration — NOT a rewrite)
The applied migration `20260917000010` is **complete for its scope, not broken** — extending it for
new features is forward evolution, so this is a **new** migration `20260917000030_finance_ap_enterprise.sql`
(additive `alter table … add column if not exists` + new tables). Do **not** edit the applied file.

- **`finance_ap_bills`** — add: `vendor_invoice_no text` (the vendor's own invoice #, distinct from
  our internal `bill_no`; the key duplicate-detection field), `reference text`, `subtotal_amount
  numeric(15,2) not null default 0`, `tax_amount numeric(15,2) not null default 0`, `tax_included
  boolean not null default false`, `withholding_tax_code text`, `payment_terms_days integer`
  (snapshot from vendor at create). Invariant becomes `subtotal_amount = Σ lines.amount` and
  `total_amount = subtotal_amount + tax_amount − withholding`. (`currency` already exists.)
- **`finance_ap_bill_lines`** — add: `quantity numeric(15,4) not null default 1`, `unit_price
  numeric(15,2) not null default 0`, `tax_code text`, `project_id uuid`. (`amount`, `gl_account_code`,
  `cost_center_id` exist; `amount = round(quantity*unit_price,2)`.)
- **`finance_ap_vendors`** — add: `default_currency text not null default 'TTD'`,
  `default_cost_center_id uuid`, `preferred_payment_method text` (check in the app), and **extend the
  status check** to `('active','inactive','on_hold')`. (`registration_no` = tax registration;
  `payment_terms_days`, `default_gl_account_code`, `contact_*` already exist.)
- **`finance_ap_payments`** — **extend method check** to `('eft','ach','wire','cheque','cash','card')`;
  add: `memo text`, `source_account_id uuid`, `payment_run_id uuid references
  finance_ap_payment_runs(id) on delete set null`. (`paid_at` = payment date; `reference` exists.)

Migration conventions (mirror the applied file + `CLAUDE.md` §3): `uuid` pk `default gen_random_uuid()`,
money `numeric(15,2)`, **actor FKs are `text references app_users(id)`** (app_users.id is TEXT),
`created_at`/`updated_at` + `set_fap_updated_at` trigger on mutable tables, RLS enabled + `service_role`
bypass policy + grants, idempotent seed, end with `NOTIFY pgrst, 'reload schema';`. Operator applies —
**do not run it**; hand it off in the final gate.

### 1.4 GL / cost-centre / tax pickers stay decoupled
The contract's "GL account **picker**" (not free text) is correct — but GL stays a separate module
(`docs/HR_FINANCE_DESIGN_SPEC.md §7.4`): the picker reads a **chart-of-accounts list endpoint** and
stores the selected **`gl_account_code` (text)** — **no hard FK** to a GL table (GL module isn't built).
Same for cost centre (reads budget/cost-centre list) and tax code (config). Until a real CoA endpoint
exists, back the picker with a **seeded finance config list** (honest, not free-text), and note the
GL-module swap as a follow-up. Do **not** invent a fake FK.

### 1.5 Permissions — the granular set replaces the coarse one (no dual keys)
Today the pages/routes gate on `finance.overview.view` + `finance.ap.view/manage/approve`. The
contract §2 granular catalogue **replaces** these. Migrate every gate (route `requirePermission`,
frontend `can(...)`, `QuickAction` visibility) to the granular keys. Catalogue **every** new key in
BOTH `netlify/functions/lib/permissions.ts` and `src/lib/permissions.ts` (exact-match drift-guard
fails the build otherwise), add Console metadata in `src/lib/permissionMeta.ts`, and add each key to
the role bundles (`finance_staff` = view/create/edit/submit/record-payment; `finance_manager` =
+approve/reject/void/payment-run/duplicate-resolve/export/kpi-drill/inline-approve; `admin`/`superadmin`
= all). Keep the coarse keys ONLY as internal role-bundle aliases if needed — never gate on both.

### 1.6 Adopt the `financeQueryKeys` factory (contract §1.1)
Refactor the inline query keys in `src/api/finance/overview.ts` + `accountsPayable.ts` to the single
`financeQueryKeys` factory (new `src/api/finance/keys.ts`). Every mutation invalidates exactly the sets
in contract §1.2. This is the single source of cache-key truth — no ad-hoc `['finance',…]` literals.

### 1.7 Reuse existing infrastructure (don't rebuild)
- **Attachments** → reuse the HR-Documents / presigned-upload + storage pattern (memory
  `avatars-public-bucket`; private files get signed URLs). `finance_ap_bill_attachments` is just the
  metadata row pointing at the stored object. Do not hand-roll an uploader.
- **Lifecycle action dialogs** (approve/reject/void, bulk decisions) → reuse `openActionModal`
  (`@/components/common/actions`) with SoD (`assertDifferentApprover` from `lib/finance/statutoryConfig`).
- **Drawers / wizard / table / pills / charts** → the `.hrfin` kit (`src/ui/hrfin/*`, via `@ui`).
  New pieces needed: multi-line **line-item editor**, **entity picker** (vendor/GL/cost-centre/tax),
  **file-drop**, **facet menu**, **row ⋮ menu**, **stepper** beyond the current thin `HrfinWizardModal`.
- **Comments / "Related records" / notifications / handoffs** → the platform fabric (messages,
  tickets, `handoff_outbox`, notifications). An action owned by another module calls THAT module's
  real endpoint (contract's cross-module approve/send), never a local no-op — if the cross-module
  approve endpoint doesn't exist yet, render **Open** only (contract §19), don't fake Approve.

### 1.8 Ref prefixes
`refGenerator.ts` already has `BILL`/`APV`. Add **`PRUN`** (payment run). Payments keep user-entered
`reference` (no generated prefix). Note the shared-counter caveat for any prefix reused elsewhere.

---

## 2. File-level task chunks (build order = contract §26)

Each chunk is the **smallest fully-wired shippable unit** (Feature-Completeness gate: no chunk ships a
dead control). Gate every chunk with `npm run typecheck:frontend` + `npm run build:backend` before
commit; run the **full E2E once at the end** of the track (`CLAUDE.md` cadence). Commit locally only,
message ending `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

Legend for file column: **N**=new, **E**=edit.

### Chunk 0 — Foundation (perms + keys + migration + pickers) — do before everything
| File | N/E | What |
|---|---|---|
| `supabase/migrations/20260917000030_finance_ap_enterprise.sql` | N | additive columns (§1.3) + 6 new tables (`finance_ap_vendor_bank_accounts`, `finance_ap_bill_attachments`, `finance_ap_payment_runs`, `finance_ap_payment_run_items`, `finance_ap_duplicate_reviews`, `finance_ap_comments`); RLS+grants+triggers+seed; `NOTIFY pgrst`. **Operator-applied.** |
| `netlify/functions/lib/permissions.ts` | E | add contract §2 keys (backend catalogue) + role bundles |
| `src/lib/permissions.ts` | E | mirror §2 keys (frontend catalogue) — must match exactly |
| `src/lib/permissionMeta.ts` | E | Console metadata for each new key |
| `netlify/functions/lib/refGenerator.ts` | E | add `PRUN` |
| `src/api/finance/keys.ts` | N | `financeQueryKeys` factory (§1.1) |
| `netlify/functions/lib/finance/pickers.ts` | N | list endpoints for vendor / GL-account (CoA) / cost-centre / tax-code / payment-terms pickers (seeded config until GL module exists) |
| `netlify/functions/routes/financePickers.ts` + mount in `api.ts` | N/E | thin routes |
| `src/api/finance/pickers.ts` | N | picker hooks |
| `src/ui/hrfin/EntityPicker.tsx` (+ export) | N | searchable async combobox (used by vendor/GL/cost-centre/tax) |
| `scripts/e2e/suites/financeAp.mjs` | E | assert new perms deny unauthorized; picker endpoints return shape |

### Chunk 1 — Vendor create/edit dialog (contract §6)
| File | N/E | What |
|---|---|---|
| `netlify/functions/lib/finance/accountsPayable.ts` | E | `getVendorDetail`, `updateVendor`, `listVendorBills`, `listVendorPayments`; extend `createVendor` to full `ApVendorForm` + bank accounts; emit `finance.vendor.created/updated` + audit |
| `netlify/functions/routes/financeAccountsPayable.ts` | E | routes `/ap/vendors/get|update|bills|payments` |
| `src/api/finance/accountsPayable.ts` | E | `useVendorDetail`, `useUpdateVendor`, `useVendorBills`, `useVendorPayments`; fix `useCreateVendor` invalidations (§1.2) |
| `src/components/sections/Finance/dialogs/ApVendorDialog.tsx` | N | full form (name/code/tax/contact/terms/currency/default GL+CC/preferred method/bank/status), inline validation, bank fields required when method∈{eft,ach,wire}, code-uniqueness check |
| `src/components/sections/Finance/drawers/ApVendorDrawer.tsx` | N | vendor detail (statement, open/overdue balance, bills, payments) |
| `PayablesOverview.tsx` | E | wire "New vendor" quick action → dialog (not `setTab`); Vendors rows → drawer |
| `scripts/e2e/suites/financeAp.mjs` | E | create/update vendor; validation denials; side-effects |

### Chunk 2 — Record Payment dialog upgrade (contract §7)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | extend `recordPayment` to full contract (method incl. ach/wire, `paymentDate`→`paid_at`, `reference`, `memo`, `sourceAccountId`); overpayment guard (needs `finance.ap.payment.record` + override perm); reject non-approved/paid/void |
| `financeAccountsPayable.ts` (route) | E | ensure `body.args` full payload passed |
| `src/api/finance/accountsPayable.ts` | E | `useRecordPayment` sends full form; invalidations §1.2 |
| `src/components/sections/Finance/dialogs/ApRecordPaymentDialog.tsx` | N | bill/vendor selector → details → **balance preview** (total/paid/remaining before/this/after → resulting status) → submit; method select, date, reference (required for non-cash), memo |
| `PayablesOverview.tsx` | E | drawer "Record payment" + AP quick action + Overview quick action all open this (not `openPay(open[0])`) |
| E2E | E | partial + full payment scenarios (contract §25), overpayment block, status transition, `finance.payment.recorded` event |

### Chunk 3 — Status filter + Advanced filter panel (contract §8)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) `listBills` | E | accept full `ApBillFilters` (status incl. `overdue`, vendor, due range, amount range, approver, GL, cost-centre, tax, `hasDuplicateRisk`, `missingAttachment`, page, pageSize) |
| `src/api/finance/accountsPayable.ts` | E | `useApBills(filters)` keyed via `financeQueryKeys.apBills` |
| `src/ui/hrfin/HrfinTable.tsx` | E | real toolbar slots (facet menu + filter button with count badge); page resets to 1 on filter change |
| `src/components/sections/Finance/filters/ApStatusFilterMenu.tsx` | N | facet menu |
| `src/components/sections/Finance/filters/ApAdvancedFilterPanel.tsx` | N | full panel (Apply/Clear/Save view) |
| `PayablesOverview.tsx` | E | wire toolbar Status/Filters (kill the dead buttons) |
| E2E | E | filter → server query narrows; pagination preserved |

### Chunk 4 — Row ⋮ action menu (contract §9)
| File | N/E | What |
|---|---|---|
| `src/ui/hrfin/RowActionMenu.tsx` (+ export) | N | a11y popover menu |
| `src/components/sections/Finance/menus/ApBillActionMenu.tsx` | N | **state-aware** actions per status table (§9); each item permission-gated (hidden or disabled-with-reason) |
| `PayablesOverview.tsx` | E | replace the dead ⋮ `stopPropagation` with this menu; wire each action to the real dialog/mutation |
| E2E | E | menu contents per status; denied actions absent/disabled |

### Chunk 5 — Bill drawer tabs (contract §10)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | `editDraftBill`; `createBillAttachment`/`listBillAttachments`/`deleteBillAttachment`; comments create/list (or platform comments); assemble Approvals (from workflow/audit) + Related (handoffs) |
| routes + `src/api/finance/accountsPayable.ts` | E | endpoints + hooks for the above |
| `src/components/sections/Finance/drawers/ApBillDrawer.tsx` | N (replaces inline drawer) | tabs: Summary, Line Items, Approvals, Payments, **Attachments**, **Comments**, **Audit Trail**, Related Records |
| `src/components/sections/Finance/drawers/panels/*` | N | `ApTimelinePanel`, `ApAttachmentsPanel`, `ApCommentsPanel`, `ApAuditTrailPanel` |
| `PayablesOverview.tsx` | E | open the new drawer; keep the real lifecycle actions (already wired) |
| E2E | E | attachment upload/list/delete; comment create; audit tab reflects `audit_logs` |

### Chunk 6 — New Bill wizard upgrade (contract §5) — the headline fix
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) `createBill` | E | full `CreateApBillRequest` (multi-line, tax, attachmentIds, submitForApproval, duplicateOverrideReason); enforce `subtotal=Σlines`, `total=subtotal+tax−withholding`; run duplicate check pre-commit; `editDraftBill` shares validation |
| routes + hooks | E | pass full payload; invalidations §1.2 incl. `apDuplicateRisks` |
| `src/ui/hrfin/WizardStepper.tsx` | N | 6-step stepper (extends the thin `HrfinWizardModal`) |
| `src/ui/hrfin/LineItemEditor.tsx` (+ export) | N | add/remove/duplicate rows, qty×price, GL/cost-centre/tax pickers, live totals |
| `src/components/sections/Finance/wizards/ApNewBillWizard.tsx` | N (replaces basic wizard) | steps 1 Vendor&Header (auto-fill from vendor) → 2 Line Items → 3 Tax&Accounting → 4 Attachments → 5 Duplicate Check → 6 Review&Submit; per-field validation; Save draft / Submit (perm-gated) |
| `PayablesOverview.tsx` | E | swap in the new wizard |
| E2E | E | multi-line create; totals; submit-for-approval; draft edit round-trip |

### Chunk 7 — Duplicate detection + banner + review drawer (contract §13)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | `detectDuplicateBills` (same vendor+invoice_no; vendor+amount+date; similar invoice_no; attachment hash), `resolveDuplicateRisk`; hard-dup blocks submit unless override perm; writes `finance_ap_duplicate_reviews` + `finance.bill.duplicate_reviewed` |
| routes + hooks | E | `/ap/duplicate-risks/list|resolve`; `useApDuplicateRisks`, `useResolveDuplicateRisk` |
| `src/components/sections/Finance/ApDuplicateRiskBanner.tsx` | N | shows when `duplicateRiskCount>0`; Review / Dismiss-for-session |
| `src/components/sections/Finance/drawers/ApDuplicateReviewDrawer.tsx` | N | compare current vs match; Mark duplicate / Ignore-with-reason / Open match |
| wizard step 5 | E | consume `detectDuplicateBills`; block on hard dup |
| E2E | E | duplicate scenario (contract §25) — block + override |

### Chunk 8 — Bulk approval queue (contract §11)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | `bulkApproveBills` (per-item SoD + perm; partial-block semantics: block ineligible **before** submit; returns approved/rejected/blocked); reject requires reason; emits per-bill events |
| routes + hooks | E | `/ap/bills/bulk-approve`; `useBulkApproveBills` |
| `src/components/sections/Finance/ApBulkApprovalQueue.tsx` | N | submitted-only; checkboxes; columns incl. SoD status + risk; Approve/Reject selected; open drawer |
| `PayablesOverview.tsx` | E | "Approve" quick action → this queue (kill the `setTab('bills')` no-op) |
| E2E | E | bulk approve; SoD block on own bill; reason-required reject |

### Chunk 9 — Finance Overview export (contract §16)
| File | N/E | What |
|---|---|---|
| `netlify/functions/lib/finance/overview.ts` | E | `exportFinanceOverview` (dashboard/approvals/spend-budget/cost-centre/all → CSV; XLSX later); emits `finance.dashboard.exported` |
| route + `src/api/finance/overview.ts` | E | `/overview/export`; `useExportOverview` |
| `src/components/sections/Finance/dialogs/FinanceExportDialog.tsx` | N | type + format select → download (reuse `exportCsv`) |
| `FinanceOverview.tsx` | E | "Export" quick action → dialog (kill `toast('Export queued')`) |
| E2E | E | export returns CSV + audit event |

### Chunk 10 — Overview KPI drill-through (contract §17)
| File | N/E | What |
|---|---|---|
| `overview.ts` (lib) | E | `getFinanceKpiDrilldown(kpiType, period, filters)` → titled row set; emits `finance.kpi.drilled` |
| route + hook | E | `/overview/kpi-drilldown`; `useKpiDrilldown` |
| `src/components/sections/Finance/drawers/FinanceKpiDrilldownDrawer.tsx` | N | filtered register per KPI (spend/pending-approvals/variance/cash-runway) |
| `src/ui/hrfin/KpiCard.tsx` | E | make clickable (onDrill) |
| `FinanceOverview.tsx` | E | wire all four KPI cards |
| E2E | E | each KPI returns its register |

### Chunk 11 — Overview approvals inbox (contract §19) — cross-module
| File | N/E | What |
|---|---|---|
| `overview.ts` (lib) | E | `getApprovalsQueue(filters)` (AP+expenses+remittances+disbursements, `userCanApprove`, `sodBlocked`); `approveFinanceQueueItem`/`rejectFinanceQueueItem`/`sendFinanceQueueItem` calling **each module's real action** |
| routes + hooks | E | `/overview/approvals/list|act` |
| `src/components/sections/Finance/FinanceApprovalsInbox.tsx` | N | filters (module/type/age/amount/priority); rows Open + (Approve/Reject inline **only where `userCanApprove`**, else Open-only — no fake buttons) |
| `src/components/sections/Finance/FinanceApprovalActionModal.tsx` | N | reuse `openActionModal` |
| `FinanceOverview.tsx` | E | "Review approvals" + alert "Review now" + KPI pending + table "View all" → inbox; the table "Approve" button either approves in place **or** is relabeled **Open** (contract §16/§24) |
| E2E | E | inline approve refreshes AP + overview (contract §25 "Overview Approve"); SoD-blocked shows Open only |

> If a module lacks a real cross-module approve action, **ship Open-only for that type** and log the
> gap — do not fake Approve (Feature-Completeness).

### Chunk 12 — Payment run builder (contract §12)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | `createPaymentRun`/`listPaymentRuns`/`getPaymentRunDetail`/`processPaymentRun`/`voidPaymentRun`; run creates payments per bill on process, marks bills paid/partial, SoD (creator ≠ processor without 2nd approval); emits `finance.payment_run.*` |
| routes + hooks + `financeQueryKeys.apPaymentRun(s)` | E | full CRUD/act |
| `src/components/sections/Finance/wizards/ApPaymentRunBuilder.tsx` | N | select approved bills → review batch → method/source → generate file / mark manual → process |
| `PayablesOverview.tsx` | E | rail "Review & run payment" → builder (kill `openPay(open[0])`) |
| E2E | E | create→process run; bills move to paid; payments created; events |

### Chunk 13 — Import wizard + Spend-vs-budget chart upgrade (contract §14, §18)
| File | N/E | What |
|---|---|---|
| `accountsPayable.ts` (lib) | E | `importBills` (parse CSV/XLSX, map, validate rows → `ImportValidationRow[]`, import valid, error report); emits `finance.bill.imported` |
| route + hook | E | `/ap/bills/import` |
| `src/components/sections/Finance/wizards/ApImportWizard.tsx` | N | upload → map → validate → review errors → import → error report (reuse Employee-Import pattern) |
| `overview.ts` (lib) `getSpendBudgetSeries` | E | real spend/budget/forecast + variance per point; period MTD/Monthly/Quarterly |
| `src/ui/hrfin/charts/TrendArea.tsx` | E | period toggle, hover tooltip, forecast segment, clickable points |
| `FinanceOverview.tsx` + `PayablesOverview.tsx` | E | wire import quick action + chart period toggle |
| E2E | E | import valid/invalid rows; chart series shape |

---

## 3. Cross-cutting requirements (apply to EVERY chunk)

1. **Backbone per mutation (Spec §2 / CLAUDE.md Feature-Completeness):** business row →
   `emitAppEvent` (contract §22 name) → `writeHrAudit` (with before/after where editing) → workflow
   task on submit/approve (`startWorkflowForRecord`) → **toast** on success/failure → notifications /
   messages / tickets / `handoff_outbox` where the rule requires. A mutation that writes its row but
   fires none of these **fails** the chunk.
2. **SoD** (`assertDifferentApprover`): approve, bulk-approve, payment-run process. Creator ≠ approver;
   submitter ≠ final approver; run creator ≠ processor without 2nd approval. Enforced in the **service**,
   surfaced as an inline reason in the UI (not just a toast).
3. **Atomicity:** no supabase-js multi-call "transaction". Use compensating rollback (delete parent on
   satellite-insert failure) until the transactional-outbox RPC exists (`MUTATION_BACKBONE_PLAN.md`).
   Never swallow a DB error.
4. **Error states (contract §23):** every dialog/drawer handles permission-denied, SoD violation,
   not-found, stale-record, network, validation, duplicate, upload-failure, over-balance, ineligible-in-run,
   vendor-inactive, already-paid/void. Shape = `FinanceApiError { code, message, fieldErrors?, recoverable }`
   → **inline per-field errors** + toast (memory `feedback-scrutinize-cross-field-gaps`).
5. **Every dialog** has loading / success / error / validation states; **every list** real
   filter+pagination; **every drawer action** state-aware; **no toast-only or navigate-only action**
   whose label implies a mutation.
6. **E2E per chunk** (`scripts/e2e/suites/financeAp.mjs`, `financeOverview.mjs`): every endpoint,
   authorized-pass + unauthorized-deny (provision a real role user — forged JWT role is ignored),
   response shape (the FE contract), and **side-effect assertions** via service-role client
   (`app_events`/`audit_logs`/`notifications`/`workflow_tasks`/`handoff_outbox`). Tag rows with `h.TAG`,
   clean up in `h.onCleanup()`. `dev:netlify` serves compiled `dist/` — `npm run build:backend` +
   restart before trusting a run.

---

## 4. Acceptance gate (contract §24 + §27) — verify BEFORE "done"
AP: New Bill = 6-step wizard, multi-line, GL **picker** not free-text, per-line cost-centre+tax,
attachments upload/preview, duplicate check pre-submit, New Vendor real form, Record Payment real
selector+balance preview (not arbitrary first bill), Approve → real bulk queue, Status + Advanced
filters hit the server, row ⋮ state-aware, drawer has all 8 tabs, payment-run builder real,
duplicate banner conditional, import wizard validates. **No AP control dead or toast-only.**
Overview: Review-approvals → inbox (or relabeled), Record-payment/New-vendor open dialogs, Export
real CSV, KPI cards drill through, spend-vs-budget has series+tooltip+period toggle, approvals-table
buttons approve-in-place or relabeled **Open**, alert actions open drilldown/inbox, deadlines/activity
rows clickable. **No Overview control dead or toast-only.**
Final checklist (contract §27): no toast-only control; no action-label that only navigates; no dead
toolbar button; every ⋮ opens a real menu; every quick action opens the correct dialog/workflow; every
mutation writes an audit event + invalidates the right keys; permission + SoD enforced; dialogs have
loading/success/error/validation; tables real filter+pagination; drawer actions state-aware.

## 5. Open decisions / deferrals (honest)
- **XLSX** export deferred → CSV first (contract allows "XLSX later").
- **Comments** table: reuse a platform comments/notes/messages table if one exists before creating
  `finance_ap_comments` (grep first). Thread-resolve deferred.
- **GL/cost-centre pickers** back onto seeded finance config until the GL module ships a real CoA
  endpoint — then swap the picker source (no schema change; still stores `gl_account_code`).
- **Cross-module approve** (Overview inbox) for a module without a real approve action → **Open-only**
  for that type until that module exposes one; logged, never faked.
- **Payment-run EFT/ACH file generation**: emit a standard file (or mark-manual) — real bank-format
  integration is a later ops concern; the run/paid state machine is built now.
