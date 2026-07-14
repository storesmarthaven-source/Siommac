# Roles — Grouping by Category (Tier) + Source: Implementation Brief

> **STATUS: BUILT — with one amendment to D1.** Category is a real field (`roles.role_category`),
> Source is `isSystem`, and Module stays the capability grouping — all as specified. **Amendment:**
> the tier list is **not a fixed enum**; it's a **managed taxonomy** — a `role_categories` table
> (migration `20260919000140`) with superadmin CRUD (`listRoleCategories` / `create` / `update` /
> `delete`). The four tiers (Administration / Management / Staff / Self-Service) are **seeded as
> `is_system` tiers** (renameable, not deletable); admins can add their own (e.g. Supervisors,
> Executives). `roles.role_category` is a **FK** into that table. Everywhere below that says a
> "fixed enum of four values" now means "any key in `role_categories`, seeded with those four."
> Migrations: `20260919000130` (nullable column + backfill) → `20260919000140` (managed table + FK).

Purpose of this doc: hand to the implementation agent (Codex). The taxonomy and decisions
below are **settled** (revised after review). Build to them. **Do not invent data or
fields**, and **do not derive category** from names or capabilities. Companion doc:
`docs/ROLES_CAPABILITY_EDITOR_BRIEF.md` (the per-role capability editor, unchanged).

Page: `src/components/sections/AccessControl/pages/AcRolesPage.tsx`
Styles: `src/components/sections/AccessControl/accessControl.css` (`.acx`)

---

## 1. The ask

Organise the role directory so that selecting an organizational **tier** (e.g. **Management**)
shows only that tier's roles — not the whole global list — while still being able to reach
everything when needed. Management is a first-class section, alongside the other tiers.

---

## 2. THE FINAL MODEL — three separate concepts (do not conflate)

| Concept | Meaning | Field / source | Example |
|---|---|---|---|
| **Category** | Organizational **tier** the role belongs to | NEW `role_category` | Management |
| **Source** | Where the role **came from** | EXISTING `isSystem` | System / Custom |
| **Module** | How **capabilities** are grouped | `PERMISSION_META.module` | HR, Finance, HSE |

These are orthogonal. A role has exactly one Category **and** one Source. "Custom" is a
**Source**, never a Category — a custom role can be a custom Management role, a custom Staff
role, a custom Administration role, etc. **Never place all user-created roles into a single
"Custom" category.** Category organizes the directory; it does not touch capability records.

```
Role
├── role_category: management      ← tier (directory organization)
├── isSystem: false                ← source (System / Custom)
└── permissions                    ← grouped by MODULE, never by category
    ├── HR capabilities
    ├── Finance capabilities
    └── …
```

---

## 3. Current model (facts — build only on these)

- **Roles** (`RoleRow`, `src/lib/superadminApi.ts`): `name, label, description, isSystem,
  protected, sortOrder, userCount`. **`isSystem` is the Source dimension (System/Custom).**
  There is **no category/tier field today** — that is what we add.
- **Built-in roles** (`ROLE_PERMISSIONS`, `src/lib/permissions.ts`) — 9:
  `superadmin, admin, manager, employee, hr_manager, hr_staff, finance_manager,
  finance_staff, hse_staff` — plus custom roles created at runtime.
- **Capabilities** carry `module` (HR, Finance, HSE, Payroll, Settings, Workflow, …). That is
  the Module dimension — leave it alone.
- Rail today has only System/Custom tabs. Superadmin is all-on & immutable.

---

## 4. Filtering model (two independent facets)

**Category** (single-select): `All · Administration · Management · Staff · Self-Service`
— plus **Needs Categorization** shown *only* while uncategorized roles exist (migration
remediation, see §7 — NOT a permanent category).

**Source** (single-select): `All Roles · System · Custom`.

They combine freely: `Management + System`, `Management + Custom`, `Staff + Custom`,
`All + Custom`, etc. `All` gives global visibility (includes uncategorized).

---

## 5. Decisions (SETTLED)

**D1 — Explicit category field (no derivation).**
  New DB column **`role_category`**, server-enforced, exposed through the **list roles**,
  **role details**, **create role**, and **edit role** APIs. Values:
  `administration | management | staff | self_service`.
  Do NOT infer from role name or capability assignments.

**D2 — Global-role mappings (backfill the 9 built-ins):**

  | Role | Category |
  |---|---|
  | superadmin | administration |
  | admin | administration |
  | manager | management |
  | hr_manager | management |
  | finance_manager | management |
  | hr_staff | staff |
  | finance_staff | staff |
  | hse_staff | staff |
  | employee | self_service |

  Do **not** repeat Administration/Self-Service roles inside every category; the **All** view
  provides global visibility.

**D3 — Single primary category.** Each role has exactly one category. It organizes the
  directory ONLY. It does **not** limit which modules/capabilities the role can receive,
  which users can be assigned, or where the role operates.

