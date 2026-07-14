# Atomic Workflow Decisions — `workflow_decide_task_tx` + transactional outbox (v2)

> **STATUS: DESIGN v2 — codex second-opinion incorporated; awaiting go-ahead + scope decision.**
> v1 (transactional-outbox direction) was validated but not implementation-ready. This v2 folds in
> the 10 codex findings. Finding #1 of the ORIGINAL audit (auth bypass) is fixed + committed
> (`0ed1ea8a`). Authoring conventions follow `MUTATION_BACKBONE_PLAN.md` + finance RPCs
> `20260919000060/70`.

## What changed from v1 (the codex deltas)
1. **Per-adapter durable receipt** replaces the weak "adapters must be idempotent" assumption.
2. **Transition identity** (`workflow_transitions` + `active_transition_id`), not a bare
   `pending_transition` text.
3. **Fenced worker leases** (`lease_token`), not just `locked_by/at`.
4. **Semantic idempotency** via `input_hash` — identical retry returns the original result.
5. **RPC self-resolves authorization** — never trusts caller-supplied `is_elevated`/role, and
   builds authoritative audit/event fields itself.
6. **RPC re-checks decision requirements** (comment/attachment) against the template snapshot +
   attachment existence/association.
7. **`resolve_approved_step`** transition kind — the RPC never guesses advance-vs-complete.
8. **All competing commands** (decide/cancel/delegate/reassign/escalate/SLA/finalize) share the
   instance-first locking + gating protocol; terminal decisions atomically close open siblings.
9. **Notification/handoff intent is durable inside the finalize transaction** (only push/realtime
   delivery is async).
10. **Dead-letter operational surface** (visible failed state, alert, admin replay, metrics; never
    auto-clear `active_transition_id`).

---

## 1. The problem (unchanged — see §1 history)
`decideTask` runs ~6 writes + TS advancement/adapter/handoff/notify as separate PostgREST calls,
no transaction. Failure modes: **F1** concurrency (double decide/advance), **F2** partial state
(worst: instance `completed` but source adapter never ran → "approved workflow, pending permit"),
**F3** retry dup. supabase-js can't wrap multi-statement transactions → atomicity requires RPCs;
advancement (`resolveNext`, `createTaskForStep`) + source adapters are TS → two-phase → outbox.

## 2. Data model

### 2a. `workflow_transitions` (the business transition — identity + status)
```
id             uuid pk default gen_random_uuid()
workflow_id    uuid not null references workflow_instances(id)
task_id        uuid null references workflow_tasks(id)
kind           text not null   -- resolve_approved_step | finalize_returned | finalize_rejected | cancel
decision       text null       -- approved | returned | rejected
actor_id       text not null   -- app_users.id (TEXT)
input_hash     text not null   -- sha256(workflow_id,task_id,actor,decision,comment,attachmentIds,override_reason)
status         text not null default 'pending'  -- pending | processing | completed | failed | dead_letter
result         jsonb null      -- the successful outcome, returned verbatim on identical retry
created_at     timestamptz not null default now()
completed_at   timestamptz null
```
- `unique (task_id, kind)` — one transition per task decision (semantic-idempotency backstop).
- `workflow_instances.active_transition_id uuid null references workflow_transitions(id)` — the
  concurrency gate. Non-null ⇒ the instance is mid-transition; new commands are refused. A derived
  **`transitioning`** flag is exposed to the FE (not a new `status` enum value).

### 2b. `workflow_outbox` (delivery queue only — separated from the business transition)
```
id, transition_id uuid not null references workflow_transitions(id),
status[pending|processing|completed|failed|dead_letter], attempts, max_attempts default 8,
next_attempt_at, lease_token uuid null, lease_expires_at timestamptz null, locked_by,
last_error, created_at, processed_at
```
Separating transition (business) from outbox (delivery) keeps dead-letters, replay, and admin
ops clean. `unique(transition_id)` (one live delivery per transition).

### 2c. Per-module source receipt (finding #1)
Each **multi-write** adapter writes a receipt row keyed by `transition_id` inside its own module
RPC (see §5). Shape (per module, or one shared table with a `module_key`):
```
workflow_source_receipts(transition_id uuid pk, module_key text, source_id text,
  input_hash text, result jsonb, created_at timestamptz default now())
```
A retry with the same `transition_id` returns the stored `result` and performs **no** writes; a
different `input_hash` for the same `transition_id` raises (tamper/bug guard).

### 2d. Backstops
`unique(task_id)` on `workflow_decisions` with `task_id NOT NULL`.

