# <Module Name> Release Evidence

**Final status:** Implemented | Live-verified | Regression-verified | Released | Blocked  
**Branch/commit:** <branch> / <sha>  
**Database target:** <target/ref>  
**Server origin and CWD:** <origin> / <absolute path>  
**Evidence timestamp:** <ISO timestamp>

## 1. Scope and traceability

- Approved contract:
- E2E matrix:
- Final in-scope journeys:
- Accepted deferrals:
- Target-module waiver count: `0` required.
- Missing matrix rows: `0` required.

## 2. Change inventory

| File | Status | Purpose | Reviewer |
|---|---|---|---|
| `<path>` | modified/new/deleted | <purpose> | <reviewer> |

- Base SHA:
- Final SHA:
- Diff checksum or reviewed commit:
- Concurrent changes reconciled:

## 3. Database evidence

| Migration | SHA-256 | Applied at | Verification query/result | Rollback/recovery |
|---|---|---|---|---|
| `<file>` | `<hash>` | <time> | <evidence> | <procedure> |

Verify and record:

- [ ] Referenced tables/columns/types exist.
- [ ] Constraints and indexes exist.
- [ ] RLS enabled.
- [ ] Policies and exact grants correct.
- [ ] Function signatures/security/search paths correct.
- [ ] PostgREST schema cache reloaded when required.
- [ ] Seed/backfill counts and invariants correct.
- [ ] Database advisors reviewed where available.

## 4. Mutation evidence

| Mutation ID | Transaction/RPC | Idempotency | Exact business/event/audit/task/outbox counts | Concurrency result | Failure rollback |
|---|---|---|---|---|---|
| MUT-XXX-001 | <RPC> | <result> | <counts> | <result> | <result> |

## 5. Security evidence

| Endpoint/permission | Authorized actor | Unauthorized actor/result | Out-of-scope result | Sensitive data check |
|---|---|---|---|---|
| API-XXX-001 | <actor/pass> | <actor/403> | <actor/403-or-404> | <absent fields> |

- [ ] No service-role secret in browser/build output.
- [ ] No direct protected browser Supabase data access.
- [ ] No caller-controlled authority/context.
- [ ] Logs/errors redact sensitive data.
- [ ] Maker-checker rules tested where applicable.

## 6. Performance evidence

| Path/query | Representative volume | Plan/query count | Index used | Result/budget |
|---|---:|---|---|---|
| <path> | <rows> | <evidence> | <index> | <pass/fail> |

- [ ] Lists bounded and stably ordered.
- [ ] No material N+1 path.
- [ ] Bulk operation bounded/chunked.
- [ ] Lock order reviewed.

## 7. UX/browser evidence

| Journey | Browser test/manual record | Roles | Result |
|---|---|---|---|
| BUI-XXX-001 | <test/artifact> | <roles> | pass/fail |

- [ ] Every visible control walked.
- [ ] Loading/empty/error/success states verified.
- [ ] Form and server validation parity verified.
- [ ] Toast/dialog/focus/keyboard behavior verified.
- [ ] Cache invalidation/optimistic rollback verified.
- [ ] No dead or misleading control.

## 8. Command evidence

Record exact command, exit code, and counts:

| Gate | Command | Time | Exit | Result/counts |
|---|---|---|---:|---|
| Diff | `git diff --check` | | | |
| Backend typecheck | `npm run typecheck:backend` | | | |
| Frontend typecheck | `npm run typecheck:frontend` | | | |
| Lint | `<commands>` | | | |
| Clean builds | `<commands>` | | | |
| Unit/frontend | `<commands>` | | | |
| E2E syntax | `<commands>` | | | |
| Route coverage | `npm run test:e2e:coverage` | | | |
| Target suite | `npm run test:e2e -- <module>` | | | |
| Dependent suites | `<commands>` | | | |
| Browser suite | `<command>` | | | |
| Full API E2E | `npm run test:e2e` | | | |
| Leak check | `<command/result>` | | | |

## 9. Operations

- Deployment order:
- Feature flag/cutover:
- Legacy removal proof:
- Rollback/recovery:
- Outbox/dead-letter monitoring:
- Alerts/dashboard:
- Support/operator instructions:

## 10. Independent review

| Review | Reviewer | Snapshot SHA/hash | Verdict | Findings resolved |
|---|---|---|---|---|
| SQL/security | | | | |
| Atomicity/concurrency | | | | |
| E2E completeness | | | | |
| UX/accessibility | | | | |

Any edit after review invalidates the affected review snapshot.

## 11. Final declaration

- [ ] No unexplained P0/P1 finding.
- [ ] No target-module waiver or skipped test.
- [ ] No known partial write or duplicate side effect.
- [ ] No unverified migration or stale-server result.
- [ ] Full regression is green.
- [ ] Cleanup is clean.
- [ ] Deferrals are explicit and user accepted.

Final verdict: SHIP | FIX-THEN-SHIP | BLOCKED | REDESIGN

