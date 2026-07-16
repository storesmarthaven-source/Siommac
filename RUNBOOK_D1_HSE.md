# RUNBOOK — Slice D1: HSE atomic create-and-start (migration 398)

Closes FINAL_CUTOVER_CONTRACT.md deferred item D1: hseCapa / hseIncidents /
hseRiskJsa hazard registration now go through `workflow_create_and_start_tx`;
the legacy Stage-3 `options.workflow` path is DELETED from moduleServiceAdapter
and its grep-gate waiver removed. Contract:
`netlify/functions/lib/workflow/CREATE_AND_START_SLICE_D1_HSE_CONTRACT.md`.

## 1. Operator — apply the migration (SQL Editor, plain tab)

1. Open `_apply_20260919000398_workflow_create_and_start_tx_hse_clean.sql`
   (repo root — comment-stripped paste copy of
   `supabase/migrations/20260919000398_workflow_create_and_start_tx_hse.sql`).
2. Paste the WHOLE file into a PLAIN Supabase SQL Editor tab (not the AI
   assistant) and run it.
3. `NOTIFY pgrst, 'reload schema';`
4. Verify:
   ```sql
   select position('hse_incidents' in prosrc) > 0
      and position('hse_capa_actions' in prosrc) > 0
      and position('hse_hazards' in prosrc) > 0
   from pg_proc where proname = 'workflow_create_and_start_tx';
   ```
   Expect `t`.

Prerequisites already applied: 210/211/212 (primitive + receipts), 390–394
(existing branches), 397 (active-workflow unique index — the HSE branches rely
on its 23505→WF409 guard for duplicate active reviews).

## 2. Build + restart (session-driven)

```
npm run build:backend
# restart dev:netlify (serves compiled dist — no hot reload)
```

## 3. E2E gate

```
npm run test:e2e -- incidents     # + new "D1 atomic create-and-start" section
npm run test:e2e -- riskjsa       # + new "D1 atomic hazard registration" section
npx jest tests/unit/workflow.startForRecord.guard.test.ts
```
Regressions (share the redefined create_and_start fn): hrOvertime, hrRequests,
hrLeave, hrOrganization, financePayComponents, hrEmployeeMaster, hrTransfers.

Expected new assertions:
- Incident create → status `triage` in-commit, workflow_id linked, in_progress
  `hse_incidents/incident_investigation` instance, pending `manager` task,
  people rows atomic, exactly 1 `hse.incident.submitted` app_event, exactly 1
  `audit_logs` row keyed by ref (NEW — the legacy path wrote no audit_logs row),
  lost-time HR handoff still raised post-commit.
- CAPA create → status `open` (capa_closure has no onStarted flip), atomic
  workflow + event + audit; content-key retry returns the same CAPA.
- Hazard create (high/critical) → status `assessment_required` in-commit +
  controls atomic + review workflow; retry dedupes; low/medium hazards start
  NO workflow.

## 4. Behavior changes (intentional, contract-documented)

- Incident status is `triage` from birth on the workflow path (previously
  `open` then adapter-flipped post-commit — the crash window is gone).
- The three creates now write a `public.audit_logs` row (a §2 gap the legacy
  adapter path never covered).
- `runModuleMutation` no longer accepts `options.workflow` (type deleted);
  `ModuleMutationResult.workflowId` is gone. The no-binding fallbacks keep
  create-only semantics (incident `open`, hazard caller status, capa `open`).
- Grep-gate allowlist is now: `lib/workflow/service.ts` (definition) +
  `lib/finance/accountsPayable.ts` (dies with AP removal, D2).