## 3. Instance-first locking protocol (finding #8 — ALL commands obey it)
Every competing command — decide, cancel, delegate, reassign, escalate, SLA sweep, admin
override, finalize — acquires locks in this order to avoid deadlock:
1. `workflow_instances` FOR UPDATE
2. its `workflow_transitions` / `workflow_outbox` row
3. `workflow_tasks` (ordered by `id` when locking several)
4. other workflow-owned rows
A command that finds `active_transition_id IS NOT NULL` refuses with **409** (except the finalize
that owns that transition). Terminal `returned`/`rejected`/`cancel` **atomically close all open
sibling tasks** in the same statement.

## 4. `workflow_decide_task_tx` (atomic commit — RPC)
Inputs: `p_workflow_id, p_task_id, p_actor_id, p_decision, p_comment, p_attachment_ids,
p_override_reason`. **No** caller-supplied role/elevation/audit/event (finding #5).
Atomically (`security definer`, service_role only):
1. Lock instance FOR UPDATE; require `status='in_progress' AND active_transition_id IS NULL` (else
   **409**).
2. Lock task FOR UPDATE; require `workflow_id` match and `status ∈ {pending,open,in_progress}`
   (else **409**).
3. **Resolve authorization from canonical tables** (not the caller): read `app_users.role`;
   `is_elevated = role='superadmin' OR EXISTS user_permissions/role_permissions grant of
   'workflow.instances.admin_override' | 'workflow.instances.reassign'`. Require
   `is_elevated OR task.assigned_to=p_actor_id OR task.assigned_role=role` (else **403**). If
   elevated-not-assigned, require `p_override_reason` (else **422**) and flag the audit row as an
   override.
4. **Re-validate decision requirements** from the instance's immutable `template_snapshot` step
   rules (requireCommentOnApprove/Return/Reject, requireAttachment) → **400**; verify each
   attachment id exists and is associated with this workflow/actor.
5. **Compute `input_hash`.** If a `workflow_transitions` row for `(task_id, kind)` already exists:
   same hash ⇒ return its stored `result` (idempotent success); different hash ⇒ **409**.
6. `UPDATE workflow_tasks` → decided; `INSERT workflow_decisions`; build + `INSERT`
   authoritative `workflow_audit_log` + `app_events` (dedupe_key) from the LOCKED row values.
7. Branch:
   - **approved & open siblings remain** → done; no transition (return `recorded_step_open`).
   - **approved & last sibling** → create `workflow_transitions(kind='resolve_approved_step')`,
     set `active_transition_id`, enqueue `workflow_outbox`.
   - **returned/rejected** → `workflow_transitions(kind='finalize_returned|rejected')`, set
     `active_transition_id`, close open siblings, enqueue outbox.
8. Store the outcome in `workflow_transitions.result`; RETURN `{ outcome, transition_id, http }`.

## 5. Worker + finalize (the TS side-effects, made exactly-once)
Claim via `workflow_outbox_claim(worker_id, limit)` → `UPDATE ... SET status='processing',
lease_token=gen_random_uuid(), lease_expires_at=now()+'5 min', attempts=attempts+1 WHERE id IN
(SELECT id ... WHERE (status='pending' AND next_attempt_at<=now()) OR (status='processing' AND
lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`. The
returned `lease_token` **fences** every subsequent write (finding #3): finalize/heartbeat/retry/
fail all include `WHERE lease_token=p_lease_token` — a reclaimed-then-resumed worker can't clobber.

Per job (outside any txn):
- **`resolve_approved_step`** → TS `resolveNext`. If complete → treat as finalize-completed; else
  resolve next step + assignees (pure) → finalize RPC inserts the next tasks + advances.
- **`finalize_*`** → call the module's **source-transition RPC** (finding #1), passing
  `transition_id` + `input_hash`. That RPC, in ONE transaction: locks the source record, validates
  its expected current state, applies **every** source mutation + module audit/event/satellite +
  the receipt, and returns the stored result on retry. Only after it succeeds does the worker call
  the workflow finalize RPC.

### `workflow_finalize_transition_tx` (fenced, atomic)
Under instance lock, `WHERE active_transition_id=p_transition_id AND outbox.lease_token=p_token`:
verify the source receipt exists for `p_transition_id` (finding #1 — never finalize without proof
the source committed); insert next tasks (`ON CONFLICT DO NOTHING`) OR set terminal status;
`active_transition_id=NULL`; **durably insert** notification-outbox + handoff-outbox + terminal
audit + app_event, all with deterministic dedupe keys (finding #9); mark transition + outbox
`completed`. Realtime/push delivery happens best-effort AFTER commit.

**Invariant:** an instance never becomes terminal/advanced unless (a) the source receipt for that
exact transition exists and (b) the fencing token is current. Retries are exactly-once-observable.

## 6. HTTP mapping (finding #2 answer)
- 200 — decision committed AND finalized in-request.
- **202 + transition_id** — decision committed, finalization still pending (in-request processing
  failed/slow; recovery worker will finish). **Never 500 after the decision committed.**
- 403 not-assigned · 409 concurrent/already-decided/mid-transition · 422 SoD/override-reason ·
  400 decision-requirement/attachment.

## 7. Immediate + scheduled recovery (finding #2/#10)
Happy path processes the job in-request. `workflow-outbox-worker.ts` scheduled `*/1min`
(pattern: `hse-ptw-sweeps.ts`) claims pending + lease-expired rows, exponential backoff,
`max_attempts=8` → `dead_letter`. Dead-letter: `workflow.transition_failed` critical alert +
admin replay endpoint + attempts/error history + queue-depth/oldest-job metrics. **Never
auto-clear `active_transition_id`** — a dead transition stays gated until an admin acts.

## 8. Adapter scope (grounded — the real cost of finding #1)
~20 registered adapters:
- **5 HSE** (`makeStatusSyncAdapter`) — a single guarded `UPDATE status` with no other writes →
  **already exactly-once; no receipt needed** (just assert they emit nothing else).
- **~15 finance/HR** (payroll, statutory, loan, pay-component, payslip-template, remittances,
  nis-profile; hr employee-master, org-structure, leave, transfer-promotion, requests, attendance,
  overtime, compensation) — **multi-write** (source UPDATE + `writeHrAudit` + `emitAppEvent` +
  handoff/notify). A crash-retry today would **dup the audit / event / handoff**. These need the
  source-transition RPC + receipt. This is the bulk of the work.
  - **Correction (verified in code):** payroll *approval* does NOT post GL — `emitRunApprovedSideEffects`
    only sends (idempotent) notifications + a `payroll_locking` handoff; GL/loan ledger posting
    happens later at **lock** time (a separate action, not workflow-driven). So the payroll receipt
    RPC is modest (status + SoD + audit + event + handoff), not a GL port. See
    `20260919000180_finance_payroll_workflow_transition_tx.sql`.

## 9. Legacy removal
The non-atomic advance/complete/return/reject chain in `decideTask` is deleted; `decideTask`
becomes pre-validate → `workflow_decide_task_tx` → process outbox → map HTTP. The finding-#1
shared authz guard stays as defense-in-depth (the RPC is now authoritative). `cancelWorkflow`,
delegate, reassign, escalate move onto the §3 protocol.

## 10. E2E (added, verified live)
Concurrency (one 200 + one 409); crash-window (finalize fails after source receipt → instance
gated, source not double-written, recovers, no dup); stale-worker fencing (reclaimed lease can't
clobber); exact-retry (identical decide → original result; different payload → 409); terminal
sibling-close; dead-letter + alert + admin replay; per-adapter exactly-once (GL posted once).

## 11. The four decisions — answered (codex-aligned)
1. **Transition identity** = `workflow_transitions` + `active_transition_id` (+ derived
   `transitioning` FE flag). Not a bare text, not a `completing` status value.
2. **Hybrid** immediate + scheduled; **202** when finalization pends; never 500 post-commit.
3. **Decision transitions first**, submission (finding #3) separate — BUT cancel/reassign/
   delegate/escalate join the §3 locking/gating protocol in THIS package.
4. Worker `*/1min`; **5-min lease + heartbeat** (not a 2-min blind reclaim); **`max_attempts=8`**
   capped exp backoff; `unique(task_id)` on `workflow_decisions`, `task_id NOT NULL`.

## 12. Build sequence (codex-recommended)
1. Define transition/receipt/lease/idempotency invariants (this doc).
2. Migrations: `workflow_transitions`, `workflow_outbox`, source-receipt schema, `active_transition_id`, backstops.
3. `workflow_decide_task_tx` + `workflow_outbox_claim` RPCs.
4. Convert each multi-write source adapter → transactional receipt-producing RPC.
5. Fenced `workflow_finalize_transition_tx` + retry/dead-letter RPCs.
6. Move every competing command onto instance-first locking/gating.
7. Delete the legacy decision chain.
8. E2E: concurrency, crash-window, stale-worker, exact-retry, terminal-sibling, dead-letter.

## 13. Scope reality — the decision to make before building
The correct (codex-complete) version is a **big-bang across the workflow engine**: 3–4 core RPCs +
the transition/outbox/receipt schema + **~15 adapter→RPC conversions** (each an operator-applied
migration) + every competing command re-locked + legacy deletion + a full crash/concurrency E2E
matrix. That is a large, multi-session effort touching finance GL and HR approvals. This mirrors
the `MUTATION_BACKBONE_PLAN` big-bang tension (deferred there for the same reason). Options for the
user in §responses.
