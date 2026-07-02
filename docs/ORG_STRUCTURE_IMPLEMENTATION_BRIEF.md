# HR Organization Structure — Implementation Brief (for Codex)

**Module:** HR sub-module #3 — Organization Structure
**Goal:** Turn the thin, read-only org scaffolding that already exists into a full
**Organization Structure** module: manage the **org-unit hierarchy** (departments as a tree with
reporting lines), **positions / job-titles**, and **cost centres**, with an org-tree UI. Sites
(“locations”) already exist and are **reused as-is**.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST. It is the canonical statement of the
> conventions every HR sub-module follows (response envelope, request body, permission model,
> mutation side-effects, camelCase DTO contract, `app_users.id` is TEXT, no URL router, test
> cadence). This brief does **not** repeat those — it only states what is specific to Org Structure.
> Also read `CLAUDE.md` (No-Band-Aids + Known Pitfalls) — several decisions below exist *because*
> of those rules.

**Frontend scope note (current mandate):** build **functional-only** pages. Do **NOT** build any
widget board / registry KPI-tile widgets for this module — the user adds per-page widgets
themselves later. Use plain tables/forms (the `.obx-*` conventions used by the onboarding admin
pages).

---

## 0. TL;DR — what to build

1. **Migrations** (additive; operator-applied + `NOTIFY pgrst`): extend `departments`,
   `hr_positions`, and `finance_cost_centers` with the few structured columns the module needs;
   add cost-centre permission grants.
2. **Backend lib** `netlify/functions/lib/hr/organization*.ts` (core/queries/mutations) composing
   the existing platform (`writeHrAudit`, `emitAppEvent`, `sb`) — mirror the onboarding lib shape.
3. **Routes** on the existing HR router (`netlify/functions/routes/hr.ts`, mounted at `/api/hr`):
   org-unit CRUD + move, positions get/retire (create/update already exist — extend), cost-centre
   CRUD, and an org stats endpoint.
4. **Permissions**: reuse `hr.organization.*` + `hr.positions.*` (already catalogued & granted);
   add `hr.cost_centers.view` / `hr.cost_centers.manage` in all four registries + a grant migration.
5. **Types** `types/hrOrganization.ts` (shared camelCase DTOs) + **hooks** `src/api/hr/organization.ts`.
6. **Frontend** `src/components/sections/HR/OrgStructure*.tsx` (functional-only), a nav item
   `s-hr-organization`, and routing in `HRSection.tsx`.
7. **E2E** `scripts/e2e/suites/hrOrganization.mjs` (every endpoint, access control, §2 side-effects).
8. **Legacy reconciliation**: the new HR org-unit editor **supersedes** the legacy Departments
   editor — repoint or remove it (see §7). No dual department editors.

---

## 0b. Phasing — build in two shippable chunks (READ THIS)

This module has an **enterprise controls** layer (change-requests, approval workflow, impact
preview, risk policy, effective-dating, org health). Shipping it all at once maximizes surface area
and merge risk against the parallel Offboarding build. Build it in two phases:

- **Phase A (Parts §1–§12 below) — the reference-data core. Ship first.**
  Migrations (base fields only) → org-unit / position / cost-centre CRUD with **cycle guards +
  guarded delete + concurrency (409)** → events + audit → **org health** → **impact preview as a
  read-only endpoint** → functional UI → legacy reconciliation → E2E. High-risk actions in Phase A
  simply surface the impact and proceed, gated by `manage`/`delete` permissions. No approval engine
  yet.
- **Phase B (Part II — §13+) — enterprise controls.**
  `hr_org_change_requests` envelope + **binding-driven** approval on the **central workflow engine**
  + an **`hr_org_structure` workflow adapter** that applies the change on workflow completion +
  effective-dating via a service-role route. Do **not** build a parallel approval authority (see
  §13.2). Decide the history-table question in §13.1.

> ⚠️ Part II CORRECTS an earlier expanded plan that had four apply/compile/runtime bugs and drifted
> from our LOCKED workflow architecture. **The Appendix (§18) lists the exact wrong patterns — do
> not copy them.** Where Part II and any pasted plan disagree, Part II wins (it is verified against
> the code).

---

## 1. Current state (verified in-repo — build ON this, do not fork)

### 1.1 Tables that already exist

**`departments`** — the canonical org table (`app_users.department_id` FKs it). `id` is TEXT with a
DB default; **never hand-generate it** — insert without `id`:
```sql
-- supabase/schema.sql
id text primary key default ('DEPT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
name text not null unique,
description text default '',
manager_id text,               -- app_users.id (text)
updated_at timestamptz
-- Extended by 20260702000002_hr_organization_structure.sql:
parent_id     text references public.departments(id) on delete set null,
org_unit_type text not null default 'department'
              check (org_unit_type in ('company','division','department','team','crew','site_department')),
site_id       text,            -- project_sites.id (text), no FK
is_active     boolean not null default true
-- indexes: departments_parent_idx, departments_site_idx, departments_active_idx
```

**`hr_positions`** (`20260702000001_hr_employee_master_satellites.sql`) — job positions:
```sql
id                    uuid primary key default gen_random_uuid(),
position_key          text unique not null,
title                 text not null,
department_id         text,            -- departments.id, no FK
site_id               text,
default_supervisor_id text references public.app_users(id) on delete set null,
is_safety_critical    boolean not null default false,
is_active             boolean not null default true,
created_by            text references public.app_users(id) on delete set null,
created_at            timestamptz not null default now(),
updated_at            timestamptz,
metadata              jsonb not null default '{}'::jsonb
-- app_users.position_id uuid references hr_positions(id)  (incumbency link)
```

**`hr_employee_assignments`** — time-versioned position/dept/site/supervisor history (`is_current`,
`effective_from/to`, `workflow_id`). **Reused** for “who is in this unit/position now.” Not managed
by this module (Employee Master / Transfers own writes to it) but **read** for headcount rollups.

