# Wave 2 Agent Fleet Brief — launch from a FRESH session

> **Historical execution brief.** Do not dispatch Accounts Payable, Budgeting, or combined Finance Overview work. Current authority: `docs/module-contracts/FINANCE_PRODUCT_SCOPE.md`.

> Purpose: finish **Wave 2A (AP + Overview)** chunks 7–13 and start **Wave 2B** with a background
> agent fleet. **Launch these from a fresh, quiet session** — agents die when the launching context is
> deep/busy (happened twice; see `docs/OVERNIGHT_BUILD_HANDOFF.md`). After launching, the orchestrator
> session **stays quiet** (monitor + relay + integrate only) so the agents have runway.

## How to use (fresh session)
1. Read this + `docs/FINANCE_WAVE2_BUILD_SPEC.md` (2A chunk contracts) + `docs/FINANCE_WAVE2B_BUILD_SPEC.md`
   (2B) + memory `project-overnight-build`. Skim `CLAUDE.md` (No-Band-Aids, Feature-Completeness, Testing).
2. Launch **Agents A, B, C** below (`run_in_background: true`, **non-isolated** — isolated = broken base).
3. Then go quiet. Relay each agent's chunk-commit pings; when all three land, integrate + run the final gate.
4. The **2B per-page fleet** (§5) is the NEXT wave — launch it only after A/B/C have landed.

## Current state (HEAD `c547f3fe`)
Wave 2A chunks **0–6 committed**: 0 foundation (perms + `financeQueryKeys` + `EntityPicker` + finance
pickers + `refGenerator PRUN` + migration `20260917000030`) · 1 vendor dialog/drawer · 2 record-payment ·
3 filters (`ApStatusFilterMenu`/`ApAdvancedFilterPanel`) · 4 row menu (`RowActionMenu`) · 5 tabbed
`ApBillDrawer` + audit/comments backend · 6 `ApNewBillWizard` (multi-line + pickers + tax + dup check).
**Reuse** these — don't rebuild. The granular `finance.ap.*` + `finance.overview.*` perms and the
`financeQueryKeys` for duplicate-risks / payment-runs / overview export/drill/approvals **already exist**
(Chunk 0), so no agent needs to touch `permissions.ts`/`permissionMeta.ts`.

## Reliability + coordination rules (put in every agent prompt)
- **Build INLINE, commit per chunk**, locally only (no push). Stage ONLY your own files with explicit
  `git add <paths>` (never `-A`); if `git commit` hits an `index.lock` (another agent committing), wait
  ~4s and retry. Commit msg ends: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- **Gate each chunk**: `npm run typecheck:frontend` + `npm run build:backend` green before commit.
- **Migrations: WRITE only** (`20260917000030` already exists; new 2B tables → new migration). Operator
  applies. Where runtime needs a migration, build the code + note it; never fake verification.
- **No band-aids / Feature-Completeness**: every mutation → `emitAppEvent`+`writeHrAudit`+toast+workflow/
  handoff where required; SoD via `assertDifferentApprover`; compensating rollback; real dialogs (all
  fields, pickers not free-text, validation); no dead controls.
- **Stay in your lane** — the file ownership below is disjoint on purpose. Don't touch onboarding
  (`OnboardingOverview/StartOnboardingWizard/StartOnboarding.css`), HR, another agent's files, or
  `permissions.ts`/`permissionMeta.ts` (perms already catalogued).

---

## Agent A — Wave 2A **AP track** (chunks 7, 8, 12, 13-import)
**Owns (only these):** `netlify/functions/lib/finance/accountsPayable.ts`, `netlify/functions/routes/financeAccountsPayable.ts`,
`src/api/finance/accountsPayable.ts`, `src/components/sections/Finance/PayablesOverview.tsx`, new
`src/components/sections/Finance/Ap*.tsx`, `scripts/e2e/suites/financeAp.mjs`. **Do NOT touch** Overview
files, lookups, `api.ts`, `keys.ts`, hrfin kit (consume only).
**Chunks** (contracts in `FINANCE_WAVE2_BUILD_SPEC.md` §2):
- **7 Duplicate reviews** — in `createBill`, on override persist `finance_ap_duplicate_reviews` (table
  in `…000030`); add `listDuplicateReviews` + `resolveDuplicateRisk` (mark-duplicate voids the newer bill;
  emits `finance.ap.bill.duplicate_reviewed`) + routes (`/ap/duplicate-risks/list|resolve`) + hooks
  (`useApDuplicateRisks`/`useResolveDuplicateRisk` — keys `financeQueryKeys.apDuplicateRisks` exist) +
  `ApDuplicateRiskBanner` + `ApDuplicateReviewDrawer`; wire into `PayablesOverview`. Perm `finance.ap.duplicate.resolve` (exists).
- **8 Bulk approval queue** — `bulkApproveBills` (per-item SoD + perm, block ineligible before submit) +
  route + hook + `ApBulkApprovalQueue`; the "Approve" quick action opens it.
- **12 Payment run** — `finance_ap_payment_runs`/`_items` (in `…000030`): create/list/get/process/void
  (process marks bills paid, SoD creator≠processor); `PRUN` ref exists; `ApPaymentRunBuilder` behind the
  rail "Review & run payment". Perms `finance.ap.payment.run.manage|process` (exist).
