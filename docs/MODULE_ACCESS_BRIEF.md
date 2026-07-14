# Module Access — a first-class "turn a module on/off for a role/user" switch

Purpose of this doc: hand to the implementation agent. It describes the DESIRED behavior and
the REAL current architecture (verified in code, refs inline). **Do not invent data or fields.**
Companion docs: `docs/ROLE_CATEGORIES_BRIEF.md` (role tiers — independent of this),
`docs/ROLES_CAPABILITY_EDITOR_BRIEF.md`.

---

## 1. Goal

Make "revoke the Finance module from admin" a **single, audited action** that actually takes
effect everywhere: it **blocks the module's data/actions** AND **hides the module from the nav**,
and is reversible without losing the underlying capability grants. Today there is no such concept.

---

## 2. Current architecture (the gap — verified)

Two independent systems that don't talk to each other:

- **Capabilities = what you can DO.** Per-key. `PERMISSION_META[k].module` only *groups* keys.
  Enforced server-side by `requirePermission()` → `loadRolePermissions(role)` (from
  `role_permissions`) merged with per-user `user_permissions` overrides via `resolveWithSet`
  ([netlify/functions/lib/auth.ts:374](netlify/functions/lib/auth.ts)). Frontend mirrors with
  `can()` ([src/lib/permissions.ts:1330](src/lib/permissions.ts)).
- **Nav = what's in your menu.** **Role-only.** `getModulesForRole(role)` is literally
  `getModules().filter(m => m.roles.includes(role))`
  ([src/lib/moduleRegistry.ts:103](src/lib/moduleRegistry.ts)) plus per-role `SECTION_DEFS[role]`.
  **The nav pipeline never calls `can()` / never looks at capabilities.** NavCustomizer only
  hides items for display (per `visibilityNamespace`) — it does not enforce access.

**Consequence:** denying all of a user's capabilities blocks the *data* (backend 403) but the
*menu entry stays* (it's driven by role). There is no unifying "module is off" concept. (Also:
`superadmin` is allow-all, so denials never visibly apply on a superadmin account.)

---

## 3. Core model — Module Access as a MASTER GATE (recommended)

Introduce a per-**(role | user)** × **module** gate: `enabled` / `disabled`, evaluated **before**
capability grants.

- **Module OFF** ⇒ *every* capability in that module is effectively **denied** (hard gate, regardless
  of individual grants) **and** the module's nav is hidden. The underlying grants are **preserved**
  — re-enabling restores them (reversible, non-destructive).
- **Module ON** ⇒ capabilities resolve normally (role default + user override).

This is a coarse master switch layered *above* the existing per-capability model — it does not
replace it.

---

## 4. The canonical "Module" entity + enforced completeness

There are **three** overlapping "module" notions today (see Appendix A): nav groups, feature-modules
(`moduleRegistry`), and permission-catalogue modules (`PERMISSION_META.module`). Module Access needs
**one** canonical list that reconciles them. Each entry:

```ts
interface ModuleAccessDefinition {
  moduleKey:         string;    // stable unique key, e.g. 'finance'
  label:             string;
  eligibleRoles:     string[];  // authorization eligibility — evaluated on BOTH server + client (§8)
  permissionModules: string[];  // PERMISSION_META.module values this gate covers
  navModuleIds:      string[];  // moduleRegistry module ids to hide
  sectionIds:        string[];  // static SECTION_DEFS ids to hide (legacy surfaces)
  routePrefixes:     string[];  // URL prefixes the route guard blocks (§8)
}
```

`MODULE_ACCESS_CATALOG` (the array of these) is the **single source of truth**, and it must be
**validated at build/CI, fail-closed** — an unmapped capability must NEVER silently bypass the gate:
- every `PERMISSION_META.module` maps to **exactly one** canonical module;
- every permission **key** resolves to exactly one canonical module;
- every **gated** nav module / section id maps to one canonical module;
- `moduleKey`s are unique; **duplicate** permission-module ownership is rejected;
- an **unknown** module key from the DB is rejected;
- a **newly introduced** permission module **fails CI** until it is mapped.

