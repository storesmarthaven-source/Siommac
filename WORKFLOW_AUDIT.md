# SIOMAC ERP — Central Workflow Engine: Full Architecture Audit

> Audience: a reviewer (Codex) with **no prior context** on this codebase. This document is self-contained. It describes the workflow engine, how modules integrate with it, the in-progress migration onto it, the decisions taken, and the open questions. Goal: a second opinion on **whether the direction is right** before we finish and commit.
>
> Stack: Preact + Vite frontend; **Netlify Functions / Hono** backend (POST-only, `body.args` envelope); **Supabase Postgres** (migrations applied **manually** in the SQL editor, then `NOTIFY pgrst, 'reload schema'`). `app_users.id` is **TEXT** (all user FKs are text). No direct browser reads of ERP data — everything goes through authenticated JWT APIs. Service-role client (`sb`) used in all backend lib code.

---

## 1. Executive summary

There used to be **two workflow engines** writing to the same tables:

- **Legacy** — `createWorkflow()` / `decideWorkflowTask()` in `netlify/functions/lib/workflowEngine.ts`. Template chosen by a hardcoded `templateKey`; steps read from `workflow_templates.definition` (old JSON shape). This is the "each module hardcodes its approval" pattern.
- **Central / spec** — `startWorkflowForRecord()` + `decideTask()` (+ full lifecycle) in `netlify/functions/lib/workflow/service.ts`. Binding-driven: a **module event** resolves a **binding** → a **published template version** → an instance. This is the intended "one backbone, config-driven" engine.

**Two prior commits already landed** (schema clean-up):
1. Migrated *both* engines + all routes to the **spec columns** and **dropped the legacy duplicate columns** (`20260704000003`). Verified green.
2. (this is committed: `5f38007`.)

**This in-progress change** (uncommitted, build currently red on purpose) is the **engine unification**: delete the legacy engine entirely and route **every** workflow creator through the central engine. The user's hard rule throughout: **no band-aids**. A runtime "legacy-definition translator" I briefly added was caught and **removed** as a band-aid.

**The core question for review:** the central engine currently acts as a **parallel approval-tracking layer** that is *decoupled* from each module's own status state machine. Is that the intended end state, or should the engine **drive** module record status (via adapters + `sourceStatusMap`), replacing the modules' bespoke state machines? See §11 (Open Question A) — this is the biggest fork.

---

## 2. Database schema

All workflow tables use `uuid` PKs (except none are text). Created across `20260621100000_erp_backbone_core.sql` (original), `20260704000001_workflow_engine_core.sql` (spec columns + new tables), `20260704000003_workflow_engine_drop_legacy.sql` (dropped legacy cols).

### `workflow_instances`
Spec columns (current): `id uuid pk`, `workflow_no text unique not null`, `template_id uuid`, `template_version_id uuid`, `module_key text not null`, `workflow_type text not null`, `source_record_id text not null`, `source_record_ref text`, `status text`, `priority text (low|medium|high|critical)`, `current_step_key text`, `site_id text`, `department_id text`, `requested_by text→app_users`, `owner_id text→app_users`, `started_at`, `completed_at`, `cancelled_at`, `closed_at`, `due_at`, `template_snapshot jsonb` (the definition at start), `source_snapshot jsonb` (record data at start), `metadata jsonb`, `created_at`, `updated_at`.
- **Dropped legacy cols:** `ref`, `source_module`, `source_entity_type`, `source_entity_id`, `current_step`, `owner_user_id`, `created_by`.
- status CHECK: `draft|submitted|triage|in_review|in_progress|awaiting_evidence|awaiting_approval|pending_approval|returned|rejected|approved|completed|closed|cancelled|escalated|overdue|stuck`.