**D4 — Escape hatch (implement all three):**
  1. An **All Roles** category view.
  2. The capability editor **always** shows the complete capability catalogue (every module),
     regardless of the role's category.
  3. Authorized admins can **reassign** an eligible role to another category (audited).
  The selected category must **never** constrain permission grants.

**D5 — Custom-role creation requires an explicit category.** No silent default (defaulting to
  Staff would misclassify management/admin roles). The create form shows:
  `Category — Select the organizational tier this role belongs to`, and the role **cannot be
  created until a valid category is selected**.

---

## 6. Backend / API

- Add `role_category text` (nullable initially — see §7). Server-validate against the four
  allowed values on create/edit; reject invalid.
- Surface `category` (or `roleCategory`) on `RoleRow` and in list/details/create/edit APIs.
- Category changes are a real mutation: business row → `app_events` → `audit_logs` → success
  toast. Server-enforced (not a client-only flag). Superadmin remains immutable.

---

## 7. Existing custom-role migration (staged — do not auto-assign Staff)

Category cannot be safely inferred for existing custom roles. Stage it:

1. Add **nullable** `role_category`.
2. Backfill the **nine built-ins** per the §5 D2 table.
3. Leave existing **custom** roles **uncategorized** (null).
4. Surface uncategorized roles under **"Needs Categorization"** in the rail and require an
   admin to classify each.
5. Require `role_category` for **every newly created** role (§5 D5).
6. Once all roles are classified, a **follow-up migration** makes the column **NOT NULL**.

"Needs Categorization" is migration remediation, **not** a permanent category.

---

## 8. Rail layout (keep the master-detail shell)

```
Role Directory
[ Search roles... ]

Categories
  All                     14
  Administration           2
  Management               4
  Staff                    5
  Self-Service             1
  Needs Categorization     2      ← only while uncategorized roles exist

Source
  [ All Roles ]  [ System ]  [ Custom ]

Management · 4 roles
  Manager                       System · 8 members
  HR Manager                    System · 3 members
  Finance Manager               System · 2 members
  Regional Operations Manager   Custom · 6 members
```

Role editor stays on the right (unchanged).

---

## 9. Category selection behavior

Selecting a category (e.g. Management):
- filters the list immediately and updates the visible result count;
- **preserves** the selected Source filter;
- search operates **only within the current result set**;
- **clears the selected role** if it is no longer visible;
- shows a **category-specific empty state** when nothing matches, e.g.:

  > **No custom Management roles**
  > Custom roles assigned to Management will appear here.
  > [ Create Management Role ]

The create action may **preselect** Management (admin initiated from that category), but the
Category field must remain **visible and editable**.

---

## 10. Role header + details

Communicate **both dimensions** with readable labels (do not rely on colour alone):

```
Finance Manager               Regional Finance Approver
Management · System           Management · Custom
2 members                     6 members
```

Role details metadata adds **Category**:

```
Role type    Custom
Category     Management
Members      6
Status       Active
```

Editable roles get **Change category**, which requires confirmation:

  > **Move role to Staff?**
  > Regional Finance Approver will move from Management to Staff.
  > Its users and permissions will not change.
  > [ Cancel ]  [ Move Role ]

The move mutation writes: business row → `app_events` → `audit_logs` → success toast.

---

## 11. URL state

Persist directory state in query params (predictable back/forward + shareable links):

```
/access-control/roles?category=management&source=custom&role=regional_finance_approver
```

Params: `category`, `source`, `query`, `role`. Invalid values fall back to `category=all`,
`source=all`.

---

## 12. Capability-editor boundary (do NOT cross)

Category must **not** be added to capability records. The capability editor continues to show
capabilities grouped by **module**, always the full catalogue. Category organizes the role
directory; capabilities stay organized by module.

---

## 13. Constraints (non-negotiable)

- No fabricated data — category is a real, server-enforced field, never invented per-render
  or derived from names/capabilities.
- Maker-checker for critical grants and **superadmin immutable** — unchanged.
- Every mutation (create/edit/reassign): business row → `app_events` → `audit_logs` → toast.
- Enterprise-clean, reusable, no band-aids; build-new → delete-legacy.

---

## 14. Minimum E2E coverage (`scripts/e2e/suites/…`)

- Management shows only management roles; Staff shows only staff roles; All shows every
  categorized role.
- System and Custom Source filters combine correctly with Category filters.
- Existing uncategorized custom roles appear under **Needs Categorization**.
- Creating a role **requires** a category; creating from Management **preselects** Management.
- Reassigning a role moves it between category lists **without** altering members or capabilities.
- Capability search still reaches **every** module.
- Superadmin remains immutable.
- Category mutations produce `app_events` + `audit_logs` records.
- Empty categories render a proper empty state.
- Browser back/forward restores directory filters + selection (URL state).

---

## 15. Out of scope

- Editing the capability catalogue (adding/removing permission keys).
- Per-user overrides (the separate **User Access** page).
- Per-module (HR/Finance) scoping of the role list — this is tier/category grouping.

---

**Final model:** Category = organizational tier · Source = system/custom · Module = capability
grouping. Keeping these three separate keeps the access-control model unambiguous.
