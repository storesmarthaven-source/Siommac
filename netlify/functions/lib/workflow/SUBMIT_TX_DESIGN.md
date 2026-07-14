# Atomic Workflow Creation — submit / create-and-start / explicit-start (finding #3, v4)

> **STATUS: DESIGN v4 — codex 4th-pass incorporated; FOR CODEX REVIEW.** Architecture confirmed by
> codex (private schema, `SECURITY INVOKER`, static typed branches, row locks, in-tx ref allocation,
> preflight, one release boundary). v4 adds: the corrected 25-site inventory, THREE complete contracts,
> request-key idempotency on both mutation shapes, side-effect ownership, `onWorkflowStarted`
> migration, explicit-start auth, and the notification-delivery worker.
>
> **Locked user decisions:** scope = ALL sites exactly-once (completes deferred MUTATION_BACKBONE for
> the workflow-start surface); rollout = **incremental per module, separate reviewed commits**, ONE
> release boundary (no non-atomic path survives to release); no-binding → hard **422**; static typed
> per-table branches; `SECURITY INVOKER`.

## 0. Caller inventory (25 sites — codex P0 #1) — the build checklist
**Shape A — status transition on an EXISTING record** (record exists → flip status → start):
| # | site | source table | transition |
|---|---|---|---|
|A1| finance/payrollRuns.submitRun | finance_payroll_runs | calculated\|returned → pending_approval |
|A2| finance/payslipTemplates.submitTemplate | payroll_payslip_templates | draft\|changes_requested → pending_approval |
|A3| finance/remittances.submitRemittance | finance_remittances | submitted |
|A4| finance/loans.submitLoan | finance_employee_loans | → pending_approval |
|A5| finance/accountsPayable.submitBill | finance_ap_bills | draft → submitted |
|A6| finance/disbursements.submitDisbursement | finance_disbursements | draft → submitted |
|A7| finance/expenses.submit | finance_expense_claims | draft → submitted *(+ ticket + msg thread)* |
|A8| finance/statutoryConfig:443 (submit version) | finance_statutory_versions | → pending |
|A9| hr/compensationMutations | hr_employee_pay_items | draft → pending_approval |
|A10| hr/timesheetService | hr_timesheets | submitted → **in_review** (onStarted!) |
|A11| hseRiskJsa:752 risk-assessment | hse_risk_assessments | → submitted |
|A12| hseRiskJsa:1214 JSA | hse_jsa | → submitted |
|A13| hseRiskJsa:1854 hazard | hse_hazards | → submitted |

**Shape B — CREATE-and-start** (INSERT business row + start):
| # | site | business table | notes |
|---|---|---|---|
|B1| hr/organizationChangeRequests | hr_org_change_requests | insert(draft) + start |
|B2| hr/leaveCore | (leave case) | insert(pending_approval) + start |
|B3| hr/overtimeMutations | hr_overtime_entries | insert + start; compensating DELETE today |
|B4| hr/requestsCore | hr_requests | create + start |
|B5| hr/statutoryProfileMutations | (hr statutory profile) | insert + start |
|B6| finance/payrollComponents | finance_pay_component_change_requests | create change-request + start |
|B7| routes/hr.ts:1211 | hr_employee_change_requests | create + start; null-binding → direct maker-checker today |
|B8| moduleServiceAdapter:188 | (generic) | write row → emit → start; guarded by **module_mutation_runs** today |

**Shape C — edit satellites + restart:** C1 = finance/statutoryConfig:858 (NIS re-approval: edit version + restart).

**Explicit template start** (no source-status flip): E1 = routes/workflows.ts:46 `/workflows/create`
(`startWorkflowByTemplate`, arbitrary template/module/source, perm `workflow.view` — auth hole);
E2 = routes/workflowEngine.ts:36 `/workflow-engine/start` (`startWorkflowForRecord`, arbitrary source
id, generic perm — auth hole); E3 = hr/onboardingCustomActions:131 (`startWorkflowByTemplate`; **many
approvals share the same case id + workflow type** → §9 index discriminator).

_Each row = one reviewed commit. Shapes verified per-commit during the build (C1/composite AP create-
and-submit confirmed in their own commit)._

## 1. Problem (all shapes)
Flip/insert the business state, THEN start the workflow (TS), THEN unchecked `workflow_id` link.
Strands: null-workflow silently skipped (F1); unchecked link (F2); crash-window (F3). Shape B also
loses the `module_mutation_runs` idempotency if naively converted.

## 2. Three contracts over one primitive
```
wf_internal._create_instance(...)                 -- PRIVATE schema; grant service_role usage+execute
public.workflow_submit_for_record_tx(...)         -- Shape A: source lock/transition + primitive
public.<module>_create_and_start_tx(...)          -- Shape B: business insert (+sat) + primitive
public.workflow_start_instance_tx(...)            -- Explicit start: primitive only (binding OR version)
```