**`finance_cost_centers`** (`20260621100003_erp_hr_payroll_finance_ops_core.sql`) — **already the
canonical cost-centre table**. Finance consumers (`finance_cost_entries`, `finance_budget_lines`)
already FK it. It is a skeleton with **no management route yet**:
```sql
id            uuid primary key default gen_random_uuid(),
name          text not null,
department_id text,
annual_budget numeric(15,2),
currency      text not null default 'TTD',
metadata      jsonb not null default '{}'::jsonb,
created_at    timestamptz not null default now()
```

**`project_sites`** — sites (“locations”). Managed by the existing Sites/ProjectSites module.
Selector already exposed via `POST /api/hr/sites/list`. **Reuse as-is**; this module does not manage
sites, only references `site_id`.

**`app_users`** relevant columns: `department_id` (text → departments), `position_id` (uuid →
hr_positions), `supervisor_id` (text → app_users; the person-level reporting line, owned by Employee
Master), `employee_grade` (text), `work_schedule` (text), and `cost_center` (**free-text** — a
legacy band-aid; see §3.3).

### 1.2 Routes that already exist (in `netlify/functions/routes/hr.ts`)

- `POST /api/hr/organization/tree` — `hr.organization.view` — flat list of units (frontend builds
  the tree). Selects `id, name, description, parent_id, org_unit_type, site_id, manager_id, is_active`.
- `POST /api/hr/positions/list` — `hr.positions.view` — `select('*').order('title')`.
- `POST /api/hr/positions/create` — `hr.positions.manage` — inserts `position_key, title,
  department_id, site_id, default_supervisor_id, is_safety_critical, created_by` + `writeHrAudit`.
- `POST /api/hr/positions/update` — `hr.positions.manage` — patch + `writeHrAudit`.
- `POST /api/hr/sites/list` — `hr.view` — `project_sites (id, name)`.

> ⚠️ The existing positions routes call `writeHrAudit` but do **NOT** `emitAppEvent`. That is a §2
> gap. When you touch them, add `emitAppEvent` (see §4) so every org mutation emits event **and**
> audit.

### 1.3 Legacy Departments editor (must reconcile — see §7)

- `netlify/functions/routes/departments.ts` — `listDepartments` / `addDepartment` /
  `updateDepartment` / `deleteDepartment`, gated by **legacy** keys `departments.add/edit/delete`
  (NOT `hr.organization.*`). `deleteDepartment` is a **hard delete with no guard** (orphans
  `app_users.department_id` and any child units) — a landmine.
- Frontend legacy editors: `src/components/sections/Employees/DepartmentsSection.tsx` and
  `src/components/sections/ProjectSites/*`.

### 1.4 Permissions that already exist

- Catalogued in **both** `netlify/functions/lib/permissions.ts` and `src/lib/permissions.ts`
  (`PERMISSION_KEYS`): `hr.organization.view`, `hr.organization.manage`, `hr.positions.view`,
  `hr.positions.manage`.
- Static role Sets in `src/lib/permissions.ts` grant them to `admin` (line ~495) and `superadmin`
  (line ~622); `manager` gets the `.view` keys (line ~405).
- DB grants (`supabase/migrations/20260702000003_hr_permissions.sql`): superadmin/admin/hr_manager
  get view+manage; `manager` gets view.
- `permissionMeta.ts` (group **'Organization'**) has labels/risk for all four.
- **hr_staff** (the execution-tier role added in the cross-module RBAC change) is **not yet**
  granted org keys — decide grants in §5.

---

## 2. What is genuinely NEW (the gap)

| Area | Exists | New work |
|---|---|---|
| Org-unit hierarchy | tree read only | create / update / **move (reparent, cycle-guarded)** / archive(deactivate) / safe-delete units; manager (reporting line) + cost-centre + site assignment on a unit |
| Positions | list/create/update | `get` (with incumbents), `retire`, headcount rollup on list, extra structured fields (grade, headcount budget, reports-to) |
| Cost centres | table only (finance skeleton) | list/create/update/retire management under HR; assign a cost centre to an org unit |
| Org stats | none | plain stats endpoint for the page header (unit/position/cost-centre counts, filled vs vacant) |
| Frontend | none (no Org page) | Org Structure page: **Tree** + **Positions** + **Cost Centres** tabs (functional-only) |
| E2E | none | `hrOrganization.mjs` |

---

## 3. Architecture decisions (No-Band-Aids — do NOT “fix” these by forking)

### 3.1 `departments` IS the org-unit tree. Do not create `hr_org_units`.
`app_users.department_id`, `hr_positions.department_id`, and `finance_cost_centers.department_id`
all reference `departments`. A parallel `hr_org_units` table would be a dual system (band-aid).
Everything hangs off `departments`; the module just adds management + hierarchy semantics on top of
the columns already present (`parent_id`, `org_unit_type`, `site_id`, `is_active`).

### 3.2 Cost centres REUSE `finance_cost_centers`. Do not create `hr_cost_centers`.
Cost centres are shared organizational/financial reference data that Finance **consumes**
(`finance_cost_entries` / `finance_budget_lines` already FK `finance_cost_centers`). The **registry**
naturally lives with Organization Structure (the roadmap lists cost centres as org-structure work).
A separate `hr_cost_centers` duplicating it is exactly the “dual system” the rules forbid. HR org
manages the registry now; when the Finance module lands it manages the **same table**. Additive
columns only (§4.1) — never rename/retype existing finance columns.

### 3.3 The free-text `app_users.cost_center` is a legacy band-aid — do not extend it.
The **structured** path is: an org unit carries `cost_center_id → finance_cost_centers`; an
employee’s cost centre derives from their unit. Do **not** rip out the free-text column in this PR
(other reads touch it — Employee Master profile, `financeReceiver`), but **all new** cost-centre
assignment flows use the FK on the unit. Leave a `-- TODO(legacy): migrate app_users.cost_center →
unit.cost_center_id, then drop` comment; the real migration happens when Payroll/Finance consumes it.

### 3.4 Direct write + event + audit (no `runModuleMutation` here).
Onboarding routes `startOnboardingCase` through `runModuleMutation` because case-creation needs
**idempotency** (dedupe on employee+package). Org-unit / position / cost-centre CRUD has no natural
idempotency key and matches the existing positions routes’ pattern: **direct `sb` insert/update →
`emitAppEvent` (fire-and-forget `void`) → `writeHrAudit` (awaited; throws on failure)**. Keep it
consistent with the existing org/positions routes. `writeHrAudit` is the mandatory §2 side-effect;
its failure must fail the mutation (it throws — do not swallow).

