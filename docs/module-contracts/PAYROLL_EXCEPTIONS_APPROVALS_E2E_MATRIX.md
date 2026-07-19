# Payroll Exceptions & Approvals E2E Traceability Matrix

**Contract:** `docs/module-contracts/PAYROLL_EXCEPTIONS_APPROVALS_DELIVERY_CONTRACT.md`
**Suite:** `scripts/e2e/suites/payrollExceptions.mjs`
**Browser suite:** BLOCKED — FE `PayrollExceptionQueuePage` deferred (DEC-EXC-006)

Every in-scope inventory ID from the contract appears here. A route call without the listed
assertions is not coverage. Test names are the exact `test('…')` strings the suite will register.

## 1. API behavior

| API ID | Endpoint | Happy | No token | No perm | Out of scope | Validation/bounds | Not found | Invalid state | Exact response | Sensitive absence | Test names |
|---|---|---|---|---|---|---|---|---|---|---|---|
| API-EXC-001 | `findings/work-queue` | ☐ | ☐ | ☐ | ☐ | ☐ | n/a | n/a | ☐ | ☐ | `work-queue — returns items+tabCounts for finance_manager`; `work-queue — 401 without token`; `work-queue — 403 for employee`; `work-queue — malformed cursor → 422`; `work-queue — limit > 100 rejected`; `work-queue — item shape matches PayrollFindingQueueItem`; `work-queue — no displayName-only leak (no raw PII columns)` |
| API-EXC-002 | `findings/get` (detail+activity) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | n/a | ☐ | ☐ | `get — returns PayrollFindingDetail incl. activity page`; `get — 403 for employee`; `get — unknown id → 404`; `get — activity keyset paginates` |
| API-EXC-003 | `findings/escalate` | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | n/a | `escalate — manager escalates → in_progress + reassigned`; `escalate — 403 for finance_staff`; `escalate — unknown id → 404`; `escalate — stale expectedVersion → 409`; `escalate — missing assigneeId → 422` |
| API-EXC-004 | `findings/comment` | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | n/a | ☐ | n/a | `comment — staff can comment (view_all)`; `comment — 403 for employee`; `comment — unknown id → 404`; `comment — empty body → 422`; `comment — does NOT bump finding version` |

## 2. Read behavior (work-queue)

| API ID | Empty | Populated | Search | Filters | Clear filters | Sort | First/next/final page | Stable order | Max page size | Test names |
|---|---|---|---|---|---|---|---|---|---|---|
| API-EXC-001 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `work-queue — empty when no findings match filter`; `work-queue — tab=blockers returns only blocker kind`; `work-queue — tab=approvals returns only approval-kind rows`; `work-queue — states filter restricts to requested`; `work-queue — search matches title/summary`; `work-queue — keyset paginates with no dup/missing`; `work-queue — tabCounts match seeded set (lower bounds)`; `work-queue — deterministic order across pages` |

## 3. Mutation integrity

| Mutation ID | Business row | Event x count | Audit x count | Workflow/tasks | Notification | Handoff | Same-key retry | Key conflict | Concurrent dup | Failure rollback | Illegal actor no-change | Test names |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MUT-EXC-001 (escalate) | ☐ | ☐ (`finance.payroll.finding.escalate` ×1) | ☐ (×1) | ☐ (writes **zero** workflow rows) | ☐ (assignee ×1) | ☐ (none) | ☐ | ☐ | ☐ | ☐ | ☐ | `escalate — writes exactly 1 event + 1 audit + 1 activity`; `escalate — same idempotencyKey returns original, no 2nd event/activity`; `escalate — writes no workflow_tasks/decisions`; `escalate — notifies new assignee once`; `escalate — staff actor blocked, no side effects` |
| MUT-EXC-002 (comment) | ☐ | ☐ (`finance.payroll.finding.comment` ×1) | ☐ (×1) | ☐ (none) | ☐ (owner ×1) | ☐ (none) | ☐ | n/a | ☐ | ☐ | ☐ | `comment — writes exactly 1 activity + 1 audit + 1 event`; `comment — retry same key writes no 2nd activity`; `comment — finding version unchanged`; `comment — notifies run owner once (skip when actor==owner)` |
| MUT-EXC-003 (existing cmds now write activity) | ☐ | ☐ (existing ×1) | ☐ (×1) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `assign — now writes an activity row`; `resolve — writes activity(resolve)`; `waive — writes activity(waive)`; `reopen — writes activity(reopen); state back to open` |

