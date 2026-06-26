# SIOMAC — Existing Orchestration Platform (reconciliation for the Cross-Module Orchestration spec)

**Read this before implementing the "Cross-Module Orchestration" spec.** This repo already
implements ~80% of that layer. The platform rule here is **no dual systems / no parallel
tables** (build-new → delete-legacy). Several spec tables would duplicate working systems,
and a few would conflict with the **LOCKED** Central Workflow Engine. Align the spec to the
systems below; only build the genuine gaps in §3.

Conventions that already hold repo-wide:
- **POST-only** JSON routes, mounted `app.route('/api/...', router)`; every route calls
  `requirePermission(c, '<key>')`; **every handler reads `body.args ?? body`** (the FE
  `apiPost` wraps payloads as `{ args }`).
- **`app_users.id` is TEXT** (not uuid). All user FK columns are text.
- Permission keys must match the catalogue **exactly** — there's a drift-guard test.
- One mutation path: **`runModuleMutation`** (record → event → audit → workflow → handoffs,
  with idempotency). Don't hand-roll the chain per route.

---

## 1. What ALREADY exists — use these, do not re-create

### 1.1 Events — `app_events` + `emitAppEvent()`
`netlify/functions/lib/appEvents.ts`
```
app_events(id uuid, event_type, source_module, source_entity_type, source_entity_id,
           actor_user_id text, site_id, department_id, severity, payload jsonb,
           dedupe_key, created_at)
```
```ts
emitAppEvent(input: {
  eventType; sourceModule; sourceEntityType; sourceEntityId;
  actorUserId?; siteId?; departmentId?; severity?; payload?;
  dedupeKey?;                       // idempotency
  explicitRecipients?; notification?;  // drives notify + realtime signal
}): Promise<{ ok; eventId?; deduped?; recipientCount? }>
```
emitAppEvent also resolves recipients, writes `notifications`, emits a realtime
`communication_signals` row, and writes an `audit_logs` row.
→ Spec's `emitModuleEvent` = this. **Deltas the spec must adopt:** field names are
`source_module/source_entity_type/source_entity_id` (not `module_key`/`source_record_*`);
`correlation_id`/`causation_id`/`actor_type`/`visibility`/`source_record_no/title/deep_link`
do **not** exist yet (add as *additive columns* only if a concrete need appears).

### 1.2 Audit — `audit_logs` (+ HR's `hr_audit_log`)
```
audit_logs(id uuid, action, table_name, record_id, user_id text, changes jsonb, created_at)
```
Written automatically by `emitAppEvent`. HR also has a richer `hr_audit_log`
(before/after/reason) via `writeHrAudit()`.
→ Spec's `audit_events` = **do not build** (it's a second audit system).

### 1.3 Notifications — `notifications` + `notify.ts` + `event_rules`
```
notifications(id, user_id text, type, title, body, link, is_read, event_id, module,
              severity, source_type, source_id, action_route, metadata, read_at,
              archived_at, expires_at, dedupe_key, action_required, action_status,
              due_at, escalated_at, completed_at, completed_by, created_at)
event_rules(id, event_type, recipient_kind, recipient_value, notify, active, created_at)
```
`event_rules` IS the "decide who gets notified for an event" layer.
→ Spec's `notification_intents` = **do not build**; extend `event_rules` if needed.

### 1.4 Messages + Tickets — Communications module
`message_threads`, `message_participants`, `messages`, `tickets` all exist (+ realtime
signals). Threads already carry `source_module/source_entity_type/source_entity_id` (record
linkage) and `action_required/priority/last_post_*`.
→ Spec's `message_threads/messages/tickets` = already here. `ticket_links` is the only
genuinely-new bit (see §3).

### 1.5 Handoffs — `handoff_outbox` + `createHandoff()` + receivers
`netlify/functions/lib/handoffBus.ts`
```
handoff_outbox(id, source_module, target_module, source_entity_type, source_entity_id,
               target_entity_type, target_entity_id, payload jsonb, status, attempts,
               error, created_by, created_at, processed_at)
```
```ts
createHandoff({ sourceModule; targetModule; sourceEntityType; sourceEntityId;
                targetEntityType?; payload; createdBy? }): Promise<{ ok; handoffId? }>
```
Module receivers (`lib/receivers/{hr,finance,operations}Receiver.ts`) process the outbox;
registered in `lib/registerModules.ts`. The workflow engine also projects its handoffs into
`workflow_handoffs`.
→ Spec's `module_handoffs` + `module_handoff_attempts` = **do not build** (second handoff
system). If retry visibility is needed, extend `handoff_outbox` (it already has
`attempts/error/processed_at`).