### 3.5 Hierarchy invariants (enforce in the mutation layer, not just the UI).
- **Cycle prevention** on create/move: a unit may not be its own ancestor. Walk `parent_id` up from
  the proposed parent; if you reach the unit being moved, reject `409`. (SQL: recursive CTE, or an
  app-layer walk over the already-loaded flat list.)
- **Single company root** convention: `org_unit_type='company'` has `parent_id = null`. Not hard-
  enforced by a constraint (keep it flexible), but the tree builder treats null-parent nodes as roots.
- **Safe delete**: reject hard-delete (`409`) if the unit has children, assigned employees
  (`app_users.department_id`), or positions (`hr_positions.department_id`). Offer **deactivate**
  (`is_active=false`) instead. (This is the fix for the legacy unguarded `deleteDepartment`.)
- **Reparent** (`/unit/move`) is a dedicated endpoint (not folded into update) so the cycle check is
  explicit and auditable as its own action.

---

## 4. Migrations (new files, additive, operator-applied)

Number them after the current max. Onboarding used up to `20260714000016`; the Offboarding module
(built in parallel) is taking `20260714000017+`. **To avoid collision, use `20260715000000+`** for
this module and confirm the highest existing number before finalizing. Every migration ends with:
```sql
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

### 4.1 `20260715000000_hr_org_structure_fields.sql`
```sql
-- departments: structured code + cost-centre link + display ordering
alter table public.departments add column if not exists code           text;
alter table public.departments add column if not exists cost_center_id uuid
  references public.finance_cost_centers(id) on delete set null;
alter table public.departments add column if not exists sort_order     integer not null default 0;
create unique index if not exists departments_code_key on public.departments(lower(code)) where code is not null;
create index if not exists departments_cost_center_idx on public.departments(cost_center_id) where cost_center_id is not null;

-- hr_positions: structured grade / headcount budget / reports-to (position-level org line)
alter table public.hr_positions add column if not exists grade              text;
alter table public.hr_positions add column if not exists headcount_budget   integer;
alter table public.hr_positions add column if not exists reports_to_position_id uuid
  references public.hr_positions(id) on delete set null;

-- finance_cost_centers: promote skeleton to a manageable registry (additive only — Finance owns it later)
alter table public.finance_cost_centers add column if not exists code       text;
alter table public.finance_cost_centers add column if not exists is_active  boolean not null default true;
alter table public.finance_cost_centers add column if not exists manager_id text references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists created_by text references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists updated_at timestamptz;
create unique index if not exists finance_cost_centers_code_key on public.finance_cost_centers(lower(code)) where code is not null;
create index if not exists finance_cost_centers_active_idx on public.finance_cost_centers(is_active);

-- All three tables already have RLS enabled + service_role access via the platform's blanket grants.
-- If your repo grants per-table, add:  grant all on public.finance_cost_centers to service_role;  (idempotent)
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```
> Verify whether `departments` / `hr_positions` have a `set_updated_at` trigger; if not, set
> `updated_at` explicitly in the update mutations (the existing positions/update already does
> `updated_at: new Date().toISOString()`).

### 4.2 `20260715000001_hr_cost_centers_perms.sql`
Grant the new cost-centre keys (mirror the org grants in `20260702000003_hr_permissions.sql`):
```sql
insert into public.role_permissions (role, permission) values
  ('superadmin','hr.cost_centers.view'),('superadmin','hr.cost_centers.manage'),
  ('admin','hr.cost_centers.view'),('admin','hr.cost_centers.manage'),
  ('hr_manager','hr.cost_centers.view'),('hr_manager','hr.cost_centers.manage'),
  ('manager','hr.cost_centers.view'),
  ('hr_staff','hr.cost_centers.view')          -- execution tier: view only (see §5)
