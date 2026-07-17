# SIOMAC Enterprise Module Delivery Standard

**Status:** Required for every new module and every substantial module expansion.

**Purpose:** Prevent incomplete features, security gaps, transaction defects, stale-server
false positives, and superficial E2E coverage. This document turns the project's existing
engineering rules into a repeatable delivery protocol with traceability and evidence.

This standard cannot guarantee zero defects. It is designed to make omissions visible before
release and to prevent an agent from claiming completion without executable proof.

---

## 1. Authority and precedence

Use this order when instructions disagree:

1. The SIOMAC Build-Ready Technical Implementation Specification.
2. `CLAUDE.md` and its no-band-aids rule.
3. This standard.
4. The approved module delivery contract created from
   `docs/templates/MODULE_DELIVERY_CONTRACT_TEMPLATE.md`.
5. Current code and database contracts.
6. Older plans, mockups, audits, and implementation briefs.

Older documentation is evidence, not truth. Verify it against current routes, schemas,
permissions, tests, and live migration state. Never copy a pattern solely because it exists.

`docs/CODING_STANDARDS.md` governs the current TypeScript/Preact frontend. The older
`docs/CODE_STANDARDS.md` describes the retired JavaScript architecture and is not authority for
new Preact/Hono work.

---

## 2. Non-negotiable completion rule

A module is complete only when all of these are true:

- Every in-scope user journey is implemented end to end.
- Every visible control performs its labelled action against a real backend contract.
- Every backend endpoint has strict validation, authorization, and record-scope enforcement.
- Every business mutation is atomic or uses a proven compensating design where atomicity is
  impossible, with no partial success reported.
- Required events, audit, workflow, notification, message, ticket, and handoff side effects are
  owned once and asserted exactly.
- Every legal state transition and every material illegal transition is tested.
- The module has live API E2E coverage and critical user journeys have browser E2E coverage.
- The target module has no E2E waiver, skipped test, `.only`, TODO test, or accepted new debt.
- Targeted tests and the full repository regression are green against the current build and
  current database.
- A release-evidence document proves each claim.

The following are not completion evidence:

- A page renders.
- TypeScript compiles.
- A route is mentioned once in an E2E file.
- Unit tests pass with mocked database boundaries.
- A database call returned no error without verifying persisted state.
- PostgREST `head: true` or a row count alone.
- The agent says a migration was applied without querying the live schema.
- Tests passed against an old `dist/` build or a server launched from another checkout.

---

## 3. Delivery states

Every module must be described with one of these states:

| State | Meaning |
|---|---|
| Designed | Contract and traceability matrix approved; no implementation claim. |
| Implemented | Code exists and fast static checks pass; live boundaries not yet proven. |
| Live-verified | Migrations applied, current server running, target E2E green. |
| Regression-verified | Target, dependency, browser, and full E2E gates green. |
| Released | Evidence accepted, deployment verified, rollback/runbook ready. |
| Blocked | A named external dependency prevents the next gate; no completion claim. |

Never use “done,” “complete,” “enterprise-ready,” or “fixed” for Designed or Implemented work.

---

## 4. Phase 0: establish a trustworthy workspace

Before analysis or edits, Claude must record:

1. Absolute repository path and `git rev-parse --show-toplevel`.
2. Branch, HEAD SHA, and `git status --short`.
3. Existing user/agent changes that must not be overwritten.
4. The running Netlify/Vite process CWD and port, if a server is already running.
5. Migration link/state and whether the target database is disposable development, shared
   development, staging, or production.
6. Current module route files, API hooks, pages, database objects, permissions, and E2E suites.

Required behavior:

- Work only in the authorized checkout.
- Treat concurrent edits as owned by another agent unless ownership was explicitly assigned.
- Split parallel work by file ownership, not merely by topic.
- Re-read a file immediately before editing it.
- Never reset, checkout, delete, or overwrite unrelated changes.
- Do not trust a server until it has been rebuilt and restarted from the same checkout.

Stop if the workspace, database target, or file ownership is ambiguous.

---