Runtime is fail-closed too: `resolveCanonicalModule(meta.module)` returning nothing ⇒ **DENY**.
(Modules deliberately *absent* from the catalogue = not gateable / platform-internal — see Appendix A6.)

---

## 5. Data model (D1 = APPROVED — explicit gate tables)

- `role_module_access(role_name text, module_key text, enabled boolean, created_at, updated_at, updated_by)`
- `user_module_access(user_id text, module_key text, state text check in ('disabled','inherit','exception'), …)`
  - **Absent row = ENABLED** default ⇒ migration preserves today's behavior with **zero backfill**.
  - `app_users.id` is TEXT — user FK is text (Spec §2).
- **User states = `Inherit · Deny · Exception` (D-U1 = YES, approved exceptions supported).**
  - **`Inherit`** (or absent) — follow the role.
  - **`Deny`** — user-level block (further restricts; always wins).
  - **`Exception`** — an **approved carve-out** that lets THIS user keep a module their role blocks. It
    (a) is labelled an *exception* in the UI, (b) is set **only via the maker-checker approval flow**
    (never a plain toggle), and (c) is surfaced whenever the role module is disabled so it's visible
    and auditable. A plain "Allow" that silently overrides org policy is still **prohibited** — the
    exception is the ONLY sanctioned pierce, and it goes through approval.
