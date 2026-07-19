# Payroll Exceptions & Approvals (§15.3) Delivery Contract

**Owner:** Payroll module (Claude, parent session)
**Status:** Designed
**Branch/HEAD:** `wf/payroll-exceptions` / off `main` `a7eb0441`
**Database target:** shared-dev
**Approved scope date:** 2026-07-19

This contract is required by `docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md` and is the source of
truth for this slice. Spec authority: `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md` §15.1 (page map)
and §15.3 (Findings Work Queue). Precedence: Spec → CLAUDE.md → this contract → code.

## 1. Objective

- **Business problem:** Payroll processors and approvers have no single authorized surface that
  combines control **findings** (blockers/warnings raised by calculation/validation) with pending
  **approval tasks** for payroll runs. Today findings are only reachable per-run; approvals live in
  the workflow engine. Reviewers cannot triage across runs, assign/escalate ownership, or leave an
  auditable comment trail.
- **Measurable outcome:** One keyset-paginated `findings/work-queue` read model returning compact
  rows (findings + approval-task links) with an optional selected detail; new `escalate` and
  `comment` commands; a persisted, append-only activity feed per finding.
- **Primary personas:** Payroll processor (finance_staff), Payroll approver/manager (finance_manager).
- **Secondary personas:** Superadmin (allow-all), auditors (read history).
- **Regulatory/statutory authority and effective date:** N/A (operational control surface; no new
  statutory computation). T&T payroll context inherited from the engine already in `main`.
- **Trinidad and Tobago constraints:** Currency TTD in impact figures; no new statutory logic.

## 2. Scope

### In scope (BACKEND slice only)

- `finance/payroll/findings/work-queue` — combined, keyset read model (findings + approval-task links)
  with tab/severity/state/run filters and one optional selected finding detail (incl. activity feed).
- `finance/payroll/findings/escalate` — new command (reassign/escalate owner, `state='in_progress'`,
  activity + event + audit + notification).
- `finance/payroll/findings/comment` — new command (append-only comment activity + audit + owner
  notification; no finding-state change).
- New append-only table `finance_payroll_finding_activity` backing the detail activity feed and
  persisting comments (Decision DEC-EXC-001).
- Extension of the existing `finance_payroll_finding_command_tx` RPC to accept `escalate` (merged
  into the assign branch — same effect: assignee + `in_progress` + version bump, differing only in
  event/audit/activity label) and to write an activity row for every **state-changing** command
  (assign/escalate/resolve/waive/reopen).
- A **separate** `finance_payroll_finding_comment_tx` RPC for `comment` — deliberately NOT routed
  through the command RPC because comments are non-state-change annotations that must be allowed on
  **frozen** (submitted / pending-approval) runs for cross-run triage; the command RPC freezes
  findings after submission. Comment writes activity+audit+event+receipt, no version bump, no freeze.
- Shared DTOs in `types/payrollFindings.ts` (`PayrollFindingQueueItem`, `PayrollFindingDetail`,
  `PayrollFindingActivity`, request/result types).
- Live E2E suite `scripts/e2e/suites/payrollExceptions.mjs`.

### Explicit non-goals

- **Frontend page** `PayrollExceptionQueuePage.tsx` (§15.6) — DEFERRED to a following slice
  (DEC-EXC-006). This slice ships the backing contracts only.
- **Approve / return / reject decisions** — NOT reimplemented here. Approval-kind rows expose the
  workflow task id with `allowedActions: ['review']` and the client deep-links to the existing
  canonical workflow decision path (Decision DEC-EXC-004).
- **Changing the existing** `findings/list|get|assign|resolve|waive|reopen` route contracts (they are
  reused; only their shared RPC gains activity-writes + two new command branches).

### Dependencies

| Dependency | Owner | Contract | Failure behavior |
|---|---|---|---|
| Workflow engine (payroll-run approval tasks) | workflow | read-only surfacing of pending approval tasks bound to `finance_payroll_runs`; decisions via existing workflow decision endpoint | If task lookup fails, work-queue returns findings and logs; never fabricates approval rows |
| Notifications | communications | `notify()` per command (assignee/owner) | Notification is post-commit fan-out; a notify failure never rolls back the committed finding command |
| app_events / audit (hr_audit_log) | platform | one event + one audit per state-changing command (inside the RPC tx) | RPC returns error, no partial state |
| controlCenter derivation | payroll (`controlCenterDerive.ts`) | reuse finding classification + approval-item derivation; no duplicate classification | n/a |

