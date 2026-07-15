# Applying the review-remediation migrations (commit `6782fe05`)

Seven migrations from the 11-finding code-review remediation need to be applied/re-applied by
an operator, plus one prerequisite. **Two of them gate live code** — until they land, employee
auto-numbering (#11) and position reports-to approvals (#7) will error.

## ⚠ Do NOT use the Supabase dashboard **AI Assistant** to run these
It rewrites the SQL: on a plpgsql function it misreads the `DECLARE … %rowtype` variables as
"new tables", **truncates the function body**, and appends bogus `ALTER TABLE v_inst ENABLE ROW
LEVEL SECURITY;` lines — producing `ERROR: unterminated dollar-quoted string at or near "$fn$"`.
The migration files are correct; the assistant corrupts them. Use one of the clean paths below.

## Clean apply method — psql (recommended)
Get the connection string from **Supabase → Settings → Database → Connection string** (URI). The
project ref is `gaflqcwcrvnusnlghwej`. Then, from the repo root:

```bash
# One password prompt for the whole batch — set it once:
export PGURL="postgresql://postgres:[YOUR-DB-PASSWORD]@db.gaflqcwcrvnusnlghwej.supabase.co:5432/postgres"
# (or paste the exact pooler URI Supabase shows — same idea)

psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

`-v ON_ERROR_STOP=1` makes psql stop on the first error instead of plowing on.

**Alternative (no psql):** paste the whole file into a **plain SQL Editor** query tab and press
Run (Ctrl/Cmd+Enter). Do not route it through the Assistant, and decline any "enable RLS" toast.
Last-resort for `160` if an editor still truncates: run lines **1–247** (function 1 through its
`$fn$;`), then lines **250–292** (function 2 + the grants) as two executions.

## Apply order + per-migration verify

Run in this order. After **all** succeed, run the `NOTIFY` at the bottom once.

### 0. Prereq — `20260628100000` (realtime RLS for `communication_signals`)
Needed BEFORE #5 below, or `230` aborts on this table. (Also the outstanding triage item #1.)
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260628100000_communication_signals_realtime.sql
```
Verify (anon should now be scoped, not the full table):
```sql
select relrowsecurity from pg_class where relname = 'communication_signals';  -- expect: t
```

### 1. `160` — decide-RPC elevation fix (#1)  ·  RE-APPLY
Elevation = `admin_override` only (+superadmin), mandatory override reason.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000160_workflow_decide_task_tx.sql
```
Verify:
```sql
-- reassign must NOT appear in the function body; admin_override must:
select position('instances.reassign'      in prosrc) as has_reassign,   -- expect 0
       position('instances.admin_override' in prosrc) as has_override    -- expect > 0
from pg_proc where proname = 'workflow_decide_task_tx';
```

### 2. `210` — wf_internal grants (#10)  ·  RE-APPLY
Grants `service_role` table/default privileges so the future 211 helpers work.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000210_workflow_creation_foundation.sql
```
Verify:
```sql
select has_table_privilege('service_role','wf_internal.workflow_request_receipts','INSERT');  -- expect t
```

### 3. `230` — RLS sweep now fails closed (#5)  ·  RE-APPLY
Aborts (instead of warning) if any realtime table is left with RLS off.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000230_enable_rls_on_all_public_tables.sql
```
If it aborts naming a realtime table, that table is genuinely exposed and needs a scoped
anon-read policy first (that is the fix working as designed — do not bypass it). `communication_signals`
is handled by step 0; any other named table needs its own policy before this can pass.
Verify (anon can no longer read a locked catalogue table):
```sql
-- with the ANON key: select * from role_permissions limit 1;  → 0 rows
```

### 4. `260` — pay-component pending-dup index (#9)  ·  APPLY
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000260_finance_pay_component_pending_create_unique.sql
```
Verify:
```sql
select indexname from pg_indexes where indexname = 'finance_pay_component_pending_create_code_uidx';  -- 1 row
```

### 5. `270` — seed the atomic EMP counter (#11)  ·  APPLY  ⚠ gates live code
Without this, `nextEmployeeNumber` mints `EMP-0001` collisions. Current max is `EMP-0023`, so it
seeds the counter to 24.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000270_seed_employee_number_counter.sql
```
Verify (expect next_number = 24):
```sql
select next_number from public.reference_counters where prefix = 'EMP' and year = 0;
```

### 6. `280` — user_permissions deny-all (#4)  ·  APPLY
Drops the `USING(true)` policy so the table is no longer anon-enumerable.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000280_user_permissions_deny_all.sql
```
Verify (with the ANON key): `select * from user_permissions limit 1;` → **0 rows**.

### 7. `290` — position hierarchy serialization (#7)  ·  APPLY  ⚠ gates live code
Adds the advisory-lock RPC + one-active-CR-per-position index. Without it, position reports-to
approvals error.
```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000290_hr_position_hierarchy_serialization.sql
```
Verify:
```sql
select proname from pg_proc where proname = 'hr_position_apply_reports_to_tx';                              -- 1 row
select indexname from pg_indexes where indexname = 'hr_org_change_requests_one_active_per_position_uidx';  -- 1 row
```

## After all seven succeed
```sql
NOTIFY pgrst, 'reload schema';
```
Then:
1. `npm run build:backend` + restart `dev:netlify` (dist serves compiled code; it does not hot-reload).
2. Run the full E2E: `npm run test:e2e`. The new `workflow-engine` "manager holding only reassign is
   denied" test goes green only after step 1 (`160`) is applied.

## Order dependency summary
- `20260628100000` **before** `230` (else `230` aborts on `communication_signals`).
- Everything else is independent, but apply `270` and `290` **before** exercising employee creation
  or position reports-to approvals (the committed code calls their RPCs).
