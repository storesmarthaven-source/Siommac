# Payroll Pay-Policy Setup E2E Traceability Matrix

| ID | Behavior | Executable test |
|---|---|---|
| APIE-PPS-001 | List: auth, permission, exact page shape, search/status/cursor/final page/empty | `payrollPayPolicies: list contract and bounded cursor filters` |
| APIE-PPS-002 | Get: exact workspace fields, missing 404, sensitive fields absent | `payrollPayPolicies: detail workspace contract` |
| APIE-PPS-003 | Create: strict enums/unknown fields/bounds/idempotency and exact effects | `payrollPayPolicies: create draft is strict and exactly once` |
| APIE-PPS-004 | Update: token concurrency, typed rule combinations, immutable state | `payrollPayPolicies: update draft enforces compatibility and optimistic concurrency` |
| APIE-PPS-005 | Preflight: exact blockers/warnings/checksum and inactive dependencies | `payrollPayPolicies: preflight proves complete governed configuration` |
| APIE-PPS-006 | Submit: certifications, SoD, workflow/tasks/events/audit, retry/conflict | `payrollPayPolicies: submit starts one central workflow atomically` |
| APIE-PPS-007 | Activate: approved-only, creator denied, concurrent winner, supersession/effects | `payrollPayPolicies: independent activation is atomic and effective-dated` |
| APIE-PPS-008 | Reject: assigned reviewer only, reason, terminal tasks, exact transition effects | `payrollPayPolicies: workflow rejection preserves evidence` |
| APIE-PPS-009 | Retire: reason/date, assignment closure, exact effects/idempotency | `payrollPayPolicies: retirement closes future use atomically` |
| APIE-PPS-010 | Versions list/get: immutable shape and bounds | `payrollPayPolicies: version history is bounded and immutable` |
| APIE-PPS-011 | Compare: field/component/source diff and no-change state | `payrollPayPolicies: version comparison is server-derived` |
| APIE-PPS-012 | Assign: active-only, overlap rejected, boundary resolution, effects/retry | `payrollPayPolicies: pay-group assignment is effective-dated and exactly once` |
| APIE-PPS-013 | End assignment: state/date/reason gates and effects | `payrollPayPolicies: assignment end preserves history` |
| APIE-PPS-014 | Copy version: published source, single unpublished version, exact copied rules/effects/idempotency | `payrollPayPolicies: new version is an atomic governed copy` |
| AUTH-PPS-001 | No token is 401 for every new path | `payrollPayPolicies: all policy endpoints require authentication` |
| AUTH-PPS-002 | Real employee receives 403 for every new path | `payrollPayPolicies: employee role is denied` |
| AUTH-PPS-003 | Finance/HR review permissions and non-assignee negative paths | `payrollPayPolicies: review permissions and assignment are enforced` |
| FSM-PPS-001 | All legal edges and response states | `payrollPayPolicies: full lifecycle draft through retirement` |
| FSM-PPS-101 | Illegal/repeat/stale/concurrent edges leave state/effects unchanged | `payrollPayPolicies: illegal transitions are side-effect free` |
| MUT-PPS-001 | Draft create event/audit/receipt exact count | `payrollPayPolicies: create draft is strict and exactly once` |
| MUT-PPS-002 | Update event/audit/receipt exact count | `payrollPayPolicies: update draft enforces compatibility and optimistic concurrency` |
| MUT-PPS-003 | Submit business/workflow event/audit/task exact counts | `payrollPayPolicies: submit starts one central workflow atomically` |
| MUT-PPS-004 | Workflow source transition exact count and retry | `payrollPayPolicies: workflow rejection preserves evidence` |
| MUT-PPS-005 | Activation event/audit/notification/handoff exact counts | `payrollPayPolicies: independent activation is atomic and effective-dated` |
| MUT-PPS-006 | Assignment event/audit/handoff exact counts | `payrollPayPolicies: pay-group assignment is effective-dated and exactly once` |
| MUT-PPS-007 | End event/audit exact counts | `payrollPayPolicies: assignment end preserves history` |
| MUT-PPS-008 | Retire event/audit/notification/handoff exact counts | `payrollPayPolicies: retirement closes future use atomically` |
| MUT-PPS-009 | Copy-version business rows/event/audit/receipt exact counts | `payrollPayPolicies: new version is an atomic governed copy` |
| BUI-PPS-001 | Authorized navigation; loading/empty/error/populated/forbidden | `Payroll Pay Policies browser: directory states` |
| BUI-PPS-002 | Search/status/pagination/clear | `Payroll Pay Policies browser: directory controls` |
| BUI-PPS-003–009 | Wizard validation, cancellation, save, resume, preflight, submit/toasts | `Payroll Pay Policies browser: governed wizard` |
| BUI-PPS-010–012 | Detail tabs, create version, compare | `Payroll Pay Policies browser: detail and versions` |
| BUI-PPS-013–017 | Assignment, activation, reject, retire, permission-hidden controls | `Payroll Pay Policies browser: governed actions` |
| CLEAN-PPS-001 | Exact business/platform cleanup; no tagged leak | `payrollPayPolicies: cleanup verification` |
