# <Module Name> E2E Traceability Matrix

**Contract:** `<path to delivery contract>`  
**Suite:** `scripts/e2e/suites/<module>.mjs`  
**Browser suite:** `<path or BLOCKED: runner not established>`

Every in-scope inventory ID must appear here. A route call without the assertions below is not
coverage.

## 1. API behavior

| API ID | Endpoint | Happy | No token | No permission | Out of scope | Validation/bounds | Not found | Invalid state | Exact response | Sensitive absence | Test names |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| API-XXX-001 | `/api/...` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | `<exact tests>` |

## 2. Read behavior

| API ID | Empty | Populated | Search | Filters | Clear filters | Sort | First/next/final page | Stable order | Max page size | Test names |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| API-XXX-001 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | `<exact tests>` |

## 3. Mutation integrity

| Mutation ID | Business row | Event exact count | Audit exact count | Workflow/tasks | Notification/message/ticket | Handoff | Same-key retry | Key conflict | Concurrent duplicate | Failure rollback | Illegal actor no-change | Test names |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| MUT-XXX-001 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | `<exact tests>` |

## 4. State-machine coverage

| State/transition ID | From | Action | To/expected error | Authorized actor | Unauthorized actor | Repeat | Stale/concurrent | Side effects | No orphan task | Test names |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|
| FSM-XXX-001 | draft | submit | pending | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | `<exact tests>` |

## 5. UI control coverage

| UI ID | Page/control | Visible for allowed role | Hidden/disabled for denied role | Action | Validation | Loading | Empty | Error | Success/failure toast | Cache refresh/rollback | Browser test |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| UI-XXX-001 | <control> | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | BUI-XXX-001 |

## 6. Cross-module and operational coverage

| ID | Scenario | Durable intent | Target processing | Retry | Duplicate delivery | Dead letter/operator view | Source finalizer | Test names |
|---|---|---:|---:|---:|---:|---:|---:|---|
| INT-XXX-001 | <scenario> | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | `<exact tests>` |

## 7. Cleanup coverage

| Created object/table | IDs tracked | `h.TAG` | Exact cleanup | Interrupted-run sweep | No real-user broad delete | Verified absent after run |
|---|---:|---:|---:|---:|---:|---:|
| `<table>` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

## 8. Coverage reconciliation

- [ ] Every contract UI ID appears here.
- [ ] Every contract API ID appears here.
- [ ] Every mutation ID appears here.
- [ ] Every legal transition appears here.
- [ ] Every permission/record gate appears here.
- [ ] Every side effect appears here.
- [ ] Every scheduled job/outbox flow appears here.
- [ ] Every target-module route is absent from `coverage-waivers.json`.
- [ ] No `.skip`, `.todo`, `.only`, placeholder assertion, or arbitrary retry exists.
- [ ] Every row names an exact test.

Uncovered rows block completion unless the user accepts a time-bound deferral in the delivery
contract.

