# RUNBOOK — Final Cutover: Active-Workflow Unique Index (migration 397)

**Branch:** `wf/cutover`
**Related migrations:** 395 (NIS re-approval), 396 (explicit-start tx), 397 (this file)
**Design doc:** `netlify/functions/lib/workflow/SUBMIT_TX_DESIGN.md` sections 9 and 11
**Contract:** `netlify/functions/lib/workflow/FINAL_CUTOVER_CONTRACT.md`

---

## Prerequisites

Migration 397 depends on migrations 395 and 396 being applied first.
If you have not yet applied those, do it now:

1. Apply `_apply_20260919000395_workflow_submit_tx_nis_reapproval_clean.sql`
2. Apply `_apply_20260919000396_workflow_start_instance_tx_clean.sql`
3. `NOTIFY pgrst, 'reload schema';`
4. Verify both RPCs exist:
   ```sql
   select proname from pg_proc
   where proname in ('workflow_submit_for_record_tx', 'workflow_start_instance_tx');
   ```
   Expected: 2 rows.

Then proceed with migration 397.

---

## Step 1: Run the DUP PREFLIGHT (inspect before applying)

Before applying migration 397 in full, you can check whether any duplicate
active workflows exist by running this read-only query:

```sql
select
  module_key,
  workflow_type,
  source_record_id,
  count(*) as active_count,
  array_agg(id order by started_at desc) as instance_ids
from public.workflow_instances
where status not in ('completed','approved','returned','rejected','cancelled','closed')
  and not (module_key = 'hr_onboarding'
           and workflow_type = 'onboarding_custom_approval')
group by module_key, workflow_type, source_record_id
having count(*) > 1;
```

**Expected:** zero rows on a healthy production database.
If rows appear, they will be auto-cancelled by the DO block in migration 397
(all but the most recent active instance per group, tagged with
`cancelled_reason = 'preflight_dedup_mig_397'`).

---

## Step 2: Apply migration 397

Open a PLAIN Supabase SQL Editor tab (not the migration editor).
Paste the contents of `_apply_20260919000397_workflow_active_unique_index_clean.sql`
from the repo root and run it.

Do NOT use the Supabase migration dashboard or `supabase db push` — this
migration is operator-applied to avoid the Supabase CLI transaction wrapper
that conflicts with `LOCK TABLE` inside the function body.

Expected output (NOTICE messages in the query result):
- If no duplicates: `preflight_dedup_mig_397: no duplicate active workflows found — index creation is clean`
- If duplicates existed: `preflight_dedup_mig_397: cancelled older duplicates in N source-record groups (M rows total)`

---

## Step 3: Reload the schema

Run in Supabase SQL Editor (or via psql):

```sql
NOTIFY pgrst, 'reload schema';
```

---

## Step 4: Verify the index was created

```sql
select indexname, indexdef
from pg_indexes
where indexname = 'uq_wf_one_active_per_record';
```

Expected: 1 row with a definition matching:
```
CREATE UNIQUE INDEX uq_wf_one_active_per_record ON public.workflow_instances
USING btree (module_key, workflow_type, source_record_id)
WHERE ((status <> ALL ('{completed,approved,returned,rejected,cancelled,closed}'::text[]))
  AND NOT ((module_key = 'hr_onboarding'::text)
           AND (workflow_type = 'onboarding_custom_approval'::text)))
```

---

## Step 5: Verify the _create_instance function was updated

```sql
select position('WF409' in prosrc) > 0 as has_wf409_guard
from pg_proc
where proname = '_create_instance'
  and pronamespace = (select oid from pg_namespace where nspname = 'wf_internal');
```

Expected: `has_wf409_guard = true`

---

## Step 6: Build and restart the dev server

```
npm run build:backend
```

Restart `dev:netlify` so the compiled backend picks up any TS changes.

---

## Step 7: Run the E2E verification

First confirm migrations 395 and 396 are applied (required by the E2E):

```
npm run test:e2e -- workflow-engine
```

Expected results include the new section:

```
Workflow > Active-workflow uniqueness (mig 397)
  PASS  UNIQUE: first start on a fresh source record succeeds
  PASS  UNIQUE: second start on the SAME active source record is rejected with 409
  PASS  UNIQUE: cancelling the first workflow reaches terminal status
  PASS  UNIQUE: new start is allowed after first workflow is cancelled
```

All existing workflow-engine tests must remain green.

---

## Step 8: Run the grep-gate unit test

```
npm run test:unit -- workflow.startForRecord.guard
```

Expected: PASS (1 test, 0 violations).

---

## Rollback

If the index must be dropped (e.g. due to unforeseen duplicates not caught by
the preflight):

```sql
drop index if exists public.uq_wf_one_active_per_record;
NOTIFY pgrst, 'reload schema';
```

Then re-apply migration 219 to restore _create_instance without the WF409 guard:

```sql
-- re-run: supabase/migrations/20260919000219_workflow_allow_unresolved_dynamic_assignee.sql
```

---

## Known Limitations

- The `moduleServiceAdapter.ts` Stage-3 path (HSE routes) is NOT deleted in
  this migration. Three HSE routes (CAPA, Incidents, Risk-JSA hazard
  registration) still call `startWorkflowForRecord` via `runModuleMutation`.
  These are waivered in the grep gate.  See FINAL_CUTOVER_CONTRACT.md D1.

- The AP module (`lib/finance/accountsPayable.ts`) calls `startWorkflowForRecord`
  directly.  Waivered until AP module removal.  See FINAL_CUTOVER_CONTRACT.md D2.

- The onboarding discriminator excludes `(hr_onboarding, onboarding_custom_approval)`
  from the uniqueness surface.  Multiple custom approval actions on one onboarding
  case are allowed.  See FINAL_CUTOVER_CONTRACT.md section 4.