## 3. Current-state verification

| Item | Evidence |
|---|---|
| Repository root | `C:\Users\MSI Laptop\Desktop\Siomac` |
| Branch/HEAD | `wf/payroll-exceptions` / off `main` `a7eb0441` (fresh worktree `.claude/worktrees/wf-payroll-exceptions`) |
| Existing changes | none (clean worktree at creation) |
| Running server CWD/build | not started (backend contract phase; functions-only dev on a spare port at implementation) |
| Migration state | `20260919000420` execution foundation (control_findings + `finance_payroll_finding_command_tx`) applied on shared-dev; no activity table yet |
| Existing routes | `findings/list|get|assign|resolve|waive|reopen` in `netlify/functions/routes/financePayroll.ts`; lib `netlify/functions/lib/finance/payroll/findings.ts` |
| Existing lib | `listPayrollFindings`, `listAllPayrollFindings`, `getPayrollFinding`, `commandPayrollFinding` (RPC `finance_payroll_finding_command_tx`) |

## 4. UI inventory

DEFERRED — the `PayrollExceptionQueuePage.tsx` UI is out of scope for this slice (DEC-EXC-006). The
backend contracts below are designed to back that page in a following slice. No UI IDs are claimed
here; none may be marked "done" until the FE slice ships its own contract addendum.

## 5. API inventory

| ID | Method/path | Route file | Permission | Record gate | Request schema | Response schema | Errors | E2E IDs |
|---|---|---|---|---|---|---|---|---|
| API-EXC-001 | POST `/api/finance/payroll/findings/work-queue` | `financePayroll.ts` | `finance.payroll.view_all` | view_all scope | `PayrollWorkQueueRequest` (keyset) | `PayrollWorkQueueResult` (+ optional `selected`) | 401/403/422 | APIE-EXC-001 |
| API-EXC-002 | POST `/api/finance/payroll/findings/detail` (NEW — `findings/get` left unchanged, DEC-EXC-009) | `financePayroll.ts` | `finance.payroll.view_all` | view_all | `{ findingId, activityCursor?, activityLimit? }` | `PayrollFindingDetail` (+ activity feed) | 401/403/404/422 | APIE-EXC-002 |
| API-EXC-003 | POST `/api/finance/payroll/findings/escalate` (NEW) | `financePayroll.ts` | `finance.payroll.finding.assign` (REUSED — escalate is a reassignment; confirmed 2026-07-19, no new key) | run manage | `{ findingId, expectedVersion, idempotencyKey, assigneeId, note? }` | `PayrollControlFinding` | 401/403/404/409/422 | APIE-EXC-003 |
| API-EXC-004 | POST `/api/finance/payroll/findings/comment` (NEW) | `financePayroll.ts` | `finance.payroll.view_all` | view_all | `{ findingId, idempotencyKey, body, expectedVersion? }` | `PayrollFindingActivity` | 401/403/404/422 | APIE-EXC-004 |
| API-EXC-R01..R04 | `findings/list|assign|resolve|waive|reopen` (REUSE, unchanged contract) | `financePayroll.ts` | existing gates | existing | existing | existing | existing | covered by existing rbac/payroll suites + regression |

For every NEW endpoint confirm:

- [ ] Uses `body.args ?? body` envelope.
- [ ] Strictly rejects unsupported fields (Zod strict).
- [ ] Authenticates + authorizes before any business work.
- [ ] Applies view_all / run-manage scope.
- [ ] Never returns short-lived URLs or raw employee PII beyond `displayName`.
- [ ] Bounded list (keyset, max limit 100).

### API-EXC-001 request/response (per §15.3, §15.2 shared page shape)

