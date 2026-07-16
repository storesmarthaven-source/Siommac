# Shape-C C1 — NIS Re-approval (finding #3)

> ONE source of truth for the `upsertNisClasses` re-approval vertical slice.
> Supersedes any conflicting statement in SUBMIT_TX_DESIGN.md for this slice.
> Every decision is **REQUIRED / FORBIDDEN / DEFERRED**.

## 0. Preflight — facts established from CODE, not assumptions

| Fact | Evidence |
|---|---|
| Source table | `finance_statutory_versions` |
| Pre-existing branch in `workflow_submit_for_record_tx` | YES — `finance_statutory_versions` (added mig 20260919000217, included in mig 380) |
| Current from-status gate | `status <> 'draft'` (only draft can submit) |
| Re-approval from-status | `approved` (version was approved, NIS classes are edited, must re-approve before activation) |
| To-status | `pending_approval` (same as fresh submit) |
| Binding: module_key | `finance_statutory` |
| Binding: workflow_type | `finance_statutory_approval` |
| Binding: trigger_event | `finance.statutory.version.submitted` (same trigger as fresh submit — same binding) |
| Owner | `finance_statutory_versions.created_by` |
| Ref format | `SV-` + `upper(left(id, 8))` |
| Audit table | `hr_audit_log` (submodule_key = `finance_statutory`) |
| Audit action (re-approval) | `statutory_version.reopened_by_edit` (differentiates from fresh-submit `statutory_version.submitted`) |
| Business event type | `finance.statutory.version.submitted` (same trigger; binding matches both cases) |
| First-step role | `finance_manager` (same as fresh submit binding) |
| `approved_by` must be cleared | YES — re-opening for re-approval means the prior approval is void |
| Legacy call | `startWorkflowForRecord` at `netlify/functions/lib/finance/statutoryConfig.ts:840` |
| Prior status-flip in TS | Line 817-818: `status: pending_approval, approved_by: null` (NON-ATOMIC, racy) |
| Trigger condition | `version.status === 'approved'` AND `finance_statutory.require_reapproval_on_edit` setting is true |
| No-binding behavior | **Hard 422** (compliance-critical: an approved version with no approval workflow is a governance hole; not opt-in) |
| Binding checked BEFORE any write | REQUIRED — prevents a failed binding lookup from requiring compensating rollback of the class upsert |

## 1. Shape determination

**Shape A** — status transition on an EXISTING record.

The source record (`finance_statutory_versions`) already exists. The re-approval path:
1. Upserts NIS classes (business write — outside the RPC)
2. Calls `workflow_submit_for_record_tx('finance_statutory_versions', id, ...)` to atomically:
   - Lock and re-validate the source row
   - Assert `status IN ('draft', 'approved')` (extended gate)
   - Flip `status → pending_approval`, clear `approved_by`, link `workflow_id`
   - Create workflow instance + tasks
   - Write `app_events` + `hr_audit_log` in the same transaction

This is NOT Shape B (no new business row is inserted). It is NOT a new `workflow_create_and_start_tx` branch.

## 2. Migration — surgical edit to `workflow_submit_for_record_tx`

Migration: `20260919000395_workflow_submit_tx_nis_reapproval.sql`
Base: `20260919000380_workflow_submit_tx_statutory_profile.sql` (14 branches)
Result: 14 branches; ONLY the `finance_statutory_versions` branch changes.

### 2a. Three surgical edits to the `finance_statutory_versions` branch

**Edit 1 — Status gate** (expand to allow `approved` from-status):
```sql
-- FROM:
if v_stat.status <> 'draft' then
  raise exception ... using errcode = 'WF409';
end if;
-- TO:
if v_stat.status not in ('draft', 'approved') then
  raise exception ... using errcode = 'WF409';
end if;
```

**Edit 2 — Audit action** (differentiate re-approval from fresh submit):
```sql
-- FROM:
v_audit_action := 'statutory_version.submitted';
-- TO:
v_audit_action := case when v_stat.status = 'approved'
                       then 'statutory_version.reopened_by_edit'
                       else 'statutory_version.submitted' end;
```

**Edit 3 — UPDATE source row** (clear `approved_by` for re-approval case):
```sql
-- FROM:
update public.finance_statutory_versions
   set status = v_to_status, workflow_id = v_wf_id
 where id = p_source_id::uuid;
-- TO:
update public.finance_statutory_versions
   set status     = v_to_status,
       workflow_id = v_wf_id,
       approved_by = case when v_from_status = 'approved' then null else approved_by end
 where id = p_source_id::uuid;
```

All 13 other branches are byte-identical to mig 380.

## 3. RPC signature (unchanged)

`public.workflow_submit_for_record_tx(p_source_table text, p_source_id text, p_actor_id text, p_binding_id uuid, p_request_key text, p_business jsonb default '{}')` — no signature change; only the `finance_statutory_versions` branch body changes.

## 4. TS wiring (`upsertNisClasses`)