### 2a. `wf_internal._create_instance` — full contract (codex #2)
Inputs (nothing forge-able is trusted): `p_binding_id uuid NULL, p_template_id uuid, p_template_version_id uuid,
p_module_key text, p_workflow_type text, p_source_record_id text, p_source_record_ref text,
p_trigger_event text, p_requested_by text, p_owner_id text, p_site_id text, p_department_id text,
p_priority text, p_source_snapshot jsonb, p_assignees jsonb  (first-step-key → {userId?|roleKey?}),
p_request_key text, p_request_hash text`.
Atomically:
1. **Config reload + validate IN-TXN (codex #4):** if `p_binding_id` → re-`SELECT` the binding
   `FOR SHARE`, assert `is_active` AND it is still the winning match for
   `(module_key, workflow_type, trigger_event, scope)`; assert the version belongs to the template and
   is `published` (a pinned version must match). Explicit start (no binding) → validate the version
   directly. Load the authoritative `template_snapshot` from the version row.
2. **Derive** `firstSteps` from the snapshot; for each, build the task row FROM THE SNAPSHOT
   (step_name, step_type, is_required, due) + the caller's assignee for that key. **Reject** a task
   with neither an assignee nor a valid role, and reject missing/duplicate/later-step keys → `WF422`.
3. `v_wf_id := gen_random_uuid()`; `v_no := 'WF-'||yr||'-'||lpad(increment_ref_counter('WF',yr)::text,5,'0')`.
4. Insert `workflow_instances` (all derived columns; `supersedes_workflow_id` if given).
5. Insert `workflow_tasks` (workflow_id injected).
6. **Workflow-owned effects only (codex #5):** `workflow_audit_log` (workflow.started) + `app_events`
   `workflow.started` + one `workflow.task.assigned` per task. (Business events + module audit +
   handoffs are the WRAPPER's job — §4.)
7. Return `{ workflowId, workflowNo }`.

### 2b. `workflow_submit_for_record_tx` (Shape A)
`(p_source_table text, p_source_id uuid, p_actor_id text, p_binding_id uuid, p_assignees jsonb,
  p_request_key text, p_business jsonb)`. Static per-table CASE owns: lock SELECT, legal from→to
contract (codex #6 — the RPC defines allowed transitions per table; Risk/JSA/HR have empty
`sourceStatusMap` so the branch, not config, decides), per-table concurrency token (codex — `updated_at`
where present, else the status-guard-under-lock; `hr_employee_change_requests` has none), update cols.
Flow: whitelist → lock source `FOR UPDATE` → validate status ∈ legal-from AND token → **request-key
receipt** (§3) → supersede check (prior wf terminal, else 409; carry `supersedes_workflow_id`) → derive
instance fields from the LOCKED source row + binding (codex #4) → `_create_instance(...)` → static
`UPDATE source SET status=to, workflow_id=v.id [+ submitted_by]` → **business side effects** (§4) →
write receipt → return.

### 2c. `<module>_create_and_start_tx` (Shape B)
`(p_business jsonb, p_satellites jsonb, p_actor_id text, p_binding_id uuid, p_assignees jsonb,
  p_request_key text)`. Typed per module: (1) INSERT business row EXPLICIT typed cols (defaults apply)
→ id; (2) INSERT satellites typed; (3) request-key receipt (§3); (4) `_create_instance(source_record_id
= new id, …)`; (5) `UPDATE business SET workflow_id=v.id`; (6) business `<module>.created`/`.submitted`
event + module audit + handoffs/tickets/threads intent (§4). Replaces `moduleServiceAdapter`'s
write→emit→start and carries its idempotency (§3).

### 2d. `workflow_start_instance_tx` (explicit)
`_create_instance` with a template_version directly (no binding, no source update). Auth is the route's
job (§7).

## 3. Idempotency — request-key + request-hash on BOTH mutation shapes (codex #3)
The source-status-derived key of v3 was wrong (status changes after success → retry can't recreate it).
Use a **client-supplied `p_request_key`** (route reads/derives an idempotency key; align with the
existing `module_mutation_runs.idempotencyKey`) + a server-computed `p_request_hash = md5(business
payload)`. New table `wf_internal.workflow_request_receipts(request_key text primary key, request_hash
text, module_key text, source_id text, result jsonb, created_at)`. In each mutation RPC, FIRST:
`select … where request_key = p_request_key` → same hash ⇒ **return stored result** (idempotent 200);
different hash ⇒ **WF409**. On success, insert the receipt in the same txn. This preserves the
exactly-once guarantee `module_mutation_runs` gives today. (Explicit-start E1/E2/E3 are not retried
mutations of a business record → no receipt required, but they get the auth fix in §7.)

## 4. Side-effect ownership (codex #5 — no duplicate events)
- **Primitive owns:** workflow instance + tasks + `workflow_audit_log` + `workflow.started` +
  `workflow.task.assigned` events.
- **Typed wrapper owns (in the SAME txn):** the business event (`<module>.submitted`/`.created`),
  **module audit** (`hr_audit_log` where payroll/HR screens read it — codex #8), and business
  handoffs/tickets/message-threads intent (payroll `payroll_locking` handoff; expenses ticket + thread;
  HSE incident conditional HR/Finance/Ops handoffs). Neither the primitive nor two wrappers emit the
  same event. Delivery of tickets/threads/handoffs stays async on their existing buses (durable rows in-txn).

## 5. Canonical config + task validation (codex #4) — see §2a.1–2. Source scope/actor-roles/snapshot
come from the LOCKED source row, not caller jsonb. Binding/version rows locked (`FOR SHARE`) + validated.

## 6. `onWorkflowStarted` migration (codex #6)
Every adapter `onWorkflowStarted` behavior moves INTO the typed RPC (as the branch's `to`-status):
HR employee-change + timesheet → `in_review`; HSE status-sync → `sourceStatusMap.onStarted`. The
configurable `onStarted` map is then **formally retired** (or validated to equal the branch contract);
`onWorkflowStarted` is deleted for converted modules. No behavior silently lost.

## 7. Explicit-start auth hardening (codex #7 — a real hole)
`/workflows/create` (perm `workflow.view` only) + `/workflow-engine/start` (generic perm, arbitrary
source id) must, in v4: verify the source record EXISTS and the caller may access it, and enforce
**module-specific authorization** for the workflow type — not a blanket `workflow.*`. Both explicit-start
families are in scope.

## 8. Notification-delivery worker (codex #8) — a durable outbox
Today email/WhatsApp delivery is direct + best-effort. Add: retry columns on `notification_deliveries`
(`status, attempts, max_attempts, next_attempt_at, lease_token, lease_expires_at, last_error`), a unique
`(notification_id, channel)`, a **claim RPC** (FOR UPDATE SKIP LOCKED + fencing lease — mirror
`workflow_outbox_claim`), and a Netlify scheduled `notification-delivery-worker.ts` that leases pending
rows, calls the provider, records result, backs off → dead-letter. In-app rows + pending delivery rows
are inserted in the mutation txn (durable intent); this worker makes external delivery durable too.

## 9. Schema (migration 1)
`wf_internal` schema + grants; `workflow_request_receipts`; `workflow_instances.supersedes_workflow_id`,
`submission_key`(if retained) ; `notification_deliveries` retry columns + unique `(notification_id,
channel)`. **Canonical terminal set** `{completed,approved,returned,rejected,cancelled,closed}`. Partial
unique **one active wf per source** — but the discriminator must handle onboarding (E3) where many
approvals share case id + type: key on `(module_key, workflow_type, source_record_id, coalesce(scope_id,
''))` or an explicit per-family discriminator; **duplicate/legacy preflight** (a `do` block that RAISES
on existing violations) BEFORE the index; the index + the `startWorkflowForRecord` deletion land in the
**final cutover migration**, not migration 1 (so legacy paths aren't disrupted mid-rollout — codex #10).

## 10. Binding-seed preflight (codex #9)
Hard-422 requires every submittable type to have an active binding. **`finance_ap_approval` is NOT
seeded** → AP would break. Preflight: enumerate the required `(module_key, workflow_type, trigger)` for
all Shape-A/B sites, assert each has an active binding (source-controlled seed migration), and delete
the direct-approval/apply fallbacks (leave, timesheet, org-change) deliberately in their commits.

## 11. Rollout (incremental, one release boundary)
1. **Migration 1** — `wf_internal`, primitive, 3 wrappers, request-receipts, notification-delivery
   columns + worker, binding seeds. (NO active-wf unique index yet.) Operator applies + NOTIFY.
2. **Per-caller commits** — one reviewed commit each (25 rows in §0): add the typed branch/RPC + wire +
   delete that caller's legacy dance + module E2E. Temporary two-path state allowed ON BRANCH.
3. **Explicit-start** — E1/E2/E3 auth fix + `workflow_start_instance_tx`.
4. **Final cutover migration** — active-wf unique index (+ preflight), then delete
   `startWorkflowForRecord`'s ad-hoc path; a **grep gate** asserts zero legacy callers remain. Full
   suite green = release.

## 12. E2E (per shape)
Shape A: no-binding→422 + source UNCHANGED; success = one commit (status+workflow_id+instance+tasks+
workflow_audit_log+hr_audit_log+business event+started/assigned events+notifications+deliveries+
handoff/ticket/thread where applicable); concurrent→one 200 + one 409; **request-key retry→original
result (200)**, different hash→409; stale token/config-changed→409; forced failure→source unchanged, no
orphan; resubmit→fresh+supersedes; access control. Shape B: create+start atomic (crash→no orphan row);
request-key idempotency; module_mutation_runs parity. Explicit: source-existence + module-authz denial.
Notification worker: lease/retry/dead-letter/fencing.

## 13. Security — `SECURITY INVOKER`; primitive in `wf_internal` (service_role usage+execute); wrappers
`public`, service_role-only. Explicit-start routes module-authz'd (§7). (Follow-up: migrate the #2 RPCs
DEFINER→INVOKER so the surface doesn't diverge.)