```ts
interface PayrollWorkQueueRequest {
  cursor?: string;
  limit: number;                 // 1..100, default 25
  tab?: 'all' | 'approvals' | 'blockers' | 'warnings' | 'resolved';
  kinds?: Array<'approval' | 'blocker' | 'warning'>;
  severities?: Array<'critical' | 'high' | 'medium' | 'low'>;
  states?: Array<'open' | 'in_progress' | 'resolved' | 'waived'>;
  runIds?: string[];
  ownerId?: string;
  search?: string;
  selectedId?: string;           // finding id OR "task:<workflowTaskId>"
}
interface PayrollWorkQueueResult {
  items: PayrollFindingQueueItem[];
  nextCursor: string | null;
  total: number;
  tabCounts: Record<'all' | 'approvals' | 'blockers' | 'warnings' | 'resolved', number>;
  asOf: string;
  selected: PayrollFindingDetail | null;
}
```

## 6. Data model and migration

| Object | Definition/change | Constraints | Indexes | RLS/grants | Migration |
|---|---|---|---|---|---|
| `finance_payroll_finding_activity` (NEW) | append-only activity/comment log | see below | `(finding_id, created_at desc)`, `(run_id)` | RLS on; revoke anon/auth; grant service_role **SELECT/INSERT/DELETE only (no UPDATE = append-only)** | `20260919000450_finance_payroll_finding_activity.sql` |
| `finance_payroll_finding_command_tx` (REPLACE, supersedes 422) | `escalate` merged into the assign branch; writes one activity row per state change | escalate→`in_progress`+assignee | — | execute→service_role | `20260919000450_finance_payroll_finding_activity.sql` |
| `finance_payroll_finding_comment_tx` (NEW) | sibling comment RPC — activity+event+audit, no state change, no version bump, no run-freeze | comment allowed on submitted runs | — | execute→service_role | `20260919000450_finance_payroll_finding_activity.sql` |
| `finance_payroll_findings_work_queue` (NEW) | strict DB keyset union (findings + open approval workflow-tasks); returns items+nextCursor+total+tabCounts+asOf | keyset `(severity_rank, neg-µs epoch, id)`; limit 1..100 | reuses finding/run/task indexes | execute→service_role | `20260919000451_finance_payroll_work_queue_fn.sql` |

`finance_payroll_finding_activity` columns:

- `id uuid pk default gen_random_uuid()`
- `finding_id uuid not null references finance_payroll_control_findings(id) on delete cascade`
- `run_id uuid not null references finance_payroll_runs(id) on delete cascade` (denormalized for run-scoped queries)
- `actor_id text references app_users(id) on delete set null`
- `activity_type text not null check (activity_type in ('created','assign','escalate','comment','resolve','waive','reopen'))`
- `body text` (comment text or command note; null for pure transitions)
- `from_state text`, `to_state text` (transitions only)
- `metadata jsonb` (assignee change, evidence refs, waiver expiry)
- `finding_version integer` (finding version AFTER the command; null for comment)
- `created_at timestamptz not null default now()`
- Append-only via GRANTS — **no `BEFORE UPDATE` trigger** (Point-3 review fix). service_role has only
  SELECT/INSERT/DELETE, so the app can never overwrite a row, while `actor_id ON DELETE SET NULL` still
  proceeds (a system referential action, not subject to column grants). This avoids the calc_versions
  orphan trap where an immutability trigger blocks the SET NULL and breaks user deletion. DELETE stays
  available for retention/sweeper cleanup; rows also cascade from finding/run.

### Migration rules

- Apply order: after `20260919000422`, apply `20260919000450` then `20260919000451`, then
  `NOTIFY pgrst, 'reload schema'`. **No grant migration** — no new permission keys (escalate reuses
  `finance.payroll.finding.assign`, comment gates `finance.payroll.view_all`).
- Absolute paths (files live on branch `wf/payroll-exceptions`, not yet on main):
  `…/.claude/worktrees/wf-payroll-exceptions/supabase/migrations/20260919000450_finance_payroll_finding_activity.sql`
  and `…/20260919000451_finance_payroll_work_queue_fn.sql`.
- Backfill: **none** — activity begins at slice go-live; historical findings have no synthetic activity (DEC-EXC-005).
- Rollback/recovery: drop `finance_payroll_findings_work_queue` + `finance_payroll_finding_comment_tx`,
  revert `finance_payroll_finding_command_tx` to the `422` (4-command) version, drop `finance_payroll_finding_activity`.