### REQUIRED (in order)

1. **Binding-first** (BEFORE any write): `selectWorkflowBinding(sb, { moduleKey, workflowType, triggerEvent, sourceRecordId, requestedBy, recordData: {} })` → no binding → throw 422 "No approval workflow is configured for statutory versions."
2. **Key validation** (BEFORE any write): `idempotencyKey?.trim()` → falsy → throw 400 "An idempotency key is required to re-submit an approved statutory version for approval."
3. **Class upsert** (first write — compensating `rollbackClasses` needed after this point on failure).
4. **RPC call**: `sb.rpc('workflow_submit_for_record_tx', { p_source_table: 'finance_statutory_versions', p_source_id: id, p_actor_id: actorId, p_binding_id: binding.id, p_request_key: requestKey, p_business: { effectiveFrom, jurisdiction, label } })`
5. **On RPC error**: `await rollbackClasses(); throw rpcHttpError(error)`.
6. **Post-commit (best-effort)**: `void notifyUsersByRole('finance_manager', { type: 'finance.statutory.version.submitted', ... dedupeKey: 'statutory.version.reapproval.<id>.<wf_id>', ... })`.
7. **Return**: upserted `NisClassRow[]`.

### DELETED from `upsertNisClasses` re-approval branch

- `startWorkflowForRecord` call (line 840) and the `wf?.id` stamp (line 841)
- Pre-RPC status flip: `sb.from('finance_statutory_versions').update({ status: 'pending_approval', approved_by: null })`
- `restoreApproved` closure and its call sites
- `resolveStatutoryApproverIds(actorId)` call (notification now via `notifyUsersByRole`)
- `emitFinanceMutationBackbone` call in the re-approval path (RPC owns events + audit)
- `const ctx: ModuleWorkflowContext = { ... }` (unused after removal)

### Import changes (`statutoryConfig.ts` line 18)

```ts
// FROM:
import { startWorkflowForRecord, rpcHttpError } from '../workflow/service';
// TO:
import { rpcHttpError } from '../workflow/service';
```

`ModuleWorkflowContext` type import (line 22) is also removed (no longer used).

## 5. idempotencyKey threading (end-to-end)

| Layer | Change |
|---|---|
| SQL RPC | `p_request_key` (already exists in the shared fn signature) |
| `upsertNisClasses` | add `idempotencyKey?: string` param; validate non-empty when re-approval path is taken |
| Route `financeStatutory.ts` | add `idempotencyKey: z.string().min(1).max(200).optional()` to upsert Zod schema; thread to lib |
| `UpsertNisClassArgs` (FE DTO) | add `idempotencyKey?: string` |
| `financeStatutoryApi.upsertNisClass` | forward `idempotencyKey` to the `classes` array request |
| `StatNisBandPage.tsx` | `useRef` stable per-attempt key; set before first save; clear on success; pass when `version.status === 'approved'` |

## 6. Side-effect ownership

| Responsibility | Owner |
|---|---|
| Workflow instance + tasks + `workflow.*` events + `workflow_audit_log` | primitive `_create_instance` (inside RPC txn) |
| Status flip (`approved → pending_approval`) + `approved_by = null` + `workflow_id` stamp | `workflow_submit_for_record_tx` branch (inside RPC txn) |
| Business event `finance.statutory.version.submitted` + `hr_audit_log` (`statutory_version.reopened_by_edit`) | `workflow_submit_for_record_tx` branch (inside RPC txn) |
| Post-commit notification to `finance_manager` | TS `upsertNisClasses` via `notifyUsersByRole` (best-effort, outside txn) |
| NIS class upsert (business write) | TS `upsertNisClasses` (outside RPC txn; compensating rollback if RPC fails) |
| Response: upserted `NisClassRow[]` | Route/service (refetch not needed; upsert result already returned) |

## 7. DEFERRED

- Explicit-start E1/E2/E3 auth hardening.
- Final cutover migration (active-wf unique index, `startWorkflowForRecord` deletion, grep gate).
- Durable notification delivery worker.
- `requireReapproval` setting wiring to the DB (current: `resolveSettingValue` already calls DB — no change needed).
- No-binding path: if the setting `finance_statutory.require_reapproval_on_edit` is false, upsert is a plain draft-level edit with no RPC (opt-out is intentional; no idempotency key required on that path).

## 8. Grep gate

After this slice lands: `grep 'startWorkflowForRecord' netlify/functions/lib/finance/statutoryConfig.ts` must return **zero matches**.

## 9. Verification gate (REQUIRED before "done")

GREEN (static): `npm run build:backend` (or `tsc --noEmit`), frontend `tsc`, `node --check scripts/e2e/suites/financeStatutory.mjs`, grep gate.

PENDING (live — operator/env): apply mig 395 + `NOTIFY pgrst,'reload schema'` → `npm run build:backend` → restart `dev:netlify` → `npm run test:e2e -- financeStatutory`. Not "done" until green.