### `workflow_tasks`
`id`, `workflow_id→instances`, `step_key`, `step_name`, `step_type`, `task_title`, `assigned_to text→app_users`, `assigned_role text`, `status`, `due_at`, `decision`, `decision_comment`, `completed_by`, `completed_at`, `decided_at`, `delegated_to`, `returned_to`, `is_required bool`, `metadata`, `created_at`.
- **Dropped:** `task_type`, `assigned_user_id`, `decision_note`, `assigned_department_id`.
- status CHECK: `open|pending|in_progress|approved|returned|rejected|delegated|reassigned|cancelled|completed|overdue`. (New engine writes tasks as `pending`; legacy wrote `open`.)

### `workflow_templates`
`id`, `template_key text unique not null`, `module_key text not null`, `workflow_type text`, `name`, `description`, `status (draft|active|inactive|deprecated)`, `current_version int`, `is_active bool`, `definition jsonb`, `created_by`, `updated_by`, `created_at`, `updated_at`, `metadata`.
- **Dropped:** `key`, `module`.

### New spec tables (`20260704000001`)
- **`workflow_template_versions`** — `id`, `template_id`, `version_no`, `version_status (draft|published|archived)`, `definition jsonb` (the spec definition), `published_at`, … **This is the intended source of step definitions.**
- **`workflow_template_steps`** — normalized step rows (currently unused by the engine; the engine reads the `definition` JSON, not these rows).
- **`module_workflow_bindings`** — `module_key`, `workflow_type`, `trigger_event`, `template_id`, `template_version_id`, `scope_type (global|site|department|role)`, `scope_id`, `priority`, `conditions jsonb`, `is_active`. **This is what makes a module event start a workflow.** Unique on `(module_key, workflow_type, trigger_event, scope_type, scope_id, priority)`.
- **`workflow_decisions`** — immutable per-decision log (actor, decision, comment, prev/new status).
- **`workflow_handoffs`** — engine-emitted cross-module handoffs (see §11; note this is a *second* handoff system).
- **`workflow_audit_log`** — immutable audit (workflow_id, task_id, module_key, source_record_id, actor, action, prev/new state, reason).

### Catalog tables (`20260704000000`, mostly metadata/validation; not all wired)
`erp_modules`, `module_event_catalog`, `workflow_type_catalog`, `workflow_assignment_resolvers`, `workflow_handoff_action_catalog`.

---

## 3. Central engine — `netlify/functions/lib/workflow/`

| File | Responsibility |
|---|---|
| `definitionTypes.ts` | `WorkflowTemplateDefinition` (steps, transitions, notifications, handoffs, sourceStatusMap, settings), `ModuleWorkflowContext`, `ModuleWorkflowAdapter` |
| `service.ts` | the engine: `startWorkflowForRecord`, `startWorkflowByTemplate`, `decideTask`, advance/return/reject/complete/cancel/delegate/reassign, `runWorkflowHandoffs`, audit + event emission |
| `bindingResolver.ts` | `selectWorkflowBinding` / `pickBinding` — match `module_key+workflow_type+trigger_event+active`, scope match, conditions, most-specific scope, lowest priority |
| `assigneeResolver.ts` | `resolveStepAssignee(step, context)` — maps assignment types (`role`, `record_owner`, `supervisor`, `hse_manager`, `fixed_user`, `dynamic_field`, …) to `{userId?, roleKey?}` |
| `transitions.ts` | `firstSteps` (lowest `sequenceNo`), `resolveNext` (explicit `transitions[]` else **sequence fall-through on `approved`**) |
| `validateDefinition.ts` | structural validation before publish/start |
| `conditionEvaluator.ts` | `evaluateWorkflowConditions` / `getPathValue` |
| `adapterRegistry.ts` | `registerWorkflowAdapter` / `getWorkflowAdapter` (null-safe) |

