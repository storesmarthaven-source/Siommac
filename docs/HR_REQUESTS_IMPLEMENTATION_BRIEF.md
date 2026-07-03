# HR Requests (Request Center) — Implementation Brief (for Codex)

**Module:** HR sub-module #4 — HR Requests
**Goal:** A **self-service Request Center** where an ordinary employee submits a request about **themselves**
(employment letter, document copy, general HR inquiry, profile-detail correction) without needing any
`hr.employees.*` permission, and HR staff **triage → decide → fulfill** it — reusing the **same central
workflow engine + audit spine**, not a parallel approval system. The genuinely new work is the **self-scope
access model** (an employee can only see/act on their OWN requests) and an employee-facing submit UI.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST (envelope `c.json({success,data})` /
> `{success:false,message}` code as `200`; body `(c.get('body') as Record<string,unknown>).args ?? {}`;
> `app_users.id` is TEXT; permission model; side-effects; camelCase DTO; no URL router; test cadence). This
> brief does not repeat those. Also read `CLAUDE.md` (No-Band-Aids + Known Pitfalls) and — for the shared
> spine you reuse — the sibling brief `docs/TRANSFERS_PROMOTIONS_IMPLEMENTATION_BRIEF.md` §1 (it documents
> `createChangeRequest`, `startWorkflowForRecord`, the binding seed, and the decide route in detail).

**Frontend scope (current mandate):** **functional-only** pages. No widget board / registry KPI-tile
widgets. Plain `.obx-*` tables/forms + `@ui` (see `OffboardingOverview.tsx`). User adds widgets later.

---

## 0. TL;DR — what to build

1. **A new `hr_requests` sibling table** (NOT a `change_type` on `hr_employee_change_requests` — see §3.1
   for why that would be a band-aid) that reuses the **same platform**: `runModuleMutation`, `nextRef('REQ')`,
   `emitAppEvent`, `writeHrAudit`, and the **central workflow engine** (new `module_key='hr_requests'`).
2. **A request-type catalogue** — a small **code-defined** const array (employment_letter, document_copy,
   profile_correction, general_inquiry, …); a DB table only if admin-editable types are a real near-term
   need (they are not, per the roadmap — keep it code-defined).
3. **A self-scope permission** `hr.requests.submit_own` (any authenticated employee; may only act on
   requests where `employee_id === actor.id`) and `hr.requests.manage` (HR triage: view all + decide +
   fulfill). Enforce self-scope **server-side**, not just in the UI.
4. **Workflow**: a `hr_requests` template + published version + binding (mirror
   `20260711000000_workflow_hr_change_bindings.sql`); route decisions through the engine — no second authority.
5. **Types** `types/hrRequests.ts` + **hooks** `src/api/hr/requests.ts`.
6. **Frontend** `src/components/sections/HR/HRRequestsOverview.tsx` — a **My Requests** surface
   (submit + track own) + an **HR Triage** surface (all pending + decide/fulfill), tab-switched by
   entitlement. Nav `s-hr-requests` + routing in `HRSection.tsx`.
7. **E2E** `scripts/e2e/suites/hrRequests.mjs` (self-scope enforcement is the headline test).

---

## 1. The spine you reuse (verified — see the Transfers brief §1 for full detail)

- `netlify/functions/lib/moduleServiceAdapter.ts` → `runModuleMutation({ context:{actorUserId}, options:{
  module, operation, entityType, idempotencyKey, eventType, getEntityIdentity, buildEventPayload },
  writeRecord })` — the atomic record→event→idempotency path every HR create uses.
- `netlify/functions/lib/refGenerator.ts` → `nextRef(prefix)` accepts arbitrary prefixes; **`'REQ'` is free**
  (used: HRC, OFB, LVR, ORC, INC, OWO, WF).
- `netlify/functions/lib/appEvents.ts` → `emitAppEvent(...)` (fire-and-forget `void`).
- `netlify/functions/lib/hr/employeeCore.ts` → `writeHrAudit({ submoduleKey, recordId, actorId, action,
  previousState?, newState?, reason? })` — **awaited; throws on failure** (do not swallow). Param is
  `previousState` (NOT `oldState`).
