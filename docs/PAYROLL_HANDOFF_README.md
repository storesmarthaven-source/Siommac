# SIOMAC Payroll Mockup and Implementation Handoff

This package contains the approved payroll mockup pages and the current code-reconciled technical
implementation. It is intended for implementation work in the SIOMAC repository, not as a
standalone production application.

## Read First

1. `documentation/PAYROLL_TECHNICAL_IMPLEMENTATION.md`
2. `documentation/PAYROLL_ENTERPRISE_SPEC_CORRECTIONS.md`
3. `documentation/PAYROLL_MOCKUP_COVERAGE.md`
4. `documentation/FEATURE_MATRIX.md`
5. `documentation/PAYROLL_TT_ASSESSMENT.md`

The technical implementation's **Current Code Reconciliation** section overrides stale statements
in older assessments. Claude must still read the current repository source and
`docs/generated/modules/payroll.md` before changing code.

## Mockup Pages

| Page | Purpose |
|---|---|
| `mockups/payroll-enterprise/index.html` | Payroll command center |
| `mockups/payroll-enterprise/runs.html` | Payroll run register and calendar |
| `mockups/payroll-enterprise/create-run.html` | Run creation wizard |
| `mockups/payroll-enterprise/run.html` | Payroll processor workspace |
| `mockups/payroll-enterprise/approval.html` | Independent approval workspace |
| `mockups/payroll-enterprise/failed.html` | Failed calculation recovery |
| `mockups/payroll-enterprise/exceptions.html` | Cross-run findings and approval queue |
| `mockups/payroll-enterprise/close-run.html` | Close, lock, outputs and release certificate |
| `mockups/payroll-enterprise/payslips.html` | Payslip batch portfolio |
| `mockups/payroll-enterprise/payslip-batch.html` | Payslip batch workspace |
| `mockups/payroll-enterprise/reports.html` | Payroll reports center |
| `mockups/payroll-enterprise/dialogs.html` | Payroll dialogs, errors and command states |
| `mockups/payroll-enterprise/crew-packages.html` | Payroll Setup pay-policy directory |
| `mockups/payroll-enterprise/create-crew-package.html` | Pay-policy wizard |
| `mockups/payroll-enterprise/crew-package.html` | Pay-policy detail and version governance |
| `mockups/payroll-enterprise/crew-run.html` | Standard run with conditional crew controls |

The `crew-*` filenames are retained because the HTML links depend on them. Their visible product
language is **Pay Policies**, supporting normal, shift, project, offshore and marine payroll. Expat
and multi-currency payroll remain out of scope.

## Package Cleanup

Discarded design-option galleries, animation experiments, reference screenshots, and duplicate
implementation documents are intentionally excluded. The package preserves only the usable pages,
their shared CSS/JavaScript, and current implementation documentation.

## Current Implementation Status

Completed in source:

- Replaced global `period_month` identity with explicit multi-run business keys.
- Corrected scale-suite command keys and isolated payslip fixtures from real pay-group assignments.
- Added durable attempts, immutable versions, controlled failure recovery and operational findings.
- Added atomic certification, funding, release, GL, immutable export and download commands.
- Added T&T contribution-period remittances, frozen bank routing evidence and release certificates.
- Preserved cancelled bank-disbursement and statutory-remittance history while allowing exactly one
  active replacement after owner-controlled cancellation.
- Corrected export integrity storage: public `checksum` is SHA-256, internal `content_md5` is MD5,
  and downloads verify size plus both hashes.

Still required before production implementation is called complete:

- Apply the corrected source migrations and migrations `20260919000420` through
  `20260919000425`, rebuild the backend and restart the live development server.
- Port the frontend API signatures to the required caller-owned idempotency keys and add clients
  for workspace, evidence, findings, certification, funding, release and release certificates.
- Run the affected payroll E2E suites against the live stack, then one complete regression run.
- Harden the separate Bank Disbursements and Statutory Remittances manual create/cancel commands
  with atomic, idempotent RPCs and shared payroll-run serialization. Payroll must continue to block
  reopen while either module has active artifacts; the owning module performs cancellation.
- ~~Statutory unit-test discovery gap~~ — resolved 2026-07-17: `tests/unit/payrollStatutory.test.ts`
  is a Jest test by repo convention (`tests/**` = Jest, `src/**` = Vitest); Jest discovers it and
  all 25 cases pass (`npx jest tests/unit/payrollStatutory.test.ts`).

Do not weaken production idempotency, workflow-assignment or pay-group-overlap controls to make an
old test pass.

## Operator Migration Apply Order (2026-07-17, rev 2)

There are TWO distinct paths. Choose by target. **Do NOT re-apply the corrected table-definition
source migrations on an existing database** — they use `create table if not exists`, which no-ops on
an existing table without adding the new columns, and their subsequent index statements
(`finance_payroll_runs_period_range_idx` on `period_start, period_end`; the pay-group business-key
indexes in `20260918000040`) then fail with `column does not exist`. Migration 420 states in its own
header that IT is the forward upgrade for existing installations, and it retrofits everything the
corrected sources define: all new run columns, the old month-uniqueness drop, the
scheduled/sequence business keys, and the one-active disbursement/remittance partial indexes.

**Step 0 — renumbering pre-check (required, both paths).** The payroll execution migrations were
renumbered 410–415 → 420–425 (collision with the applied messaging `20260919000410`). Confirm the
target DB never received a manual 410–415 apply: the migration history must contain no payroll rows
numbered `20260919000411`–`415`, and `pg_proc` must not already contain
`finance_payroll_create_run_tx` / `finance_payroll_finding_command_tx` /
`finance_payroll_lock_run_tx` from an earlier apply. If any exist, STOP — reconcile deliberately
from the 420–425 source (drop and re-create) rather than applying on top of drifted identities.

### Path A — EXISTING database (the live dev DB)

1. **Prerequisite check** (schema preflight, do not skip):
   - `finance_loan_deductions` exists with `unique(loan_id, run_id)` (from `20260918000090`;
     if the loans tables are missing entirely, apply 090 once — note 090 is NOT generally
     rerunnable: its trigger is created without a preceding drop).
   - `finance_loan_deductions.entry_type` exists (from `20260918000130` — previously flagged
     unapplied; the reopen RPC in 423 reads it; apply 130 if missing, it is idempotent).
   - `finance_remittances.period_year` / `period_month` exist (original `20260805000000` — live
     since the remittances build; 420's partial index depends on them).
2. Apply the execution migrations in strict numeric order:
   `20260919000420` → `421` → `422` → `423` → `424` → `425` → `426` → `427`.
   (426/427 carry the execution-aligned GL command RPCs. They intentionally live AFTER 420
   because their functions declare `finance_payroll_calculation_versions%rowtype`, which
   PostgreSQL resolves at CREATE time — the table must already exist. The historical
   `20260918000140`/`141` files are untouched; they stay exactly as applied.)
3. `NOTIFY pgrst, 'reload schema';` (425 issues it, but re-run if applying files individually),
   then `npm run build:backend` and restart `dev:netlify` before trusting any E2E.

### Path B — CLEAN install / full rebuild

Apply ALL of `supabase/migrations/` in normal timestamp order. The corrected source files
(`20260804000000`, `20260804000002`, `20260805000000`, `20260808000001`, `20260918000040`) define
the corrected schema from scratch; the original `20260918000140`/`141` create the first-generation
GL RPCs (valid pre-420 — they reference nothing from the execution model); 420–425 then run as
guarded no-ops for the retrofit parts and create the execution tables/RPCs; finally
`20260919000426`/`427` replace the GL RPCs with the execution-aligned versions. Plain timestamp
order is therefore valid end-to-end. No file may be skipped or reordered.

## Viewing

Serve the package root over HTTP and open `mockups/payroll-enterprise/index.html`. The mockups are
static and require no build step.
