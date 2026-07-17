# `workflow_start_instance_tx` - Explicit-Start Contract (v2)

> Design authority: `SUBMIT_TX_DESIGN.md` §2d, §7.
> This document is the REQUIRED/FORBIDDEN/DEFERRED preflight for the explicit-start
> slice (finding #3, Shape E). Read it before modifying the RPC or any call site.

---

## 1. RPC signature

```sql
public.workflow_start_instance_tx(
  p_template_version_id uuid,         -- REQUIRED
  p_module_key          text,         -- REQUIRED
  p_workflow_type       text,         -- REQUIRED
  p_source_record_id    text,         -- REQUIRED
  p_source_record_ref   text   = null,
  p_trigger_event       text   = 'manual.start',
  p_requested_by        text   = null,
  p_owner_id            text   = null,
  p_site_id             text   = null,
  p_department_id       text   = null,
  p_priority            text   = 'medium',
  p_source_snapshot     jsonb  = '{}',
  p_assignees           jsonb  = '{}',  -- backend-resolved first-step assignees
  p_request_key         text   = null  -- blank -> no dedup; non-blank -> exactly-once
) returns jsonb  -- { workflowId, workflowNo, currentStepKey, firstTasks }
```

Returns `{ workflowId uuid, workflowNo text, currentStepKey text, firstTasks jsonb[] }`.
On an idempotent duplicate hit, returns the stored result plus `"duplicate": true`.

Custom SQLSTATEs: `WF422` (invalid input), `WF404` (template/version not found),
`WF409` (config changed / concurrent conflict). Mapped to HTTP by `rpcHttpError()`.

---

## 2. REQUIRED — what this RPC guarantees

- **Template-mode only** (no binding; `p_binding_id` is always NULL internally).
  Bound starts (Shape A/B) use `workflow_submit_for_record_tx` /
  `workflow_create_and_start_tx`.
- **Atomically** inserts `workflow_instances` + first-step `workflow_tasks`
  + `workflow_audit_log` (workflow.started) + `app_events`
  (workflow.started + one workflow.task.assigned per task) via
  `wf_internal._create_instance`.
- **In-txn template re-validation**: the version is re-read FOR SHARE so a
  concurrent version-status change cannot slip through.
- **Server-derived context**: public HTTP routes load the canonical source row,
  enforce actor scope, redact sensitive fields, and resolve first-step assignees.
  Caller-supplied snapshots and assignees are rejected by strict request schemas.
- **In-txn receipt** (when `p_request_key` is non-blank): `_claim_request` blocks
  concurrents on the same key; `_record_request` writes the receipt in the same txn.
  Same key + same hash -> return stored result (idempotent 200).
  Same key + different hash -> `WF409`.
- Does **NOT** update the source record (no `workflow_id` link, no status change).
  Source linkage belongs to the typed Shape-A/B wrappers.

---

## 3. FORBIDDEN — what the call sites must NOT do

- **No dual path**: callers MUST NOT call `startWorkflowForRecord` / `instantiateWorkflow`
  for explicit starts after migration 396 is applied. Build-new -> delete-legacy.
- **No re-emit**: the TS wrapper MUST NOT call `emitAppEvent` / `emitWf` for
  `workflow.started` or `workflow.task.assigned` after the RPC returns — the primitive
  already wrote those in-txn. Doing so doubles the events.
- **No source-record update in TS**: any `UPDATE source SET workflow_id = ...` after
  this RPC is a band-aid. If source linkage is needed, use the Shape-A/B wrappers.
- **No auth bypass**: routes MUST run canonical source loading, actor-scope checks,
  and module authorization BEFORE calling this service-role-only RPC.
- **No caller-supplied workflow context**: public routes MUST reject `recordData`,
  `assignees`, owner/site/department overrides, and caller priority. The backend
  alone constructs `p_source_snapshot` and `p_assignees`.

---

## 4. Auth model per call site

### E1 — `POST /api/workflows/create`
**Gate 1 (platform):** `workflow.view` via `requirePermission`.
**Gate 2 (module):** actor must hold `MODULE_START_PERMISSION[sourceModule]`
  checked via `userCan`. Unknown module -> 403.
**Gate 3 (source):** `buildCanonicalStartContext` resolves the module through the
  static `SOURCE_SPECS` registry, requires the canonical UUID for UUID-backed
  modules, loads the source record, and applies `assertInScope`. Unknown module ->
  422; malformed identifier -> 400; missing record -> 404; out-of-scope -> 403.
**idempotencyKey**: REQUIRED in Zod schema (uuid); FE generates `crypto.randomUUID()`
  per mutation attempt.

### E2 — `POST /api/workflow-engine/start`
**Gate 1 (platform):** `workflow.submit` via `requirePermission`.
**Gate 2 (module):** actor must hold `MODULE_START_PERMISSION[moduleKey]`
  checked via `userCan`. Unknown module -> 403.
**Gate 3 (source):** same canonical registry load and scope check as E1.
**templateVersionId**: REQUIRED in Zod schema (replaces bound-start binding resolution).
**idempotencyKey**: REQUIRED in Zod schema (uuid); caller generates per attempt.
**assignees / recordData / context overrides**: FORBIDDEN by the strict Zod
  schema. The backend resolves assignees from the canonical source snapshot.

### E3 - onboarding custom approval action

E3 is not an explicit start. It creates an onboarding case-action row and starts a
workflow for that new action, so it requires the typed
`hr_onboarding_action_create_and_start_tx` Shape-B wrapper. Until that wrapper and
caller cutover land, E3 remains a tracked blocker and MUST NOT be described as
transactionally complete.

---

## 5. Source-validation rules

`buildCanonicalStartContext(input)` in `sourceContext.ts`:
- rejects modules absent from the static source registry;
- rejects non-UUID references for UUID-backed source tables;
- loads the complete canonical source row and rejects missing records;
- derives site, department, owner, subject, supervisor, department manager, site
  manager, HSE manager, area owner, requester manager, priority, and source ref;
- applies `assertInScope` before any workflow can be created;
- removes password, MFA, banking, and token fields from the stored snapshot.

---

## 6. Idempotency semantics

The `p_request_key` hash is computed from
`{ version, module, type, source, trigger, actor }`.
Two concurrent explicit-start calls with the same key and the same hash return the
same `workflowId` (exactly-once). A second call with a different hash (different
payload) raises WF409 — this is a caller bug, not a retry.

For E1/E2 the idempotencyKey is a per-attempt `crypto.randomUUID()` (stable
within one attempt, new for a user-initiated re-submit). This prevents accidental
double-start from network retries while correctly allowing a user to start a second
workflow on the same source record.

---

## 7. Side-effect ownership table

| Side-effect | Owner |
|---|---|
| `workflow_instances` row | Primitive (`_create_instance`) |
| `workflow_tasks` (first steps) | Primitive |
| `workflow_audit_log` (workflow.started) | Primitive |
| `app_events` workflow.started | Primitive |
| `app_events` workflow.task.assigned (per task) | Primitive |
| In-app notification delivery | event_rules pipeline from primitive events |
| `wf_internal.workflow_request_receipts` | This wrapper (when key non-blank) |
| Source-record status update | NOT owned here (Shape-A/B only) |
| Source-record `workflow_id` link | NOT owned here (Shape-A/B only) |
| Business `<module>.created/.submitted` event | NOT owned here (Shape-A/B only) |
| Module audit (`hr_audit_log` / `audit_logs`) | NOT owned here (Shape-A/B only) |

---

## 8. DEFERRED

- Move the canonical source read and source-scope assertion into static typed SQL
  wrappers. The current E1/E2 server-side read closes caller injection but still
  occurs immediately before the workflow transaction, leaving a narrow source-row
  change race. The typed wrappers are the final transaction-boundary design.
- E3 onboarding custom approvals: implement
  `hr_onboarding_action_create_and_start_tx`, link the workflow to the case-action
  id, and remove the current create-then-start path.

- Binding-mode support in this wrapper (pass a `p_binding_id` and omit
  `p_template_version_id`): the primitive already supports bound mode; a future
  migration can add a second wrapper or extend this one. Blocked on the final
  cutover migration (active-wf unique index + grep gate).
- Notification-durability outbox for the task.assigned events: tracked as design §8
  (notification-delivery worker). All three sites today rely on the event_rules
  pipeline from the primitives in-txn app_events.
- `supersedes_workflow_id` support for explicit-start resubmit: not needed for
  E1/E2/E3 today. Add when a UI action requires it.
