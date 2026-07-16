# Final Cutover Contract — Active-Workflow Unique Index (finding #3)

> **Status:** BUILT — migration 397, grep-gate test, E2E addition, runbook committed.
> Branch: `wf/cutover`. Operator must apply migs 395/396 BEFORE 397; see RUNBOOK_FINAL_CUTOVER.md.

---

## REQUIRED

| # | Requirement | File / location |
|---|-------------|-----------------|
| R1 | Partial unique index `uq_wf_one_active_per_record` on `workflow_instances(module_key, workflow_type, source_record_id)` WHERE `status NOT IN terminal_set` AND NOT onboarding discriminator | `supabase/migrations/20260919000397_*` |
| R2 | Terminal status set is exactly `{completed,approved,returned,rejected,cancelled,closed}` | index WHERE clause |
| R3 | Onboarding discriminator excludes `(module_key='hr_onboarding' AND workflow_type='onboarding_custom_approval')` from the uniqueness surface | index WHERE clause + contract §4 |
| R4 | DUP PREFLIGHT runs BEFORE the index: auto-cancels older duplicate active rows (all but latest by `started_at DESC, id DESC`), never deletes, tags them with `cancelled_reason='preflight_dedup_mig_397'` | DO block in migration |
| R5 | `wf_internal._create_instance` catches `unique_violation` (23505) and re-raises as `WF409` with the message pattern `_create_instance: an active workflow...` | CREATE OR REPLACE in migration |
| R6 | `rpcHttpError` in `service.ts` already maps `WF409` to HTTP 409; no change to `service.ts` required | `service.ts:400` |
| R7 | Grep-gate test fails if `startWorkflowForRecord` is referenced outside the allowlist | `tests/unit/workflow.startForRecord.guard.test.ts` |
| R8 | E2E test proves: (a) second active start on same source → 409; (b) after terminal state → second start succeeds | `scripts/e2e/suites/workflow-engine.mjs` |

---

## FORBIDDEN

| # | Prohibition | Reason |
|---|-------------|--------|
| F1 | Do NOT delete rows that violate the preflight — set `status='cancelled'` only | Audit trail must be preserved |
| F2 | Do NOT use `CONCURRENTLY` for the index — migration runs inside a transaction; `CONCURRENTLY` requires its own implicit transaction | Postgres constraint |
| F3 | Do NOT remove the `options.workflow` path from `moduleServiceAdapter.ts` — the path has THREE live callers (hseCapa, hseIncidents, hseRiskJsa hazard registration). Slice-5 design doc claim of "zero callers" was FALSE per grep verification. Deleting would silently break those HSE routes. | No-Band-Aids; verified by grep |
| F4 | Do NOT remove `startWorkflowForRecord` from `lib/workflow/service.ts` — `lib/finance/accountsPayable.ts` is a real direct caller, and `moduleServiceAdapter.ts` imports it for the live HSE path | AP module removal is a separate user-owned task |
| F5 | Do NOT add `CONCURRENTLY`, `NONCONCURRENTLY`, or `IF NOT EXISTS` to the final `CREATE UNIQUE INDEX` that would allow a silent no-op if the index already exists — use `IF NOT EXISTS` for idempotency only | Operator safety |
| F6 | Do NOT accept `scope_id` as a discriminator column for the index — `workflow_instances` does NOT have a `scope_id` column; `scope_id` lives on `module_workflow_bindings`. The design doc suggestion of `coalesce(scope_id,'')` does not apply here | Verified from schema migration 20260704000001 |

---

## DEFERRED

| # | Item | Ticket / next step |
|---|------|--------------------|
| D1 | Convert HSE routes (hseCapa, hseIncidents, hseRiskJsa) from `runModuleMutation + options.workflow` to direct RPC pattern, then delete `options.workflow` path and `ModuleWorkflowRequest` type from `moduleServiceAdapter.ts` | Separate slice per module; each removes one pre-migration caller from the grep gate waiver |
| D2 | Remove `startWorkflowForRecord` from `lib/workflow/service.ts` entirely after AP module removal and HSE migration | AP module removal task |
| D3 | Add `scope_id`-discriminated variant of the index if multi-scope onboarding custom approvals ever need to share a case record | Future onboarding enhancement |
| D4 | Migrate `wf_internal._create_instance` from SECURITY INVOKER to DEFINER parity audit (SUBMIT_TX_DESIGN.md follow-up) | Post-cutover hardening |

---

## §4 — Onboarding Discriminator Decision

**Problem:** E3 (`onboardingCustomActions.ts:131`) calls `startWorkflowByTemplate` multiple times on the same `hr_onboarding_cases` case, using `workflowType = 'onboarding_custom_approval'` each time. Multiple custom approval actions on one onboarding case legitimately produce multiple concurrent active instances of the same `(module_key, workflow_type, source_record_id)` triplet.

**Decision:** Exclude the `('hr_onboarding', 'onboarding_custom_approval')` pair from the uniqueness surface via a NOT clause in the index WHERE predicate. This is the "explicit per-family discriminator" option from SUBMIT_TX_DESIGN.md §9.

**Not chosen:** `coalesce(scope_id,'')` extension — `scope_id` does not exist on `workflow_instances`. Adding a new column is D3 (deferred).

**Risk:** Any future `(module_key='hr_onboarding', workflow_type='onboarding_custom_approval')` workflow can now accumulate active instances without constraint. The onboarding team must enforce their own dedup logic (the `idempotencyKey` / `request_key` receipt mechanism in `workflow_start_instance_tx` handles same-action retries; the index exclusion covers DIFFERENT custom actions on the same case).

---

## §5 — Caller Inventory (verified by grep at commit time)

Direct callers of `startWorkflowForRecord` in `netlify/functions`:

| File | Type | Disposition |
|------|------|-------------|
| `lib/workflow/service.ts` | Definition/export | KEEP — canonical location |
| `lib/moduleServiceAdapter.ts` | Import + call in Stage 3 | KEEP (waivered) — mediates 3 live HSE callers: `routes/hseCapa.ts` (capa_closure), `routes/hseIncidents.ts` (incident_investigation), `routes/hseRiskJsa.ts` (hazard_review). Waiver dies when those routes are converted to direct RPC (D1). |
| `lib/finance/accountsPayable.ts` | Direct caller | KEEP (waivered) — dies with AP module removal (D2) |
| `routes/workflowEngine.ts` comment | Comment only | Not a real caller; comment says "Legacy startWorkflowForRecord call REMOVED" |

No other files reference `startWorkflowForRecord` (grep confirmed).

---

## §6 — 23505 → WF409 Mapping

`wf_internal._create_instance` inserts into `workflow_instances`. After migration 397 adds the partial unique index, a duplicate active-workflow INSERT raises `unique_violation` (SQLSTATE 23505). Without handling, this surfaces to supabase-js as `{ code: '23505', message: '...' }`. The `rpcHttpError` helper in `service.ts` only maps `WF*` codes; 23505 would produce an untagged error (no `.status`) which routes treat as HTTP 500.

**Fix in this migration:** wrap the `INSERT INTO workflow_instances` in a sub-block with `EXCEPTION WHEN unique_violation THEN RAISE ... USING errcode = 'WF409'`. The existing `rpcHttpError` then maps `WF409 → 409` correctly with no change to TypeScript code.
