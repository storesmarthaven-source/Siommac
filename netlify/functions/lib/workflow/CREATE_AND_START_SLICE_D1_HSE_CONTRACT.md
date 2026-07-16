# Slice D1 — HSE create-and-start atomization (finding #3 tail)

> Converts the LAST three `runModuleMutation + options.workflow` callers
> (hseCapa, hseIncidents, hseRiskJsa hazard registration) onto the atomic
> `workflow_create_and_start_tx` RPC, then DELETES the Stage-3 legacy path and
> `options.workflow` end-to-end from moduleServiceAdapter, and drops the
> moduleServiceAdapter waiver from the grep gate.
> Closes FINAL_CUTOVER_CONTRACT.md deferred item D1.

## Preflight facts (probed LIVE 2026-07-16)

| Flow | Table | Binding (live, active) | Trigger | onStarted status | First step | Ref |
|------|-------|------------------------|---------|------------------|-----------|-----|
| Incident report | `hse_incidents` | hse_incidents / incident_investigation | `incident.reported` | insert `'triage'` directly (was adapter sourceStatusMap.onStarted) | `triage` — role `manager` (static) | `INC-YYYY-NNNN` |
| CAPA create | `hse_capa_actions` | hse_capa / capa_closure | `capa.created` | none — status stays `'open'` (live template has NO onStarted) | `assign_owner` — role `manager` (static) | `CAPA-YYYY-NNNN` |
| Hazard registration (high/critical only) | `hse_hazards` | hse_hazards / hazard_review | `hazard.registered` | insert `'assessment_required'` directly (was afterCommit UPDATE) | `approval` — role `manager` (static) | `HAZ-YYYY-NNNN` |

- Satellites IN the txn: `hse_incident_people` (from `p_business.people`),
  `hse_controls` (from `p_business.controls`, `source_id` is TEXT → cast).
- `hse_hazards.initial_score` is a GENERATED column — never inserted.
- `hse_incidents.return_to_work` is DATE; OSH due columns timestamptz.
- HSE audit target is `public.audit_logs (action, table_name, record_id, user_id,
  changes, created_at)` keyed by REF with action = the dotted event type
  (mig-218 precedent), NOT `hr_audit_log`.
- `app_events.severity` check: info|success|warning|high|critical.
- First steps are all STATIC role `manager` → `_resolve_and_validate_assignee`
  static path; no mig-219 dynamic dependency.

## REQUIRED

| # | Requirement |
|---|-------------|
| R1 | Mig `20260919000398`: copy-then-surgical-edit of 394 — 3 new branches (`hse_incidents`, `hse_capa_actions`, `hse_hazards`), all 6 existing branches byte-identical. Clean apply copy at repo root (zero `--` lines). |
| R2 | Branch owns: ref allocation (increment_ref_counter), INSERT with the POST-START status (triage / open / assessment_required), satellite inserts, workflow link in-commit, ONE app_event (payload parity incl. entityRef+operation), ONE audit_logs row keyed by ref. |
| R3 | Routes go BINDING-FIRST: `selectWorkflowBinding` → binding → RPC (request key = the existing CONTENT-derived idempotency key, slice-4 precedent — dedupes true resubmits, no FE churn); NO binding → `runModuleMutation` create-only (today's semantics when no workflow starts: incident stays `open`, hazard keeps caller status, capa `open`). |
| R4 | Post-commit TS (notify-only, never re-emit events): notification fan-out via `deliverEventNotifications`-equivalent (dedupe-keyed) for the SAME recipients as today; incidents' 3 conditional cross-module handoffs via `createHandoff` (same payloads/conditions). |
| R5 | Response shapes unchanged (id/ref/workflowId/eventId/handoffIds…). |
| R6 | DELETE Stage-3 from moduleServiceAdapter + `workflow` field from ModuleMutationOptions + `ModuleWorkflowRequest` type + `startWorkflowForRecord` import + `workflow_created` stage handling; delete the waiver from the grep-gate test. |
| R7 | E2E: hseIncidents/hseCapa(riskjsa) suites assert atomic create (workflow_id linked in-commit, instance in_progress, manager task, exactly-1 event + 1 audit_logs row, satellites present) + idempotent retry (same content key → same record, no dup) + no-review hazard starts NO workflow. |

## FORBIDDEN
- Deleting `startWorkflowForRecord` from service.ts (accountsPayable still calls it — dies with AP removal, D2).
- Emitting the business event in BOTH the RPC and TS (double-emit).
- A synthetic per-request idempotency key on these routes — the existing content-derived keys are the correct dedupe semantic (CLAUDE.md: derive keys from content).
- Touching the mig-218 SUBMIT branches for hse_hazards (hazard submit-for-review is a different flow; the mig-397 unique index correctly serializes both against the same record family).

## DEFERRED
- Handoffs inside the txn (they are separate PostgREST writes today; moving them in-txn is MUTATION_BACKBONE scope).
- The incident/capa/hazard UPDATE/transition flows (only CREATE is in scope — updates never started workflows via Stage-3).

## Side-effect ownership

| Side-effect | Owner |
|-------------|-------|
| Business row + satellites + ref | RPC branch |
| workflow instance + tasks + workflow_audit_log + workflow.started/task.assigned events | `wf_internal._create_instance` |
| workflow_id link on the row | RPC branch (in-commit) |
| ONE business app_event + ONE audit_logs row | RPC branch |
| Assignee/owner notifications (notify-only) | TS post-commit |
| Cross-module handoffs (incidents) | TS post-commit (parity with today's Stage-4) |
| module_mutation_runs receipt | no-binding path only (runModuleMutation); RPC path uses the wf_internal receipt ledger |
