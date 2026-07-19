# Payroll Runs Register — Slice Contract (spec §15.1/§15.2)

Vertical slice built per PAYROLL_TECHNICAL_IMPLEMENTATION.md §15.7 (contract → schema/query → route →
client → page → E2E). **This document is frozen before implementation.** Backend is built and E2E-green
first, then a review pause **before** the frontend.

Isolation: branch `wf/payroll-runs-register` (worktree). Does not touch the active Command Center or
Compliance files.

## Endpoints (this slice)

| Endpoint | Permission | Purpose |
|---|---|---|
| `finance/payroll/runs/list` | `finance.payroll.view_all` | The **only** run-register authority — keyset page + tab counts + readiness. |
| `finance/payroll/run-views/list` | `finance.payroll.view_all` | Saved filter views visible to the caller (own personal + team). |
| `finance/payroll/run-views/create` | `finance.payroll.view_all` (+ `finance.payroll.run_views.manage_team` for team scope) | Persist a validated filter set. |
| `finance/payroll/run-views/update` | owner, or team-manage for team views | Rename / re-filter. |
| `finance/payroll/run-views/delete` | owner, or team-manage for team views | Remove. |
| `finance/payroll/runs/calendar` | `finance.payroll.view_all` | Scheduled calendar instances derived from pay-group schedule + linked run ids. |

## Reuse (no duplication)

- **Readiness/classification**: `controlCenterDerive.registerReadinessState(status, blockerCount)` is the
  ONE source. `runs/list` blocker/warning counts use the same current-calculation-version findings rule
  as the Command Center register (`finance_payroll_control_center`). No second readiness switch.
- **Vocabulary**: `PayrollRunType`, `ReadinessState`, `MoneyValue` imported from
  `types/payrollControlCenter.ts`.
- **runs/list** is EXTENDED (not forked): the existing basic `listPayrollRuns` (status/limit/offset) is
  replaced in-place by the §15.2 keyset contract on the same route. No parallel list route.

## Decisions to review at the pause

1. **Archive/retention DEFERRED.** The runs table has no archive/retention columns. We do NOT fake them
   (no accept-and-drop). `PayrollRunListRequest` omits `archive`; the item omits `archivedAt`/`retentionUntil`.
   Default excludes `cancelled`; `states: ['cancelled']` surfaces them. A real archive model is a later slice.
2. **Tabs are register-derived, not stored.** `all / in_progress / approval / attention / released`
   computed server-side over the current filter scope (independent of active tab), mirroring the Command
   Center tab semantics (attention = open blockers / failed / returned / overdue task).
3. **Calendar is schedule-derived, not run-scan.** Instances come from active pay groups' `frequency` +
   `default_pay_day` + `default_cutoff_offset_days` across the bounded window, then linked to an existing
   scheduled run for that `(pay_group, period)` if present. Window span capped server-side (≤ 186 days).
4. **Team saved views cannot widen access.** A view only stores a `PayrollRunListRequest`; on read the
   request is re-validated and the caller's own `view_all` scope still gates the data. Team publish needs
   `finance.payroll.run_views.manage_team`.

## Control-to-contract checklist

| UI value/control | Response field / command | Permission | Allowed states | Success side effects | Failure/conflict | E2E |
|---|---|---|---|---|---|---|
| Register rows | `runs/list` → `items[]` (PayrollRunListItem) | `view_all` | any | none (read) | 400 bad filter; 403 unauth | list shape + filters + keyset |
| Tab counts | `runs/list` → `tabCounts` | `view_all` | any | none | — | exact counts per scope |
| Next page | `runs/list` → `nextCursor` (keyset) | `view_all` | any | none | 422 malformed/stale cursor | no dup/missing across pages |
| Readiness bar | `items[].readiness` (`registerReadinessState`) | `view_all` | any | none | — | matches CC classification |
| Saved views list | `run-views/list` → items | `view_all` | any | none | 403 | own + team returned |
| Save view | `run-views/create` | `view_all` (+team perm) | — | insert row + audit | 400 invalid filters; 403 team | create/persist filters |
| Team publish denied | `run-views/create` scope=team | needs team perm | — | — | 403 without team perm | negative |
| Edit/delete view | `run-views/update|delete` | owner/team | — | update/delete + audit | 404 not owner; 409 stale | owner-only guard |
| Calendar cells | `runs/calendar` → `instances[]` | `view_all` | any | none | 400 window too wide | schedule-derived + linked run |
| Empty scheduled cell | `instances[].run = null` | `view_all` | — | none | — | instance with no run yet |

## Data

- New table `finance_payroll_run_views` (RLS, service-role grant, indexes). No changes to
  `finance_payroll_runs` in this slice.
- Read-only for `runs/list` and `runs/calendar` (no business mutation).

## Gates before pause

- `tsc` backend + frontend typecheck green.
- Focused E2E suite `scripts/e2e/suites/payrollRunsRegister.mjs` green against the live stack.
- `npm run repo:index` + coverage gate not regressed.
