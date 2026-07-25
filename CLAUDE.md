# SIOMAC ERP — Claude Code Instructions

## Authoritative Specification
The canonical build spec is the **SIOMAC ERP Build-Ready Technical Implementation Specification** (pasted into session on 2026-06-22). All decisions defer to it.

## Orient first — Repository Map and Generated Index
Read these before broad repository searches:

1. `docs/REPO_MAP.md` — curated architecture, conventions, ownership boundaries, and hotspots.
2. `docs/generated/CODEBASE_INDEX.md` — deterministic inventory and module summary.
3. `docs/generated/modules/<module>.md` — module-local pages, hooks, routes, permissions, database
   objects, widgets, and E2E coverage.
4. `docs/generated/SYMBOL_INDEX.tsv`, `ROUTE_INDEX.tsv`, `WIDGET_INDEX.tsv`, or
   `CODEBASE_INDEX.json` — exact machine-searchable lookup when the summaries are insufficient.

Usage details are in `docs/CODEBASE_INDEX_GUIDE.md`.

Generated index files are navigation aids, not authority. Re-read the current source immediately
before editing. Never hand-edit `docs/generated/`; run `npm run repo:index` after structural code,
route, schema, widget, or E2E changes. `npm run repo:index:check` must pass before commit.

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

## Feature Completeness — NON-NEGOTIABLE (no half-wired pages)
Before building or substantially expanding a module, follow
`docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md`. Create the required delivery contract, E2E
traceability matrix, and release-evidence document from `docs/templates/`. The route-coverage gate
only proves that an endpoint is called somewhere; it does not replace behavioral, side-effect,
permission, concurrency, cleanup, or browser-journey evidence.

When building OR upgrading any module/page, it is **NOT "done"** until EVERY interactive element is
fully wired to a real backend AND the platform backbone. "It renders" and "it navigates" are not
"done." Shipping dead buttons, navigate-only stubs, or thin one-field dialogs is the same failure as
a band-aid (see **Accept-and-drop**) — `docs/FINANCE_FEATURE_AUDIT.md` is the cautionary record of
exactly this. Before calling a page complete, walk EVERY control and confirm:
- **Every button is wired** — no `onClick`-less buttons, no toast-only handlers, no `setTab` masquerading
  as an action. A button whose label implies an action (Approve, Export, Pay, Send) MUST perform it, not
  just navigate. If it's really a link, label it like one.
- **Every dialog with input is fully built out** — ALL real fields (not one), inline per-field validation,
  the FULL backend contract sent (never a hardcoded subset like `method:'eft'`), pickers (not free-text)
  for FK'd entities, and real empty/loading/error states.
- **Every wizard is fully built out** — all steps, multi-row/line editors where the domain needs them,
  attachments, duplicate/conflict checks, and submit-for-approval (or equivalent) on completion.
- **Every feature & function is wired** — search, filters/facets, row ⋮ menus, bulk actions, drill-through,
  import/export, pagination — each functional against a real endpoint, or NOT shown at all.
- **Ties into the platform backbone (Spec §2)** — every mutation emits `app_events` + `audit_logs`, raises
  a **toast** on success/failure, and — where the rules require — creates **notifications**, **messages**,
  **tickets**, **workflow tasks/approvals**, and **handoffs** into the **other modules** it touches. A
  feature that writes its row but fires none of these is incomplete.
- **Cross-module wiring is real** — an action that belongs to another module (approve elsewhere, open a
  ticket, message a party) calls THAT module's real action/endpoint, never a local no-op.

If a feature can't be finished this session, **do not stub it** — leave it out and say so (No-Band-Aids),
rather than shipping a control that lies about what it does. Audit the whole page against this list (the
`FINANCE_FEATURE_AUDIT.md` lens) BEFORE declaring done, and back it with the E2E suite (Testing Standard)
that asserts those side-effects actually fired.

