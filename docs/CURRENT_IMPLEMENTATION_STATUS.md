# Current Implementation Status

**This document is the single source of truth for repository authority.** `AGENTS.md`,
`ARCHITECTURE.md` and `CLAUDE.md` point here rather than restating any of it. Update it
whenever implementation authority changes — do not let a second document start declaring
which branch is current.

| | |
|---|---|
| Last verified | 2026-08-05 |
| Verified commit | `10668d3a` |
| Active implementation branch | `codex/employee-profile-s1` |
| Superseded branch | `codex/hr-employee-master-improvements` — **preserved**, do not delete without explicit authorisation |

## Active workstreams

- HR Employee Master
- HR Onboarding
- Email Template Studio
- Dashboard and widget platform
- Calendar

These share one branch and are largely uncommitted work in progress. Verify with
`git status --short` before assuming anything about the working tree.

## Canonical specifications

- **SIOMAC ERP Build-Ready Technical Implementation Specification** — the authority all
  decisions defer to.
- `docs/REPO_MAP.md` — curated architecture, conventions, ownership boundaries, hotspots.
- `docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md` — required before building or substantially
  expanding a module.
- `docs/generated/` — deterministic inventory. **Navigation aid, not authority.** Never
  hand-edit; regenerate with `npm run repo:index`.
- Module contracts under `docs/module-contracts/`.

## Completed capabilities

Platform backbone, Communications, HSE-core migrations, and the HR/Finance module build-out
are complete and green. Per-module detail belongs in the module contract for that module,
not here.

## Active implementation work

HR Onboarding and its dashboards/widgets, alongside the workstreams listed above.

## Known defects and blockers

- **Migration history is not reconciled.** `supabase migration list` reports almost every
  local migration as absent from remote history, so `supabase db push` would attempt to
  replay hundreds of migrations. **Do not run it.** See *Migration state* below.
- **The live schema has been changed without an attributable apply event** (2026-08-05).
  Treat "applied" state in this environment as unverified and re-run the probes in
  `docs/module-contracts/PROBATION_AUDIT_BASELINE_2026-08-05.md` rather than trusting
  migration history.
- **`hr_onboarding.work_email_domain` is deliberately unset**, pending organisation
  confirmation of the production work-email domain. Account provisioning stays visibly
  blocked until it is set; it must never silently generate an address.
- Known unrelated unit-test reds on the active branch: `emailTemplates.dev.test.ts` (×2) and
  `EmployeeProfilePage.test.tsx` (×1). Confirm against the parent commit before attributing
  them to new work.

## Protected records and fixtures

- **`ONB-2026-0645`** (employee `USR-40397F16`) — retained QA verification case. **Do not
  purge.** It predates the probation pre-image fix, so the employee's prior
  `probation_end_date` is unknown and the case is the only remaining business context for an
  employee mutation that cannot be safely reversed. Removable only once an authoritative
  prior value exists, and only through `hr/employees/probation/correct`.
- Two synthetic E2E users (`…_gfm`, `…_ppr_hr`) remain FK-blocked by append-only payroll
  evidence and `work_calendar_command_receipts`.

## Migration state

| Migration | State |
|---|---|
| `20261005000000_app_setting_values_scope_uniqueness` | **Applied** |
| `20261006000000_hr_onboarding_access_work_parity` | **Unapplied / pending** — blocks one E2E access-parity assertion |
| `20261004000000_hr_employee_probation_correction` | **Applied** — verified behaviourally (function body reached, anon denied, grants present) |
| `20260804024501_hr_onboarding_atomic_launch` | **Applied**, including the probation pre-image revision |

Known anomalies, to be resolved by the migration-reconciliation workstream, **not**
opportunistically:

- **180 migrations carry future timestamps** (2026-09 onward) against a current date of
  2026-08-05. `20261005000000` is already applied, so `20261006000000` must **not** be
  renamed to an August timestamp — that would sort it before a migration already present in
  remote history. Preserve the sequence and document the anomaly.
- **7 duplicate version prefixes**: `20260629000000`, `20260710000000`, `20260804000000`,
  `20260919000220`, `20260919000380`, `20260919000440`, `20260919000441`.
- One non-standard filename lacking a valid 14-digit prefix, and `_apply_*` operational
  scripts sitting in the migrations directory.

**Migration changes are frozen** until the reconciliation ledger is complete: no new
migration files, no unreviewed `db push`, no renaming duplicates, no deleting `_apply_*`.

## Superseded documentation

- The HSE-centred build order formerly in `AGENTS.md` — describes the backbone-era
  programme, not current work.
- The machine-specific worktree rule formerly in `AGENTS.md` — hard-coded one developer's
  absolute path and a superseded branch.
- Any statement in `ARCHITECTURE.md` that HR or Finance are merely planned.

## Required verification commands

```bash
git status --short
git branch --show-current
npm run repo:index:check
npm run typecheck
npx vitest run
npm run test:e2e -- <module>
```

`repo:index:check` must pass **after** committing, from a clean checkout — not only before.
The generator indexes tracked and staged files only, so new source files must be `git add`ed
before `npm run repo:index`.
