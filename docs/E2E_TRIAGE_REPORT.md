# E2E Triage Report — non-workflow suites (2026-07-14)

Full sweep of all 57 E2E suites (workflow suites excluded — green + owned by the #2 work).
**~102 failures across the 48 swept suites**, which collapse to **~12 root causes**. The original
"171" was inflated by a stale-dev-server full run + cascades; per-suite runs on a fresh server give
the real picture below. **~80% are unapplied operator migrations, not code regressions.**

## Category A — UNAPPLIED MIGRATIONS (operator must apply) — ~80 failures
| Migration to apply | Clears | Failures (~) |
|---|---|---|
| `20260917000200_finance_pay_component_change_requests.sql` | `finance_pay_component_change_requests` table ("Could not find the table … in the schema cache") | Pay Component CR suite ~20 + Finance Statutory pay-components 4 + component_id-null cascades = **~26** |
| `20260803000002_hr_roster_permissions.sql` | roster perms (`hr_staff … Unauthorized` on rosters) — cascades to every `rosterId: null` | Roster suite **~20** |
| `20260807000000_finance_budget_lines_extend.sql` | `finance_budget_lines.owner_id` ("Could not find the 'owner_id' column") | Finance Budgets bulk-upsert **4** |
| Wave-2B permissions seed (AP + statutory perm keys not in DB `role_permissions`) | `admin` has `finance.ap.payment.run.process` / `finance.statutory.nis_class.delete` in code but not DB — the agent re-routed these tests through `finance_manager` (who has them in DB), so they now pass; applying the seed lets `admin` pass too | (already worked around) |
| `20260628100000` (communication realtime signals) | anon realtime SELECT / signals published for realtime | communications **1** |

> Confirm each is genuinely unapplied before applying (probe the object). After applying: `NOTIFY pgrst, 'reload schema'`.

## Category D — REAL CODE BUGS (fixed by the stopped agent, verified) — committed
| File | Bug fixed |
|---|---|
| `lib/communications.ts` | Unread-count string-compare bug: PostgREST strips trailing zeros from `last_read_at`, so `'…00.2+00:00' > '…00.200123+00:00'` is wrong in ASCII → parse both to ms-epoch (`tsMs`). |
| `lib/finance/expenses.ts` | Notification `actionRoute` used `/finance/expenses/<id>` (an entity-id path the FE resolver can't navigate) → `s-finance-expenses` section id. |
| `lib/hr/employeeCore.ts` | `nextEmployeeNumber` broke on non-numeric `EMP-FIN01`-style ids winning the desc sort → filter to pure-numeric, take max. |
| `lib/hr/requestsCore.ts` | Idempotency key was base64-truncated raw JSON (prefix-collision risk) → SHA-256. |
| `scripts/e2e/harness.mjs` | `acquireActors` didn't mark freshly-created synthetic users `_borrowed` → the same user handed back twice, causing SoD test failures. Added `skip()` + `serviceKey`. |

## Category D/E — REMAINING code/test bugs (NOT yet fixed) — ~15
- **HR Employee Master (~21, biggest remaining):** `hr_employee_change_requests_change_type_check`
  violated on submit — the code/test submits a `change_type` value the constraint doesn't allow (no
  expansion migration exists → likely a code or test value mismatch, or a constraint that needs a
  value added). Cascades to `hr.employee.change_requested/applied app_event not found`. **Investigate.**
- **Transfers (~7):** same `change_type` constraint family → likely the same root as above.
- **communications:** per-thread `unreadCount` still `1` after markRead (`expected 0, got 1`) — a
  residual timing/`>` vs `>=` edge the `tsMs` fix didn't fully close. **Investigate.**
- **hrDocuments:** `documents/requirements/create` duplicate should 409 — no dedupe firing (missing
  unique index or a code check). **Investigate.**
- **hrOrganization:** "position reports-to cycle should be rejected — got success" — cycle validation
  not enforced (real gap).
- **Seed bugs (Category B, fixable in test seeds):** `project_sites.latitude` not-null (a suite's
  site seed omits latitude); `hr_coverage_requirements.site_id` FK; `hr_leave_requests.employee_id`
  FK (hrLeave seed).
- **`expected 422, got 400` (×4):** validation returns Zod-400 where the test expects business-422 —
  align the route's error code or the test.
- **`expected failure — got success` (×2, investigations/access):** an access/validation guard not
  firing — investigate whether code or test.

## POST-APPLY residual (migrations applied + settled server) — exactly 8
After the operator applied the migration batch, a clean re-run isolates the true residual to **8**
real items (367 passed · 8 failed across the residual suites). Root-caused:
| # | suite | root cause | category | status |
|---|---|---|---|---|
| 1 | communications | `realtime DELIVERY (anon)` — `communication_signals` not published for realtime / anon SELECT | A (mig `20260628100000` not applied / verify) | operator |
| 2 | financeBudgets | variance-breach notifications DO write — the TEST selected a non-existent column `recipient_user_id` (it's `user_id`) so the query errored to 0 rows | E (test, mis-diagnosed as recipient logic) | **FIXED** (suite: `user_id` + scoped to the finance_manager recipient + `waitFor` + notif cleanup) |
| 3 | financePayComponents | duplicate code accepted — optimistic check hit `finance_pay_components` (empty until approval), missed a pending CREATE CR | D | **FIXED** (pending-CR check) |
| 4 | hrDocuments | duplicate requirement accepted — code maps 23505→409 but the UNIQUE constraint was never created | A/D | **FIXED** (mig `20260919000250` — operator applies) |
| 5 | hrOnboarding | probation test started `contractor_worker` (contractor-only) as the default employee type → correctly rejected; AND a stale `(employee,package)`-keyed `onboarding.started` dedupe_key from interrupted runs deduped the event | E (test) | **FIXED** (suite: pass `workerType:'contractor'`+fields; `waitFor` on the event; defensive setup+cleanup clears leaked cases/mutation_runs/event dedupe_keys for the STABLE test employees) |
| 6 | hrOrganization | position reports-to cycle check reads only committed `hr_positions`; a high-risk reports-to change is GATED as a pending CR, so two in-flight changes jointly forming a cycle both pass | D (feature gap) | **FIXED** (code: submission overlays pending CRs onto the graph → 409; `applyPositionChange` re-checks committed state as the apply-time backstop) |
| 7 | hrOrganization | delete-unit counted an ARCHIVED child as blocking. NB the "delete live-child → 409" test failing in the earlier run was a STALE-DIST artifact (an uncommitted `.neq('status','inactive')` on a non-existent column erroring to 0); committed source counts children correctly | D (count should exclude archived) | **FIXED** (code: shared `assertUnitDeletable` counts only `is_active=true` children, checks query errors instead of swallowing them; used at submission + apply time) |
| 8 | hrRoster | min-rest: the test scenario was 32h rest (correctly allowed — TEST bug), AND the rest formula added a whole day back for crosses-midnight adjacents (CODE bug: reported 24h for a real 0h gap) | D+E | **FIXED** (code: rest = later-start − earlier-end, both from the earlier day's midnight; test: genuine NIGHT→morning-DAY 0h rejection + a 16h positive guard) |

Fixed this pass: #3, #4, plus #2/#5/#6/#7/#8 (this session). Only #1 remains — an operator
migration (`20260628100000`) to publish `communication_signals` for realtime + anon SELECT.

**Operational note (stale dist):** the running `dev:netlify` `dist/` had DIVERGED from committed
source — an uncommitted `.neq('status','inactive')` in `deleteOrgUnit` had been compiled into dist but
never committed (git showed no source diff). It erroring to a 0 child-count is what made the "delete
live-child → 409" test fail and mis-pointed the #7 diagnosis. Re-verify by rebuilding from committed
source (`npm run build:backend`) + restarting the dev server BEFORE trusting any run — a passing test
against a divergent dist is a false result (see the netlify-dev-stale-dist rule).

## Bottom line
The pre-release triage took the non-workflow suites from ~102 failures to a precisely-scoped set;
this session fixed #2/#5/#6/#7/#8 (2 code, 3 test/robustness), each verified against a rebuilt server:
hrOrganization 34/34 · hrRoster 41/41 · financeBudgets 50/50 · hrOnboarding 105/105. Only the #1
operator migration remains. NONE are regressions from the finding #1/#2 workflow changes or the RLS
security fix (those suites are green + verified).