- Workflow: `startWorkflowForRecord({ context:{ moduleKey, workflowType, triggerEvent, sourceRecordId,
  sourceRecordRef, requestedBy, departmentId, siteId, recordData }, actor:{id} }) → WorkflowRow | null`.
  Resolves the active **binding**; `null` if none (then it stays a passive maker-checker request). Engine
  resolves a **PUBLISHED** template version only, else throws. `decideTask({ workflowId, taskId, actor,
  decision, comment })` is the ONE decision authority.
- `requireUser(c)` / `requirePermission(c, key)` resolve role/permission from the DB (`app_users.role` +
  `role_permissions`), **not** the JWT. `userCan(actor, key)` for in-route checks.

---

## 2. What is genuinely NEW

| Area | Exists | New work |
|---|---|---|
| Self-service requests | none (change requests are HR-INITIATED field changes) | employee submits/tracks own letter/document/inquiry/correction requests |
| Self-scope access | none | `submit_own` gate: an employee may only see/submit/cancel requests where `employee_id === actor.id` (enforced server-side) |
| Request-type registry | none | code-defined catalogue of request types (label, needs-fulfillment-artifact?, needs-approval?) |
| Triage | change-request decide (HR field changes) | HR triage of service requests: approve/reject/return + **fulfill** (mark delivered, attach artifact) |
| Page | none | Request Center: My Requests + HR Triage (functional-only) |
| E2E | none | `hrRequests.mjs` |

---

## 3. Architecture decisions (No-Band-Aids)

### 3.1 A `hr_requests` sibling table — NOT a fake `change_type`. (This is the key decision.)
`hr_employee_change_requests` exists to **apply a field change to `app_users`** — its whole point is the
`applyChange()` switch that mutates a column on approval. A self-service request like “please issue me an
employment letter” or “I have a question for HR” has **no `app_users` mutation to apply**. Shoving it into
`change_type` would force a change_type with **no apply branch** — i.e. accept-and-drop (the exact band-aid
CLAUDE.md forbids: “accepting an input the code doesn’t actually honor”). So a **separate `hr_requests`
table is correct and is NOT a dual system** — it is a genuinely different concept (a fulfillment/service
request), and it **reuses the same spine** (workflow engine, events, audit, refs). That reuse — same engine,
one approval authority — is what keeps it from being a fork.

> Edge: `profile_correction` *could* end in an actual `app_users` change. Do NOT auto-apply it from
> `hr_requests`. Model it as a service request; when HR fulfills a `profile_correction`, HR (with the proper
> `hr.employees.*` permission) creates the corresponding **`hr_employee_change_request`** as the fulfillment
> action (the existing, correct, audited path for mutating `app_users`). `hr_requests` never writes
> `app_users` directly.

### 3.2 One approval authority — the central engine.
Route decisions through `startWorkflowForRecord` + `decideTask` exactly like the change-request flow. Do NOT
add an independent approve/apply endpoint that bypasses the engine. If a request type does not need approval
(e.g. a trivial `general_inquiry` HR just answers), model that as **no binding** → the request stays a plain
triage item HR resolves via `fulfill`/`decide` without a workflow (the `null`-binding path). Whether a type
needs approval is a property in the request-type catalogue (§4.2).

### 3.3 Self-scope is a SERVER-SIDE invariant, not a UI convenience.
Every read/submit/cancel route that an employee can hit with only `hr.requests.submit_own` must enforce
`request.employee_id === actor.id` (or set `employee_id = actor.id` on submit and ignore any client-supplied
id). A user with `hr.requests.manage` bypasses the scope (sees all). Never rely on the UI hiding others’
requests. Test the negative path explicitly (§8).

### 3.4 Request-type catalogue: code-defined const (like `STANDARD_EXIT_TASKS`).
Mirror `netlify/functions/lib/hr/offboardingCore.ts`’s const-array pattern. A DB `hr_request_types` table is
over-build unless admin-editable types are a stated near-term need — the roadmap doesn’t call for it. Keep it
a typed const the FE and BE both import (via `types/hrRequests.ts`), each entry:
`{ key, label, description, requiresApproval: boolean, producesArtifact: boolean }`.

---

## 4. Data model