- (Rejected: deriving module-on from "has ≥1 grant" — brittle, loses grants on toggle, doesn't fix nav.)

---

## 6. Effective-access algorithm — a role disable is a HARD CEILING (single resolver)

For user `U` (role `R`), capability `K` in canonical module `M`:

```
if (R === 'superadmin')                          return ALLOW;   // immutable
if (!isRoleEligibleForModule(R, M))              return DENY;    // catalogue eligibleRoles (§4/§8)
if (userModuleGate(U, M) === 'disabled')         return DENY;    // user hard-deny always wins (most restrictive)
if (roleModuleGate(R, M) === 'disabled'
      && userModuleGate(U, M) !== 'exception')   return DENY;    // role CEILING — only an APPROVED exception pierces it
return resolveCapabilityNormally(U, R, K);                       // user 'inherit'/absent/exception → role default + user_permissions
```

**The rule (review #1):** a role-level **disable is a ceiling** — a user override can only *further
restrict*, never bypass… **except** a single approved `exception` (D-U1 = yes). So "disable Finance for
the admin role" denies Finance for **every** admin, unless a specific admin has been granted an
**approved exception** (set via maker-checker, §10). A plain user "Allow" still cannot bypass it.

This one predicate drives **all four consumers**: data/action (`requirePermission` / `can()`),
**route access** (§8), and **nav visibility** (§8) — one gate, four consumers, no dual system.

---

## 7. Backend enforcement

- Extend `resolveWithSet` / `requirePermission` to run the **module gate first** (key →
  `PERMISSION_META.module` → `resolveCanonicalModule` → gate). ONE resolver path; **fail-closed** on
  an unmapped module (§4).
- Deliver each user's **module-gate map + eligibility** in the session/permissions payload so `can()`,
  the **route guard**, and the nav all consult the same truth (server remains authoritative).

---

## 8. Nav + ROUTE + eligibility (the biggest lift — three parts)

1. **Nav visibility:** hide a module's `navModuleIds` / `sectionIds` when its gate resolves disabled
   for the current role/user. Augment `getModulesForRole` + `SECTION_DEFS` handling with the gate.
2. **Route access (review #2 — hiding the menu is not enough):** add a **shared route guard** keyed on
   `routePrefixes`. Gate enabled → route may render; gate **disabled → redirect to a "Module blocked"
   screen** — never render the page and merely let its API calls 403. A **realtime revocation must
   evict a user currently inside** the module (redirect them out), not leave a stale page open.
3. **Eligibility (review #3):** `m.roles` today is a **frontend nav-registry** value, not backend
   authorization — a split. **Move eligibility into the catalogue's `eligibleRoles`, evaluated on both
   server and client** (recommended). Handle **custom roles deliberately** — a custom role must not be
   permanently excluded just because its name isn't in a hard-coded array (default custom roles to
   eligible, or drive eligibility from data). If instead `m.roles` is kept, **demote it to a legacy nav
   default** and stop describing it as "which roles may ever have M."

---

## 9. UI

- **Role editor** (`AcRolesPage`): a **"Module Access"** grid — each canonical module with an on/off
  master toggle for this role. Natural home = the existing collapsed **Modules** view.
- **User Access** (`AcUsersPage`): a module-level **Inherit / Deny / Exception** control per module (§5).
  Deny is immediate; **Exception** opens the approval flow (it's a carve-out from a role block, not a
  plain toggle) and is surfaced with a badge wherever that user's role has the module disabled.
- **Blocked state must be explicit and reassuring** (review UI note) — a gated-off module shows, e.g.:
  > **Finance** — Blocked by role module access
  > 42 capability grants are preserved and will apply again when this module is enabled.

  …and its capability rows stay **visible but visually subordinate** (greyed), so admins see the switch
  is **non-destructive** and never assume grants were deleted. Only show the count if it can be computed
  reliably from existing data.

---

## 10. Maker-checker (ENABLING is as consequential as disabling)

Because grants are preserved, **turning a module back ON instantly reactivates every underlying grant** —
so enable is as sensitive as disable. Reuse the existing **protected-role / critical-change** concepts —
do NOT introduce a second, unrelated sensitivity model.

| Change | Handling |
|---|---|
| Any module change on **superadmin** | **Prohibited** (immutable) |
| Role-level module **disable** | **Approval required** |
| Role-level module **enable** | **Approval required** |
| Change on a **protected / privileged** role | **Approval required** |
| **User-level Deny** | Immediate + audit (unless existing policy requires approval) |
| **User-level Allow that bypasses a role block** | **Prohibited** (a plain allow can't pierce a ceiling) |
| **User-level Exception** (carve-out from a role block) | **Approval required** (D-U1 = yes; the only sanctioned pierce) |

Every change: business row → `app_events` → `audit_logs` → **toast**; invalidate affected users'
permission caches; realtime refetch **and route-evict** (§8).

---

## 11. Migration

- New tables + RLS. **Absent = enabled** default ⇒ **no backfill needed** (current behavior
  preserved). Operator-applied; after: `NOTIFY pgrst, 'reload schema';`.

---

## 12. Decisions — SETTLED after review

- **D1** ✅ explicit gate tables (approved).
- **D2** ✅ maker-checker on **both disable and enable**, and any change on a protected/privileged role;
  prohibited on superadmin (§10 table). Reuse existing protected-role/critical-change concepts.
- **D4** ✅ user gate = **Inherit / Deny / Exception** (§5). No plain bypassing Allow; hard ceiling (§6).
- **D5** ✅ role eligibility moves into the **catalogue `eligibleRoles`**, evaluated server + client
  (§8.3); custom roles handled deliberately (not name-array-excluded).
- **D6** ✅ superadmin immutable, bypasses gates.
- **D7** ✅ independent of Role Categories (tier = directory; module access = enforcement).
- **D3** ✅ **canonical switch list = HR · Finance · Payroll · HSE · Sites & Map · Calendar ·
  Communications (Messages) · Settings.** Payroll is its **own** switch, split from Finance (D-A1).
  Communications = **Messages only**, not Notifications (D-A2). NOT-gateable (Appendix A6):
  Access Control, Auth, System, User Management, Workflow, Dashboard, Tickets, Notifications, Profile.
- **D-U1** ✅ **YES — approved per-user exceptions supported** (state `exception`, approval-gated, §5/§10).

### Still open
- Only the **exact nav-id / route-prefix wiring** per switch (an implementation detail of the catalogue,
  esp. splitting Payroll's finance sub-items from Finance's — Appendix A5). No product decisions remain.

---

## 13. Minimum E2E coverage

- Module OFF ⇒ a capability in it is **denied (403)** even when individually granted; nav item hidden.
- **Route access:** opening a blocked module's URL directly **redirects to "Module blocked"** — the page
  never renders (not merely a failed API call).
- **Realtime revoke** while a user is inside the module **evicts** them (redirect out), no stale page.
- **Hard ceiling:** role disable denies **every** user of that role — including one with a prior
  user-level grant/allow; a user Deny can further restrict but **cannot bypass** a role disable.
- **Approved exception** (D-U1): a user with an approved `exception` **keeps** a module their role
  blocks; the same user WITHOUT approval is denied; setting an exception routes through approval.
- **Finance vs Payroll are independent switches:** disabling **Payroll** hides payroll/payslips but
  leaves the rest of Finance (AP, statutory) working, and vice-versa.
- Module ON ⇒ capabilities resolve normally; **re-enabling restores** the prior grants (non-destructive).
- **Eligibility** is enforced identically server + client (custom role not wrongly excluded).
- **Catalogue completeness:** a CI/unit test fails if any permission module/key is **unmapped**; runtime
  is **fail-closed** (unmapped ⇒ DENY).
- **Enable requires approval** (not just disable); superadmin change is rejected; protected-role change
  routes to approval.
- Every change writes `app_events` + `audit_logs` (+ approval when maker-checker applies).
- Nav + route visibility reflect the gate for a real provisioned user of that role.

---

## 14. Out of scope

- Editing the capability catalogue (adding/removing keys).
- Per-capability grants/overrides (already exist — this sits above them).
- Role Categories (separate brief).

---

**One-line model:** Module Access is a **master ON/OFF gate per role/user per module**, evaluated
before capabilities, that **both blocks the module's data and hides its nav** — the missing link
between "what's in my menu" (role) and "what I can do" (capabilities).

---

# Appendix A — the REAL "module" lists (raw material for the §4 canonical-module decision)

There are actually **three** overlapping groupings the word "module" refers to today. Codex must
collapse them into ONE canonical gate list. All data below is pulled from the live code.

## A1. Nav GROUPS — sidebar section headers (`src/config/index.ts`)
`overview · workforce · operations · finance · administration · personal · account`.
These are display buckets, **not** access units — generally NOT what you gate.

## A2. Feature MODULES — self-registering (`src/components/sections/*/module.ts`)
Each contributes a nav group + a mounted section.

| module id | nav group (label) | roles | sectionId | nav items |
|---|---|---|---|---|
| `access-control` | Access Control | superadmin | `s-access-control` | Overview, User Access, Roles, Module Coverage, Approvals, Audit Log, Sessions, Payslip Designer |
| `hr` | Human Resources | admin, manager, superadmin | `s-hr` | Employee Master, Onboarding, Organization, Documents, Offboarding, Leave & Absence, Transfers & Promotions, Attendance & Timekeeping |
| `finance` | Finance | admin, superadmin | `s-finance` | Overview, Accounts Payable, Statutory Configuration, Payroll, Payroll Setup, Payslip Designer, Statutory Remittances, My Payslips |
| `hse` | HSE | admin, manager, superadmin | `s-hse` | HSE Dashboard, functional areas, PPE Manager |
| `calendar` | (flat, `overview`) | superadmin, admin, manager, employee | `s-calendar` | Calendar & Tasks |

## A3. Legacy STATIC sections — per-role config, pre-module, STILL LIVE (`src/config/index.ts`)
- **workforce:** Employees `s-adm-employees` · Departments `s-adm-departments` · Attendance `s-adm-attendance` · Leaves `s-adm-leaves`
- **operations:** Project Sites `s-adm-projects` · Live Map `s-projectMap`
- **finance:** Hourly Rates `s-adm-rates` · Payroll `s-payroll`
- **overview:** Dashboard `s-adm-dashboard`
- **personal** (employee self-service): My Attendance · My History · My Leaves · My Payslips
- **account:** Notifications `s-notification-center` · Messages `s-messages` · My Profile `s-profile` · Settings `s-settings` · About `s-about`

⚠️ These **overlap** the HR & Finance feature modules — there are **two HR surfaces** (new `s-hr-*` and
legacy `s-adm-employees/…`) and two Finance surfaces. Legacy HR removal is currently blocked, so a
gate must hide **both** the module and its legacy sections.

## A4. Permission-catalogue MODULES — `PERMISSION_META.module` (key counts)
`HR 120 · Finance 83 · Settings 77 · HSE 39 · Workflow 33 · Communications 19 · Employees 10 ·
Attendance & Leave 9 · Payroll 7 · Sites & Map 6 · Calendar 5 · User Management 4 · System 4 ·
Auth 4 · Dashboard 2 · Tickets 1`

## A5. PROPOSED canonical MODULE list (the on/off gate) — Codex finalizes
A canonical module = a business surface a user could lose wholesale. Each maps to permission-module(s)
it revokes + nav ids it hides.

| Canonical module | Permission modules covered | Nav to hide (module + legacy) | Note |
|---|---|---|---|
| **Human Resources** | HR, Employees, Attendance & Leave | `hr` module (`s-hr*`, incl. `s-hr-leave`) + manager `s-adm-leaves` + **ESS `s-emp-leave`** + legacy `s-adm-employees/departments/attendance` | `eligibleRoles` ⊇ **employee** (ESS-only); Leave is an HR **submodule** — see A8 |
| **Finance** | Finance | `finance` module *minus* payroll sub-items (Overview, Accounts Payable, Statutory Config) + legacy `s-adm-rates` | Payroll split out ↓ (D-A1 = separate) |
| **Payroll** | Payroll | finance payroll sub-items (`s-finance-payroll`, `s-finance-payroll-setup`, `s-finance-statutory-remit`, `s-finance-mypayslips`, Payslip Designer) + legacy `s-payroll` | own switch; hides only payroll surfaces |
| **HSE** | HSE | `hse` module (`s-hse`) | clean |
| **Sites & Map** | Sites & Map | `s-adm-projects`, `s-projectMap` | no feature module (static only) |
| **Calendar** | Calendar | `calendar` module (`s-calendar`) | clean |
| **Communications** | Communications | `s-messages` | Messages only (D-A2); NOT Notifications |
| **Settings** | Settings | `s-settings` | large surface; gate = lock user out of settings |

⚠️ **Payroll split is finer-grained nav hiding:** Finance and Payroll live in the *same* `finance`
feature module, so the two switches hide **specific sub-item ids**, not two separate nav modules. The
implementer must confirm the exact `s-finance-*` id split (which sub-items are "payroll") against the
live `Finance/module.ts` navItems. The `sectionIds`/`navItemIds` catalogue fields carry this.

## A6. NOT gateable — platform-internal (Codex confirms)
- **Access Control** — the admin console itself; gating it could lock admins out.
- **Auth · System · User Management** — platform security/identity plumbing.
- **Workflow** — cross-cutting; embedded approvals, no standalone nav. Gating it would silently break
  approvals across every module.
- **Dashboard · Tickets · Notifications · Account/Profile** — universal chrome, not a "feature" you own.

Rationale: these are infrastructure, not business modules held "as a unit." A gate here breaks the
app rather than restricting a feature.

## A7. Sub-decisions — SETTLED (product) / implementer confirms wiring
- **D-A1 — Payroll:** ✅ **its own switch**, split from Finance (owner: `Payroll` permission module +
  the finance payroll sub-items + legacy `s-payroll`). Enables "Finance yes, salaries no."
- **D-A2 — Communications scope:** ✅ **Messages only** — Notifications stay universal (not gateable).
- **D-A4 — NOT-gateable set (A6):** ✅ confirmed (Access Control, Auth, System, User Management,
  Workflow, Dashboard, Tickets, Notifications, Profile).
- **D-A3 — legacy overlap:** implementer confirms each gate hides BOTH the feature-module nav AND the
  legacy static sections (until legacy removal).
- **D-A5 — Departments** (`s-adm-departments`): part of the **HR** gate (org structure).

The product decisions are locked; the only remaining implementer task is confirming the exact
`s-finance-*` payroll/finance sub-item split against the live nav, then §4's `MODULE_ACCESS_CATALOG`
is this table made concrete.

## A8. Human Resources ownership — Leave is an HR SUBMODULE, not a separate module

**Do NOT add a "Leaves" canonical module.** Leave is a feature *inside* Human Resources. All its
role-specific surfaces roll up to the single `human_resources` gate:

```
human_resources
└── Leave Management
    ├── HR/Admin leave      → hr module, s-hr-leave  (canonical HR leave service, hrLeave.ts)
    ├── Manager approvals   → s-adm-leaves           (AdminLeave — currently legacy leaves.ts)
    └── ESS "My Leave"      → s-emp-leave            (employee self-service — currently legacy leaves.ts)
```

Two facts this makes concrete for `MODULE_ACCESS_CATALOG`:

1. **A legacy API ≠ a separate module.** `leaves.ts` being a live backend that `AdminLeave` + ESS
   still call is an **implementation dependency**, not evidence that Leave is its own top-level
   module. Backend files, API generations, screens, and product modules are different concepts —
   a legacy API can serve a feature inside HR without becoming a separate gate.

2. **`moduleRegistry.hr.roles = ['admin','manager','superadmin']` is NOT the full HR eligibility.**
   It describes the current HR *administration navigation* surface — not everyone HR owns. The
   canonical `human_resources` **`eligibleRoles` MUST include `employee`**, who receives *only* the
   **ESS leave** nav/routes (`s-emp-leave`) — never Employee Master, HR Settings, or the HR admin
   sidebar. Surface visibility is per-role *within* the gate; eligibility for the gate is broader
   than any one nav module's `roles`. (This is the concrete case behind §8.3.)

```ts
{ moduleKey: 'human_resources',
  eligibleRoles:     ['admin', 'manager', 'superadmin', 'employee'],   // employee = ESS surface only
  permissionModules: ['HR', 'Employees', 'Attendance & Leave'],
  navSurfaces:       ['hr' /* s-hr* incl. s-hr-leave */, 's-adm-leaves', 's-emp-leave', 's-adm-employees', 's-adm-departments', 's-adm-attendance'],
  // routeGroups: URL prefixes if/when real routing exists; today these are section ids above.
}
```

### Legacy `leaves.ts` retirement — an HR sub-task, tracked under HR (NOT a module)
The clean long-term path (this is Leaves option 1; the manager-only move is a valid *interim stage*,
not a completed retirement):
1. Choose the canonical HR leave backend + data model (the newer HR leave service).
2. Add / confirm **employee self-service** endpoints on it (HR leave must serve employees, not just admin/manager).
3. Rewire **ESS "My Leave"** (`s-emp-leave`) to the canonical HR leave service.
4. Rewire **AdminLeave / manager approvals** (`s-adm-leaves`) to it.
5. Verify functional parity: requests, balances, approvals, cancellation, history, attachments, notifications, audit.
6. Confirm **no remaining callers** of `leaves.ts`.
7. Delete the legacy routes + implementation.

**One-line for the implementer:** *Leave is an HR submodule, not a separate canonical Module-Access
entity. `leaves.ts`, `AdminLeave`, and ESS "My Leave" are current implementation surfaces that map
to Human Resources. Legacy `leaves.ts` cannot be deleted until both the manager/admin and the
employee ESS consumers are migrated to the canonical HR leave service.*