- Existing migration already released? No (new).
- Live verification queries: `select count(*) from finance_payroll_finding_activity where finding_id = $1`; RPC round-trip via E2E.
- PostgREST schema reload required? Yes after apply (`NOTIFY pgrst,'reload schema'`).

## 7. State machines

### finance_payroll_control_findings (states: `open`, `in_progress`, `resolved`, `waived` — Decision DEC-EXC-003)

| From | Action | To | Actor/permission | Preconditions | Side effects | Repeat/concurrent | E2E ID |
|---|---|---|---|---|---|---|---|
| open/in_progress | assign | open (assignee set) | run.manage | version match | MUT-EXC-A: activity+event+audit+notify(assignee) | idempotent by key; 409 stale | FSM-EXC-001 |
| open/in_progress | **escalate** | **in_progress** (assignee escalated) | run.manage | version match; `assigneeId` present | MUT-EXC-001 | idempotent; 409 stale | FSM-EXC-002 |
| open/in_progress | resolve | resolved | run.manage | version match | activity+event+audit+notify(owner) | idempotent; 409 stale | FSM-EXC-003 |
| open/in_progress | waive | waived | run.manage | version match; **severity ≠ blocker** | activity+event+audit+notify(owner) | idempotent; 409 stale | FSM-EXC-004 |
| resolved/waived | reopen | open | run.manage | version match | activity(`reopen`)+event+audit+notify(owner) | idempotent; 409 stale | FSM-EXC-005 |
| any queryable | **comment** | (no state change) | view_all | finding exists | MUT-EXC-002: activity(`comment`)+audit+notify(owner) | idempotent by key; no version bump | FSM-EXC-006 |

"Reopened" is an **action/history event only** (activity row `activity_type='reopen'`); the persisted
state returns to `open` (Decision DEC-EXC-003).

**`escalate` semantics (v1) — ownership/routing escalation ONLY.** Escalate reassigns the finding to a
target owner (`assigneeId` is REQUIRED) and moves it to `in_progress`; it is recorded distinctly
(`activity_type='escalate'`, `event_type=finance.payroll.finding.escalate`, `audit action=payroll_finding.escalate`,
`receipt.command='escalate'`) and gated by `finance.payroll.finding.assign`. It **does NOT** change the
finding's `severity`/urgency or introduce a new state in v1. Raising urgency/priority is an explicit
v2 behaviour change, not implied by this command.

Illegal transitions that must be tested:

| Current state | Attempted action | Expected code | No-change assertions | E2E ID |
|---|---|---|---|---|
| resolved | resolve again | 409 | no new event/audit/activity | FSM-EXC-101 |
| finding severity=blocker | waive | 422 (blocker not waivable) | state unchanged, no activity | FSM-EXC-102 |
| open | reopen | 409 | state unchanged | FSM-EXC-103 |
| stale expectedVersion | any state cmd | 409 (current version+state returned) | no change | FSM-EXC-104 |

## 8. Mutation ownership

| ID | Business write | Event(s) exact count | Audit | Workflow | Notification | Handoff | Transaction owner | E2E IDs |
|---|---|---|---|---|---|---|---|---|
| MUT-EXC-001 (escalate) | control_findings row (state=in_progress, assignee) + activity(`escalate`) x1 | `finance.payroll.finding.escalate` x1 | hr_audit_log x1 | none (findings service never touches workflow decisions) | notify new assignee x1 (skip if actor==assignee) | none | `finance_payroll_finding_command_tx` | MUTI-EXC-001 |
| MUT-EXC-002 (comment) | activity(`comment`) x1 | `finance.payroll.finding.comment` x1 | hr_audit_log x1 | none | notify run owner x1 (skip if actor==owner) | none | `finance_payroll_finding_command_tx` | MUTI-EXC-002 |
| MUT-EXC-A (existing assign/resolve/waive/reopen) | existing row change + **now** activity x1 | existing event x1 | existing audit x1 | none | existing notify x1 | none | same RPC (extended) | MUTI-EXC-003 |

### Idempotency and locks