### Definition format (`WorkflowTemplateDefinition`, schemaVersion 1)
```
{ schemaVersion:1,
  steps:[ { stepKey, stepName, stepType(review|approval|verification|acknowledgement|assignment|handoff|automation|closeout),
            sequenceNo, assignment:{type, value?, dynamicField?}, dueDurationHours?, required,
            decisionRules:{canApprove,canReturn,canReject,canDelegate,requireCommentOn*,requireAttachment} } ],
  transitions:[ {fromStep,onDecision,toStep?|completeWorkflow?,conditions?} ],   // optional; linear flows omit it
  notifications:[…], handoffs:[ {event,targetModule,action,fieldMap,conditions?,required} ],
  sourceStatusMap:{ onStarted?, onReturned?, onRejected?, onApproved?, onCompleted?, onCancelled? },
  settings:{ allowReturn, allowReject, allowDelegate, allowAdminOverride, requireAuditAllTransitions } }
```

### Start flow
- `startWorkflowForRecord({context, actor})` → `selectWorkflowBinding` → if no binding **returns null (module proceeds without a workflow)** → `resolveDefinition(binding)` → `instantiateWorkflow`.
- `startWorkflowByTemplate({templateKey, context, actor})` → `resolveDefinitionByTemplateRef` (lookup by `template_key` **or** uuid `id`; **requires a published version** — no legacy translation) → `instantiateWorkflow`.
- `instantiateWorkflow` → `validateWorkflowDefinition` → `nextRef('WF')` → insert instance (`status='in_progress'`, `template_snapshot=definition`, `source_snapshot=recordData`) → create first task(s) via `createTaskForStep` (`resolveStepAssignee`) → `workflow_audit_log` + emit `workflow.started` app_event + `getWorkflowAdapter(moduleKey)?.onWorkflowStarted` (null-safe).

### Decide flow
- `decideTask({workflowId, taskId, actor, decision(approved|returned|rejected), comment?, attachmentIds?})`: validates task ownership + `decisionRules`, updates task, inserts `workflow_decisions`, audit, then `returned→returnWorkflow`, `rejected→rejectWorkflow`, else `advanceWorkflow`.
- `advanceWorkflow`: waits for parallel siblings on the step, `resolveNext` (explicit transition or next `sequenceNo`); if none → `completeWorkflow`.
- `completeWorkflow` / `returnWorkflow` / `rejectWorkflow` / `cancelWorkflow`: set instance status, fire `getWorkflowAdapter(...)?.onWorkflow{Completed,Returned,Rejected,Cancelled}` (null-safe), `runWorkflowHandoffs`, audit, emit app_event.

### `resolveDefinition` (binding path) — note a fallback
Order: `binding.template_version_id` → newest `published` version for the template → **`workflow_templates.definition`** if it has a `steps` array. The last fallback only works if `definition` is already spec-shaped; an old-format definition would fail validation. (Flag: minor fallback, possibly worth removing for purity.)

---

## 4. Module integration — how workflows get created

Modules **own their record + their record's status**; they ask the engine to start/track an approval workflow. Two integration shapes:

**(a) via `runModuleMutation` (the Module Service Adapter, `lib/moduleServiceAdapter.ts`)** — the standard `record write → app_event → workflow → handoff → notification` orchestration. Its `workflow` option was changed from `{templateKey}` to **`{workflowType, triggerEvent, priority, ownerUserId?, …}`**; the adapter now calls `startWorkflowForRecord` with `moduleKey = options.module`, `sourceRecordId = identity.id (uuid)`, `recordData = metadata`.

**(b) direct `startWorkflowForRecord` calls** in route handlers (risk-jsa submit routes).

### Creator inventory (the full footprint)

| # | Creator | Path | module_key / workflow_type / trigger | Status in this migration |
|---|---|---|---|---|
| 1 | Incident create | `hseIncidents.ts` (runModuleMutation) | hse / incident_investigation / incident.reported | ✅ migrated |
| 2 | CAPA create | `hseCapa.ts` (runModuleMutation) | hse / capa_closure / capa.created | ✅ migrated |
| 3 | Hazard **submit** | `hseRiskJsa.ts` (direct) | hse / hazard_review / hazard.submitted | ✅ migrated |
| 4 | Risk-assessment **submit** | `hseRiskJsa.ts` (direct) | hse / risk_assessment_review / risk_assessment.submitted | ✅ migrated |
| 5 | JSA **submit** | `hseRiskJsa.ts` (direct) | hse / jsa_review / jsa.submitted | ✅ migrated |
| 6 | Hazard **create** (auto, high-risk) | `hseRiskJsa.ts` (runModuleMutation, ~line 243) | hse / hazard_review / hazard.registered? | ❌ still `templateKey` → **build red** |
| 7 | Ops work-order from handoff | `lib/receivers/operationsReceiver.ts` (runModuleMutation) | operations / work_order_assignment / ? | ❌ still `templateKey` → **build red** |
| 8 | Frontend explicit "create workflow" | `/api/workflows/create` → `startWorkflowByTemplate` | by templateKey/id | ⚠️ facade migrated; see below |

