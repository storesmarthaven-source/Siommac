# Wave 1 Agent Brief — HR & Finance module build (SHARED SPEC, read first)

You are ONE of several agents building a module end-to-end **concurrently in the same worktree**.
Stay strictly in your lane — only your own DELIVERABLE files. Other agents are editing other files
right now. This doc is the shared spec; your launch prompt adds the module specifics.

Worktree: `C:\Users\MSI Laptop\Desktop\Siomac\.claude\worktrees\wonderful-panini-34b331`
(branch `claude/wonderful-panini-34b331`). NEVER touch the production copy at
`C:\Users\MSI Laptop\Desktop\Siomac`.

## Hard rules (violating any = failed task)
- Build ONLY your DELIVERABLE files. Do NOT touch shared files:
  `netlify/functions/api.ts`, `netlify/functions/lib/permissions.ts`, `src/lib/permissionMeta.ts`,
  `src/components/sections/Finance/{FinanceSection.tsx,module.ts,mount.ts,financeShared.ts,index.ts}`,
  `src/components/sections/HR/{HRSection.tsx,module.ts,mount.ts,index.ts}`,
  `netlify/functions/lib/refGenerator.ts`, `netlify/functions/lib/finance/statutoryConfig.ts`,
  `netlify/functions/lib/hr/employeeCore.ts`, the shared dialog/action preset files
  (`src/components/common/dialogs/*`, `src/components/common/actions/*`), `scripts/e2e/{harness.mjs,run.mjs}`.
  The orchestrator integrates the shared changes from your REPORT.
- Do NOT run `npm`/`tsc`/`build`/any test (concurrent runs race the other agents). Do NOT `git commit`/push.
- Write correct, compiling TypeScript — `noUncheckedIndexedAccess` is ON.
- **No band-aids** (non-negotiable in this codebase): no accept-and-drop (don't accept inputs you don't
  persist/honor), no swallowed DB errors (check every `error`; on a satellite-insert failure do a
  compensating rollback of the parent — see the finance expenses service), no mock-data fallbacks in the FE.
  Fix root causes.

## UI direction (the user's TOP priority — "really well built, enterprise, professional, visually appealing")
Build a **BESPOKE, premium, enterprise layout tailored to THIS module's data**. Do **NOT** use the rigid
PAGE_GUIDE template (no mandatory "PageHeader → 4 StatsCards → TabBar → spark row → table" ordering). You
have design latitude — make it polished, information-rich, and genuinely well-thought-out. BUT compose ONLY
from the shared library so it stays consistent + themable (if a primitive is missing, compose from existing
ones — never hand-roll raw modal/table/input CSS):
- Primitives from `@ui`: `PageHeader`, `Tabs`/`TabBar`, `RegisterTable`, `Card`, `StatsCard`, `MetricRow`,
  `Drawer`, `Modal`, `Wizard`, `Field`, `FormGrid`, `TextInput`/`SelectInput`/`TextareaInput`, `StatusPill`,
  `EmptyState`, `Callout`, `DetailGrid`, `Sparkline`/chart cards, skeleton loaders.
- Rich create/edit forms → `EnterpriseFormModal` (2-pane form + context) from `@/components/common/dialogs`.
  Multi-step creation → `Wizard`. Pass context **inline**; do NOT add to the shared preset files.
- Lifecycle actions (approve/reject/pay/close/…) → the action-modal system: `openActionModal` from
  `@/components/common/actions`. Define actions **inline/locally**; do NOT edit the shared preset files.
- Detail views → `Drawer`.
- Theme through **tokens only** (`var(--siomac-*)`, `var(--st-*)`, `var(--space-*)`, `var(--radius-*)`) — no
  raw hex / magic numbers. Status via `StatusPill` routed through `@ui/status/statusTokens`, never a local colour switch.
- **Exemplars** for the quality bar + correct use of the dialog/wizard/drawer system (study, but build bespoke —
  do NOT clone their layout): `src/components/sections/HR/OrgStructureOverview.tsx`,
  `src/components/sections/HR/HRDocumentsOverview.tsx`.
- **No mock-data fallbacks.** Live data only via your TanStack Query hooks; real `EmptyState` when empty.
  Cold-load: gate skeletons on `q.isLoading && !q.data`; never render `?? 0` / "—" / "Loading…" on a pending query.
- Put page CSS in a co-located `<Name>Overview.css`, imported at the top of the page, every rule scoped under
  one root class to prevent bleed. Reuse existing shared classes where they fit.

## Backend pattern (mirror EXACTLY: `netlify/functions/routes/financeExpenses.ts` + `netlify/functions/lib/finance/expenses.ts`)
- **Thin route** (POST-only) in `netlify/functions/routes/<file>.ts`:
  `const b = (c) => (c.get('body') as Record<string,unknown>).args ?? {};`
  per handler: `const actor = await requirePermission(c, '<perm>')`, validate `zv(c, z.object({...}), b(c))`,
  delegate to the service, `try/catch` → `c.json({ success:false, message }, (status ?? 500) as 200)`.
  Success envelope: `c.json({ success:true, data })`.
- **Service** in `netlify/functions/lib/<area>/<module>.ts`: DTOs (camelCase) + Db row types (snake_case) +
  `toDto` mappers; `list`/`get` + `create` + each lifecycle transition. EVERY mutation emits BOTH:
  `emitAppEvent({ eventType, sourceModule, sourceEntityType, sourceEntityId, actorUserId, severity, payload })`
  and `writeHrAudit({ submoduleKey, recordId, actorId, action, previousState, newState, reason? })`
  (`writeHrAudit` is imported from `../hr/employeeCore` — it is the generic module audit writer, used by finance too).
  Approval flows → `startWorkflowForRecord({ context, actor })` with rollback-on-failure (revert status if the
  workflow start throws). Separation of duties → `assertDifferentApprover({ actorId, createdBy, action })`
  (import from `./statutoryConfig` for finance services). Human refs → `nextRef('<PREFIX>')` (arbitrary prefix
  string is fine). Satellite-insert failure → compensating rollback (delete parent), never a swallow. Throw
  errors as `Object.assign(new Error(msg), { status })`.
- **FE API hooks** in `src/api/<area>/<module>.ts`: TanStack Query `useQuery`/`useMutation` +
  `apiPost('<area>/<path>', args, { signal } | { retryable:false })`; mirror `src/api/finance/expenses.ts`.
  (apiPost wraps the body as `{ args }` automatically; every route reads `body.args`.)

## Migration (greenfield modules only — mirror `supabase/migrations/20260806000000_finance_expense_claims.sql`)
File `supabase/migrations/<ASSIGNED_TS>_<name>.sql`. Conventions: uuid PK `default gen_random_uuid()`; money
`numeric(15,2)`, `currency text not null default 'TTD'`; dates `date`; user FKs
`text references public.app_users(id) on delete set null|restrict|cascade` (app_users.id is TEXT);
`created_at timestamptz not null default now()`, `updated_at timestamptz` + an updated_at trigger;
`metadata jsonb not null default '{}'::jsonb`; indexes on lookup columns; `enable row level security` + a
`service_role` bypass policy + `grant select,insert,update,delete ... to service_role`. IDEMPOTENT seed
(`on conflict do nothing`, pick real `app_users` via subquery) so the page renders populated. End with
`-- After applying: NOTIFY pgrst, 'reload schema';`. **DO NOT run the migration or any DB/psql command** —
the operator applies it later.

## Permissions
Your routes enforce NEW keys `<area>.<module>.<action>` (e.g. `.view` / `.manage` / `.approve`). These are NOT
catalogued yet — DO NOT edit `permissions.ts` / `permissionMeta.ts` (shared). Enforce them and **REPORT** each
exact key string + one-line description + suggested risk (low/medium) + which roles should hold it. The
orchestrator catalogues them, assigns roles, and adds `permissionMeta`.

## Section registration
Build your page as a named export `export function <Name>Overview(): VNode` in
`src/components/sections/<Area>/<Name>Overview.tsx`. Do NOT edit `FinanceSection.tsx` / `HRSection.tsx` /
`module.ts` (shared). **REPORT**: section id (`s-<area>-<x>`), nav label, Font Awesome icon, one-line `sub`,
and the `import { <Name>Overview } from './<Name>Overview';` line — the orchestrator wires the section router + nav.

## E2E suite
`scripts/e2e/suites/<bareName>.mjs` exporting `export const title` + `export default async function run(h)`.
Mirror `scripts/e2e/suites/financeExpenses.mjs` (finance role/SoD patterns) and
`scripts/e2e/suites/communications.mjs` (the bar). Harness:
`const { api, test, expect, ok, fails, mint, sb, TAG } = h; const { admin, b, c } = h.users;`.
Cover: every endpoint; the full lifecycle/state-machine; access control (authorized passes AND unauthorized/
low-priv DENIED with the correct code — provision a REAL user of the role; NEVER forge a JWT role, auth
re-reads role from the DB); SoD (creator ≠ approver is rejected); exact response shape the FE consumes; and
per-mutation side-effects via the `sb` service-role client (app_events, audit rows, notifications, workflow
rows). Tag rows with `h.TAG`; delete in `h.onCleanup()`. **DO NOT run the suite** (migrations aren't applied
yet; concurrent runs race).

## REPORT (your final message = structured data the orchestrator acts on)
A. Files created (full paths).
B. api.ts wiring — exact `import <x>Router from './routes/<file>';` + `app.route('/api/<area>', <x>Router);`.
C. New permission keys enforced — key · description · risk · which roles should get them.
D. Section registration — section id, nav label, icon, sub, and the page import line + which `XxxSection.tsx` + `module.ts`.
E. Ref prefix(es) used.
F. Migration filename + tables (or "no migration — uses existing schema").
G. E2E suite filename + run command.
H. Cross-module handoffs/workflows, assumptions, follow-ups.

## Cross-module note — General Ledger account contract
The GL module defines `finance_gl_accounts(code text unique, name, type in
('asset','liability','equity','revenue','expense'), subtype, parent_code, normal_balance in ('debit','credit'),
is_active, …)` and exposes `POST /api/finance/gl/accounts/list`. If your module references a GL account, store
it as a **`gl_account_code text` column (no FK — stay decoupled)** and offer a picker sourced from that endpoint.
Do NOT hard-FK the GL table and do NOT fake auto-posting to the ledger (that cross-module posting is a later wave).