on conflict do nothing;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```
> Also add `hr_staff` grants for the existing execution-tier org keys if the RBAC model wants
> Org visible to staff — see §5; put those grants in this same migration.

---

## 5. Permissions — exact edits

**Decision:** cost-centre management is sensitive (financial) → dedicated keys
`hr.cost_centers.view` / `hr.cost_centers.manage`. Org-unit + positions **reuse the existing**
`hr.organization.*` / `hr.positions.*` — do not invent new keys for those.

**Add `hr.cost_centers.view` and `hr.cost_centers.manage` in all FOUR places** (the drift-guard test
`tests/unit/permissions.sync.test.ts` fails the build if an *enforced* key isn’t catalogued in both
`permissions.ts` files):
1. `netlify/functions/lib/permissions.ts` → `PERMISSION_KEYS` (next to the `hr.organization.*` block ~line 143).
2. `src/lib/permissions.ts` → `PERMISSION_KEYS` (next to ~line 99), **and** the `admin` Set (~line 495)
   and `superadmin` Set (~line 622); add `.view` to the `manager` Set (~line 405) if managers should see it.
3. `src/lib/permissionMeta.ts` → group `'Organization'` (mirror the `hr.positions.*` entries):
   ```ts
   'hr.cost_centers.view':   { module: 'HR', group: 'Organization', label: 'View Cost Centres',   description: 'View cost centres.', risk: 'low' },
   'hr.cost_centers.manage': { module: 'HR', group: 'Organization', label: 'Manage Cost Centres', description: 'Create or edit cost centres.', risk: 'high' },
   ```
4. DB grants: migration §4.2.

**hr_staff (execution tier) grants** — mirror the onboarding staff split (execution yes, oversight
no). Recommended for Org Structure (add to the §4.2 migration):
- `hr_staff` **gets**: `hr.organization.view`, `hr.positions.view`, `hr.cost_centers.view` (read the
  structure to do their job).
- `hr_staff` does **NOT** get `*.manage` (org/positions/cost-centres are oversight-managed).
> Confirm the exact `hr_staff` policy against the onboarding split before finalizing.

---

## 6. Backend — services + routes

### 6.1 Lib files (`netlify/functions/lib/hr/`)
Mirror the onboarding lib shape. Compose the platform — don’t reimplement it.

- **`organizationQueries.ts`** (reads):
  - `listOrgUnits()` → every unit with rollups: `directEmployeeCount` (count `app_users` where
    `department_id=unit.id`), `positionCount`, `childCount`, joined `managerName`, `siteName`,
    `costCenterName`. Frontend builds the tree from the flat list (keep the existing `/tree` contract,
    just enrich it).
  - `getOrgUnit(id)` → the unit + its direct positions + a small sample/paged list of direct
    employees (id, name, position title) + immediate children.
  - `listPositions()` → each position with `departmentName`, `siteName`, `defaultSupervisorName`,
    `incumbentCount` (count `app_users.position_id=pos.id`), `grade`, `headcountBudget`, vacancy =
    `headcountBudget - incumbentCount` when budget set.
  - `getPosition(id)` → the position + incumbents (app_users with that position_id).
  - `listCostCenters()` → id, code, name, currency, annualBudget, isActive, managerName,
    `assignedUnitCount` (count departments with `cost_center_id=cc.id`).
  - `getOrgStats()` → `{ unitCount, activeUnitCount, positionCount, activePositionCount,
    filledHeadcount, budgetedHeadcount, costCenterCount, employeesWithoutUnit }`.

- **`organizationMutations.ts`** (writes; each does event + audit; enforce §3.5 invariants):
  - `createOrgUnit(actorId, { name, code?, orgUnitType, parentId?, siteId?, managerId?, costCenterId?, description? })`
    — insert WITHOUT `id` (DB default). Validate parent exists. Return `{ id }`.
  - `updateOrgUnit(actorId, { unitId, ...patch })` — name/code/type/site/manager/costCentre/
    description/isActive/sortOrder. (Does **not** change parent — that’s `move`.)
  - `moveOrgUnit(actorId, { unitId, newParentId | null })` — cycle-guard → reject `409` on cycle;
    reject if `unitId===newParentId`.
  - `archiveOrgUnit(actorId, { unitId })` — `is_active=false`.
  - `deleteOrgUnit(actorId, { unitId })` — guarded hard-delete (reject `409` if children / employees
    / positions reference it; message tells the caller to reassign or deactivate).
  - `createPosition` / `updatePosition` — extend the existing route logic with the new fields
    (grade, headcountBudget, reportsToPositionId); keep `position_key` unique (409 on dup).
  - `retirePosition(actorId, { positionId })` — `is_active=false`; if `incumbentCount>0` you may
    still retire (blocks new assignment) but never hard-delete an occupied position.
  - `createCostCenter` / `updateCostCenter` — code unique (409 on dup); currency default 'TTD'.
  - `retireCostCenter(actorId, { costCenterId })` — `is_active=false`; guard: if assigned to units,
    allow retire (hides from pickers) but warn; never hard-delete a referenced cost centre.

- **`organizationCore.ts`** (optional): shared helpers — `assertNoCycle(units, unitId, newParentId)`,
  `buildOrgTree(flat)` if you want a server-side tree, `slugifyCode`. Keep pure/tested.

### 6.2 Routes — add to `netlify/functions/routes/hr.ts` (already mounted at `/api/hr`)
All follow the house style: `const actor = await requirePermission(c, '<key>')`, validate
`(c.get('body') as Record<string, unknown>).args ?? {}` with a zod schema via `zv`, return
`c.json({ success: true, data })` / `c.json({ success: false, message }, <code> as 200)`.

**Org units** (`hr.organization.view` / `hr.organization.manage`):
- `POST /organization/tree` — **extend** existing to return the enriched `listOrgUnits()` rows
  (keep field names camelCase; add `costCenterId/costCenterName`, `employeeCount`, `positionCount`,
  `childCount`). Existing frontend consumers of the raw fields must keep working — additive only.
- `POST /organization/unit/get` — `{ unitId }` → unit + positions + employees + children.
- `POST /organization/unit/create` — `hr.organization.manage`.
- `POST /organization/unit/update` — `hr.organization.manage`.
- `POST /organization/unit/move` — `hr.organization.manage`.
- `POST /organization/unit/archive` — `hr.organization.manage`.
- `POST /organization/unit/delete` — `hr.organization.manage` (guarded; 409 on refs).
- `POST /organization/stats` — `hr.organization.view`.

**Positions** (`hr.positions.view` / `hr.positions.manage`):
- `POST /positions/list` — **extend** to enriched rows.
- `POST /positions/get` — `{ positionId }`.
- `POST /positions/create` — extend (grade, headcountBudget, reportsToPositionId). **Add emitAppEvent.**
- `POST /positions/update` — extend. **Add emitAppEvent.**
- `POST /positions/retire` — `{ positionId }`.

**Cost centres** (`hr.cost_centers.view` / `hr.cost_centers.manage`):
- `POST /cost-centers/list`
- `POST /cost-centers/create`  — `{ code?, name, currency?, annualBudget?, departmentId?, managerId? }`
- `POST /cost-centers/update`
- `POST /cost-centers/retire`  — `{ costCenterId }`

### 6.3 Events + audit (§2 compliance)
For every mutation:
```ts
void emitAppEvent({
  eventType: 'org.unit.created',          // .updated / .moved / .archived / .deleted
  sourceModule: 'hr', sourceEntityType: 'org_unit', sourceEntityId: id,
  actorUserId: actor.id, severity: 'info',
  payload: { name, parentId, orgUnitType },
});
await writeHrAudit({ submoduleKey: 'organization', recordId: id, actorId: actor.id,
  action: 'hr.org_unit.created', newState: {...} });   // throws on failure — do not swallow
