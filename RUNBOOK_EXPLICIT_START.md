# Runbook: Explicit-Start Slice (Finding #3 — Shape E)

**Branch:** `wf/explicit-auth`  
**Migration:** `20260919000396_workflow_start_instance_tx.sql`  
**Contract:** `netlify/functions/lib/workflow/START_INSTANCE_CONTRACT.md`

---

## What this slice fixes

Three call sites (E1/E2/E3) could trigger workflow starts without:
- verifying the actor has module-level permission (not just `workflow.view`/`workflow.submit`)
- verifying the source record exists in the DB
- providing an idempotency key (double-start on network retry was possible)

The explicit-start path previously called the legacy `instantiateWorkflow` / `startWorkflowForRecord`
code path (JS-level inserts, no atomicity guarantee). All three sites now go through the new
`workflow_start_instance_tx` Postgres RPC, which wraps `wf_internal._create_instance` atomically.

---

## Call sites

| Site | Route | Fix |
|------|-------|-----|
| E1 | `POST /api/workflows/create` | Gate 2 (module-authz) + Gate 3 (source-existence) added; `idempotencyKey` required |
| E2 | `POST /api/workflow-engine/start` | Same gates + `templateVersionId` required; `startWorkflowForRecord` removed |
| E3 | `addCaseAction` custom_approval | `crypto.randomUUID()` threaded to `startWorkflowByTemplate` |

---

## Operator checklist

### 1. Apply the migration

Connect as a privileged role (`postgres` or `service_role` with schema-create rights):

```sql
\i _apply_20260919000396_workflow_start_instance_tx_clean.sql
```

Or paste the body of `supabase/migrations/20260919000396_workflow_start_instance_tx.sql` into
the Supabase SQL editor.

Verify:

```sql
select proname, prosecdef
from pg_proc
where proname = 'workflow_start_instance_tx'
  and pronamespace = 'public'::regnamespace;
```

Expected: one row, `prosecdef = false` (SECURITY INVOKER).

Verify grants:

```sql
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'workflow_start_instance_tx';
```

Expected: only `service_role` with `EXECUTE`. No `anon`, no `authenticated`.

### 2. Rebuild the backend

```
npm run build:backend
```

Restart the dev server:

```
npm run dev:netlify
```

### 3. Run the E2E suite

```
npm run test:e2e -- workflow-engine
```

All tests must be green, including the new `Workflow › Explicit-start auth` section.

### 4. Smoke-test the gates manually (optional)

Using a non-admin JWT that lacks `hse.incidents.view`:

```bash
curl -X POST http://localhost:9999/.netlify/functions/api/workflow-engine/start \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{"args":{"moduleKey":"hse_incidents","workflowType":"incident_review","triggerEvent":"test","sourceRecordId":"<uuid>","templateVersionId":"<ver-uuid>","idempotencyKey":"<uuid>"}}'
```

Expected response: `{ "success": false, "message": "Forbidden: insufficient module access" }` with HTTP 403.

---

## What was NOT changed by this slice

- `startWorkflowForRecord` remains in `service.ts` (bound start, Shape A/B path). Final cutover
  (adding the active-wf unique index + deleting `startWorkflowForRecord` + the grep gate) is the
  next Shape-E tail item, tracked in memory.
- Module bindings (`module_workflow_bindings`) are still seeded for the E2E lifecycle tests and
  are NOT removed. Binding-based start (Shape A/B) continues to use `startWorkflowForRecord`.
- The `wf_internal._create_instance` primitive is unchanged.
- `moduleServiceAdapter.ts`, `finance/accountsPayable.ts`, `finance/statutoryConfig.ts` were not
  touched.

---

## Rollback

If the migration must be rolled back before the cutover:

```sql
drop function if exists public.workflow_start_instance_tx(
  uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text
);
```

Then redeploy the prior backend build (the TS call sites will 500 until the new backend is
removed, because `startWorkflowByTemplate` now calls `startWorkflowExplicit` → the RPC).

**Safe rollback window:** before any production explicit-start calls are made with `idempotencyKey`.
After production traffic flows through the new path, rolling back the migration will leave orphaned
`wf_internal.workflow_request_receipts` rows pointing at workflows that exist — benign but noisy.