### 1.6 Workflows / Approvals — Central Workflow Engine **(LOCKED)**
`netlify/functions/lib/workflow/service.ts` + adapters; routes `/api/workflow-engine` and
`/api/workflows`.
```
workflow_instances(id, workflow_no, module_key, workflow_type, source_record_id,
   source_record_ref, status, current_step_key, priority, site_id, department_id,
   requested_by, owner_id, template_id, template_version_id, template_snapshot,
   source_snapshot, started_at, completed_at, cancelled_at, ...)
workflow_tasks(id, workflow_id, step_key, step_name, step_type, task_title, assigned_to,
   assigned_role, status, decision, decision_comment, completed_by, decided_at, is_required, ...)
module_workflow_bindings(id, module_key, workflow_type, trigger_event, template_id,
   template_version_id, scope_type, scope_id, priority, conditions, is_active, ...)
workflow_decisions(id, workflow_id, task_id, actor_id, decision, comment, ...)
+ workflow_template(_version)s, workflow_handoffs, workflow_audit_log
```
```ts
startWorkflowForRecord({ context: ModuleWorkflowContext, actor }): Promise<WorkflowRow|null>
decideTask({ workflowId, taskId, actor, decision:'approved'|'returned'|'rejected', comment? })
```
A module declares a `module_workflow_bindings` row (module_key + workflow_type +
trigger_event → template) and registers a `ModuleWorkflowAdapter`
(`onWorkflowStarted/Completed/Rejected/Returned/Cancelled`). The engine instantiates,
assigns tasks, and drives approve/return/reject; the adapter applies the result.
→ Spec's `workflow_requests` + `workflow_steps` = **HARD CONFLICT — do not build.** The
locked decision is "one binding/version engine, no dual approval authority." A second
approval table would split authority. Map any "approval" need onto bindings + adapters.

### 1.7 The mutation wrapper — `runModuleMutation()` (+ idempotency ledger)
`netlify/functions/lib/moduleServiceAdapter.ts` + `moduleMutationRuns.ts`
```ts
runModuleMutation({
  context: { actorUserId; siteId?; departmentId? },
  options: {
    module; operation; entityType; idempotencyKey;
    eventType; eventSeverity?; eventPayload?; notification?; explicitRecipients?;
    workflow?: { moduleKey?; workflowType; triggerEvent; priority; required?; ... };
    handoffs?: { targetModule; condition?; payload }[];
    getEntityIdentity; buildEventPayload?; afterCommit?;
  },
  writeRecord: () => Promise<TRecord>,
})
```
Every mutation goes through this: it writes the business row (`writeRecord`), emits the
app_event (+notifications), starts the bound workflow, creates handoffs, and records a
`module_mutation_runs` row keyed by `idempotencyKey` (dedupes completed runs).
→ Spec's `runModuleMutation` = this. Don't introduce a second signature.

> Note on atomicity (already decided): true record+event+audit atomicity needs a Postgres
> RPC; supabase-js can't transact across PostgREST calls. This is documented +
> **deferred** in `netlify/functions/lib/MUTATION_BACKBONE_PLAN.md`. Do not reopen it as
> part of orchestration.

---

## 2. Hard conflicts — DELETE these from the spec
| Spec table/concept | Why not | Use instead |
|---|---|---|
| `workflow_requests`, `workflow_steps` | second approval authority; **locked** engine owns approvals | `module_workflow_bindings` + adapters + `decideTask` |
| `audit_events` | duplicate audit | `audit_logs` (+ `hr_audit_log`) |
| `module_handoffs`, `module_handoff_attempts` | duplicate handoff bus | `handoff_outbox` + `createHandoff` |
| `notification_intents` | duplicate recipient layer | `event_rules` → `notifications` |
| a new `app_events` / `messages` / `tickets` | already exist | the existing tables (add columns if needed) |
| a new `runModuleMutation` | already exists | the existing wrapper |

---

## 3. Genuine GAPS — safe + valuable to build (no conflict)
Build these *on top of* the existing backbone, in ROI order:

1. **Unified timeline service + endpoint** — aggregate the *existing* `app_events` +
   `audit_logs` + `handoff_outbox` + `workflow_instances` + `message_threads` + `tickets`
   for one record into a single feed (`POST /api/orchestration/timeline/get`). Highest ROI;
   all data already exists. (Spec §21 is right in spirit — point it at the real tables.)
2. **`record_links`** — generic record-to-record linking (we have none). Spec §7 table is
   fine as-is; adjust FK/column names to repo conventions (text user ids).
3. **`module_registry`** (+ record types / action catalog) — capability registry for
   cross-module action menus. Net-new. (Partially overlaps the permission catalogue + the
   `MODULE_ROUTE` map in `workflow/service.ts` — reuse those values.)
4. **Rule engine extension** — `event_rules` only does event→notification. A general
   `orchestration_rules` (event → create ticket / handoff / workflow / link) is a real gap,
   but should *call the existing* `createHandoff` / workflow / ticket / notify services.
5. **`integration_outbox` + dead-letters** — only if a concrete external-integration need
   appears; `handoff_outbox` already covers cross-module handoffs.
6. **Additive `correlation_id` / `causation_id`** on `app_events` (columns), if cross-event
   tracing is wanted.

Permission keys to ADD to the catalogue (backend `lib/permissions.ts` + frontend
`src/lib/permissions.ts` + `permissionMeta.ts`) for the new pieces only:
`orchestration.view/admin`, `orchestration.timeline.view`, `orchestration.record_links.view/manage`,
`orchestration.registry.view/manage`, `orchestration.rules.view/manage`,
`orchestration.outbox.view/retry` (only for what you actually build).

---

## 4. Naming the spec must align to
- Event names: existing app_events use `source_module` values like `hr`, `hse`; the workflow
  engine uses **granular** `module_key` like `hr_employee_master`, `hse_incidents`. The spec's
  `module.record.action` event names are fine — keep `source_module` coarse, `module_key` granular.
- IDs: `app_users.id` TEXT; business record ids are mostly uuid, refs via `nextRef('INC'|'HRC'|...)`.
- Idempotency: `runModuleMutation`'s `idempotencyKey` (content-derived) + `emitAppEvent`'s
  `dedupeKey`. Don't invent a parallel scheme.
