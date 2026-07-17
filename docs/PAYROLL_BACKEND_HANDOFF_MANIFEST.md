# Payroll Backend Handoff Manifest

Snapshot date: 2026-07-17

Source worktree:
`C:\Users\MSI Laptop\Desktop\Siomac\.Codex\worktrees\wonderful-panini-34b331`

Source branch: `Codex/wonderful-panini-34b331`

## Purpose

This package is the review and implementation handoff for the payroll execution control plane.
It contains the corrected source migrations, migrations 420-425, backend command/query services,
the Finance Payroll route, payroll E2E coverage and implementation documentation.

The package is a source snapshot, not a database backup and not proof that migrations were applied.
Review and merge it against the current repository; do not overwrite newer concurrent work blindly.

## Included Behavior

- Explicit multi-run payroll identity and effective-dated pay-group population.
- Frozen input snapshots and immutable calculation versions.
- Durable calculation attempts with controlled failure and recovery.
- Versioned operational findings with assignment, resolution, waiver and reopen commands.
- Final lock and governed reopen with downstream ownership gates.
- Processor certification, funding confirmation, release preflight and three-way segregation of
  duties.
- Immutable release certificate, bank-routing evidence, T&T contribution-period remittances,
  downstream drafts and durable handoffs.
- Balanced GL posting/reversal through the canonical transactional path.
- Immutable, versioned exports with public SHA-256, internal MD5 and verified downloads.
- E2E coverage for blocker/failure/recovery, idempotency, conflict, side effects and cancelled
  downstream history followed by one active replacement.

## Explicitly Excluded

- Production UI implementation. Claude owns the widget-board main pages and non-widget wizards.
- Payroll mockup HTML/CSS. Those assets remain in Claude's separate worktree and existing mockup
  package; this isolated backend worktree does not contain them.
- `src/api/finance/payroll.ts`. Its current signatures are stale and must be ported as one coherent
  frontend contract slice using caller-owned idempotency keys.
- Messenger, Realtime, HSE and account-security work.
- Secrets, `.env`, build output, dependencies and database dumps.
- Standalone Bank Disbursements and Statutory Remittances command rewrites. Those modules retain
  ownership of cancellation/payment/filing/reconciliation and need separate atomic/idempotent
  hardening.

## Verification Recorded

Green in this worktree:

- `npm run typecheck:backend`
- `node --check scripts/e2e/suites/financePayroll.mjs`
- `npm run test:e2e:payroll-contract`
- `npx jest tests/unit/permissions.drift.test.ts tests/unit/permissionMeta.sync.test.ts --runInBand`
- `npx vitest run src/lib/permissions.test.ts` (25 tests)
- Route/catalogue static reconciliation: all 259 enforced route keys are catalogued.
- Frontend permission/metadata reconciliation: 431 catalogue keys and 431 metadata entries, with
  no missing or extra keys.
- Focused `git diff --check`
- Migration delimiter checks for 420-425
- Constraint regression check: the old full remittance uniqueness is dropped and never recreated;
  the partial one-active-period index remains.

Not run or not green:

- Live payroll E2E: blocked because this isolated worktree has no `.env`, no dev server and no
  applied 420-425 migration state.
- Full E2E regression: run once only after the focused live payroll suites pass.
- Frontend typecheck: currently blocked by the existing `ReactGridLayout`/Preact type mismatch in
  `src/ui/widgets/WidgetBoardZone.tsx` at lines 240 and 251. This payroll backend slice did not edit
  that file.
- `npm run repo:index:check`: blocked by a repository-wide stale generated index that includes
  concurrent non-payroll work.
- `npm run test:e2e:coverage`: blocked because it requires the same current generated index.
- `tests/unit/payrollStatutory.test.ts`: not discovered by current Vitest configuration because
  `tests/**` is excluded.

## Claude Review Order

1. Read `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md`.
2. Review corrected source migrations before migrations 420-425.
3. Review the RPCs against their TypeScript wrappers and route schemas.
4. Review `scripts/e2e/suites/financePayroll.mjs` as the executable contract.
5. Apply migrations to a disposable development database in order.
6. Rebuild/restart the backend and run the focused payroll suites.
7. Port the frontend API and UI only after backend contracts are proven.
8. Regenerate the repository index after concurrent work is integrated, then run coverage and the
   one final full E2E gate.

## Required Live Acceptance

Do not call this slice complete until the live suite proves:

- A failed/null operation leaves the prior run state and current evidence pointers unchanged.
- Same-key retry returns the original result without duplicate rows or side effects.
- Same key with different input returns `409`.
- Concurrent commands have one winner.
- Exact app-event, audit, notification and handoff/outbox counts.
- Reopen refuses active disbursement/remittance artifacts.
- Owner-controlled cancellation preserves history and permits one active replacement on a later
  release.
- T&T NIS is employee/contribution-period correct and PAYE/Health Surcharge dates are correct.
- Release and export segregation-of-duty and immutability controls hold.
