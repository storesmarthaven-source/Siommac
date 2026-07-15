# Payroll-run submit (Shape A1) — AUTHORITATIVE SLICE CONTRACT

> ONE source of truth for the finding-#3 payroll-submit vertical slice. Supersedes any
> conflicting statement in SUBMIT_TX_DESIGN.md / SUBMIT_TX_BUILD.md **for this slice**.
> Every decision is **REQUIRED / FORBIDDEN / DEFERRED**. No contradictions (md5 resolved).

## 1. RPC signatures (exact)
- `wf_internal._create_instance(p_binding_id uuid, p_template_id uuid, p_template_version_id uuid, p_module_key text, p_workflow_type text, p_source_record_id text, p_source_record_ref text, p_trigger_event text, p_requested_by text, p_owner_id text, p_site_id text, p_department_id text, p_priority text, p_source_snapshot jsonb, p_assignees jsonb, p_supersedes_workflow_id uuid default null) returns jsonb` — mig 211, APPLIED.
- `wf_internal._claim_request(text, text) returns jsonb` · `wf_internal._record_request(text, text, text, text, text, uuid, jsonb) returns void` — mig 211, APPLIED.
- `wf_internal._resolve_and_validate_assignee(p_assignment jsonb, p_source_ctx jsonb, p_owner_id text) returns jsonb` — mig 212.
- `public.workflow_submit_for_record_tx(p_source_table text, p_source_id text, p_actor_id text, p_binding_id uuid, p_request_key text, p_business jsonb default '{}') returns jsonb` — mig 212.
- TS: `submitRun(runId: string, actorId: string, idempotencyKey: string): Promise<PayrollRunDto>` — **REQUIRED** 3rd arg, no default.

## 2. Schema columns touched (verified against live migrations)
- `finance_payroll_runs`: `id uuid`, `run_no text`, `period_month date`, `status` (enum below), `workflow_id uuid`, `created_by text`, `updated_at` (trigger).
- `workflow_instances` / `workflow_tasks` / `workflow_audit_log` / `app_events` / `hr_audit_log(previous_state,new_state)` / `handoff_outbox` / `module_workflow_bindings` / `workflow_template_versions` / `workflow_templates.module_key` — per migs 20260704000001/03, 20260621100000, 20260919000210.

## 3. Allowed transitions (REQUIRED)
- from `calculated` | `returned` → `pending_approval`. Any other from-status ⇒ **WF409**.
- Resubmit (`returned`) allowed **only if** the prior `workflow_id` is terminal ∈ `{completed,approved,returned,rejected,cancelled,closed}` AND belongs to this record (same module + source_record_id) ⇒ else **WF409**; carries `supersedes_workflow_id`.
- Run status enum: `draft,input_locked,calculated,pending_approval,returned,approved,locked,exported,cancelled`.

## 4. Lock order (REQUIRED — no deadlock vs decide/finalize 160/170 or binding admin)
`finance_payroll_runs` row (`FOR UPDATE`) → `module_workflow_bindings` (`SHARE MODE`, re-entrant in `_create_instance`) → `workflow_template_versions` row (`FOR SHARE`) → `workflow_templates` row (`FOR SHARE`) → insert `workflow_instances`/`workflow_tasks`. Binding admin touches only the bindings table ⇒ no cycle.

## 5. Idempotency inputs (REQUIRED; md5 = REQUIRED, sha256 = FORBIDDEN here)
- Receipt key (SCOPED): `actor|submit|source_table|request_key`. Advisory lock: `pg_advisory_xact_lock(hashtextextended(receipt_key,0))` (64-bit).
- `request_hash = md5((jsonb_build_object('table',...,'source',...,'actor',...,'binding',...,'business',p_business))::text)` — canonical, server-computed. **md5 not sha256:** pg_catalog builtin, always resolves under `search_path=public`, matches decide RPC 160, no pgcrypto dependency; non-adversarial fingerprint (not security).
- Same key+hash ⇒ stored result (200). Same key + different hash ⇒ **WF409**. Blank key ⇒ **WF400** (REQUIRED end-to-end; **server fallback FORBIDDEN**). FE generates ONE key per attempt, reused on retry, cleared only on definitive success.

## 6. Side-effect ownership (REQUIRED — displaced writes DELETED on cutover)
| Responsibility | Owner |
|---|---|
| workflow instance / tasks / `workflow.*` events / `workflow_audit_log` | primitive `_create_instance` |
| business status + `workflow_id` | wrapper `workflow_submit_for_record_tx` |
| business `finance.payroll.run.submitted` event + `hr_audit_log` + `handoff_outbox` | wrapper (same txn) |
| notification delivery (finance_manager) | post-commit TS `submitRun` |
| API response mapping (PayrollRunDto) | route/service (`submitRun` refetch) |

DELETED from TS `submitRun` (grep-gated): `startWorkflowForRecord`, status-flip, `workflow_id` stamp, `writeHrAudit`, `emitAppEvent('finance.payroll.run.submitted')`, `createHandoff`, the compensating rollback, and the fabricated DTO fallback.

## 7. Required invariants → proving test (`scripts/e2e/suites/financePayroll.mjs`)
| Invariant | Test |
|---|---|
| Failed creation leaves run unchanged (no strand/orphan) | "a rejected submit leaves the run UNCHANGED" |
| Same key+payload ⇒ exactly one workflow | "retry with the same idempotency key…no double-create" |
| Same key + different payload ⇒ WF409 | "same key + different payload is rejected WF409" |
| Concurrent ⇒ one workflow + one side-effect set | "concurrent submits — exactly one succeeds" |
| Returned run resubmits (fresh wf + supersedes) | "a returned run resubmits…via supersedes" |
| Audit/event/handoff/task counts EXACT (no dup) | count=1 assertions inside the idempotent-retry test |
| Legacy status/start/stamp path gone | grep gate: no `startWorkflowForRecord` in payrollRuns.ts |
| Unauthorized caller rejected | "employee is DENIED submitting a run" |
| Missing idempotency key rejected | "a submit without an idempotency key is rejected" |

## 8. DEFERRED (tracked, not this slice)
- Shape-A A2–A13, Shape-B/C create-and-start, explicit-start auth, final-cutover active-wf unique index.
- Full binding re-selection parity (condition operators / role-scope actorRoleIds).
- `dynamic_field` assignee resolution (raises WF422 until an HR slice needs it).
- Durable notification intent + delivery worker (engine-wide).
- `workflow_request_receipts` E2E cleanup (schema off PostgREST — receipts leak, TAG-scoped, harmless).

## 9. Verification gate (REQUIRED before "done")
GREEN (static): backend `tsc`, frontend `tsc`, E2E `node --check`, legacy grep gate.
PENDING (live — operator/env): apply mig 212 (CLEAN path, NOT the dashboard AI Assistant) → `npm run build:backend` → restart `dev:netlify` → `npm run test:e2e -- financePayroll`. **Not "done" until this is green.**