## 5. Phase 1: contract before code

Create a module contract from
`docs/templates/MODULE_DELIVERY_CONTRACT_TEMPLATE.md` before implementation. It must contain the
following inventories.

### 5.1 Scope and personas

- Business objective and measurable outcome.
- Primary and secondary personas.
- In-scope workflows and explicit non-goals.
- Regulatory, statutory, contractual, and data-retention obligations.
- Trinidad and Tobago-specific behavior where relevant, including evidence source, effective
  date, currency, timezone, and filing/banking limitations.

Do not implement a feature merely because a mockup contains it. Every feature needs a named user
benefit, owner, backend capability, permission, and acceptance test.

### 5.2 UI control inventory

List every page, tab, card, table, row action, button, link, field, filter, sort, pagination
control, import/export action, dialog, drawer, wizard step, and empty/error state.

Each control receives a stable ID such as `UI-ONB-001` and maps to:

- Persona and permission.
- Backend endpoint or local-only behavior.
- Validation contract.
- Success and failure feedback.
- E2E test ID.

An unmapped control must be removed from scope; it must not ship as a stub.

### 5.3 Endpoint inventory

Each endpoint receives a stable ID such as `API-ONB-001` and records:

- Method/path and route file.
- Permission and record-level read/write gate.
- Strict Zod request schema and request-envelope handling (`body.args ?? body`).
- Response schema used by the frontend.
- Tables/functions touched.
- Mutation ID, if applicable.
- Error/status contract.
- E2E positive and negative test IDs.

Every protected ERP route must use the authenticated Netlify API. The browser must not read or
write protected Supabase tables directly.

### 5.4 State-machine inventory

For every stateful entity, document:

- All states.
- Every legal transition.
- Actor/permission for each transition.
- Required preconditions and reason fields.
- Side effects.
- Whether creator and approver must differ.
- Behavior for repeat, stale, concurrent, and illegal requests.

State transitions must be enforced server-side and, for multi-write transitions, inside the
transaction that changes the state.

### 5.5 Mutation and side-effect ownership

Each mutation receives a stable ID such as `MUT-ONB-001` and a matrix covering:

- Business row(s).
- `app_events` event type and exact cardinality.
- Module audit table and workflow audit.
- Workflow instance/task creation or transition.
- Notification intent/delivery ownership.
- Message/thread creation.
- Ticket creation or update.
- `handoff_outbox` row and receiving module.
- Idempotency key and hash inputs.
- Lock order and concurrency behavior.
- Retry owner and terminal failure handling.

Every side effect has exactly one owner. “Both the RPC and route emit it” is a duplicate bug.
“The route assumes a worker emits it” without a durable intent row is a missing-side-effect bug.

### 5.6 Data and migration inventory

Record:

- Tables, columns, types, nullability, defaults, checks, unique constraints, and foreign keys.
- `app_users.id` references as `text`, never UUID.
- RLS policy and explicit grant for each table/view/function.
- Indexes for foreign keys, selective filters, ordering, RLS predicates, and idempotency keys.
- Function security mode, fixed `search_path`, and exposed signature.
- Data migration/backfill, rollback, and compatibility strategy.
- Canonical source migration and whether it has already shipped.

If a migration is not released, fix the source migration and reapply cleanly. If it has shipped
to a shared or production environment, preserve history and use an explicit forward migration;
also update the canonical schema documentation. Never edit history and pretend the live database
changed.

### 5.7 Traceability matrix

Create `docs/module-contracts/<module>-e2e-matrix.md` from the template. Every UI, API, state,
mutation, permission, side effect, scheduled job, and integration ID must map to tests before
implementation begins.

No row may say only “covered by module suite.” It must identify a specific test name.

---

## 6. Architecture and implementation requirements

### 6.1 API boundary

- Hono routes are POST-only according to the existing project convention.
- Authenticate and authorize before business work.
- Use exact permission catalogue keys; verify them against current code.
- Enforce record/site/department/ownership scope server-side.
- Do not trust client-supplied actor, owner, assignee, site, department, role, totals, status,
  approval, or source snapshot where the server can derive it.
