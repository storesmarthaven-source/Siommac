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

## Operator Migration Apply Order (2026-07-17)

Apply from the MAIN tree flow against the live DB, in this exact order. Every file below is
idempotent (`if not exists` / `create or replace`) and safe to re-apply over an earlier version.

**Step 0 — renumbering pre-check (required).** The payroll execution migrations were renumbered
410–415 → 420–425 (collision with the applied messaging `20260919000410`). Before applying, confirm
the target DB never received a manual 410–415 apply: the migration history must contain no payroll
rows numbered `20260919000411`–`415`, and `pg_proc` must not already contain
`finance_payroll_create_run_tx` / `finance_payroll_finding_command_tx` / `finance_payroll_lock_run_tx`
from an earlier apply. If any exist, STOP — reconcile deliberately from the 420–425 source (drop and
re-create) rather than applying on top of drifted identities.

Corrected source migrations first (re-apply even if a prior version ran):

1. `supabase/migrations/20260804000000_finance_payroll_runs.sql`
2. `supabase/migrations/20260804000002_finance_payslips_exports.sql`
3. `supabase/migrations/20260805000000_finance_remittances.sql`
4. `supabase/migrations/20260808000001_finance_disbursements.sql`
5. `supabase/migrations/20260918000040_finance_pay_groups.sql`
6. `supabase/migrations/20260918000090_finance_employee_loans.sql` — only if never applied
   (prerequisite: `finance_loan_deductions` with `unique(loan_id, run_id)`)
7. `supabase/migrations/20260918000130_finance_loan_ledger_settlement.sql` — VERIFY applied:
   the reopen RPC in 423 reads `finance_loan_deductions.entry_type`, which this adds
   (previously flagged unapplied — payrollLoans ran 14/15 because of it)
8. `supabase/migrations/20260918000140_finance_payroll_gl_atomic.sql`
9. `supabase/migrations/20260918000141_finance_payroll_gl_reverse_tx.sql`

Then the execution migrations in strict numeric order (NOT the withdrawn 410–415 numbering — those
collided with the applied messaging migration `20260919000410`):

10. `supabase/migrations/20260919000420_finance_payroll_execution_foundation.sql`
11. `supabase/migrations/20260919000421_finance_payroll_execution_commands.sql`
12. `supabase/migrations/20260919000422_finance_payroll_finding_commands.sql`
13. `supabase/migrations/20260919000423_finance_payroll_lock_reopen_tx.sql`
14. `supabase/migrations/20260919000424_finance_payroll_certification_release_tx.sql`
15. `supabase/migrations/20260919000425_finance_payroll_export_tx.sql`

After apply: `NOTIFY pgrst, 'reload schema';` (425 issues it, but re-run if applying files
individually), then `npm run build:backend` and restart `dev:netlify` before trusting any E2E.

## Viewing

Serve the package root over HTTP and open `mockups/payroll-enterprise/index.html`. The mockups are
static and require no build step.
