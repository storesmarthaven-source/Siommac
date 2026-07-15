# Atomic Workflow Creation — BUILD PLAN (finding #3)

> Architecture is codex-APPROVED (twice): private primitive in `wf_internal`, `SECURITY INVOKER`,
> static typed per-table wrappers, row locks, in-tx reference allocation, durable delivery, one final
> cutover. This doc is the **build contract** — it supersedes the SUBMIT_TX_DESIGN.md v1–v4 *for
> building*. We now move to CODE: codex reviews each migration's SQL + each caller-conversion diff
> (per-caller facts read from source, not prose). Full design rationale stays in SUBMIT_TX_DESIGN.md.

## Locked decisions
- Scope: ALL workflow-creation call sites become exactly-once transactional (completes the deferred
  MUTATION_BACKBONE for the start surface). Rollout: **incremental per caller, separate reviewed
  commits**, ONE release boundary (no non-atomic path survives to release).
- No binding → hard **422**. `SECURITY INVOKER`. Static typed branches (no dynamic SQL).

## Three design-level corrections folded from codex pass-5
- **#2 Assignees are NOT caller-supplied.** No `p_assignees` on any PUBLIC RPC. Each typed wrapper
  RESOLVES assignees inside the transaction from the LOCKED source row + the template assignment rule
  + canonical user/role/org relationships, then passes resolved ids to the private primitive, which
  VALIDATES each (active user, valid role, segregation-of-duties: assignee ≠ creator where required).
  Dynamic types (supervisor/dept_manager/site/hse_manager) resolve from canonical org data keyed off
  the locked source — never from free-form caller `recordData`.
- **#4 E3 (onboarding custom action) is Shape B, not explicit.** It starts the workflow then inserts
  `hr_onboarding_case_actions` (orphan risk). Convert to `hr_onboarding_action_create_and_start_tx`:
  create the case-action row + workflow atomically, using the **case-action id as `source_record_id`**
  — which also removes the shared-case-id uniqueness problem (no vague `scope_id` discriminator).
- **#7 Two explicit-start contracts.** `workflow_start_bound_tx` (binding-based, e.g.
  `/workflow-engine/start`) and `workflow_start_by_template_tx` (allowlisted template, e.g.
  `/workflows/create`). Each statically identifies its source family, locks + revalidates source
  EXISTENCE and caller access in-tx, enforces module permission, and rejects template/source mismatch.

## Idempotency (codex #1) — claim-first, not SELECT-then-INSERT
Every mutation RPC, at transaction start: `pg_advisory_xact_lock(hashtext(key))` where
`key = org|actor|operation_family|request_key`, THEN upsert a claim row in
`wf_internal.workflow_request_receipts`. Compute `request_hash = sha256(<all behaviorally-relevant
inputs>)` INSIDE the RPC. Same key+hash ⇒ return the stored result (200); same key different hash ⇒
**WF409**. Explicit starts are idempotent too. This serializes concurrent duplicates and preserves the
guarantee `module_mutation_runs` gives today.

## Notification durability (codex #6) — SQL enqueue + delivery worker
`wf_internal._enqueue_notification(...)` applies canonical recipients + preferences + mutes and writes
the `notifications` row + `notification_deliveries` rows INSIDE the mutation txn. Delivery-status
constraint gains `processing` + `dead_letter`; add `(notification_id, channel)` unique + retry columns.
A scheduled `notification-delivery-worker.ts` leases pending rows (FOR UPDATE SKIP LOCKED + fencing,
mirroring `workflow_outbox_claim`), calls the provider (at-least-once unless the provider supports
idempotency keys), records result, backs off → dead-letter.