- Use strict Zod schemas. Reject unknown or unsupported fields rather than accepting and dropping
  them.
- Validate strings, numbers, dates, UUIDs, arrays, enum vocabularies, cross-field rules, and
  payload size.
- Return stable error codes/messages without stack traces or sensitive detail.
- Select explicit database columns; redact secrets, tokens, banking data, medical data, and
  internal metadata from responses unless the endpoint explicitly requires them.

### 6.2 Transaction boundary

Use one Postgres RPC for a business operation that must commit multiple database effects. A chain
of Supabase client calls is not a transaction.

The RPC must:

1. Validate required input and canonical identity.
2. Lock the source row and related mutable configuration in a documented order.
3. Recheck state and authorization-relevant invariants under lock.
4. Claim idempotency inside the transaction.
5. Write business rows, audit, events, workflow, and durable outbox intent.
6. Record the idempotency result in the same transaction.
7. Return the committed canonical result.

External network calls never run while database locks are held. Commit durable intent and let a
worker perform external work with retry/backoff/dead-letter behavior.

### 6.3 Idempotency and concurrency

Every retryable create/submit/transition must define:

- Request key owner and lifecycle.
- Canonical hash inputs.
- Same-key/same-hash behavior: return the original result and create nothing new.
- Same-key/different-hash behavior: conflict.
- Concurrent same-key behavior: one committed operation.
- Concurrent different-key behavior against the same entity: state/row locks prevent invalid
  duplicate transitions.
- What retries after a timeout or worker crash.

Do not generate a new idempotency key inside each backend retry. Do not use a synthetic key that
can never deduplicate the actual user action.

### 6.4 State transitions and maker-checker

Financial, payroll, statutory, security, access-control, and other sensitive changes require a
documented approval model where appropriate:

- Draft -> submitted -> approved/rejected/returned -> active/locked.
- Creator cannot approve their own change when segregation of duties applies.
- Server checks transition source state and actor authority.
- Approved/locked records cannot be silently edited.
- Revisions create a new controlled version or reapproval path.
- Workflow engine owns approvals; do not add parallel ad-hoc approval flags.

### 6.5 Database security

- Enable RLS on every exposed-schema table.
- Use least-privilege grants and explicitly revoke unintended roles.
- Service-role credentials remain backend-only.
- Never authorize from user-editable JWT metadata.
- Views in exposed schemas use `security_invoker = true` where supported or are inaccessible to
  public API roles.
- Privileged helper functions live in a private schema, use a fixed minimal `search_path`, and
  have exact execute grants.
- RLS filter/join columns are indexed.
- Update policies include the necessary select visibility.

Before implementing Supabase-sensitive behavior, verify the current Supabase documentation and
changelog; do not rely on remembered platform behavior.

### 6.6 Realtime

- Realtime is a refetch signal, not an authorized data source.
- Private channel membership is derived server-side from the authenticated subject.
- Topic shapes are strict and non-participants are tested as denied.
- Loss of Realtime degrades to polling/refetch without exposing data or inventing a key.
- A live event must not duplicate business events, notifications, or messages already emitted by
  the transaction.

### 6.7 Query and scale discipline

- No unbounded list endpoint.
- Use stable ordering and cursor/keyset pagination for large or growing datasets.
- Eliminate N+1 application loops with joins or batch queries.
- Add foreign-key and filter/order indexes.
- For high-volume paths, record `EXPLAIN (ANALYZE, BUFFERS)` evidence using representative data.
- Keep transactions short and acquire locks in a consistent order.
- Bulk operations must be bounded, chunked, and return per-item failure only when partial success
  is an approved business contract; otherwise commit atomically.

### 6.8 Frontend contract

- Use typed API hooks and central query keys.
- Mutations do not silently retry unless the idempotency contract permits it.
- Cache invalidation targets every affected view; optimistic changes roll back on failure.
- Every form has field-level, cross-field, loading, disabled, success, and server-error states.
- Frontend validation mirrors but never replaces backend validation.
- Foreign keys use real pickers, not free text.
- No raw UUIDs, internal status values, or sensitive fields are displayed.
- Use the established dialog, toast, table, icon, widget, and page-layout components.
- Every control is keyboard accessible, focus is managed in dialogs, and status is not conveyed by
  color alone.
