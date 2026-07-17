# <Module Name> Delivery Contract

**Owner:** <name/role>  
**Status:** Designed | Implemented | Live-verified | Regression-verified | Released | Blocked  
**Branch/HEAD:** <branch> / <sha>  
**Database target:** <local/shared-dev/staging/production>  
**Approved scope date:** <ISO date>

This contract is required by `docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md`. Replace every
placeholder. Delete non-applicable rows only after stating why they are not applicable.

## 1. Objective

- Business problem:
- Measurable outcome:
- Primary personas:
- Secondary personas:
- Regulatory/statutory authority and effective date:
- Trinidad and Tobago constraints:

## 2. Scope

### In scope

- <journey>

### Explicit non-goals

- <feature and reason>

### Dependencies

| Dependency | Owner | Contract | Failure behavior |
|---|---|---|---|
| <workflow/communications/tickets/etc.> | <module> | <endpoint/event> | <behavior> |

## 3. Current-state verification

| Item | Evidence |
|---|---|
| Repository root | `<absolute path>` |
| Branch/HEAD | `<branch>` / `<sha>` |
| Existing changes | `<git status summary>` |
| Running server CWD/build | `<proof>` |
| Migration state | `<proof>` |
| Existing pages/routes/suites | `<paths>` |

## 4. UI inventory

| ID | Page/control | Persona | Permission | Behavior | Endpoint/local action | Validation/states | E2E ID |
|---|---|---|---|---|---|---|---|
| UI-XXX-001 | <control> | <persona> | <permission> | <result> | API-XXX-001 | <rules> | BUI-XXX-001 |

Inventory every:

- Page and tab.
- Button/link/row menu/bulk action.
- Dialog/drawer/wizard step.
- Field and picker.
- Search/filter/sort/pagination control.
- Import/export/upload/download action.
- Empty/loading/error/disabled/success state.

## 5. API inventory

| ID | Method/path | Route file | Permission | Record gate | Request schema | Response schema | Errors | E2E IDs |
|---|---|---|---|---|---|---|---|---|
| API-XXX-001 | POST `/api/...` | `<file>` | `<key>` | `<scope>` | `<schema>` | `<DTO>` | 400/401/403/... | APIE-... |

For every endpoint confirm:

- [ ] Uses `body.args ?? body` according to the project envelope.
- [ ] Strictly rejects unsupported fields.
- [ ] Authenticates and authorizes before business work.
- [ ] Applies record/site/department/participant scope.
- [ ] Does not expose sensitive columns.
- [ ] Has bounded list behavior.

## 6. Data model and migration

| Object | Definition/change | Constraints | Indexes | RLS/grants | Migration |
|---|---|---|---|---|---|
| `<table/function>` | <change> | <checks/FKs/unique> | <indexes> | <policies/grants> | `<file>` |

### Migration rules

- Apply order:
- Backfill:
- Rollback/recovery:
- Existing migration already released? Yes/No:
- Live verification queries:
- PostgREST schema reload required? Yes/No:

## 7. State machines

### <Entity>

| From | Action | To | Actor/permission | Preconditions | Side effects | Repeat/concurrent behavior | E2E ID |
|---|---|---|---|---|---|---|---|
| draft | submit | pending | <actor> | <rules> | MUT-XXX-001 | <idempotency> | FSM-XXX-001 |

Illegal transitions that must be tested:

| Current state | Attempted action | Expected code | Expected no-change assertions | E2E ID |
|---|---|---|---|---|
| <state> | <action> | 409 | <rows/events unchanged> | FSM-XXX-101 |

## 8. Mutation ownership

| ID | Business write | Event(s) exact count | Audit | Workflow | Notification/message/ticket | Handoff | Transaction owner | E2E IDs |
|---|---|---|---|---|---|---|---|---|
| MUT-XXX-001 | <row> | `<type>` x1 | <table/action> | <behavior> | <behavior> | <behavior> | `<RPC>` | MUT-... |

### Idempotency and locks

| Mutation | Key owner | Hash inputs | Same/same | Same/different | Lock order | Concurrent result |
|---|---|---|---|---|---|---|
| MUT-XXX-001 | <FE/route/job> | <canonical fields> | return original | 409 | <ordered objects> | exactly one |

### Failure matrix

| Failure point | Expected rollback/intent state | Retry owner | Operator visibility | E2E ID |
|---|---|---|---|---|
| <point> | <state> | <owner> | <log/dead letter> | FAIL-XXX-001 |

## 9. Permission matrix

| Persona/role | Read | Create | Edit | Submit | Approve | Admin | Record scope | Negative E2E ID |
|---|---:|---:|---:|---:|---:|---:|---|---|
| <role> | Y/N | Y/N | Y/N | Y/N | Y/N | Y/N | <scope> | AUTH-XXX-001 |

Segregation-of-duties rules:

- <creator cannot approve, etc.>

## 10. Cross-module integration

| Source action | Target module | Mechanism | Correlation/dedupe | Retry/dead letter | Target evidence |
|---|---|---|---|---|---|
| <action> | <module> | handoff/event/API | <key> | <behavior> | <test/query> |

## 11. Query and scale contract

- Expected row volume now / 12 months / 5 years:
- Default and maximum page size:
- Cursor/order contract:
- Index plan:
- N+1 prevention:
- Bulk-operation bound/chunk size:
- Query-plan evidence required:

## 12. UX and accessibility contract

- Loading strategy:
- Empty state:
- Error/retry state:
- Success/failure toast:
- Optimistic update and rollback:
- Keyboard/focus behavior:
- Responsive/desktop requirement:
- Sensitive-data masking:

## 13. Test scope

- Unit tests:
- Database/RPC tests:
- Live API E2E suite:
- Dependent suites:
- Browser journeys:
- Full regression:
- Cleanup strategy:

Traceability matrix: `docs/module-contracts/<module>-e2e-matrix.md`

## 14. Decisions and deferrals

| ID | Decision/deferral | Reason | Risk | Owner | Due milestone | User accepted |
|---|---|---|---|---|---|---|
| DEC-XXX-001 | <text> | <reason> | <risk> | <owner> | <milestone> | Yes/No |

## 15. Approval

- Product/scope approval:
- Security/SQL reviewer:
- UX approval:
- Test-plan approval:
- Date:

