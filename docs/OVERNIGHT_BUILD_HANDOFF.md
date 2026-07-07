# Overnight Module Build — Handoff (read this first in a fresh session)

## Why this doc exists
Background build-agents kept dying because they were launched from a **large context** that
compacted / restarted the Claude Code process (the notification read: *"agent was running when the
previous Claude Code process exited"*). **Fix: run the agent fleet from a FRESH, small context** so
they have runway to finish before any compaction. This doc is the plan so the fresh session needs no
re-derivation.

## Hard-won learnings (do NOT repeat these mistakes)
- **`isolation: 'worktree'` gives a BROKEN base** here — the agent worktree branched ~471 commits
  behind (missing the whole codebase: no `moduleServiceAdapter.ts`, no HSE pages). NEVER use
  `isolation:'worktree'` for these builds. Verified: agent worktree had 0 HSE section files.
- **Non-isolated agents run on the CORRECT base** (the recon agents produced accurate current-code
  inventories). Use `run_in_background: true` WITHOUT isolation.
- Agents die on process restart → launch from fresh context, keep the launching session quiet.

## Constraints (from the user — non-negotiable)
- **Commit LOCALLY only — do NOT push** (`origin/main` was already set to `e34e6a52` once at the
  user's request; no further pushes).
- **Do NOT touch the onboarding design**: `OnboardingOverview.tsx`, `StartOnboardingWizard.tsx`,
  `StartOnboarding.css` are FINAL. Other modules may link to onboarding but must not restyle these.
- **Enterprise layouts, NOT widget boards**: PageHeader + tabbed workspace + tables + drawers/dialogs
  + stat/spark rows + charts. Information-rich, usable, visually polished. No colored left-accent
  rails. No band-aids, no mock fallbacks left in.
- Reference to mirror for every HSE module: `src/components/sections/HSE/Incidents.tsx` +
  `netlify/functions/routes/hseIncidents.ts` + `netlify/functions/lib/hse/*` + `src/api/hse/incidents.ts`.

## Repo conventions
- Migrations: `supabase/migrations/<ts>_hse_<mod>.sql`. uuid PK `default gen_random_uuid()`;
  `created_at timestamptz not null default now()`; `updated_at timestamptz` + reuse existing
  `public.set_updated_at()` trigger (copy trigger + `enable row level security` + `grant ... to
  service_role` from an existing `hse_` migration). **`app_users.id` is TEXT** → user FKs are
  `text references public.app_users(id)`. Idempotent seed so the page renders populated. Operator
  applies migrations later (`NOTIFY pgrst, 'reload schema'`) — do NOT run them.
- Backend routes: POST-only, `requirePermission(c,'hse.<mod>.*')`, body = `body.args ?? body`,
  validate with `zv`/`z`. Mutations via `runModuleMutation` (app_events + audit + notifications,
  compensating rollback). Ref numbers via `nextRef` (`netlify/functions/lib/refGenerator.ts`).
- **Permission catalogue** (drift-guard test FAILS build on any uncatalogued enforced key):
  add keys to the flat array in `netlify/functions/lib/permissions.ts` (~line 125, after the HR
  block or in an HSE block) AND to `src/lib/permissionMeta.ts` as
  `'hse.x.y': { module:'HSE', group:'<Area>', label:'…', description:'…', risk:'low|medium' }`.
- **Route mount**: `netlify/functions/api.ts` — `import hseXRouter from './routes/hseX';` then
  `app.route('/api/hse', hseXRouter);` (grep how `hseIncidents` is mounted).
- **HSE section registration**: `src/components/sections/HSE/AreaRouter.tsx` switch + `HSESection.tsx`
  / `nav.ts` already route the existing dummy pages — the section files already exist, so a
  dummy→real conversion just REWRITES the existing `.tsx` (no new nav needed).

## The agent fleet (launch 5 at a time, NON-isolated, disjoint-file discipline)
Each agent builds ONLY its own new files and does NOT touch shared files (`api.ts`,
`permissions.ts`, `permissionMeta.ts`, `src/components/sections/HSE/types.ts`, nav). It REPORTS its
`app.route(...)` line + permission keys; the ORCHESTRATOR integrates those + runs ONE gate. Tell
agents NOT to run npm/tsc/build (concurrent races) and NOT to git commit.

Wave A (5): **Emergency Response, Contractors, Environmental, Legal & Compliance, Toolbox Talks**
Wave B (2): **PPE Manager (XL — 13 sub-tabs, give it the sharpest brief), Documents & SDS**

Assigned migration timestamps (avoid collisions):
| Module | migration | perms | new files |
|---|---|---|---|
| Emergency Response | `20260916000000_hse_emergency_response.sql` | `hse.emergency.*` | lib/hse/emergencyResponse.ts, routes/hseEmergency.ts, api/hse/emergency.ts, rewrite EmergencyResponse.tsx + EmergencyResponse.css, e2e/hseEmergency.mjs |
| Contractors | `20260916000010_hse_contractors.sql` | `hse.contractors.*` | lib/hse/contractors.ts, routes/hseContractors.ts, api/hse/contractors.ts, rewrite Contractors.tsx + .css, e2e/hseContractors.mjs |
| Environmental | `20260916000020_hse_environmental.sql` | `hse.environmental.*` | lib/hse/environmental.ts, routes/hseEnvironmental.ts, api/hse/environmental.ts, rewrite Environmental.tsx + .css, e2e/hseEnvironmental.mjs |
| Legal & Compliance | `20260916000030_hse_legal_compliance.sql` | `hse.legal.*` | lib/hse/legalCompliance.ts, routes/hseLegalCompliance.ts, api/hse/legalCompliance.ts, rewrite LegalCompliance.tsx + .css, e2e/hseLegalCompliance.mjs |
| Toolbox Talks | `20260916000040_hse_toolbox.sql` | `hse.toolbox.*` | lib/hse/toolbox.ts, routes/hseToolbox.ts, api/hse/toolbox.ts, rewrite Toolbox.tsx + .css, e2e/hseToolbox.mjs |
| PPE Manager | `20260916000050_hse_ppe.sql` | `hse.ppe.*` | lib/hse/ppe.ts, routes/hsePpe.ts, api/hse/ppe.ts, rewrite PPEManager.tsx + .css, e2e/hsePpe.mjs |
| Documents & SDS | `20260916000060_hse_documents.sql` | `hse.docs.*` | lib/hse/hseDocuments.ts, routes/hseDocuments.ts, api/hse/hseDocuments.ts, rewrite Documents.tsx + .css, e2e/hseDocuments.mjs |

## Integration recipe (orchestrator, after each wave)
1. `git status` — confirm the agents' files landed.
2. For each module: add its `import`+`app.route('/api/hse', …)` to `netlify/functions/api.ts`; add its
   permission keys to `netlify/functions/lib/permissions.ts` (array) and `src/lib/permissionMeta.ts`.
3. Gate: `npm run typecheck:frontend` && `npm run build:backend` && `npm run build:frontend` — fix any errors.
4. `git add -A && git commit` (LOCAL only) with the co-author trailer from CLAUDE.md.
5. Collect migration filenames for the user to apply in the morning (list them in the final report).
6. Run E2E only after the user applies migrations (`npm run test:e2e -- <suite>`), the morning proof.

## HR Contract Management (in progress — build by hand or one non-isolated agent)
- **DONE:** `supabase/migrations/20260915000000_hr_contract_management.sql` (tables
  hr_contract_templates, hr_contracts, hr_contract_signatories; renewal chain via
  `parent_contract_id`; optional `onboarding_case_id` link; seed templates).
- **TODO:** add `'CTR'` to `RefPrefix` in `netlify/functions/lib/refGenerator.ts`;
  `netlify/functions/lib/hr/contractsService.ts` (lifecycle draft→pending_signature→active→
  expired/terminated/superseded via `runModuleMutation`, `nextRef('CTR')`, `writeHrAudit`);
  `netlify/functions/routes/hrContracts.ts` (mount `/api/hr` in api.ts); `hr.contracts.*` perms;
  `src/api/hr/contracts.ts`; new `ContractsOverview.tsx` section + register in `HRSection.tsx` +
  add `s-hr-contracts` nav item to `src/components/sections/HR/module.ts`; CSS; E2E.
- HR pages are otherwise already wired (grep showed 10–41 API-hook signals each) — Contract
  Management is the only HR greenfield. See [[hr-worker-type-package-eligibility]] for the wiring bar.

## Base state
Branch `claude/wonderful-panini-34b331` @ `e34e6a52` (== origin/main). Migrations already applied by
the user for onboarding (document_requests, blocks_onboarding/can_waive, scheduled_launch_at,
probation_days). The 7 new HSE migrations + the contracts migration are pending operator apply.