- Remove unsupported controls instead of shipping dead buttons or fake results.

### 6.9 Cross-module integration

Cross-module effects must use the platform backbone:

- Durable `handoff_outbox` for module-to-module work.
- Notifications through the notification/event pipeline.
- Messages through the communications API.
- Tickets through the ticket API.
- Workflow approvals through the workflow engine.

The source module records intent; the target module owns target behavior. Document retries,
deduplication, correlation IDs, and dead-letter/operator recovery.

---

## 7. Implementation sequence

Build one vertical slice at a time:

1. Contract and traceability rows.
2. Canonical migration/RPC and database constraints.
3. Backend service and strict route.
4. API schema/hook.
5. UI control and all states.
6. Unit tests for pure logic and validation.
7. Live API E2E for the slice.
8. Browser E2E for the user journey.
9. Update evidence and remove replaced legacy path.

Do not build all UI first and retrofit the backend later. Do not retain old and new mutation paths
after cutover. Build new, verify, cut over, and delete legacy in the same controlled slice.

During implementation use fast feedback only:

- Typecheck the affected frontend/backend project.
- Lint changed files.
- `node --check` changed E2E scripts.
- Parse/inspect SQL and verify referenced objects exist.

Run slow suites at the final gate, consistent with repository test cadence.

---

## 8. E2E completeness standard

### 8.1 Test taxonomy

SIOMAC needs distinct evidence at each layer:

| Layer | Purpose | Required evidence |
|---|---|---|
| Static | Types, lint, route inventory, forbidden patterns | Clean commands and diff review |
| Unit | Pure rules, formatters, schema boundaries | Focused Jest/Vitest tests |
| Database | Constraints, RPC atomicity, grants/RLS, concurrency | Live SQL/RPC assertions |
| Live API E2E | JWT -> Hono -> Zod -> service -> Postgres | `scripts/e2e/suites/<module>.mjs` |
| Browser E2E | Real page controls, forms, cache, dialogs, navigation | Automated critical journeys |
| Regression | Cross-module and platform compatibility | Full unit/frontend/API/browser run |
| Operational | Jobs, outbox, retry, dead-letter, observability | Worker/sweep and recovery tests |

The current `scripts/e2e` harness is a live API integration harness. It is essential, but it does
not click the Preact UI. A user-facing module is not UI-verified until critical journeys are
automated in a browser runner. Until the repository browser runner is established, a recorded
browser acceptance pass is required and the module cannot be described as fully automated.

### 8.2 Route-coverage gate limitation

`npm run test:e2e:coverage` proves that a literal API path appears in some suite. It does not prove:

- Correct assertions.
- Authorized and unauthorized behavior.
- Response shape.
- State transitions.
- Side effects.
- Idempotency/concurrency.
- Cleanup.
- UI behavior.

Therefore, route coverage is only one gate. The module traceability matrix is the behavioral
coverage authority.

For the module being built:

- Every module route must be covered.
- Remove its entries from `coverage-waivers.json`.
- Do not run `--write-waivers` to make a new endpoint pass.
- A waiver requires explicit user acceptance, a named owner, reason, risk, and expiry milestone.

### 8.3 Minimum endpoint tests

Every endpoint requires tests for all applicable rows below:

1. Authorized happy path.
2. No token -> 401.
3. Authenticated without permission -> 403 using a real non-superadmin role.
4. Out-of-scope/non-owner/non-participant -> 403 or 404 according to the privacy contract.
5. Missing required input -> 400/422.
6. Unknown field or unsupported option -> rejected.
7. Boundary lengths/numbers/dates and invalid enum/UUID.
8. Missing source record -> 404.
9. Invalid state transition -> 409/422.
10. Exact response fields and types consumed by the frontend.
11. Pagination, sort, filter, search, empty result, and final-page behavior for reads.
12. Sensitive fields absent from the response.

