# Shape-B Slice 5 — moduleServiceAdapter Generic Create-and-Start

## Decision: DESIGN DOC ONLY — do not build yet

A clean, typed generic solution is NOT achievable without a half-build. This document
records the analysis and recommended path.

---

## What Slice 5 Was Asked to Do

Atomize the `startWorkflowForRecord` call that lives inside `runModuleMutation`
(Stage 3, `moduleServiceAdapter.ts:188`) so that the business INSERT + workflow
start happen in one Postgres transaction.

---

## Current State: The `options.workflow` path is unused

`runModuleMutation` calls `startWorkflowForRecord` only when the caller passes
`options.workflow: { ... }`. A comprehensive grep of all callers confirms:

```
grep -rn "workflowType:" netlify/functions/lib/{hr/contractsService,hr/onboardingCore,
hr/offboardingCore,hr/rosterCore,receivers/*}.ts netlify/functions/routes/{calendar,
hr,hrEmployeeImport,hseCapa,hseIncidents,hseInspections}.ts
```

**Result: zero hits.** None of the active `runModuleMutation` callers pass a `workflow:`
option. The Stage-3 `startWorkflowForRecord` path inside `runModuleMutation` is dead
code for the current codebase.

All actual workflow starts have already been atomized by Slices 1–4 (direct RPC calls
on per-table branches), or are non-approvable and never started a workflow at all.

---

## Why a Generic Solution Is Not Clean Right Now

### Option A — Generic `module_mutation_commit` RPC (MUTATION_BACKBONE_PLAN.md)

The backbone plan (`netlify/functions/lib/MUTATION_BACKBONE_PLAN.md`, status: DEFERRED)
describes a single `module_mutation_commit(business, satellites, event, audit)` RPC that
`runModuleMutation` ALWAYS calls. This is the correct long-term shape because:

- Every caller is converted declaratively (no per-caller branch in the migration)
- The legacy `writeRecord` path is deleted (no dual system)
- But it's a **big-bang migration**: all 18+ callers must convert together; operator
  applies a multi-table DDL + JS wiring in one coherent release

Partial implementation (atomizing some callers but not all while keeping the legacy
`writeRecord` path) re-introduces the dual system — a band-aid per CLAUDE.md.

### Option B — Add a `txCommit` option to `runModuleMutation`

Described in MUTATION_BACKBONE_PLAN.md §JS Side as an intermediate step. Explicitly
reverted because keeping both `writeRecord` and `txCommit` is a transitional dual system.

### Option C — Per-caller typed branches in the existing `workflow_create_and_start_tx`

Possible only for callers that both INSERT a business row AND start a workflow in the
same operation. Currently that is zero callers (as shown above). Future callers that
need this already have a model to follow (Slices 1–4). Each future caller that adds a
`workflow:` option should instead use the direct RPC pattern (not route through
`runModuleMutation`).

---

## Enumeration of `runModuleMutation` Callers

For completeness, here are all active callers and their workflow status:

| Caller | Table | Passes `workflow:` option? | Notes |
|--------|-------|---------------------------|-------|
| `hr/contractsService.ts` (createContract) | `hr_contracts` | No | create-only |
| `hr/contractsService.ts` (terminateContract) | `hr_contracts` | No | update-only |
| `hr/contractsService.ts` (renewContract) | `hr_contracts` | No | update-only |
| `hr/contractsService.ts` (others) | `hr_contracts` | No | |
| `hr/leaveCore.ts` (non-binding path) | `hr_leave_requests` | No | binding path already RPC'd (Slice 2) |
| `hr/offboardingCore.ts` | `hr_offboarding_cases` | No | create-only |
| `hr/onboardingCore.ts` | `hr_onboarding_cases` | No | create-only (Supabase Auth call = can't be in-tx) |
| `hr/requestsCore.ts` (non-approvable) | `hr_requests` | No | approvable path already RPC'd (Slice 1) |
| `hr/rosterCore.ts` | `hr_rosters` | No | create-only |
| `routes/hr.ts` (provisionEmployee) | `app_users` | No | calls Supabase Auth API — can never be in-tx |
| `routes/hr.ts` (createChangeRequest no-binding) | `hr_employee_change_requests` | No | binding path RPC'd (Slice 4) |
| `routes/hrEmployeeImport.ts` | `hr_employee_imports` | No | create-only |
| `routes/hseCapa.ts` | `hse_capas` | No | create-only |
| `routes/hseIncidents.ts` | `hse_incidents` | No | workflow started separately outside runModuleMutation |
| `routes/hseInspections.ts` | `hse_inspections` | No | create-only |
| `routes/calendar.ts` (createEntry) | `calendar_entries` | No | create-only |
| `routes/calendar.ts` (updateEntry) | `calendar_entries` | No | update-only |
| `lib/receivers/hrReceiver.ts` | (handoff receipt) | No | create-only |
| `lib/receivers/financeReceiver.ts` | (handoff receipt) | No | create-only |
| `lib/receivers/operationsReceiver.ts` | (handoff receipt) | No | create-only |

**No caller passes `options.workflow` to `runModuleMutation`.**

---

## Recommended Path

1. **Now:** leave `runModuleMutation` Stage-3 `startWorkflowForRecord` in place as dead
   code. It causes no harm and can be removed with the full backbone migration.

2. **Future callers that need create-and-start atomicity:** use the direct RPC pattern
   (Slices 1–4) — `selectWorkflowBinding` → `sb.rpc('workflow_create_and_start_tx', {...})`
   → `rpcHttpError` → `notifyUsersByRole` — NOT `runModuleMutation` with `options.workflow`.

3. **Long-term:** execute the MUTATION_BACKBONE_PLAN.md big-bang when the team is ready
   to convert all 18+ callers together. At that point, remove the `writeRecord` path and
   `startWorkflowForRecord` from `runModuleMutation`.

---

## Risk if Deferred

- The `startWorkflowForRecord` inside `runModuleMutation` is dead code, so it causes no
  atomicity bug in the current codebase.
- New callers who mistakenly route through `runModuleMutation` with `options.workflow`
  instead of the direct RPC pattern would reintroduce the non-atomic strand. The code
  review checklist should flag any `options.workflow` addition to a `runModuleMutation`
  call as requiring the direct RPC pattern instead.

---

*Generated: 2026-07-16 | Finding #3 Shape-B Slice 5 | Author: Claude Sonnet 4.6*