### Frontend explicit creates (`useCreateWorkflow`, `src/api/workflows.ts`)
Called by 5 components: `Incidents.tsx` & `Environmental.tsx` (`hse_incident_investigation` — has a version ✅), `Documents.tsx` (`hse_document_approval` — **template not seeded anywhere**), `PPEManager.tsx` (`ppe-request` — **not seeded**), `Workflows.tsx` (passes a **template UUID** `tpl.id` from a picker).
- Pre-migration these went through legacy `createWorkflow`, which read `workflow_templates.definition`. `hse_document_approval`/`ppe-request` **don't exist as templates** → they were **already 500-ing** before this migration. So post-migration they error honestly ("template not found / no published version") — not a regression.

### Status coupling — **currently decoupled**
- No `ModuleWorkflowAdapter` is registered (`registerModulesOnce` only registers handoff *receivers*). The engine's adapter callbacks are all no-ops.
- Each module sets its **own** record status in its **own** routes: incidents `afterCommit` sets `status='triage'`; risk-jsa submit routes set `submitted`/`under_review`; risk-jsa has a **separate state machine** `transitionEntity()` (with its own `STATUS_TRANSITIONS` map) for approve/activate/return driven by **module routes**, not by the workflow.
- So today the workflow instance is an **approval-tracking artifact decided via an inbox**, running *in parallel* to the module's status. They are not wired to each other. (This matches legacy behavior — legacy `decideWorkflowTask` also never synced module status.)

---

## 5. API surface

### Native engine — `/api/workflow-engine/*` (`routes/workflowEngine.ts`)
`start`, `decide`, `delegate`, `reassign`, `cancel`, `my-tasks`, `register`, `get`, `audit/list`, `templates/version/create`, `templates/version/publish`, `bindings/list`, `bindings/create`, `bindings/set-active`. Gated by `workflow.*` perms (below). **No frontend currently calls these** except via E2E.

### Facade — `/api/workflows/*` (`routes/workflows.ts`) — what the frontend uses
- `create` → `startWorkflowByTemplate` (explicit start). `decision` → `decideTask` (looks up `workflow_id` from the task; maps legacy `verified|completed`→`approved`). `list`/`get`/`tasks`/`audit` → read **spec columns aliased back to the legacy DTO field names** (`ref:workflow_no`, `source_module:module_key`, `task_type:step_type`, `assigned_user_id:assigned_to`, …) so the frontend contract is unchanged.

### Permissions (`workflow.*`, seeded `20260704000002`)
`tasks.{approve,return,reject,delegate}`, `instances.{view,cancel,reassign,escalate,admin_override,migrate}`, `templates.{view,create,update,publish,clone,deprecate}`, `bindings.{view,create,update,activate,deactivate}`, `handoffs.{view,retry,cancel}`, `audit.{view,export}`, `my_tasks.view`, `dashboard.view`, `register.view`.

---