### 8.4 Minimum mutation tests

Every mutation must assert, by exact IDs/correlation key:

- Business row content and status.
- Exact event type and count.
- Exact audit action, actor, previous state, new state, and reason.
- Workflow instance/task count and assignee where required.
- Notification/message/ticket/handoff intent and recipient where required.
- No duplicate side effects.
- No unexpected side effects.
- Same-key retry returns the original result.
- Same-key/different-payload conflicts.
- Concurrent duplicate requests create one operation.
- Failure at a material internal step leaves no partial business state.
- Illegal actor/state request changes nothing.

Avoid broad assertions such as `count >= 1` when the contract says exactly one. Query by the
created record ID, event correlation ID, request key, or test tag so old rows cannot make a broken
test pass.

### 8.5 State-machine tests

For each transition table:

- Test every legal edge.
- Test all security-sensitive illegal edges.
- Test repeat requests.
- Test stale version/concurrent actor behavior.
- Test returned/rejected resubmission.
- Test cancellation and supersession.
- Assert terminal workflows have no actionable open tasks.

### 8.6 Outbox and scheduled-job tests

Test:

- Claim/lease ownership.
- Retry count and backoff.
- Idempotent reprocessing.
- Crash after external success but before acknowledgment.
- Poison/dead-letter behavior.
- Operator-visible failure detail without sensitive data.
- Correct finalizer/source transition.
- No duplicate notification/message/handoff.

Use deterministic clocks or explicit timestamps. Do not depend on wall-clock sleeps when a state
or timestamp can be controlled directly.

### 8.7 Browser journey tests

At minimum automate the module's critical paths:

- Authorized navigation and page load.
- Empty, loading, populated, and server-error states.
- Search, filter, sort, pagination, and clear-filter behavior.
- Create/edit wizard including validation and cancellation.
- Submit/approve/reject/return flow using different actors.
- Dialog/drawer focus, keyboard escape, and confirmation behavior.
- Success and failure toast behavior.
- Cache refresh after mutation and after a Realtime signal.
- Cross-module drill-through to message, ticket, workflow, or receiving record.
- Permission-hidden and permission-denied controls.
- Export/import download/upload where present.

Browser tests must use stable semantic selectors or explicit test IDs. Do not bind tests to visual
CSS classes or incidental text where a stable accessible name exists.

### 8.8 Test identities and cleanup

- Never use the superadmin fixture to prove an ordinary role's permission.
- Prefer `acquireActors`; create synthetic actors only when the test mutates identity or requires a
  clean history.
- Tag every created object with `h.TAG` where supported.
- Track created IDs and delete only those IDs.
- Never clean broadly by a real employee ID, actor ID, or date range.
- Register cleanup immediately after creation becomes possible.
- Pre-run and post-run sweep failure is a failed run.
- After the full suite, verify no tagged users/rows/outbox entries remain.

### 8.9 Flake policy

- No automatic rerun to turn red into green.
- No arbitrary sleep to hide eventual-consistency defects.
- No order dependence between suites.
- No shared mutable fixture unless explicitly reset.
- A flaky test is a product/test defect and blocks release until root-caused.
- Record random seeds and IDs needed to reproduce a failure.

---

## 9. Required final gates

Run from the authorized checkout after implementation is complete:

1. `git diff --check`
2. Frontend and backend typechecks.
3. Frontend and backend lint for changed surfaces.
4. Clean frontend/backend builds.
5. Unit/frontend tests.
6. `node --check` on changed E2E scripts.
7. `npm run test:e2e:coverage` with zero new gaps and zero target-module waivers.
8. Verify migrations/functions/grants/RLS against the live target database.
9. Rebuild and restart `dev:netlify` from the same checkout.
10. Run target module E2E.
11. Run directly dependent module suites.
12. Run critical browser journeys.
13. Run `npm run test:e2e` with no suite argument to execute every discovered API suite.
14. Run post-test leak/sweep verification.
15. Review `git status`, diff, and generated output before commit.