## Build order (each = a reviewed commit + focused checks)
1. **Migration 210 — foundation schema** (this step's code): `wf_internal` schema + grants
   (schema usage AND `service_role` table/default privileges — the 211 `SECURITY INVOKER`
   helpers run as `service_role` and would otherwise hit "permission denied");
   `workflow_request_receipts`; `workflow_instances.supersedes_workflow_id`. Pure schema, low
   risk. Operator applies + NOTIFY. Post-apply probe (extend `verify-workflow-tx-apply.mjs`).
   NOTE: the `notification_deliveries` durability hardening (status constraint + retry cols +
   `(notification_id,channel)` unique + the scheduled worker) is a SEPARATE migration with its
   own data-migration preflight — it is deliberately NOT bundled into 210 (see 210's header).
2. **Migration 211 — primitive + idempotency ledger** ✅ WRITTEN (`20260919000211_workflow_creation_primitive.sql`),
   awaiting codex review + operator apply. Contains `wf_internal._create_instance` (config-revalidate
   binding/version active+published+belongs-to-template under `FOR SHARE`; snapshot-derived first
   task(s); validate each RESOLVED assignee = active user / known role / opt-in SoD; instance + tasks +
   `workflow_audit_log` + `workflow.started` + one `workflow.task.assigned` per task; returns
   `{workflowId, workflowNo, currentStepKey, firstTasks}`) + `_claim_request`/`_record_request`
   (advisory-xact-lock + receipt ledger — the exactly-once guarantee `module_mutation_runs` gives
   today, but in-txn). `SECURITY INVOKER` (runs as service_role), grants service_role-only.
   **Two step-2 helpers deferred by design so each is exercised by a real caller's E2E, not built
   speculatively:** (a) `_resolve_and_validate_assignee` → lands with the **212** payroll wrapper,
   where the real assignment types are known (the primitive already VALIDATES what the wrapper
   resolves — single authority); (b) `_enqueue_notification` → the **notification-durability track**
   (separate migration; needs the `notification_deliveries` hardening). Until (b) lands, the wrapper
   fans out notifications in TS post-RPC from the returned `firstTasks` (parity with today), using a
   **notify-ONLY** path so it does NOT re-emit the `workflow.started`/`workflow.task.assigned`
   app_events the primitive already wrote. `workflow_no` = **4-digit** (`WF-YYYY-NNNN`, matching
   `nextRef`, not the design's 5-digit).
   ⚠ Cannot be machine-verified pre-apply (no local psql/parser; `wf_internal` is off PostgREST).
   Verification = operator apply + catalog existence check (see `docs/APPLY_MIGRATIONS.md`), then the
   **212 payroll-submit E2E** (first public caller) proves it behaviorally.
3. **Migration 212 + wire — first vertical slice**: `workflow_submit_for_record_tx` with the
   **payroll-run** branch (A1) + wire `submitRun` + delete its legacy dance + E2E (proves the whole
   Shape-A pattern end-to-end, incl. idempotency + no-strand).
4. **Per-caller commits** — remaining Shape A (A2–A13), Shape B typed `*_create_and_start_tx`
   (B1–B8 = the moduleServiceAdapter families expand to CAPA/incident/hazard, per codex #3, so ~27
   families), Shape C (C1 NIS re-approval), E1/E2/E3. Each: typed branch/RPC + wire + delete legacy +
   binding seed if missing (e.g. **`finance_ap_approval`** — codex #9) + module E2E. Correct
   per-caller transition facts read from source (codex #5: timesheet `draft|reopened→in_review`,
   statutory `draft→pending_approval`, hazard `→under_review`).
5. **Final cutover migration** — active-workflow unique index (canonical terminal set
   `{completed,approved,returned,rejected,cancelled,closed}` + dup preflight) keyed on the real source
   discriminator; delete `startWorkflowForRecord`'s ad-hoc path; **grep gate** = zero legacy callers.
   Full suite green = release.

## Deferred to P1 hardening (tracked, not release-blocking)
- #8 full SQL binding-SELECTION parity (scope rank + priority + 11 condition operators) + parity
  tests. Foundation uses a LIGHT revalidate (binding still active, version still published + belongs to
  template) — catches the P0 race; full re-selection parity is additive.
- #9 published-version immutability triggers (reject update/delete on published versions).
