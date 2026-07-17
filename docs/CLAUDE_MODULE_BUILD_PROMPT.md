# Claude Module Build Prompt

Use this prompt when resuming a SIOMAC module. Replace every `<placeholder>` before sending it.

```text
Build or complete the SIOMAC <module name> module in <absolute repository path>.

GOVERNING RULES
1. Read CLAUDE.md, docs/REPO_MAP.md, and
   docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md before changing code.
2. Work only in the authorized checkout. Report branch, HEAD, git status, existing changes,
   running-server CWD, and migration state first.
3. Do not overwrite unrelated or concurrent work. Re-read every file immediately before editing.
4. No band-aids: no accept-and-drop fields, swallowed errors, fake values, duplicate systems,
   random retry keys, weakened tests, or waivers used to hide missing coverage.

CONTRACT FIRST
5. Before implementation, create:
   - docs/module-contracts/<module>-delivery-contract.md from the delivery template;
   - docs/module-contracts/<module>-e2e-matrix.md from the E2E matrix template.
6. Inventory every UI control, endpoint, permission, record-scope rule, state transition,
   mutation, side effect, workflow, notification, message, ticket, handoff, job, table, RPC,
   and cross-module dependency. Give each a stable ID and map it to exact tests.
7. Identify contradictions, unsupported Trinidad and Tobago behavior, and decisions requiring
   product input before coding. Remove unsupported controls instead of stubbing them.

IMPLEMENTATION
8. Build approved vertical slices: database/RPC -> backend route -> API hook -> UI -> tests.
9. Protected data goes through authenticated Netlify APIs. Realtime only triggers refetch.
10. Strictly validate body.args ?? body and reject unsupported fields. Derive authority and
    canonical context server-side. Enforce exact permission keys and record scope.
11. Multi-row business mutations use one transactional RPC with idempotency, documented lock
    order, exact events/audit/workflow/outbox ownership, and no partial success.
12. Sensitive changes use workflow maker-checker and server-enforced segregation of duties.
13. Every control must work against a real endpoint and have loading, empty, disabled, success,
    validation, and error behavior. No dead buttons or toast-only fake actions.

TESTING
14. Extend scripts/e2e/suites/<module>.mjs to cover every endpoint and matrix row. A route call
    alone is not coverage.
15. For each endpoint test authorized, unauthenticated, unauthorized real role, out-of-scope,
    validation boundaries, missing record, invalid state, exact response shape, and sensitive
    field absence where applicable.
16. For each mutation assert exact business/event/audit/task/notification/message/ticket/handoff
    counts, same-key retry, key conflict, concurrent duplicate, rollback on failure, and no-change
    on illegal requests.
17. Use h.TAG and exact created IDs. Never broadly delete data belonging to real users.
18. Remove all target-module coverage waivers. Do not run --write-waivers to make the gate pass.
19. Add automated browser coverage for critical journeys. If no browser runner exists, report
    that as an automation blocker and provide a recorded browser acceptance pass; do not call UI
    coverage fully automated.

FINAL GATE
20. During edits use fast typecheck/lint/node --check feedback. When the module is complete, run
    the required final gates in the enterprise standard, including target suites, dependent
    suites, browser journeys, npm run test:e2e:coverage, and npm run test:e2e with no suite
    argument.
21. Prove the server is the current clean build from this checkout and prove migrations/functions/
    grants/RLS against the live target database.
22. Complete docs/module-contracts/<module>-release-evidence.md from the release template with
    exact commands, exit codes, test counts, hashes, migration state, and cleanup proof.
23. Request independent SQL/security, atomicity/concurrency, and E2E completeness review against
    a fixed SHA/hash. Any edit invalidates the affected review.
24. Do not claim done unless the module is regression-verified. If a gate cannot run, report:
    “Implemented, live verification blocked,” with the exact blocker and next command.

MODULE SCOPE
- Objective: <objective>
- Personas: <personas>
- In scope: <journeys>
- Explicit non-goals: <non-goals>
- Approved mockups: <paths>
- Regulatory sources/effective dates: <sources>
- Known dependencies: <dependencies>
- Known concurrent work/file ownership: <ownership>
```

The prompt is intentionally strict. Remove a requirement only when it is genuinely not applicable
and record that decision in the module contract.