Record exact command, timestamp, exit code, suite/test counts, server origin, branch, HEAD, database
target, and migration state. Do not report only “tests passed.”

If the full run cannot execute, state **Implemented, live verification blocked**. Never substitute a
targeted run for full regression evidence.

---

## 10. Release and operational evidence

Complete `docs/templates/MODULE_RELEASE_EVIDENCE_TEMPLATE.md`.

Required evidence includes:

- Approved contract and final scope.
- Traceability matrix with no missing test IDs.
- Migration filenames, checksums, apply order, and live verification queries.
- Function signatures/grants/RLS verification.
- Build SHA and running-server provenance.
- Test commands and counts.
- Side-effect exact-count evidence.
- Performance/query-plan evidence for high-volume paths.
- Security/permission negative-path evidence.
- Cleanup proof.
- Deployment/rollback/recovery procedure.
- Explicit deferrals with owner and milestone.

Screenshots may support UX review but never replace executable assertions.

---

## 11. Stop conditions

Claude must stop and report instead of improvising when:

- Business behavior, statutory interpretation, or approval ownership is ambiguous.
- Two designs perform the same action and the user has not selected one.
- The database target or migration state cannot be verified.
- A required permission or record-scope rule is missing.
- A mutation needs atomicity but no acceptable transaction design exists.
- Existing concurrent edits overlap the same files or migration sequence.
- A feature would require accepting unsupported input or returning fake data.
- A test can pass only by weakening an assertion, adding a broad waiver, retrying, or swallowing an
  error.
- A critical external integration is not actually supported in Trinidad and Tobago.

The correct output is a concrete blocker with options and consequences, not a guessed
implementation.

---

## 12. Claude execution protocol

For each module, Claude must follow this order:

1. Read `CLAUDE.md`, `docs/REPO_MAP.md`, this standard, current module code, and current contracts.
2. Verify workspace and concurrent edits.
3. Produce the delivery contract and E2E matrix before coding.
4. Identify all contradictions and decisions requiring user input.
5. Implement approved vertical slices without touching unrelated files.
6. Update contract/matrix as behavior changes; do not let documentation drift.
7. Run fast checks during implementation.
8. Run final target, dependency, browser, and full regression gates once the module is complete.
9. Produce release evidence.
10. Ask for independent review on SQL, security, permissions, atomicity, and test completeness.
11. Fix findings and rerun affected gates.
12. Commit only when the evidence is green and the required trailer is present.

Independent review must use the fixed file hashes or commit SHA being reviewed. Any edit invalidates
that review and requires a new pass on the changed snapshot.

---

## 13. Enterprise definition of done

The final reviewer answers each item **PASS**, **FAIL**, or **NOT APPLICABLE**, with a file/test/query
reference:

- Scope and non-goals are explicit.
- Every UI control is mapped and functional.
- Every endpoint is mapped and behaviorally tested.
- Every response contract matches frontend consumption.
- Every input has frontend and backend validation.
- Permissions and record scope have positive and negative tests.
- Sensitive data is redacted.
- Every mutation is atomic and idempotent where required.
- Every side effect has one owner and exact-count assertions.
- Every legal state transition and material illegal transition is tested.
- Maker-checker rules are server-enforced where required.
- Realtime is private and only triggers authorized refetch.
- Cross-module handoffs are durable and retry-safe.
- Lists are bounded, indexed, and free of N+1 behavior.
- Migrations, RLS, grants, constraints, and function security are live-verified.
- Loading, empty, error, disabled, and success UX states work.
- Accessibility and keyboard behavior are verified.
- Target API E2E and browser journeys are green.
- Full repository regression is green.
- Cleanup leaves no test data.
- Deployment, rollback, and operator recovery are documented.
- No target-module waiver, skipped test, dead control, fake value, or known P0/P1 remains.

Any unexplained FAIL blocks completion.

---

## 14. External references

Verify these at implementation time because platform behavior changes:

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase database functions: https://supabase.com/docs/guides/database/functions
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html

