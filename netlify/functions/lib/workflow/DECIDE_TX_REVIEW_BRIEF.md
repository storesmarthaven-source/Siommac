# Second-opinion brief — atomic workflow decisions (for external review)

Self-contained review packet. Full repo-grounded version:
`netlify/functions/lib/workflow/DECIDE_TX_DESIGN.md`.

## Stack & hard constraints
- **Backend:** Netlify Functions (Hono), TypeScript. **DB:** Supabase Postgres accessed via
  supabase-js over PostgREST. **Key limitation:** supabase-js issues each `.from().insert()/
  .update()` as a **separate HTTP call** — it **cannot** wrap multiple statements in one DB
  transaction. The only way to get atomicity is a **Postgres function (RPC)** that runs as one
  transaction (any `raise` rolls back everything). This pattern is already used elsewhere in the
  codebase (finance payroll commit RPCs).
- **Two-phase reality:** the workflow "advancement engine" (compute next step, resolve
  assignees) and the per-module **source adapters** (e.g. on approval, set the source permit/
  payroll-run row to `approved`) are **TypeScript** — they cannot run inside a Postgres function.
  So any decision inherently has a DB-atomic part and a TS side-effect part.
- Every mutation must also write an `app_events` row + an `audit_log` row, and terminal
  transitions fan out notifications + cross-module "handoffs".

## The workflow engine (just enough)
A workflow instance has ordered **steps**; each step spawns **tasks** assigned to a user or a
role. An approver **decides** a task (`approved | returned | rejected`). On the last approval the
workflow **completes**; a `returned`/`rejected` decision ends it too. A step can have parallel
sibling tasks — the step only advances when the **last** sibling is decided.

## The problem (today: non-atomic)
A decision is a chain of separate PostgREST calls with no transaction:
1. read task, check `status ∈ {pending,open,in_progress}` + authz
2. `UPDATE workflow_tasks` → decided
3. `INSERT workflow_decisions`, `INSERT workflow_audit_log`
4. branch (TypeScript): either **advance** (resolve next step, insert next tasks, update
   instance.current_step) or **finalize** (update instance → completed/returned/rejected, run the
   **source adapter**, enqueue handoffs, insert audit + app_event, send notifications)

Three failure modes:
- **F1 concurrency** — two approvers (or a double-click) both pass the status check → double
  decision, double advance, or the terminal adapter fires twice.
- **F2 partial state** — task marked decided but a later call fails → stuck; or instance marked
  `completed` but the **source adapter never ran** → "workflow approved while the permit is still
  pending". This is the worst one.
- **F3 retry dup** — a retry re-runs from the top, no idempotency → duplicate rows.

## Proposed design (transactional outbox)
Because the atomic DB write and the TS side-effects can't be in one place, split them:

**1. Concurrency gate.** Add `workflow_instances.pending_transition` (nullable:
`advance | finalize_completed | finalize_returned | finalize_rejected`). While non-null, the
instance has a committed-but-not-yet-applied decision and the RPC rejects new decisions. The
`status` enum (`in_progress|completed|returned|rejected|cancelled`) is left unchanged.

**2. Durable job table `workflow_outbox`** — `(id, workflow_id, task_id, kind, decision, actor_id,
payload jsonb, status[pending|processing|completed|failed|dead_letter], attempts, max_attempts,
next_attempt_at, locked_at, locked_by, last_error, created_at, processed_at)`, with
`unique(workflow_id, task_id, kind)` for idempotent enqueue.

**3. `workflow_decide_task_tx` RPC (the atomic commit)** — signature takes the ids, the
TS-resolved `actor_role` + `is_elevated` boolean (role/permission catalogue is TS-owned), the
decision/comment, and prebuilt `audit`/`event` jsonb. It:
- `SELECT ... workflow_instances FOR UPDATE` (lock instance first → serializes all decisions on
  this instance), then `SELECT ... workflow_tasks FOR UPDATE`;
