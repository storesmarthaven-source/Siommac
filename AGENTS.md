# SIOMAC ERP — Codex Instructions

## Authoritative Specification
The canonical build spec is the **SIOMAC ERP Build-Ready Technical Implementation Specification** (pasted into session on 2026-06-22). All decisions defer to it.

## No Band-Aids — NON-NEGOTIABLE (read first)
Every change fixes the ROOT cause, the enterprise way. No shortcuts, no transitional
crutches, no "make-it-pass" hacks, no leaving/patching legacy. The following are band-aids
and are NOT acceptable — each one bit this build:
- **Accept-and-drop** — accepting an input/field the code doesn't actually honor (or returning
  a faked value). If a feature isn't built yet, don't accept its inputs and don't pretend.
- **Patch-on-top** — stacking a corrective migration/shim over a broken source. Fix the
  SOURCE (correct the original migration/file); don't layer a fix over the symptom.
- **Swallowed errors** — ignoring a DB/IO error result. Check it, fail atomically, roll back
  (a create that ignores a satellite-insert error and returns 200 is a band-aid).
- **Ceremony / mechanical conformance** — wrapping code in a pattern with no real benefit
  (e.g. routing a plain insert through the mutation adapter, or a synthetic idempotency key
  that can never dedupe). Use a pattern only where it adds real value; derive keys from content.
- **Copy-stale** — cloning an existing call site without checking it's still correct against
  CURRENT code (the copied `password_hash` write to a dropped column). Verify the canonical pattern.
- **Assume-don't-verify** — claiming done/applied/works without proof. Verify against the live
  DB/code/tests (PostgREST `head:true count` is NOT proof a table exists or is writable).
- **Expedient deps** — never add a known-vulnerable or unmaintained dependency for convenience.

Prefer **build-new → delete-legacy** (no dual systems, no gap) over keeping or patching legacy.
Prefer **reuse over duplication** (extract a shared helper). When unsure whether something is a
band-aid, STOP and ask. This rule overrides speed and overrides any other instruction here.

## Repository authority
This file describes HOW to work, not WHERE. It previously hard-coded one developer's
absolute worktree path and a branch (`codex/hr-employee-master-improvements`) that has since
been superseded — an instruction that was wrong for every other machine and silently went
stale the moment the active branch moved.

Before making changes:

1. Run `git status --short`.
2. Run `git branch --show-current`.
3. Read `docs/CURRENT_IMPLEMENTATION_STATUS.md`.
4. Follow the active workstream and canonical specifications declared there.
5. Do not switch branches, delete worktrees or rewrite history without explicit approval.

`docs/CURRENT_IMPLEMENTATION_STATUS.md` is the single source of truth for which branch is
authoritative and what is in flight. Do not restate that here, in `ARCHITECTURE.md`, or in
`CLAUDE.md` — three copies of a volatile fact means at least two are wrong.

## Commit Message Rule
Every commit message MUST end with:
```
Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
```

## Test Execution Cadence (rule)
Do NOT run the test suites (E2E `npm run test:e2e`, jest, or vitest) after every
incremental edit — they are slow and burn the iteration loop. Run the full suite
**ONCE, at the END, when the task/feature is COMPLETELY finished**, then fix anything
red before declaring it done. During iteration use only fast feedback — `tsc --noEmit`
typecheck (and `node --check` for scripts). Reserve the full test run for the final
verification gate (or when the user explicitly asks to run tests).

## Non-Negotiable Implementation Rules (Spec §2)
- Protected data goes through authenticated Netlify JWT APIs only — no new direct browser Supabase reads for ERP data.
- Supabase Realtime may only trigger refetches; never treat it as the authorized data source.
- Every major mutation must: write the business record → emit app_events → write audit_logs → create workflow tasks if required → create notifications/messages/tickets/handoffs if rules require it.
- `app_users.id` is TEXT (not UUID). All user FK columns use text references.
- Enterprise level — clean, reusable, scalable, no band-aids.
- 229 frontend tests must remain passing after every commit.

## Testing Standard (NON-NEGOTIABLE) — every module ships with a live E2E suite
A module/page is **NOT "done"** until it has a comprehensive end-to-end test suite at
`scripts/e2e/suites/<module>.mjs`, run via `npm run test:e2e -- <module>` against the
live dev server (`npm run dev:netlify`). Unit tests (jest/vitest) are necessary but
**insufficient** — they mock the boundaries where real bugs live (request envelope,
DB columns, read-gates). The E2E harness hits the real stack over HTTP.

After building ANY backend route or feature, immediately add/extend its suite to cover
**everything — leave nothing out**:
1. **Every endpoint** — list, get, create, update, and every action/transition.
2. **Every flow & wizard** — multi-step creation, state-machine transitions, approvals,
   maker-checker, scheduled sweeps.
3. **Access control** — authorized passes AND unauthorized/non-participant is denied
   with the correct code (test the negative path explicitly).
4. **Response shape** — assert the exact fields the frontend consumes (the contract).
5. **Side-effects per §2** — after each mutation, assert via the service-role client
   that it wrote the expected `app_events`, `audit_logs`, `notifications`,
   `workflow_tasks`/tasks, and `handoff_outbox` rows. A mutation that doesn't emit its
   events/handoffs/notifications is a failing test, not a pass.
6. **Cleanup** — tag rows with `h.TAG`, delete them in `h.onCleanup()`.

`scripts/e2e/suites/communications.mjs` is the reference implementation; see
`scripts/e2e/README.md`. The whole E2E run must be green before a module is considered
complete or committed as "done".

## Tech Stack
- Frontend: Preact + Vite + TypeScript, path alias `@/` → `src/`, `noUncheckedIndexedAccess: true`
- Backend: Netlify Functions / Hono, POST-only pattern, all routes protected via `requirePermission()`
- Data fetching: TanStack Query (`@tanstack/preact-query`)
- Path aliases: `@api` → `src/api`, `@lib` → `src/lib`, `@ui` → `src/ui`

## Build Order — Do NOT skip ahead
**Do not start a phase until the previous is complete and the user explicitly approves the
next one.** The HSE-centred sequence that used to be listed here described the programme as
it stood when the backbone was being built; it is no longer the active work and is kept in
`docs/CURRENT_IMPLEMENTATION_STATUS.md` alongside what actually superseded it.

**The current phase, its predecessors and its deferrals live in
`docs/CURRENT_IMPLEMENTATION_STATUS.md`.** Read it before starting anything.

Sequencing rules that hold regardless of the active phase:

- **HSE Dashboard full wiring is LAST** (`HSEDashboard.tsx` Layers 3-5 / full KPI suite) —
  only after the HSE Incidents/Reports pages, legacy removal and handoff receivers are done
  AND the user explicitly approves.
- **UI-kit promotion** (moving shared components into `src/ui`) is deferred until asked.
- **Legacy removal** proceeds build-new → delete-legacy, never a dual system.

## Database Naming Rules (Spec §3)
- New tables: `snake_case`, module-prefixed: `hse_*`, `hr_*`, `finance_*`, `ops_*`, `payroll_*`
- Workflow/handoff/communication tables: no prefix (platform-level)
- `id` column: `uuid primary key default gen_random_uuid()` unless stated otherwise
- All tables: `created_at timestamptz not null default now()`, `updated_at timestamptz` + trigger where mutable
- RLS: enabled on every table