### 4.1 `20260721000000_hr_requests.sql` (max existing migration is `20260718000004`; use `20260721000000+`
and confirm no higher exists). Ends with `-- After applying, run: NOTIFY pgrst, 'reload schema';`
```sql
create table if not exists public.hr_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique not null,                         -- nextRef('REQ')
  employee_id text not null references public.app_users(id) on delete cascade,   -- the SUBJECT/requester
  request_type text not null,                              -- catalogue key (validated in app layer)
  title text not null,
  details jsonb not null default '{}'::jsonb,              -- type-specific payload (letter purpose, doc type, question body…)
  status text not null default 'submitted'
    check (status in ('draft','submitted','in_review','returned','approved','rejected','fulfilled','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,  -- uuid FK (not text)
  requested_by text not null references public.app_users(id) on delete set null, -- usually = employee_id
  decided_by   text references public.app_users(id) on delete set null,
  fulfilled_by text references public.app_users(id) on delete set null,
  decision_comment text,
  resolution jsonb not null default '{}'::jsonb,           -- artifact ref / fulfillment note
  requested_at timestamptz not null default now(),
  decided_at timestamptz, fulfilled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create index if not exists hr_requests_employee_idx on public.hr_requests(employee_id, status);
create index if not exists hr_requests_status_idx   on public.hr_requests(status);
create index if not exists hr_requests_workflow_idx on public.hr_requests(workflow_id) where workflow_id is not null;
alter table public.hr_requests enable row level security;
grant select, insert, update, delete on table public.hr_requests to service_role;
drop trigger if exists trg_hr_requests_updated_at on public.hr_requests;
create trigger trg_hr_requests_updated_at before update on public.hr_requests for each row execute function public.set_updated_at();
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```
> Confirm `public.set_updated_at()` exists (offboarding/onboarding migrations use it). If not, set
> `updated_at` in the mutations instead.

### 4.2 `20260721000001_hr_requests_permissions.sql` — grants (`role_name` column)
```sql
insert into public.role_permissions (role_name, permission) values
  -- self-service submit: grant to the broad employee baseline roles so any employee can file their OWN request
  ('employee','hr.requests.submit_own'),('manager','hr.requests.submit_own'),('supervisor','hr.requests.submit_own'),
  ('hr_staff','hr.requests.submit_own'),('hr_manager','hr.requests.submit_own'),
  ('admin','hr.requests.submit_own'),('superadmin','hr.requests.submit_own'),
  -- triage/decide/fulfill: HR oversight
  ('hr_staff','hr.requests.manage'),('hr_manager','hr.requests.manage'),
  ('admin','hr.requests.manage'),('superadmin','hr.requests.manage')
on conflict do nothing;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```
> VERIFY the exact employee-baseline role names in this repo before finalizing (grep `role_permissions`
> seeds — `employee`/`manager`/`supervisor` baselines are used elsewhere; `20260714000013_module_staff_roles.sql`
> documents that roles are flat/non-hierarchical and each role’s grant list must be complete). Decide whether
> `hr_staff` should `manage` (triage) — the map implies HR staff triage day-to-day, so yes.

