# Payroll Enterprise Spec — Grounding Corrections (read WITH the spec, BEFORE generating)

> Current authority: `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md`. This file remains the schema and
> naming correction ledger. Where it references the older enterprise plan, use the reconciled
> current-state section in the technical implementation first.

The "SIOMAC Enterprise Payroll — Full Technical Implementation" spec is the target. It is sound.
But several DDL snippets/column names in it do **not** match the actual SIOMAC schema. Apply these
corrections or the generated migrations/queries will fail. Cross-checked against the real code
(`netlify/functions/lib/finance/*`, `lib/hr/*`, migrations). Companion to
`docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md`.

## C1. ❌ `organization_id uuid` — SIOMAC is SINGLE-TENANT (critical)
Every new table in the spec has `organization_id uuid not null`. **There is no `organizations`
table and no org concept anywhere in SIOMAC.** Do **not** add `organization_id` to any payroll
table, and never `references organizations(id)` — that table doesn't exist. Scope config through
the existing **settings catalog** (`netlify/functions/lib/settings/`), not an org column. (Same
finding as the AI-layer grounding — see [[project-ai-layer-phase1]].)

→ Drop `organization_id` from `finance_pay_groups`, `finance_employee_pay_group_assignments`,
`finance_employee_loans`, `finance_payroll_gl_mappings`, `finance_payroll_jobs*`, etc.

## C2. ✅ `app_users.id` is TEXT (spec mostly right — keep it)
User FKs are `text references app_users(id)` — the spec's `created_by text references app_users(id)`
is correct. Do NOT switch any user column to uuid. New PKs stay `uuid default gen_random_uuid()`.

## C3. ❌ Overtime column names
Spec index uses `hr_overtime_entries(employee_id, work_date, approval_status)`. The real column is
**`status`** (values include `'approved'`), not `approval_status`. Actual columns:
`employee_id, work_date, hours, multiplier, status`. Fix the index and any query.

## C4. Pay-item gating is TWO columns
`hr_employee_pay_items` gates on **both** `is_active = true` AND `status = 'active'`, effective-dated
by `effective_from` / `effective_to` (nullable). The proposed
`employee_pay_items_effective_idx(employee_id, effective_from, effective_to)` is good; add `status`
if the planner needs it.

## C5. Permission keys — 4-file cascade + drift-guard (not free)
Many proposed keys **already exist**: `finance.payroll.view_own/view_all/run.manage/approve/lock/
export/reports.view`. The NEW ones (`run.create`, `run.calculate`, `run.submit`, `run.reopen`,
`worksheet.override`, `exceptions.resolve`, `payslips.generate/distribute`, `payments.prepare/approve`,
`bank_files.generate`, `remittances.manage`, `gl.preview/gl.post`, `employee_profile.view/manage`,
`sensitive_data.view`, `settings.manage`) must be added in ONE coordinated commit across FOUR files
or the drift-guard tests fail: `src/lib/permissions.ts` (+ role defaults), `netlify/functions/lib/
permissions.ts` (+ role defaults), `src/lib/permissionMeta.ts`. Keys must appear as literal strings.
Route `requirePermission(c, 'finance.payroll.*')` in `routes/*.ts` is auto-covered by the scan.
(See [[rbac-permission-registry]].)

## C6. Mutation atomicity — NO app-layer transaction across tables
supabase-js issues separate PostgREST calls; you cannot wrap `business row + app_events + audit +
handoff` in one transaction from JS. Use `runModuleMutation` / `emitFinanceMutationBackbone` (already
used across payroll) OR a Postgres RPC, with **compensating rollback** on satellite failure — never a
silent swallow. The existing run lifecycle already does compensating rollback; match that pattern.
(See [[module-service-adapter-pattern]], `lib/MUTATION_BACKBONE_PLAN.md`.)

## C7. Scale/jobs — Netlify has NO long-lived process
The async batch engine (§20) is the right shape, but Netlify Functions time out (sync ~10s, background
functions ~15 min) — there is **no persistent worker**. Implement the queue as **Supabase-table-backed
job/batch rows** driven by Netlify **background functions** and/or **`pg_cron`/scheduled** sweeps, with
`pg` advisory locks (or a unique in-flight row) for the "distributed lock". No in-memory queue, no
reliance on a single request finishing the run. Batches (250–500) each in their own invocation;
idempotent + resumable + correlation id. This is the biggest architecture risk — design it first.

## C8. Statutory values come from the ACTIVE VERSION (never constants)
The `annualPayPeriods` map is fine as a *period divisor*, but PAYE personal allowance, band ceiling,
band rates, NIS classes, HS thresholds must always be read from `finance_statutory_versions` /
`finance_nis_classes` at calculate time (already the case in `payrollStatutory.ts`). The T&T rule
"NIS/HS are NOT deducted before PAYE" must be preserved. NIS stays weekly-class based for all
frequencies. (See [[statutory-nis-model-reconciliation]], [[reference-nis-schedule-2026]].)

## C9. Legacy `routes/payroll.ts` — retire build-new → delete-legacy
It still powers some ESS/manager/LiveMap views (see [[finance-ui-and-legacy-hr]]). Don't extend it,
but don't hard-delete until the new submodules cover those surfaces — replace, then remove, no gap.

## C10. Naming + conventions
- Tables: `snake_case`, module-prefixed `finance_*`; `id uuid pk default gen_random_uuid()`;
  `created_at timestamptz not null default now()` + `updated_at` + trigger where mutable; **RLS on
  every table** (the spec's DDLs omit RLS — add it).
- Routes: POST-only, behind `requirePermission`, read `body.args ?? {}`, mounted in
  `netlify/functions/api.ts`.
- Every submodule ships a live E2E suite `scripts/e2e/suites/<name>.mjs` asserting §2 side-effects via
  the service-role client (not just HTTP 200). A module isn't "done" without it (CLAUDE.md).
- No hardcoded rates, no accept-and-drop, no half-wired controls (CLAUDE.md No-Band-Aids).

## Build order note
This is a large multi-wave program. Current active work is HR; per CLAUDE.md build-order, this
payroll expansion is a new phase that needs explicit user go and sequencing. Waves 1 (payslip PDF) and
2 (GL posting) are the highest-impact and safest to start; Wave 8 (async batch/scale) should be
**designed** early (C7) even if built last, because retrofitting it changes the calculation entry path.