## 6. Notifications, handoffs, audit, events (§2 side-effects)
- **Events:** engine emits `app_events` with `sourceModule='workflow'` (e.g. `workflow.started`, `workflow.task.assigned`, `workflow.completed`). These feed the existing `app_events → event_rules → notifications` pipeline. **Open Q:** are `event_rules` seeded for these `workflow.*` event types? If not, no notifications fire. The definition also has a `notifications[]` block (engine-native notification rules) that is **currently unused** (all seeds set `notifications:[]`). Two notification paths exist; only the app_event one is wired.
- **Handoffs:** **two systems.** (1) `handoff_outbox` + module *receivers* (`hr/finance/operations`) — the established module handoff bus (`lib/handoffBus.ts`, `lib/registerModules.ts`). (2) `workflow_handoffs` + the definition's `handoffs[]` — engine-native, written by `runWorkflowHandoffs`, currently always empty in seeds. **Open Q:** consolidate?
- **Audit:** `workflow_audit_log` written on every transition.

---

## 7. Migration state (this change — uncommitted)

**Done & committed previously:** spec-column cutover + drop-legacy (`20260704000003`), commit `5f38007`.

**Done in this change (uncommitted):**
- `service.ts`: added `startWorkflowByTemplate` + shared `instantiateWorkflow`; **removed the legacy-definition translator** (band-aid).
- Repointed creators #1–#5 to `startWorkflowForRecord`.
- `/api/workflows` facade → `startWorkflowByTemplate` / `decideTask`; broadened task-status filters to include `pending`/`in_progress`.
- **Deleted `lib/workflowEngine.ts`** (legacy `createWorkflow`/`decideWorkflowTask`).
- Seed migration `20260704000006_workflow_engine_seed_hse_bindings.sql`: templates+published versions+bindings for the 5 HSE workflows (all `module_key='hse'`).

**Not done — build is RED here:**
- Creators #6 (hazard auto-create) and #7 (operations) still pass `templateKey` to the (changed) `runModuleMutation` option → 2 type errors. Because the legacy engine is **deleted**, there is **no clean half-state** — every creator must be migrated or its workflow option removed.
- Operations needs its own template+version+binding (`module_key='operations'`) **or** the auto-workflow dropped.
- E2E not yet re-run; nothing re-committed.

---