## 4. State-machine coverage

| ID | From | Action | To/error | Authorized | Unauthorized | Repeat | Stale/concurrent | Side effects | No orphan task | Test names |
|---|---|---|---|---|---|---|---|---|---|---|
| FSM-EXC-002 | open/in_progress | escalate | in_progress | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `escalate — manager escalates → in_progress + reassigned`; `escalate — staff → 403` |
| FSM-EXC-003 | open/in_progress | resolve | resolved | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `resolve — → resolved + activity` |
| FSM-EXC-004 | open/in_progress | waive | waived | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `waive — warning → waived` |
| FSM-EXC-005 | resolved/waived | reopen | open | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | `reopen — resolved → open + activity(reopen)` |
| FSM-EXC-006 | any | comment | no state change | ☐ | ☐ | ☐ | n/a | ☐ | ☐ | `comment — no state change; activity appended` |
| FSM-EXC-101 | resolved | resolve | 409 | ☐ | — | ☐ | ☐ | ☐ | — | `resolve — already resolved → 409, no new event` |
| FSM-EXC-102 | severity=blocker | waive | 422 | ☐ | — | — | — | ☐ | — | `waive — blocker not waivable → 422, no activity` |
| FSM-EXC-103 | open | reopen | 409 | ☐ | — | — | — | ☐ | — | `reopen — open finding → 409` |
| FSM-EXC-104 | any | any state cmd (stale version) | 409 (+current version/state) | ☐ | — | — | ☐ | ☐ | — | `command — stale expectedVersion → 409 with current version` |

## 5. UI control coverage

DEFERRED — FE out of scope (DEC-EXC-006). No UI IDs claimed. To be added in the FE slice's matrix.

## 6. Cross-module and operational coverage

| ID | Scenario | Durable intent | Target processing | Retry | Duplicate delivery | Dead letter/operator view | Source finalizer | Test names |
|---|---|---|---|---|---|---|---|---|
| INT-EXC-001 | approval-kind row surfaces a real workflow task | n/a (read-only) | ☐ (task id present, `allowedActions:['review']`) | n/a | n/a | n/a | n/a | `work-queue — approval row exposes workflow task id + review-only`; `work-queue — reading approvals writes NO workflow rows` |
| INT-EXC-002 | command notification | ☐ (notify best-effort) | ☐ (notifications row) | n/a | ☐ (dedupeKey blocks dup) | log | n/a | `escalate — notification row asserted`; `comment — owner notification asserted` |

## 7. Cleanup coverage

| Created object/table | IDs tracked | `h.TAG` | Exact cleanup | Interrupted-run sweep | No real-user broad delete | Verified absent after run |
|---|---|---|---|---|---|---|
| `finance_payroll_finding_activity` | ☐ | ☐ | ☐ (FK-cascades from findings/runs; assert absent) | ☐ (payroll chain in sweep-orphans owns parent runs) | ☐ | ☐ |
| `finance_payroll_control_findings` (seeded) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| `finance_payroll_runs` (seeded parents) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| `app_events` / `hr_audit_log` / `notifications` | ☐ | ☐ | ☐ (by source/run ids) | ☐ | ☐ | ☐ |

## 8. Coverage reconciliation

- ☐ Every contract API ID (EXC-001..004) appears here.
- ☐ Every mutation ID (MUT-EXC-001/002/003) appears here.
- ☐ Every legal transition (assign/escalate/resolve/waive/reopen/comment) appears here.
- ☐ Every illegal transition (FSM-EXC-101..104) appears here.
- ☐ Every permission/record gate (AUTH-EXC-001..003) appears here.
- ☐ Every side effect (event/audit/activity/notification exact counts) appears here.
- ☐ Approval read path asserts **zero** workflow writes (DEC-EXC-004 guard).
- ☐ No new route left out of `coverage-waivers.json` handling (work-queue/escalate/comment added to suite).
- ☐ No `.skip`/`.todo`/`.only`/placeholder assertion.
- ☐ Every row names an exact test.

UI/browser rows are the only intentionally-uncovered items; the user accepted FE deferral
(DEC-EXC-006). All backend rows above must be green before this slice is called complete.