| Mutation | Key owner | Hash inputs | Same/same | Same/different | Lock order | Concurrent result |
|---|---|---|---|---|---|---|
| MUT-EXC-001/002 | caller (FE) generates one `idempotencyKey` per logical command | findingId + command + actor | return original (`duplicate:true`, no 2nd event/activity) | new key ⇒ new command (subject to version/state) | row-lock the finding, then insert activity | exactly one activity/event/audit |

### Failure matrix

| Failure point | Expected rollback/intent state | Retry owner | Operator visibility | E2E ID |
|---|---|---|---|---|
| RPC raises mid-tx (bad assignee FK) | no row/activity/event/audit written | caller re-issues with same key | RPC error surfaced as HTTP; server log | FAIL-EXC-001 |
| notify() fails post-commit | finding command stays committed; notification best-effort | notifications subsystem | log line | FAIL-EXC-002 |

## 9. Permission matrix

| Persona/role | Read WQ | Comment | Assign | Escalate | Resolve | Waive | Reopen | Record scope | Negative E2E ID |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| finance_staff (view_all + run.manage) | Y | Y | Y | Y | Y | **N** | Y | view_all | AUTH-EXC-004 (staff waive → 403) |
| finance_manager (+ approve) | Y | Y | Y | Y | Y | Y | Y | view_all | AUTH-EXC-002 |
| employee | N | N | N | N | N | N | N | none | AUTH-EXC-001 (employee escalate/WQ → 403) |
| superadmin | Y | Y | Y | Y | Y | Y | Y | all | — |

**Live-verified correction (2026-07-19):** `finance_staff` holds `run.manage`, and migration `20260919000422`
grants `finance.payroll.finding.{assign,resolve,reopen}` to every `run.manage` holder — so staff CAN
assign/escalate/resolve/reopen; only `waive` (granted to `approve` holders) is manager-only. The negative
path for escalate is therefore `employee`, not staff.

Segregation-of-duties: findings commands are operational (not maker-checker); the **approval**
decisions they link to keep their workflow-engine SoD (creator ≠ approver) and are NOT executed here.

**Gates confirmed 2026-07-19** against `financePayroll.ts:1104-1283` (DEC-EXC-007) — no new key introduced:

| Action | Enforced key |
|---|---|
| work-queue / get (read) | `finance.payroll.view_all` |
| comment | `finance.payroll.view_all` (operational annotation) |
| assign | `finance.payroll.finding.assign` |
| escalate | `finance.payroll.finding.assign` (REUSED — reassignment) |
| resolve | `finance.payroll.finding.resolve` |
| waive | `finance.payroll.finding.waive` |
| reopen | `finance.payroll.finding.reopen` |

## 10. Cross-module integration

| Source action | Target module | Mechanism | Correlation/dedupe | Retry/dead letter | Target evidence |
|---|---|---|---|---|---|
| escalate/comment/resolve/… | communications | `notify()` post-commit | `dedupeKey = payroll.finding.<id>.<version>` (existing pattern) | best-effort; no dead letter | notifications row asserted in E2E |
| approval-kind row | workflow | read-only surfacing of workflow task id; client deep-links to decision path | workflow task id | n/a (no write) | E2E asserts `allowedActions:['review']` + task id present, and that WQ writes NO workflow rows |

## 11. Query and scale contract

- Expected finding volume: ~10–200 open findings across active runs now; low thousands over 5y.
- Default page size 25, max 100 (§15.2).
- Cursor/order: keyset on `(severity_rank desc, created_at desc, id)` — deterministic; cursor encodes filter identity (reject on filter drift, mirror runs-register 422 behavior).
- Index plan: reuse `finance_payroll_findings_(assignee_id,state,due_at)` + `(run_id,state,severity)`; activity `(finding_id,created_at desc)`.
- N+1 prevention: batch-fetch run refs + owners for the page in one query each (mirror `runRegister.ts`); never per-row.
- Bulk bound: approval-task union fetched once per page window, chunked ≤100.
- Query-plan evidence: capture `explain` for the work-queue keyset at implementation.

## 12. UX and accessibility contract