## 8. Decisions taken (and why)
1. **`module_key='hse'` for all HSE workflows** (group-level), `workflow_type` disambiguates. Chosen because `runModuleMutation` already passes `module:'hse'` and the HSE dashboard KPI counts `module_key='hse'`. *Alternative considered:* granular `module_key` (`incidents`,`capa`,`hazards`,…) per the spec's "short token" hint. **(Open Q B.)**
2. **`source_record_id` = record UUID** everywhere (risk-jsa previously used the human ref). Detail views look up the linked workflow by `workflow_id`, so this is safe and consistent.
3. **No status-driving adapters** — modules keep owning their status (behavior-preserving, avoids fighting risk-jsa's `transitionEntity`). **(Open Q A — the big one.)**
4. **`startWorkflowByTemplate` kept** as a clean explicit-start primitive (version-only). *Alternative:* remove `/api/workflows/create` entirely and let workflows start only from module events. **(Open Q C.)**
5. **Routes alias spec→legacy DTO names** so the frontend contract didn't change.
6. **Deleted the legacy engine** rather than keeping it for un-migrated modules (the no-band-aid directive).

---

## 9. Open questions for review

**A. (Biggest) Coupled vs decoupled status.** Today the central engine is a *parallel approval layer*; modules drive their own record status (incidents `update`, risk-jsa `transitionEntity` state machine). Is the intended end state that the **engine drives** record status (register `ModuleWorkflowAdapter`s that apply `sourceStatusMap` on start/approve/return/reject/complete), and the modules' bespoke state machines are **retired**? Or is decoupled-parallel correct (engine = approvals only, module = lifecycle)? This determines whether risk-jsa's `transitionEntity` (and incidents' status logic) should be deleted and replaced by engine-driven status — a much deeper change than what's done so far.

**B. `module_key` granularity.** Group (`'hse'`) vs granular (`'incidents'`,`'capa'`,`'hazards'`,`'assessments'`,`'jsa'`). Bindings + adapters key on `module_key`. Which is intended? (Affects the seed + the dashboard KPI + future HR/Finance modules.)

**C. Frontend-initiated creates.** Should the frontend ever start a workflow by handing the backend a `templateKey`/`tpl.id` (current `useCreateWorkflow`), or should workflows **only** start from backend module events via bindings? Several callers (`Documents`, `PPEManager`) reference templates that don't exist (already broken). If creates should be event-only, `/api/workflows/create` + `useCreateWorkflow` should be removed and those pages reworked — but the corresponding module backends aren't built yet.

**D. Operations work-order workflow** (the immediate fork). `operationsReceiver` auto-starts `ops_work_order_assignment`, but there's no Operations module/UI and no seeded template. Options: **(1)** seed it as a real workflow (`module_key='operations'` + version + binding) and keep it on the engine; **(2)** drop the auto-workflow from the receiver and re-add it when Operations is actually built. (Same dilemma will apply to HR/Finance receivers as they grow.)

**E. Two handoff systems** (`handoff_outbox`/receivers vs `workflow_handoffs`/definition `handoffs[]`). Consolidate onto one? Today modules use the receiver bus; the engine's handoff table is unused.

**F. Two notification paths** (`app_events→event_rules` vs definition `notifications[]`). Which is canonical? Are `event_rules` seeded for `workflow.*` events (else no notifications)?

**G. Decision facade vs native.** Frontend decides via `/api/workflows/decision` (facade → `decideTask`). Should the frontend instead call `/api/workflow-engine/decide` directly and retire the facade over time?

**H. Assignment roles in definitions.** Translated definitions use roles like `investigator`, `hse_officer`, `owner` that are **not real `app_users.role` values**. Tasks assigned to a non-existent role can only be actioned by elevated users. Intended (placeholder until those roles exist) or should assignments use real roles / resolver types?

**I. `workflow_template_steps` table** is created but unused (engine reads the `definition` JSON). Keep (future normalized editing) or drop?

**J. `resolveDefinition` fallback** to `workflow_templates.definition` when a binding lacks a version — keep as a convenience or remove for purity (force published versions)?

---

## 10. "Are we going in the right direction?" — my read
- **Yes** on: one engine (delete legacy), binding-driven starts, spec-column schema, published-version definitions, route-level DTO aliasing to protect the frontend. These are clean and spec-aligned.
- **The unresolved architectural question is A** (coupled vs decoupled status). Right now we've unified *workflow creation/decision* but left *record lifecycle* in each module. If the spec intends the engine to be the **process owner** (drive status), we have more to do (adapters + retire module state machines) and should decide that **before** finishing, because it changes the seeds (`sourceStatusMap`), whether adapters are registered, and whether risk-jsa's `transitionEntity` survives.
- Secondary cleanups worth a decision now: B (module_key granularity), C/D (frontend + operations creates for unbuilt modules), E/F (duplicate handoff/notification paths).

---

## 11. File reference (for navigation)
- Engine: `netlify/functions/lib/workflow/{service,definitionTypes,bindingResolver,assigneeResolver,transitions,validateDefinition,conditionEvaluator,adapterRegistry}.ts`
- Module adapter: `netlify/functions/lib/moduleServiceAdapter.ts`, `lib/moduleMutationRuns.ts`
- Creators: `routes/hseIncidents.ts`, `routes/hseCapa.ts`, `routes/hseRiskJsa.ts`, `lib/receivers/operationsReceiver.ts`
- API: `routes/workflowEngine.ts` (native), `routes/workflows.ts` (facade)
- Frontend: `src/api/workflows.ts`, `src/components/workflow/{ApprovalInbox,WorkflowDrawer}.tsx`, `src/components/sections/HSE/{Workflows,HSEDashboard,Incidents,Documents,Environmental,PPEManager}.tsx`
- Migrations: `supabase/migrations/20260704000000`(catalogs) `…001`(core) `…002`(perms) `…003`(drop legacy) `…004`(risk-jsa status superset) `…006`(seed HSE bindings — this change); `20260629000000`(expose module_mutation_runs); `20260705000000`(hse.capa.view)
