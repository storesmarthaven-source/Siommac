# RUNBOOK — Shape-C C1: NIS Re-approval Atomization (finding #3)

Branch: `wf/shape-c`
Migration: `20260919000395_workflow_submit_tx_nis_reapproval.sql`

## What changed

The `upsertNisClasses` re-approval path (editing an approved statutory version's NIS figures)
was previously non-atomic: it flipped status, then called `startWorkflowForRecord`, then wrote
audit via `emitFinanceMutationBackbone` as three separate PostgREST round-trips. A crash between
any two steps left the DB in a partial state.

This slice extends `workflow_submit_for_record_tx` (the Shape-A transactional RPC) to accept
`from_status = 'approved'` in the `finance_statutory_versions` branch, making the re-approval
a single Postgres commit. Three surgical edits in the `finance_statutory_versions` branch only;
all 13 other branches are byte-identical to mig 20260919000380.

The frontend now generates a stable per-attempt `idempotencyKey` (via `useRef`) on approved
versions, enabling exactly-once semantics even under retries.

## Operator steps

### 1. Apply the migration (ONCE, idempotent)

Connect to Supabase with the service role. Run either:

Option A — via Supabase Studio SQL editor:
  Paste the contents of `_apply_20260919000395_workflow_submit_tx_nis_reapproval_clean.sql`
  (at the repo root) and execute.

Option B — via psql:
  psql "$DATABASE_URL" -f _apply_20260919000395_workflow_submit_tx_nis_reapproval_clean.sql

Then reload PostgREST:
  select pg_notify('pgrst', 'reload schema');

Or in Supabase Studio:
  NOTIFY pgrst, 'reload schema';

### 2. Verify the migration applied

Run in SQL:
  select position('approved' in prosrc) > 0 as has_approved_gate,
         position('statutory_version.reopened_by_edit' in prosrc) > 0 as has_reopen_action
  from pg_proc
  where proname = 'workflow_submit_for_record_tx';

Both columns must be true.

### 3. Rebuild the backend and restart the dev server

  npm run build:backend
  (restart dev:netlify on :9999 or your BASE_URL port)

The running server does NOT hot-reload backend changes. A stale server will 404 on the
function or serve the old compiled code.

### 4. Run the E2E suite

  npm run test:e2e -- financeStatutory

Expected green: all existing tests plus the new "Shape-C" section.

The 4 new Shape-C tests are:
  - Shape-C setup: create sv4 draft and approve it (by separate actors)
  - Shape-C: missing idempotency key on approved version returns 400
  - Shape-C: upsert on approved version with key triggers atomic re-approval
  - Shape-C: idempotent retry with same key returns same workflow, no new workflow started
  - Shape-C: employee is DENIED NIS class upsert (access control)

### 5. Grep gate (static check, pre-commit already done)

  grep 'startWorkflowForRecord' netlify/functions/lib/finance/statutoryConfig.ts

Must return zero matches. (The call was deleted; only `rpcHttpError` remains from that import.)

## What the RPC does (3 surgical edits vs mig 380)

1. Status gate: `status not in ('draft', 'approved')` raises WF409
   (was: `status <> 'draft'` — now approved versions can be re-submitted)

2. Audit action: `case when v_stat.status = 'approved' then 'statutory_version.reopened_by_edit'
   else 'statutory_version.submitted' end`
   (differentiates re-approval from a fresh draft submit in the audit trail)

3. UPDATE source row: now also clears `approved_by` when re-opening an approved version
   `approved_by = case when v_from_status = 'approved' then null else approved_by end`
   (void the prior approval — the new approval run must resolve a new approver)

## Rollback

The migration is a `create or replace function`. To rollback, re-apply the previous
version (mig 20260919000380) the same way:

  psql "$DATABASE_URL" -f supabase/migrations/20260919000380_workflow_submit_tx_statutory_profile.sql

Then reload PostgREST and rebuild. Note: if mig 380 was already at CREATE OR REPLACE,
this is safe and does not drop any data.

## Dependencies

Migs that must already be applied:
  - 20260919000210 (wf_internal schema)
  - 20260919000211 (_claim_request / _record_request)
  - 20260919000212 (_create_instance)
  - 20260919000380 (base workflow_submit_for_record_tx with all 14 branches)

A `finance_statutory_approval` workflow binding + published template version must exist
in `module_workflow_bindings`. Without a binding the re-approval path raises 422
("No approval workflow is configured for statutory versions.").

## Notes

- The idempotencyKey is REQUIRED in the request body when `version.status === 'approved'`
  AND `finance_statutory.require_reapproval_on_edit = true` (default true).
  On draft versions, no key is needed (no RPC call is made).
- The class upsert (write to `finance_nis_classes`) happens before the RPC call.
  If the RPC fails, a compensating rollback restores the pre-existing class rows.
- `notifyUsersByRole('finance_manager', ...)` fires best-effort post-commit. A notification
  failure does NOT rollback the re-approval (the RPC already committed).
- The `startWorkflowForRecord` import has been removed from `statutoryConfig.ts`. If any
  other code path in that file still needed it, the build would fail (it does not).