DEFERRED with the FE page (DEC-EXC-006). Backend guarantees that enable it: `asOf` timestamp, stable
drill-down ids, `selected` inline detail, tabCounts for badges, `allowedActions` per row so the FE
renders only permitted controls.

## 13. Test scope

- Unit: DTO mapping + severity/kind/state derivation (`toQueueItem`), keyset cursor codec.
- DB/RPC: escalate/comment branches of `finance_payroll_finding_command_tx` (activity written, no
  version bump on comment, blocker-waive rejected).
- Live API E2E: `scripts/e2e/suites/payrollExceptions.mjs` (see matrix).
- Dependent suites: existing `financePayroll` / rbac / control-center suites must stay green
  (the RPC change touches assign/resolve/waive/reopen — regression risk).
- Browser journeys: BLOCKED — FE deferred.
- Full regression: `npm run test:e2e` at the end.
- Cleanup: tag rows with `h.TAG`; add `finance_payroll_finding_activity` to the sweeper's payroll
  chain (it cascades from `control_findings`/runs, but assert absence after run).

Traceability matrix: `docs/module-contracts/PAYROLL_EXCEPTIONS_APPROVALS_E2E_MATRIX.md`.

## 14. Decisions and deferrals

| ID | Decision/deferral | Reason | Risk | Owner | Due | User accepted |
|---|---|---|---|---|---|---|
| DEC-EXC-001 | Add append-only `finance_payroll_finding_activity` backing the detail feed + comments | §15.3 requires activity + persisted comments; no such table exists | low | payroll | this slice | **Yes** |
| DEC-EXC-002 | `escalate` = reassign owner + `state='in_progress'` + activity/event/audit/notify; no new enum state | DB enum has no `escalated`; avoids schema churn | low | payroll | this slice | **Yes** |
| DEC-EXC-003 | Persisted states = `open/in_progress/resolved/waived`; "reopened" is an activity event, not a state | matches DB; spec's `reopened` is historical | low | payroll | this slice | **Yes** |
| DEC-EXC-004 | Approval rows are workflow-task links (`allowedActions:['review']`); decisions via existing workflow path | §15.3 forbids re-implementing approve/return/reject | med (must not double-write) | payroll | this slice | **Yes** |
| DEC-EXC-005 | No historical activity backfill; feed starts at go-live | avoids synthesizing evidence | low | payroll | this slice | **Yes** |
| DEC-EXC-006 | FE `PayrollExceptionQueuePage` deferred to a following slice | backend-first; mirrors runs-register | med (page not shipped) | payroll | next slice | **Yes (FE after)** |
| DEC-EXC-007 | Reads gate `finance.payroll.view_all`; commands reuse existing granular `finance.payroll.finding.{assign,resolve,waive,reopen}`; escalate reuses `finding.assign`; comment gates `view_all` | confirmed against `financePayroll.ts:1104-1283` — no new permission introduced | low | payroll | confirmed 2026-07-19 | **Yes** |
| DEC-EXC-008 | Severity/kind mapping: blocker→kind`blocker`/sev`critical`; warning→kind`warning`/sev`medium`; info→kind`warning`/sev`low`; approval→kind`approval`/sev`high` | §15.3 splits `kind` (source) vs `severity` (priority); DB has only info/warning/blocker | low | payroll | this slice | **Yes** |
| DEC-EXC-009 | **Compatibility:** `findings/get` is left UNCHANGED (returns `PayrollControlFinding`; consumed by existing payroll pages). The Exceptions detail is a NEW `findings/detail` route returning `PayrollFindingDetail` + activity feed; the work-queue `selected` hydrates via the same detail function | changing `findings/get`'s response shape would break existing consumers | low | payroll | this slice | **Yes** |
| DEC-EXC-010 | `impact` object present on EVERY row (stable FE shape): findings → `{amount:null, employeeCount:null, label:null}`; approval rows → run `net_total`/`employee_count` + label `"Run net pay"` | consistent DTO beats omitting the object | low | payroll | this slice | **Yes** |

## 15. Approval

- Product/scope approval: **pending user sign-off of this contract**
- Security/SQL reviewer: pending (RPC + new evidence table)
- UX approval: N/A (FE deferred)
- Test-plan approval: pending (see matrix)
- Date: 2026-07-19