### 4.3 `20260721000002_workflow_hr_requests_binding.sql` — template + published version + binding
Mirror `20260711000000_workflow_hr_change_bindings.sql`. Seed ONE `hr_requests` approval template (single
HR-manager/HR-staff approval step) + a **published version** (the engine throws on none) + a binding
`module_key='hr_requests'`, `workflow_type='hr_request_approval'`, trigger `hr.request.<type>.submitted` (or
a single `hr.request.submitted` trigger if all approvable types share one flow). Only approvable request
types (per §4.2 catalogue `requiresApproval`) start a workflow; non-approvable types skip it (null binding).
```
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

---

## 5. Permissions — exact edits (drift-guard fails the build if you miss one)

Add `hr.requests.submit_own` and `hr.requests.manage` to **all four**:
1. `netlify/functions/lib/permissions.ts` → `PERMISSION_KEYS`.
2. `src/lib/permissions.ts` → `PERMISSION_KEYS` **and** admin + superadmin Sets (both keys); add
   `hr.requests.submit_own` to the `manager` Set and any employee-baseline Set the FE uses to decide nav
   visibility (so an ordinary employee sees the My Requests surface).
3. `src/lib/permissionMeta.ts` → group `'Requests'`: `submit_own` (risk low, “Submit own HR requests”),
   `manage` (risk medium/high, “Triage and decide HR requests”).
4. DB grants: §4.2.

---

## 6. Backend

### 6.1 Lib `netlify/functions/lib/hr/requests*.ts`
- `requestsCore.ts` — the request-type catalogue const + `submitRequest(actorId, args)` via
  `runModuleMutation` (idempotencyKey e.g. `hr.request:${actorId}:${type}:${hash(details)}`, `nextRef('REQ')`,
  insert `hr_requests` status `submitted`, `writeHrAudit`, then `startWorkflowForRecord` for approvable types
  and store `workflow_id`). Emits `hr.request.submitted`.
- `requestsQueries.ts` — `listMyRequests(employeeId)`, `listAllRequests(filters)`, `getRequest(id)` (all
  joined to employee/decider names).
- `requestsMutations.ts` — `decideRequest` (approve/reject/return: if `workflow_id` → `decideTask`, else set
  status directly), `fulfillRequest(actorId,{id,resolution})` (approved → `fulfilled`, stamp `fulfilled_by`/
  `fulfilled_at`, store artifact/note in `resolution`), `cancelRequest` (requester own or manage). Each does
  event + `writeHrAudit`.

### 6.2 Routes `netlify/functions/routes/hrRequests.ts` (mount in `netlify/functions/api.ts` under `/api/hr`
or `/api/hr/requests`; validate `(c.get('body') as Record<string,unknown>).args ?? {}` with zod via the
repo’s validator)
- `POST /requests/types` — any authenticated user — returns the catalogue.
- `POST /requests/submit` — `requirePermission(c,'hr.requests.submit_own')`. **Force `employee_id = actor.id`
  unless the actor also has `hr.requests.manage`** (an HR user may file on behalf of an employee). Reject a
  client-supplied `employeeId !== actor.id` when the actor lacks `manage`.
- `POST /requests/my` — `hr.requests.submit_own` — only the caller’s own requests.
- `POST /requests/list` — `hr.requests.manage` — all (status/type/employee filters).
- `POST /requests/get` — `{ requestId }` — `manage` OR (`submit_own` AND `request.employee_id === actor.id`);
  else 403.
- `POST /requests/decide` — `hr.requests.manage` — approve/reject/return via the engine (single authority).
- `POST /requests/fulfill` — `hr.requests.manage` — approved → fulfilled.
- `POST /requests/cancel` — requester (own, `submit_own`) OR `manage`; reject cancel of terminal states.

### 6.3 Events + audit (§2)
Events: `hr.request.submitted|decided|fulfilled|cancelled` (`source_module='hr'`,
`source_entity_type='hr_request'`). Audit `submoduleKey:'requests'`, actions `hr.request.submitted|
approved|rejected|returned|fulfilled|cancelled`. `writeHrAudit` throws on failure — do not swallow.

---

## 7. Types + hooks + frontend

`types/hrRequests.ts` — the catalogue const + `HrRequestType`, `HrRequestStatus`, `HrRequestRow`,
`SubmitRequestArgs`, `DecideRequestArgs`, `FulfillRequestArgs` (camelCase; shared BE+FE).
`src/api/hr/requests.ts` — mirror `src/api/hr/offboarding.ts`; keys `['hr','requests']`; `apiPost` wraps
`{ args }`; `call<T>()` throws on `success:false`.

`src/components/sections/HR/HRRequestsOverview.tsx` (functional-only, `OffboardingOverview.tsx` style):
- `@ui Tabs` with **My Requests** (visible if `can('hr.requests.submit_own')`) and **Triage** (visible if
  `can('hr.requests.manage')`); if the user has only one, show only that surface (no empty tab bar).
- **My Requests**: a **New Request** modal (type select → type-specific fields from the catalogue → submit),
  and an `.obx-table` of the caller’s own requests with status + a cancel action on non-terminal ones.
- **Triage**: an `.obx-table` of all requests (status/type filter) with Approve/Return/Reject (via decide)
  and, on approved rows, a **Fulfill** action (resolution note / artifact). `@lib/dialog` for all
  confirms/prompts/toasts.
- Loading: `placeholderData` + gate `loading={isLoading && !data}`; `@ui TableSkeleton` cold-path only.

Nav wiring:
- `module.ts` — `REQUESTS_ITEM: ModuleNavItem = { id:'s-hr-requests', label:'HR Requests', icon:'fa-inbox',
  sub:'Employee self-service requests & HR triage' }` → push into `navItems`.
- `HRSection.tsx` — `REQUESTS_ID='s-hr-requests'`, include in `isHrSection`, render `<HRRequestsOverview/>`.

---

## 8. E2E — `scripts/e2e/suites/hrRequests.mjs`

Mirror `hrOffboarding.mjs`. Run `npm run test:e2e -- hrRequests` against live `dev:netlify` (serves
`dist/` → `build:backend` + restart first). Cover:
1. **Submit** (as a provisioned real `employee`) → `hr_requests` row, `status='submitted'`, `employee_id =
   that employee`, `workflow_id` set for an approvable type / null for a non-approvable type.
2. **Self-scope (the headline test)** — employee A **cannot** `get`/`cancel` employee B’s request (403); A’s
   `/requests/my` returns only A’s; a submit with `employeeId = B` while A lacks `manage` is rejected/coerced
   to A. **Provision real users** (auth resolves role from `app_users`, not the JWT — CLAUDE.md pitfall).
3. **Triage** — an `hr_staff`/`hr_manager` with `manage` sees all via `/requests/list`, `decide`s
   (approve→`approved` or single-step→ the true status the adapter wrote), then `fulfill`s → `fulfilled`.
   An employee with only `submit_own` is **denied** `decide`/`list`/`fulfill` (403).
4. **§2 side-effects** — poll for `app_events` (`hr.request.submitted`/`decided`/`fulfilled`) + `hr_audit_log`
   (`submodule_key='requests'`).
5. **Cleanup** — tag with `h.TAG`; delete created requests in `h.onCleanup()`.

---

## 9. Verification gate (run ONCE, at the end)
1. `npm run typecheck:frontend` + `npm run typecheck:backend` — clean.
2. `npm run build:backend` — clean.
3. `npm test` + `npx vitest run` — green (watch `tests/unit/permissions.sync.test.ts` for `hr.requests.*`).
4. `npm run test:e2e -- hrRequests` — green (after migrations applied + `NOTIFY pgrst`).
5. 229 frontend tests remain green.

**Migrations to operator-apply, in order (then `NOTIFY pgrst`):** `20260721000000_hr_requests.sql`,
`20260721000001_hr_requests_permissions.sql`, `20260721000002_workflow_hr_requests_binding.sql`.

---

## 10. APPENDIX — DO NOT COPY these
| # | Wrong | Correct |
|---|---|---|
| 1 | fake `change_type` on `hr_employee_change_requests` for service requests | separate `hr_requests` table (no `app_users` apply branch to honor → accept-and-drop otherwise), reusing the same engine/events/audit |
| 2 | `hr_requests` writes `app_users` directly (e.g. profile_correction) | fulfillment of a profile change creates an `hr_employee_change_request` via the existing audited path |
| 3 | self-scope enforced only in the UI | enforce `employee_id === actor.id` in every `submit_own` route; test the negative path |
| 4 | second approve/apply authority | route decisions through `startWorkflowForRecord` + `decideTask`; non-approvable types use the null-binding path |
| 5 | `insert into role_permissions (role, permission)` | column is **`role_name`** |
| 6 | `workflow_instance_id text` | `workflow_id uuid references workflow_instances(id)` |
| 7 | `writeHrAudit({ oldState })` | param is **`previousState`** |
| 8 | template with no published version | engine resolves a **published** version only (throws otherwise) — seed one |
| 9 | new enforced keys granted only in DB | also add to `permissions.ts` ×2 + `permissionMeta.ts` or the **drift-guard fails the build** |
| 10 | DB `hr_request_types` table | code-defined catalogue const unless admin-editable types are a stated need |

## 11. Definition of done
- Employees self-serve requests about themselves (`submit_own`, server-enforced self-scope); HR triages
  (`manage`) via the central engine (approve/reject/return) and fulfills; artifacts/notes recorded.
- `hr_requests` reuses the platform spine (runModuleMutation, nextRef('REQ'), emitAppEvent, writeHrAudit,
  workflow engine) — no fake change_type, no second approval authority, no direct `app_users` writes.
- `hr.requests.*` catalogued in all four places + granted; drift-guard green.
- Functional-only Request Center (My Requests + Triage), nav-wired. `hrRequests.mjs` green (self-scope test
  included); full gate green; migrations listed for operator-apply.