## Known Pitfalls — verified this build (read before touching the area)
Each of these cost real debugging time. Don't relearn them.

- **Mutation atomicity needs a Postgres RPC — not JS.** supabase-js issues SEPARATE PostgREST
  calls; you cannot wrap `business row + app_events + audit_logs + handoff_outbox` in one
  transaction from the app layer. Throwing between the calls is a band-aid (partial state +
  dup-on-retry, because `startMutationRun` only short-circuits `completed` runs — a `failed`
  run re-runs `writeRecord`). The real fix is a transactional-outbox RPC, as ONE commit path
  for ALL mutations with the legacy `writeRecord` path DELETED (no `txWrite`-alongside dual
  system) — a big-bang migration. Design: `netlify/functions/lib/MUTATION_BACKBONE_PLAN.md`.
  When no RPC exists yet, use a **compensating rollback** (e.g. delete the parent on a
  satellite-insert failure), never a silent swallow.
- **`requireUser` resolves role from the DB, not the JWT.** Minting a token with a forged
  `role` does nothing — auth re-reads `app_users.role` by `sub`. E2E role-denial tests must
  PROVISION a real user of that role (the harness's `admin` can be a superadmin = allow-all).
- **`apiPost`/`apiPatch`/`authPost` wrap the body as `{ args: payload }`.** Every backend
  route must validate `body.args ?? body`. Reading the raw body silently breaks the endpoint
  (it was already broken on webauthn rename/delete/auth-options).
- **Permission keys must match the catalogue EXACTLY** (`hse.ptw.view`, not `hse.permits.view`).
  Read-gate / record-inheritance mappings are NOT covered by the enforced-key drift-guard —
  grep the catalogue to confirm any key string before shipping it.
- **A new permission key is DEAD until it's granted in the `role_permissions` TABLE.**
  `requirePermission` resolves a role's capabilities via `loadRolePermissions`, which reads
  `role_permissions` from the DB — NOT the static `ROLE_PERMISSIONS` in
  `netlify/functions/lib/permissions.ts` / `src/lib/permissions.ts`. Adding a key to both
  catalogues (and `permissionMeta`) makes it typecheck and show up in the RBAC console, but every
  call still **403s** until a migration inserts the `role_permissions` rows. Superadmin is the only
  exception (allow-all in memory) — which is exactly why this hides during superadmin testing. It
  surfaced on the SoD build when `finance_manager` 403'd on every new endpoint. So: ship the
  `role_permissions` insert in the SAME migration as the key, and prove it with an E2E that
  provisions a REAL user of that role. Note `ROLE_CACHE_TTL_MS = 30s` — after granting, wait for the
  cache to expire (or restart) before retesting.
- **`dev:netlify` serves compiled `dist/`.** Backend source changes need `npm run build:backend`
  AND a dev-server restart — the running server does NOT hot-reload (module-adapter registration
  especially). A passing test against a stale server is a false pass; restart before trusting E2E.
- **Verify external audit claims against the code first.** The "admin can approve manifests"
  finding was a TEST-FIXTURE bug (`T.admin` = superadmin), not a code bug. Don't implement
  audit items blindly — reproduce the root cause.
- **Dependency pins (do not bump blindly):** `@supabase/supabase-js` is pinned EXACTLY to
  `2.105.3` + `overrides.ws ^8.21.0` — 2.105.4/2.108 drop `ws` and change realtime, which broke
  ~29 E2E. `hono ^4.12.27` (CVE patch; we use our own `jsonwebtoken`, not hono's JWT middleware).
  Re-run the FULL E2E (esp. realtime suites) before changing either.
- **v36 mockup CSS has multiple cascade layers** — the WINNING rule is the LAST (the v32 "unify
  all wizards" block). Grep ALL declarations for a selector and take the last applicable one.
- **Security-policy DB seed ≠ static code (lockout landmine).** `auth_security_policy` defaults
  `require_mfa_for_super_admin = true`, but static `securityPolicy.REQUIRE_MFA_ROLES` is only
  `['admin','manager']`. Wiring `isMfaRequiredForRole` to read the DB will START requiring MFA
  for superadmin — locking out any superadmin (incl. the E2E's `admin=superadmin`) without an
  enrolled factor. Before that wiring: confirm every superadmin has MFA, or default super-admin
  MFA off. Don't flip it blind.

## Worktree Rule
Work **directly in `C:\Users\MSI Laptop\Desktop\Siomac` on branch `main`** — that is the
complete, runnable copy (has `.env`, `node_modules`, `netlify/`, `assets/`, `docs/`) and the
dev servers run from it. The former working branch `claude/wonderful-panini-34b331` was
fully merged into `main` (identical at the merge point); commit new work to `main`.

Any `wonderful-panini-*` folders under `.claude\worktrees\` are DEAD stray/Explorer copies
(stale snapshots, broken or missing `.git` links) and must NOT be used for anything —
delete them once no process holds them open. Genuine short-lived worktrees for parallel
agents (e.g. `wf-*`) are created/removed by sessions via `git worktree add/remove`.

## Commit Message Rule
Every commit message MUST end with:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
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

The existing harness is live API E2E, not browser automation. User-facing modules also require
critical browser journeys under the enterprise module delivery standard. Until a repository browser
runner is established, record the browser acceptance pass and state the automation gap explicitly.

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

## Module Completion Audit — run ON REQUEST (enterprise Definition of Done)
This is the gate the user runs when they believe a module is complete. **Do NOT run it
unprompted** — only when the user says "audit <module>" / "is <module> complete" / "run the
completion checklist". It is the union of **Feature Completeness** + **Testing Standard** +
**§2**, turned into a walk-every-control audit. This is enterprise software — a single dead
button, unvalidated field, ungated sensitive mutation, or missing audit row is a FAIL, not a
nit. Produce a written report: for EACH item below → ✅ pass (with proof: file:line / test
name / DB assertion), ⚠️ gap (with the exact risk), or ❌ fail. Fix every ❌/⚠️ or list it as a
known gap the user must accept. "It renders / it navigates / typecheck passes" is NOT a pass.

Walk the WHOLE module against these — leave nothing out:

**A. Every interactive control (walk each one).** Every button performs its labelled action
(no `onClick`-less, no toast-only, no `setTab`-as-action); search filters real data; every
basic + advanced filter/facet applies AND clears AND shows an active-chip; sort on every
sortable column; row ⋮ menus, bulk actions, drill-through, import/export, pagination + rows-
per-page all hit a real endpoint; tabs and drawers open/close and load their own data. A
control that can't be finished is REMOVED, not stubbed.

**B. Every input & form.** EVERY real field present (never a one-field dialog for a multi-field
contract); inline per-field validation (required, **min/max length**, numeric range, format/
regex, date sanity) shown on the field (not just a toast); FK'd entities use pickers not free-
text; cross-field & cross-entity rules enforced (selection A constrains B; value X forces field
Y; **FE gate ⇒ matching BE gate**); the FULL backend contract is sent (never a hardcoded subset
like `method:'eft'`); real empty / loading / error / disabled states; submit disabled until
valid; no silent truncation.

**C. Mutations & §2 side-effects (assert, don't assume).** Every mutation writes the business
row → `app_events` → `audit_logs`, and — where rules require — `notifications` / `messages` /
`tickets` / `workflow_tasks` / `handoff_outbox`, AND raises a success/failure **toast**.
Atomicity: multi-row writes go through the transactional path or a **compensating rollback** (no
swallowed errors, no partial state, no dup-on-retry). Cross-module actions call the OTHER
module's real endpoint, never a local no-op.

**D. Approval / maker-checker for sensitive data.** Anything financial, statutory, payroll,
security, or access-control MUST be gated: draft → submit → approve → activate, with
**segregation of duties** (creator ≠ approver, enforced server-side), correct state guards
(can't approve a non-pending row, can't edit an approved/active record without re-approval),
and the approval routed through the **central workflow engine** + binding — not an ad-hoc flag.
No sensitive value takes effect on a single actor's say-so.

**E. Access control (test the NEGATIVE path).** Authorized role passes AND unauthorized / non-
participant is DENIED with the correct HTTP code — provisioned as a REAL user of that role (not
the superadmin harness). Permission keys match the catalogue EXACTLY; read-gates & record-
inheritance verified.

**F. Data integrity & display.** No raw UUIDs/IDs in the UI (resolve to names/pickers); correct
units/rounding/currency; immutable-after-activation honored; idempotent seed ships so the page
renders populated.

**G. E2E proof (the contract).** `scripts/e2e/suites/<module>.mjs` covers every endpoint, every
flow/wizard/transition, both access-control paths, the exact **response shape** the FE consumes,
and asserts the §2 side-effects via the service-role client. Rows tagged `h.TAG` + cleaned up.
Full E2E green.

**H. UX polish.** Instant-from-cache where possible; skeletons on cold path (never a fake "0");
toasts on every success/failure; a11y (aria, keyboard, focus); responsive.

**Questions to ask on every module (the gap-finders):**
1. Which button/field/filter is NOT wired to a real endpoint — and did I click every one?
2. Which mutation does NOT emit its `app_events` + `audit_logs` (+ required notifications/
   handoffs)? Prove each with a DB assertion, not a claim.
3. Which sensitive change can take effect WITHOUT approval or without creator≠approver?
4. Which FE validation/gate has NO matching BE gate (or vice-versa)?
5. Which field has no min/max length, format, or cross-field rule that it should?
6. What's the unauthorized-user result for each endpoint — tested explicitly?
7. What happens on partial failure mid-transaction — rollback or orphaned rows?
8. What does each empty / loading / error state actually show?
9. Which value is faked, hardcoded, defaulted, or silently dropped instead of honored?
10. What did the E2E NOT cover that a user could actually do?

## Tech Stack
- Frontend: Preact + Vite + TypeScript, path alias `@/` → `src/`, `noUncheckedIndexedAccess: true`
- Backend: Netlify Functions / Hono, POST-only pattern, all routes protected via `requirePermission()`
- Data fetching: TanStack Query (`@tanstack/preact-query`)
- Path aliases: `@api` → `src/api`, `@lib` → `src/lib`, `@ui` → `src/ui`

## Build Order — Do NOT skip ahead
**Do not start a phase until the previous is complete and the user explicitly approves the next
one.** The platform backbone, Communications, HSE-core migrations, and the HR/Finance module
build-out are complete and green; active work is HR (onboarding/offboarding/attendance/etc.) and
its dashboards/widgets. Per-module status lives in memory + `docs/PHASE_PLAN.md`, not here.

Still-standing sequencing rules:
- **HSE Dashboard full wiring is LAST** (`HSEDashboard.tsx` Layers 3-5 / full KPI suite) — only
  after HSE Incidents/Reports pages, legacy removal, and handoff receivers are done AND the user
  explicitly approves.
- **UI-kit promotion** (moving shared components into `src/ui`) is deferred until asked.
- **Legacy removal** (localStorage workflow store, synthetic notification route, legacy HR
  sections) proceeds build-new → delete-legacy, no dual system.

## Database Naming Rules (Spec §3)
- New tables: `snake_case`, module-prefixed: `hse_*`, `hr_*`, `finance_*`, `ops_*`, `payroll_*`
- Workflow/handoff/communication tables: no prefix (platform-level)
- `id` column: `uuid primary key default gen_random_uuid()` unless stated otherwise
- All tables: `created_at timestamptz not null default now()`, `updated_at timestamptz` + trigger where mutable
- RLS: enabled on every table