```
Event types to use: `org.unit.created|updated|moved|archived|deleted`,
`org.position.created|updated|retired`, `org.cost_center.created|updated|retired`.
Audit `submoduleKey: 'organization'` (positions already use this), `action` in
`hr.org_unit.*` / `hr.position.*` / `hr.cost_center.*`.

---

## 7. Legacy reconciliation (No-Band-Aids — no dual editors)

The new HR org-unit editor supersedes the legacy Departments editor. In the **same PR**:
- Repoint `src/components/sections/Employees/DepartmentsSection.tsx` to the new `/organization/unit/*`
  endpoints, **or** remove it if the new Org Structure page fully replaces it in nav. Do not leave two
  places that create/edit departments with different permissions and no delete-guard.
- The legacy `netlify/functions/routes/departments.ts` (`departments.add/edit/delete`) and its
  unguarded `deleteDepartment`: either delete it (preferred, once nothing calls it — grep
  `listDepartments`/`addDepartment`/`updateDepartment`/`deleteDepartment` and the legacy perm keys)
  or, if other callers remain this cycle, leave it but document the follow-up removal. **The Org
  Structure page must use the new guarded endpoints, never the legacy ones.**
- Grep before deleting: `src/store/data.ts`, `src/api/*`, `RolesTab.tsx` reference departments —
  confirm they read via `/api/hr/organization/tree` or the employees list, not the legacy route.

---

## 8. Types + hooks

### 8.1 `types/hrOrganization.ts` (shared, camelCase; imported by BE and FE — no per-endpoint mappers)
```ts
export type OrgUnitType = 'company' | 'division' | 'department' | 'team' | 'crew' | 'site_department';

export interface OrgUnit {
  id: string; name: string; code: string | null; description: string | null;
  parentId: string | null; orgUnitType: OrgUnitType;
  siteId: string | null; siteName: string | null;
  managerId: string | null; managerName: string | null;
  costCenterId: string | null; costCenterName: string | null;
  isActive: boolean; sortOrder: number;
  employeeCount: number; positionCount: number; childCount: number;
}
export interface OrgUnitDetail extends OrgUnit {
  positions: Array<{ id: string; title: string; incumbentCount: number }>;
  employees: Array<{ id: string; fullName: string; positionTitle: string | null }>;
  children: Array<Pick<OrgUnit, 'id' | 'name' | 'orgUnitType' | 'isActive'>>;
}
export interface Position {
  id: string; positionKey: string; title: string; grade: string | null;
  departmentId: string | null; departmentName: string | null;
  siteId: string | null; siteName: string | null;
  defaultSupervisorId: string | null; defaultSupervisorName: string | null;
  reportsToPositionId: string | null;
  isSafetyCritical: boolean; isActive: boolean;
  headcountBudget: number | null; incumbentCount: number; vacancy: number | null;
}
export interface CostCenter {
  id: string; code: string | null; name: string; currency: string;
  annualBudget: number | null; isActive: boolean;
  managerId: string | null; managerName: string | null;
  departmentId: string | null; assignedUnitCount: number;
}
export interface OrgStats {
  unitCount: number; activeUnitCount: number;
  positionCount: number; activePositionCount: number;
  filledHeadcount: number; budgetedHeadcount: number;
  costCenterCount: number; employeesWithoutUnit: number;
}
// + request payload types for each mutation (CreateOrgUnitArgs, MoveOrgUnitArgs, …).
```

### 8.2 `src/api/hr/organization.ts`
Mirror `src/api/hr/onboarding.ts`: a `call<T>()` helper that **throws on `success:false`**, an
`hrOrganizationApi` object of methods, and TanStack hooks. Query keys under `['hr','organization', …]`.
`useOrgMutation` invalidates `['hr','organization']`. Use `apiPost` (wraps body as `{ args }`).

---

## 9. Frontend — functional-only (NO widgets)

`src/components/sections/HR/` — plain pages using the `.obx-*` table/form conventions (see
`OnboardingPackageManager.tsx` / `OnboardingCaseDetail.tsx` for the plain patterns) and `@ui`
(`PageHeader`, `Modal`, `Field`/`FormGrid`/`TextInput`/`SelectInput`/`TextareaInput`, `Tabs`,
`EmptyState`, `TableSkeleton`, `exportCsv`). **No `WidgetBoard`, no `registry.hrOrg*.tsx`.**

- **`OrgStructureOverview.tsx`** — page header + a **plain stat row** (from `/organization/stats`,
  not widgets) + a `Tabs` with three tabs:
  - **Structure** — the org tree. Render the flat list as an indented, collapsible tree (build from
    `parentId`). Row shows name, type pill, manager, cost centre, employee/position counts, active
    badge. Actions per node: **Add child unit**, **Edit**, **Move** (parent picker, guarded), **Archive/Activate**,
    **Delete** (guarded → shows the 409 reason via `@lib/dialog`, never `window.confirm`). Clicking a
    node opens the unit detail (drawer or inline panel) from `/organization/unit/get`.
  - **Positions** — `.obx-table` of positions (search + active filter) with New/Edit/Retire modals;
    columns incl. incumbents / headcount budget / vacancy / safety-critical.
  - **Cost Centres** — `.obx-table` with New/Edit/Retire modals (code, name, currency, annual budget,
    manager, assigned-units count).
- **Modals** (reuse `@ui Modal` + `Field/FormGrid`): Create/Edit Unit, Move Unit, Create/Edit
  Position, Create/Edit Cost Centre. Use `@lib/dialog` for all confirms/prompts/toasts (never
  `window.alert/confirm/prompt`).
- **Selectors**: units/positions/cost-centres/sites/managers come from the list endpoints +
  `/api/hr/sites/list` + an app-users picker (reuse whatever Employee Master uses for supervisor
  selection).
- **Loading**: `placeholderData` + gate `loading={isLoading && !data}`; `@ui Skeleton`/`TableSkeleton`
  on cold path only; never render a fake `0`.

**Nav wiring:**
- `src/components/sections/HR/module.ts` — add:
  ```ts
  const ORG_ITEM: ModuleNavItem = {
    id: 's-hr-organization', label: 'Organization', icon: 'fa-sitemap',
    sub: 'Org units, positions, cost centres & reporting lines',
  };
  // add ORG_ITEM to navItems
  ```
- `src/components/sections/HR/HRSection.tsx` — add `ORG_ID = 's-hr-organization'`, include it in
  `isHrSection`, and render `<OrgStructureOverview/>` when `sectionId === ORG_ID`.
  > NOTE: the Offboarding module (parallel build) adds `s-hr-offboarding` to these same two files —
  > expect a trivial merge (keep both nav items + both branches).

---

## 10. E2E — `scripts/e2e/suites/hrOrganization.mjs`

Mirror `scripts/e2e/suites/hr.mjs` / `hrOnboarding.mjs` (harness in `scripts/e2e/harness.mjs`,
reference `scripts/e2e/README.md`). Run via `npm run test:e2e -- hrOrganization` against the live
`npm run dev:netlify` (remember: `dev:netlify` serves compiled `dist/` — `npm run build:backend` +
restart before trusting it).

Cover **everything**:
1. **Every endpoint** — tree/get/create/update/move/archive/delete for units; list/get/create/
   update/retire for positions; list/create/update/retire for cost centres; stats.
2. **Hierarchy invariants** — create a parent→child chain, then attempt `move(parent → child)` and
   assert **409** (cycle blocked); attempt `delete` of a unit with a child / with an employee and
   assert **409**; then archive succeeds.
3. **Access control** — a provisioned real `employee` is denied (correct code); a provisioned real
   `hr_staff` can **read** (tree/positions/cost-centres list) but is **denied** `*.manage`
   (create/update/delete). **Provision real users of each role** — do NOT forge a role in the JWT
   (auth resolves role from `app_users`, per the CLAUDE.md pitfall).
4. **Response shape** — assert the exact camelCase fields the frontend consumes (§8 DTOs).
5. **§2 side-effects** — after each mutation, assert via the service-role `sb` client that it wrote
   the expected `app_events` row (`source_module='hr'`, correct `event_type`) and `hr_audit_log` row
   (`submodule_key='organization'`, correct `action`). Because `emitAppEvent` is fire-and-forget
   (`void`), **poll** for the event with a local `waitFor` helper defined in the suite (it is NOT
   global) — do not read once.
6. **Cost-centre reuse** — assert a created cost centre is a row in `finance_cost_centers` (not a new
   `hr_cost_centers` table) and that assigning it to a unit sets `departments.cost_center_id`.
7. **Cleanup** — tag rows with `h.TAG` (name/code prefix) and delete them in `h.onCleanup()`.

---

## 11. Verification gate (run once, at the end)

1. `npm run typecheck:frontend` and `npm run typecheck:backend` — clean.
2. `npm run build:backend` — clean (needed before E2E; `dev:netlify` serves `dist/`).
3. `npm test` (jest) + `npx vitest run` — green. **Watch the permission drift-guard**
   (`tests/unit/permissions.sync.test.ts`) — it fails if `hr.cost_centers.*` isn’t in both
   `permissions.ts` files.
4. `npm run test:e2e -- hrOrganization` — green (after the migrations are applied + `NOTIFY pgrst`).
5. 229 frontend tests must remain green.

**Migrations to operator-apply, in order (then `NOTIFY pgrst, 'reload schema';`):**
1. `20260715000000_hr_org_structure_fields.sql`
2. `20260715000001_hr_cost_centers_perms.sql`
(Confirm the numbers don’t collide with the parallel Offboarding migrations before finalizing.)

---

## 12. Definition of done — Phase A
- Org units: full hierarchy management (create/update/move/archive/guarded-delete) with cycle +
  reference guards, concurrency check (409), manager/site/cost-centre assignment.
- Positions: get/list-with-headcount + create/update (extended fields, reports-to cycle guard) +
  retire; events + audit.
- Cost centres: managed via `finance_cost_centers` (no fork); assignable to units; events + audit.
- Org health endpoint + impact-preview (read-only) endpoint working.
- Frontend Org Structure page (Structure/Positions/Cost Centres tabs + Health panel), functional-only, nav-wired.
- Legacy Departments editor reconciled (no dual editor; new guarded endpoints only).
- `hrOrganization.mjs` green; full gate green; migrations listed for operator-apply.
- No band-aids: no `hr_cost_centers` fork, no `hr_org_units` fork, no unguarded delete, no swallowed
  DB errors, `app_users.cost_center` left with a documented migration TODO (not extended).

---

# PART II — Enterprise controls (Phase B)

> **Guiding principle: reuse the engine, do not reinvent it.** We already have a maker-checker
> approval spine (`hr_employee_change_requests` + the central workflow engine) and the architecture
> is LOCKED: **one binding/version engine, ONE approval authority, no dual system.** Phase B adds an
> org-change *envelope* that rides that engine — it does NOT add a second approver. Study the
> existing pattern in `netlify/functions/routes/hr.ts` (`createChangeRequest`, ~line 826) and
> `netlify/functions/lib/workflow/service.ts` before writing anything.

## 13. Approval architecture — the correct wiring

### 13.1 `hr_org_change_requests` — the envelope (migration `20260715000002_…`)
An envelope table that mirrors `hr_employee_change_requests` (own status **mirrored from** the
workflow; the workflow is the authority). **Corrections vs the earlier plan:**
- `workflow_id **uuid** references public.workflow_instances(id) on delete set null` — **NOT**
  `workflow_instance_id text`. `workflow_instances.id` is uuid; the house convention is a uuid FK
  (see `hr_employee_change_requests.workflow_id`).
- `entity_id text` is fine (org unit ids are TEXT; position/cost-centre ids are uuid → store as text).
```sql
-- 20260715000002_hr_org_change_requests.sql
create table if not exists public.hr_org_change_requests (
  id uuid primary key default gen_random_uuid(),
  change_no text unique,                                   -- nextRef('ORC') on write (like HRC)
  entity_type text not null check (entity_type in ('org_unit','position','cost_center')),
  entity_id text,
  action text not null,                                    -- 'move' | 'archive' | 'delete' | 'update' | 'retire' | ...
  risk_level text not null default 'low'
    check (risk_level in ('low','medium','high','critical')),
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','rejected','scheduled','applied','cancelled','failed')),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  reason text, rejection_reason text,
  old_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  workflow_id uuid references public.workflow_instances(id) on delete set null,   -- uuid FK (corrected)
  requested_by text references public.app_users(id) on delete set null,
  decided_by   text references public.app_users(id) on delete set null,
  applied_by   text references public.app_users(id) on delete set null,
  requested_at timestamptz not null default now(), decided_at timestamptz, applied_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create index if not exists hr_org_cr_entity_idx   on public.hr_org_change_requests(entity_type, entity_id);
create index if not exists hr_org_cr_status_idx   on public.hr_org_change_requests(status);
create index if not exists hr_org_cr_effective_idx on public.hr_org_change_requests(effective_from);
create index if not exists hr_org_cr_workflow_idx on public.hr_org_change_requests(workflow_id) where workflow_id is not null;
alter table public.hr_org_change_requests enable row level security;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

**History table — DECIDE, don't default to building it.** We already have three history surfaces:
`hr_audit_log` (stores `previous_state`/`new_state` per action via `writeHrAudit`), `app_events`,
and the **orchestration timeline** (`/orchestration/timeline/get`) that aggregates events + audit +
handoffs + workflow per record. Onboarding shipped enterprise-grade with **no** per-module history
table. Only add `hr_org_structure_history` if it stores something those cannot — i.e. the
**effective-dated ledger** of scheduled/future-dated states. If you keep the change-request row for
scheduled changes (it already holds `old_state`/`new_state`/`effective_from`), the history table is
**redundant → drop it** and read history from the timeline + audit. Default: **do not build it.**

### 13.2 Start the workflow the LOCKED way — bindings, not hardcoded template keys
The existing HR flow uses **`startWorkflowForRecord({ context, actor })`** which resolves the active
**binding** for the trigger event (bindings seeded in `20260711000000_workflow_hr_change_bindings.sql`
— “ONE global binding per change type”). If no binding exists it returns `null` and the request
stays a plain maker-checker (no workflow). **Routing lives in bindings, not in code.** Do NOT
hardcode a `resolveOrgWorkflowTemplateKey()` + `startWorkflowByTemplate` — that pulls routing out of
the locked binding model.

**Real signatures (verified — the earlier plan had these wrong):**
```ts
// lib/workflow/service.ts
startWorkflowForRecord(params: { context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow | null>
startWorkflowByTemplate(params: { templateKey: string; context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow>
// ModuleWorkflowContext (fields the HR flow passes):
//   moduleKey, workflowType, triggerEvent, sourceRecordId, sourceRecordRef,
//   requestedBy, departmentId, siteId, recordData, priority?, ownerId?
// WorkflowActor = { id: string };  WorkflowRow has .id (uuid)
```
Correct submit (mirrors `createChangeRequest`, throws-not-swallows, guards double-start on
`workflow_id`):
```ts
const wf = await startWorkflowForRecord({
  context: {
    moduleKey: 'hr_org_structure', workflowType: 'hr_org_change_approval',
    triggerEvent: `hr.org.${entityType}.${action}`,        // binding routes on this
    sourceRecordId: changeRequestId, sourceRecordRef: changeNo, requestedBy: actor.id,
    departmentId: null, siteId: null,
    recordData: { entityType, entityId, action, riskLevel, oldState, newState, impactSummary },
  },
  actor: { id: actor.id },
});
if (wf) await sb.from('hr_org_change_requests').update({ workflow_id: wf.id, status: 'pending_approval' }).eq('id', changeRequestId);
```
> If you genuinely need explicit template routing (no binding), you MUST first seed
> `workflow_templates` + a **published version** per template key — `startWorkflowByTemplate` (and
> `startWorkflowForRecord`) resolve a **published version only** and **throw** if none exists. Prefer
> bindings.

### 13.3 Apply on completion via a workflow ADAPTER — never a manual approve/apply
There is **ONE** approval authority: the workflow engine (`decideTask`). Do **not** add
approve/reject endpoints on the org-change-request, and do **not** let `apply-approved` be a manual
HR shortcut that bypasses the engine. Follow the `hr_employee_master` adapter pattern: register an
**`hr_org_structure` workflow adapter** in the adapter registry. The engine calls the adapter’s
completion/status-sync hook; the adapter reads the pending `hr_org_change_request` and:
- **approved + `effective_from <= now`** → apply the stored mutation (the same `applyOrgUnit*` /
  `applyPosition*` / `applyCostCenter*` functions used for the direct-apply path), set status
  `applied`, write audit + event.
- **approved + `effective_from` in the future** → set status `scheduled` (the sweep applies it — §14).
- **rejected** → status `rejected`, store `rejection_reason`; no mutation.

The change-request `status` is thus **driven by the workflow** (`sourceStatusMap`), never decided
independently. This preserves “no dual approval authority.”

### 13.4 Risk policy + impact preview (KEEP — these are good)
`organizationRiskPolicy.ts` (`classifyOrgChangeRisk` / `requiresApproval`) and
`organizationImpact.ts` (preview affected employees / positions / child units / active onboarding &
offboarding cases / pending transfers / finance references + warnings/blockers) are solid. In
**Phase A** the preview endpoint is read-only (informs the UI). In **Phase B** the mutation computes
impact → classifies risk → if `requiresApproval(risk)` routes to §13.2, else applies directly.
Recommended policy: `low` → apply; `medium` → apply (reason required); `high`/`critical` → workflow;
`delete`/`override_approval` → superadmin-gated.

### 13.5 Phase-B PREREQUISITE — seed the template + binding, or approvals get stuck
`startWorkflowForRecord` resolves the active **binding** for the context; if none exists it returns
`null`. The existing employee flow tolerates null (it stays a passive maker-checker request), but an
org change that risk-policy has **classified as requiring approval** must NOT silently end up with no
workflow. So Phase B MUST include, in a seed migration (mirror
`20260711000000_workflow_hr_change_bindings.sql`):
1. A **workflow template + a PUBLISHED version** for org-change approval (the engine resolves a
   *published* version only, else it throws). Define its `sourceStatusMap` so lifecycle events sync
   the CR status (e.g. `onStarted → pending_approval`, `onCompleted → approved`, `onRejected →
   rejected`) — or let the adapter set status explicitly (§13.3), matching whichever the
   `hr_employee_master` adapter does.
2. A **binding** (`module_key='hr_org_structure'`, trigger `hr.org.<entity>.<action>`) routing to
   that template.
And a **null-binding fallback** in the submit path: if `requiresApproval(risk)` is true but
`startWorkflowForRecord` returns `null` (no binding configured), do NOT apply silently and do NOT
leave the CR stuck — either (a) fail the mutation with a clear "approval workflow is not configured
for this change type — configure a binding" error, or (b) fall back to a direct maker-checker hold
that an authorized user must explicitly release (audited). Pick one and make it explicit; never a
silent auto-apply of a change that was classified high/critical.

## 14. Effective-dating — a service-role ROUTE, not an invented scheduler
There is **no `netlify/functions/scheduled/` directory** in this repo — do not assume a scheduled
function works. Implement the sweep as a **service-role-only route** `POST
/api/hr/organization/changes/apply-due` that applies every `scheduled` change with `effective_from
<= now` (via the same adapter apply path). **Verify how it will be triggered** (check `netlify.toml`
for scheduled config, or an external cron) and document it — do not ship a timer that isn’t wired.

## 15. Phase-B permissions — corrected migration
**Corrections vs the earlier plan:** the column is **`role_name`** (not `role`), and any **enforced**
new key MUST also be added to the four catalogue locations or the drift-guard test fails the build.
New enforced keys introduced in Phase B: `hr.organization.delete` (the delete route gates on this,
not `manage`) and `hr.organization.override_approval` (critical-change override). Add **both** to
`netlify/functions/lib/permissions.ts` + `src/lib/permissions.ts` (`PERMISSION_KEYS` + the admin /
superadmin Sets) + `src/lib/permissionMeta.ts` (group `'Organization'`) — then this grant migration:
```sql
-- 20260715000003_hr_org_enterprise_permissions.sql
insert into public.role_permissions (role_name, permission) values   -- role_name (corrected)
  ('superadmin','hr.organization.delete'),('admin','hr.organization.delete'),
  ('superadmin','hr.organization.override_approval')
on conflict do nothing;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

## 16. Phase-B DTOs, routes, hooks
Add the DTOs from the pasted plan (`OrgChangeRequest`, `OrgChangeImpactSummary`, `OrgHealthIssue`,
`OrgHealthSummary`, `OrgChangeStatus`, `OrgChangeRiskLevel`, `OrgEntityType`) to
`types/hrOrganization.ts` — with `workflowId: string | null` (uuid as string). Routes (on
`/api/hr`): `organization/change/preview`, `organization/changes/list`, `organization/change/get`,
`organization/change/cancel` (maker cancels own pending), `organization/changes/apply-due`
(service-role). **No** `change/apply-approved` manual endpoint (§13.3 — the adapter applies). Hooks:
`useOrgChangeRequests`, and `useOrgMutation` returns the `applied | pendingApproval` union so the UI
toasts “applied” vs “submitted for approval.”

## 17. Phase-B E2E additions (`hrOrganization.mjs`)
- high-risk move/cost-centre change creates an `hr_org_change_requests` row **and** a
  `workflow_instances` row (assert the `workflow_id` FK is set).
- approving the workflow task (via the workflow API) drives the change-request to `applied` and the
  mutation actually lands (assert the department/position/cost-centre row changed).
- rejecting → status `rejected`, **no** mutation applied.
- future `effective_from` → status `scheduled`; then `apply-due` applies it.
- **single authority:** assert there is no way to move the CR to `applied` except via workflow
  completion / the adapter (no manual approve endpoint exists).
- reports-to cycle blocked (409); concurrency conflict (409); duplicate code (409).

---

## 18. APPENDIX — corrected signatures / DO NOT COPY these from the earlier plan
These exact patterns appeared in the expanded plan and are **wrong against the codebase**:

| # | Wrong (do not copy) | Correct |
|---|---|---|
| 1 | `insert into role_permissions (role, permission)` | column is **`role_name`**: `(role_name, permission)` |
| 2 | `startWorkflowByTemplate({ templateKey, entityType, entityId, actorId, payload })` | `startWorkflowByTemplate({ templateKey, context: ModuleWorkflowContext, actor: { id } })`; prefer **`startWorkflowForRecord({ context, actor })`** (binding-driven) |
| 3 | `workflow_instance_id text` (no FK) | `workflow_id uuid references public.workflow_instances(id) on delete set null` |
| 4 | `writeHrAudit({ oldState, newState })` | param is **`previousState`**: `writeHrAudit({ previousState, newState })` (an unknown key is silently dropped = accept-and-drop band-aid) |
| 5 | hardcoded `resolveOrgWorkflowTemplateKey()` routing | routing lives in **bindings** (locked engine); trigger event → binding → template |
| 6 | manual `apply-approved` / approve endpoints on the CR | **workflow adapter** applies on completion; status synced from workflow (single approval authority) |
| 7 | `netlify/functions/scheduled/applyDueOrgChanges.ts` | no scheduler infra exists → service-role **route** `changes/apply-due` + verified external trigger |
| 8 | new enforced keys granted only in DB | also add to `permissions.ts` ×2 + `permissionMeta.ts` or the **drift-guard test fails the build** |
| 9 | `hr_org_structure_history` by default | redundant with `hr_audit_log` + `app_events` + orchestration timeline — build ONLY as the effective-dated ledger, else drop |

## 19. Definition of done — Phase B
- `hr_org_change_requests` envelope (uuid `workflow_id` FK), risk policy + impact preview wired into
  mutations; high-risk actions route to the **central engine via bindings**.
- An **`hr_org_structure` workflow adapter** applies approved changes on completion; the CR status is
  workflow-driven (no manual approve/apply). Effective-dating via the `apply-due` service-role route.
- Phase-B permissions catalogued in all four places + granted; drift-guard green.
- Phase-B E2E green (approval creates workflow, approve applies, reject doesn’t, scheduled applies via
  sweep, single-authority assertion).
- No band-aids: no second approval authority, no hardcoded workflow routing, no invented scheduler,
  no redundant history table, corrected signatures throughout (§18).