- re-validate **under lock**: task open (else raise → **409**); `is_elevated OR assigned_to=actor
  OR assigned_role=actor_role` (else raise → **403**, catches a concurrent reassign);
  instance `in_progress` and `pending_transition IS NULL` (else **409**);
- `UPDATE` task → decided; `INSERT` decision + audit + app_event;
- if approved and open siblings remain → done (no transition); else set `pending_transition` and
  `INSERT workflow_outbox` job; return the outcome + `outbox_id`.

**4. Worker `processWorkflowOutbox` (TS).** Claims jobs via
`workflow_outbox_claim(worker_id, limit)` = `UPDATE ... WHERE id IN (SELECT id ... WHERE
status='pending' AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n)
RETURNING *` (race-free claim). For each job it runs the TS side-effects **outside** any txn:
- `advance` → resolve next step + assignees (pure), then call the finalize RPC to insert next
  tasks + advance status atomically.
- `finalize_*` → **run the source adapter FIRST** (the one unavoidable external write), then call
  the finalize RPC.

**5. `workflow_finalize_transition_tx` RPC.** Under instance lock: verify the outbox row is
`processing`; insert next tasks (`ON CONFLICT DO NOTHING` on an idempotency key) OR set terminal
status; `pending_transition=NULL`; enqueue handoffs; insert terminal audit + app_event; mark the
outbox row `completed`. Notifications delivered best-effort **after** this commit.

**Resulting invariant:** because the source adapter runs (in TS) *before* finalize, and the
instance stays in `pending_transition` until finalize commits, **an instance never becomes
`completed` unless its source adapter already succeeded.** If the adapter throws, the job stays
`processing`, the instance stays gated, and it's retried. Source adapters must therefore be
**idempotent** (guard on current source status; dedupe their own events) — retries re-run them.

**6. Immediate + recovery.** Happy path: the decide route processes the just-enqueued job
in-request (user sees the finalized state). A Netlify scheduled function (`*/1min`) recovers
`pending` jobs and stale `processing` rows (`locked_at < now()-2min`), with exponential backoff;
at `max_attempts` → `dead_letter` + a critical admin notification.

**7. Legacy removal.** The old non-atomic advance/finalize chain is **deleted** — one commit path,
no dual system.

## The four decisions I want a second opinion on
For each: my recommendation + the tradeoff. Please challenge these and flag anything the design
misses (deadlock ordering, the idempotency keys, the in-request-processing choice, dead-lettering,
anything).

1. **Transitional state representation.** (a) *new `pending_transition` column* [my pick — leaves
   the status enum + all its consumers untouched] vs (b) *add a `completing` value to the `status`
   enum* [fewer columns, but every status reader/badge/mapping must learn it].

2. **Processing model.** (a) *immediate in-request finalize + scheduled recovery* [my pick — best
   UX, still durable] vs (b) *always async, client polls* [simpler route handler, worse UX].

3. **Scope of the first unit.** (a) *ship decision-atomicity first, then reuse the same pattern
   for a separate "submission" atomicity fix* [my pick — smaller blast radius] vs (b) *bundle both
   now* [fewer migrations, bigger risk].

4. **Operational defaults.** worker every 1 min; reclaim stale `processing` after 2 min;
   `max_attempts=5` exponential backoff → dead_letter + critical notification; add
   `unique(task_id)` on `workflow_decisions` as an idempotency backstop. Reasonable?

## Specifically: is anything wrong or missing?
- Is "lock instance first, then task, `FOR UPDATE`" the right deadlock-safe ordering given the
  finalize RPC and a cancel path also touch both?
- Is the source-adapter-idempotency requirement a reliable enough foundation, or should terminal
  effects be redesigned to be exactly-once some other way?
- Is in-request processing of the outbox worth the coupling, or is always-async cleaner?
- Any failure interleaving that still leaves source and workflow inconsistent?