- **13-import** — `importBills` (CSV parse→map→validate→import + error report) + `ApImportWizard`. Perm
  `finance.ap.bills.import` (exists).
Extend `financeAp.mjs` per chunk. Note: runtime needs `…000030` applied.

## Agent B — Wave 2A **Overview track** (chunks 9, 10, 11, 13-chart)
**Owns (only these):** `netlify/functions/lib/finance/overview.ts`, `netlify/functions/routes/financeOverview.ts`,
`src/api/finance/overview.ts`, `src/components/sections/Finance/FinanceOverview.tsx`, new
`src/components/sections/Finance/Finance*.tsx`, `src/ui/hrfin/charts/TrendArea.tsx`,
`scripts/e2e/suites/financeOverview.mjs`. **Do NOT touch** AP files, lookups, `api.ts`, `keys.ts`, permissions.
**Chunks** (`FINANCE_WAVE2_BUILD_SPEC.md` §2):
- **9 Export** — `exportFinanceOverview` (CSV; emits `finance.dashboard.exported`) + route + hook +
  `FinanceExportDialog`; kill the toast-only "Export". Perm `finance.overview.export` (exists).
- **10 KPI drill** — `getFinanceKpiDrilldown` + route + hook + `FinanceKpiDrilldownDrawer`; make the 4
  `KpiCard`s clickable (add `onDrill` to `KpiCard`? NO — keep KpiCard generic; wrap in a clickable). Perm `finance.overview.kpi.drill`.
- **11 Approvals inbox** — `getApprovalsQueue` + `approve/reject/sendFinanceQueueItem` (call each module's
  real action) + `FinanceApprovalsInbox` + `FinanceApprovalActionModal` (reuse `openActionModal`). Where a
  module lacks a real cross-module approve, show **Open** only — never fake Approve. Perm `finance.overview.approvals.inline`.
- **13-chart** — upgrade `TrendArea`: period toggle + hover tooltip + forecast segment.
Extend `financeOverview.mjs`.

## Agent C — Wave 2B **Phase 0 foundation** (mostly new files — unblocks the 6 pages)
**Owns:** `netlify/functions/lib/finance/lookups.ts` (+ `routes/financeLookups.ts` + **mount in `api.ts`**),
`src/api/finance/lookups.ts`, `src/components/sections/Finance/_shared/EmployeeCell.tsx` + `pickers.tsx` +
`reports.tsx`, `netlify/functions/lib/finance/attachments.ts`, `netlify/functions/lib/finance/bridges.ts`,
extend `src/api/finance/keys.ts`. **Only C touches `api.ts` + `keys.ts`.** Do NOT touch AP/Overview or the
6 page files (that's the next wave).
**Build** `FINANCE_WAVE2B_BUILD_SPEC.md` §2: `resolveEmployees(ids)` (app_users full_name) + `useEmployeeNames`
+ `<EmployeeCell>`; picker list endpoints (employees / cost-centres [reuse HR Org `hr.cost_centers`] /
approved-payroll-runs / authorities / budget-categories); shared report-surface over the existing reports
endpoints + `exportCsv`; attachments-via-`lib/upload.ts`; idempotent `createDisbursement/RemittanceFromRun`
+ `createReimbursementHandoff` (unique-key guarded). Gate on `finance.ap.view` (exists) or reuse module perms.

---

## Ready-to-paste agent prompt (adapt per agent)
> You are finishing **<TRACK>** for SIOMAC Wave 2, autonomously, to enterprise quality, INLINE in the main
> session (background agents die — commit per chunk so nothing is lost). Branch
> `claude/wonderful-panini-34b331`; never touch the main production copy. Read `docs/FINANCE_WAVE2_BUILD_SPEC.md`
> (or `_WAVE2B_`) §<chunks>, `docs/WAVE2_AGENT_FLEET_BRIEF.md` (your file ownership + rules), `CLAUDE.md`,
> and the existing AP/Overview files for the patterns. Build ONLY your owned files (listed in the brief);
> do NOT touch onboarding, HR, other agents' files, or `permissions.ts`/`permissionMeta.ts` (perms already
> exist). Per chunk: build backend (lib→route→hook) → frontend → extend the E2E suite → `typecheck:frontend`
> + `build:backend` green → `git add <your paths>` (retry on index.lock) → commit (trailer
> `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`) → `SendMessage` main "Chunk N committed <hash>".
> Migrations: write only; note that `20260917000030` must be operator-applied for runtime. Report at end:
> chunks committed (hashes), any new migration, deviations, what remains.

## 2B per-page fleet (NEXT wave — after A/B/C land)
Per `FINANCE_WAVE2B_BUILD_SPEC.md`: one agent per page, order **Statutory → Remittances → Disbursements →
Expenses → Budgets → Payroll**, each reusing the shared layer (EntityPicker, RowActionMenu, ApBillDrawer
pattern, Agent C's lookups/pickers/EmployeeCell). Disjoint page files; each reports its route mount + any
new perm keys for the orchestrator to integrate. Aurora rebuild + real dialogs + detail drawer + E2E per page.

## Operator + final gate
Apply `supabase/migrations/20260917000030_finance_ap_enterprise.sql` → `NOTIFY pgrst,'reload schema'` →
`npm run build:backend` → restart `dev:netlify` → `npm run test:e2e -- financeAp financeOverview`. (Plus any
new 2B/Contracts migrations the agents write.)
