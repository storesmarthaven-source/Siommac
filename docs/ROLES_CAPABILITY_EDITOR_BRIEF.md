# Roles — Capability Editor: Layout, Features & Capabilities Brief

Purpose of this doc: hand to a planning agent (Codex) to produce an implementation plan.
It describes the DESIRED end-state and the REAL data available. **Do not invent data or
fields** — anything not listed under "Data we have" must be added to the backend first or
left out.

Page: `src/components/sections/AccessControl/pages/AcRolesPage.tsx`
Styles: `src/components/sections/AccessControl/accessControl.css` (`.acx .rl2-*`)

---

## 1. Goal

Let a superadmin **review and change what a role can do** without drowning in ~423
capabilities across 16 modules. Optimise for: (a) quickly seeing the current state of a
role, (b) finding a capability fast, (c) changing many capabilities safely, (d) never
letting a role-wide change land without an explicit, reviewed commit.

Success = an admin can confidently answer "what can this role do, and what changed?" and
make a batch of edits in under a minute.

---

## 2. Data we have (authoritative — build only on these)

- **`PERMISSION_KEYS`** (`src/lib/permissions.ts`) — the full flat list of capability keys
  (~423). This is the catalogue.
- **`PERMISSION_META[key]`** (`src/lib/permissionMeta.ts`) — per key:
  - `module` (top-level group, e.g. `HR`, `Payroll`, `Finance`, `HSE`, `Settings`…)
  - `group` (sub-group within the module, e.g. `Incidents`, `Permit to Work`)
  - `risk`: `'low' | 'medium' | 'high' | 'critical'`
  - `label` (human name) · `description` (one sentence)
- **`CRITICAL_GRANT_KEYS`** — the subset that requires **maker-checker** approval to
  ENABLE (a second superadmin must approve). Enabling one does NOT apply immediately.
- **`role_permissions`** table — the set of capability keys **granted** to a role.
  A role only ever GRANTS or doesn't — there is **no per-role deny / restricted / inherit**.
- **Roles** (`useRoles` → `RoleRow`): `name`, `label`, `description`, `isSystem`,
  `userCount`. `superadmin` is all-on and **immutable** (read-only).
- **Audit** (`activity_logs`, via `useAuditLogs`): role changes are logged as
  `role_perm_grant` / `role_perm_revoke`, `entity_id = roleName`,
  `details = { permission, granted }`, plus actor + `created_at`. → gives per-capability
  **last-changed date + actor** and the role's overall last-updated.
- Hooks: `useRoles`, `useRolePermissions(role)`, `useSetRolePermission()`,
  `setRolePermissionWithReasonApi()` (critical grants), `usePermissionApprovals('pending')`.

### Data we do NOT have (must not fabricate)
- Per-role deny/restricted/inherit states (only grant-or-not).
- Per-capability "applies to" scope, free-text notes, or multi-bullet "what this allows"
  (only the single `description`).
- A capability "status" (active/deprecated) concept.
- Live cross-role grant sets without querying each role (`ROLE_PERMISSIONS` static defaults
  exist but may be stale vs the DB — treat as approximate only).

---

## 3. Layout (master-detail, current shell to keep)

```
┌ Roles ───────────────────────────────────────────── [ + New Role ] ┐
│ ┌ LEFT RAIL (320px) ┐  ┌ RIGHT — role detail ─────────────────────┐ │
│ │ search roles      │  │ HEADER: icon · name · System/Custom ·    │ │
│ │ [System][Custom]  │  │   description · "N users assigned" ·      │ │
│ │ • Admin      12   │  │   [Role details]                          │ │
│ │ • HR Manager 42 ◀ │  │ ────────────────────────────────────────  │ │
│ │ • Finance…        │  │ EDITOR (see §4)                            │ │
│ └───────────────────┘  └───────────────────────────────────────────┘ │
│                        [ floating save bar when there are edits ]     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Left rail** and **role header** stay (liked). First role auto-selects.
- The **editor** is the part to get right (§4). The floating buffered save bar stays.

---

## 4. Editor — chosen direction: "one module at a time"

Toolbar → module menu → capability panel.

- **Toolbar**: global **Search all capabilities** (switches the panel to grouped
  cross-module results) + a compact summary (`312/423 enabled · 8 high-risk`).
- **Module menu** (left, ~220px): every module row = icon · name · `enabled/total` ·
  a red **high-risk dot** if a critical is enabled. Selecting one shows only that module.
- **Capability panel** (right): the selected module's capabilities as **toggle rows**:
  - `label` + `description`, a **risk pill** (low/med/high/critical), a subtle
    **last-changed date** (from audit), and the **toggle**.
  - Critical capabilities carry an "Approval" flag.
  - Panel header: `Module · N capabilities` + **Enable all / Disable all** (bulk-enable
    skips criticals; they must go through maker-checker individually).
- **Search mode**: panel shows `N results for "…"` grouped by module header, same rows.

Everything is **buffered**: toggles collect locally; a **floating action bar** shows
`N pending · affects M members` with **Discard / Save**. Save applies each change; enabling
a critical opens the **maker-checker reason dialog** and routes to approval instead.

States: loading, empty (`No capabilities match`), superadmin read-only (all-on, toggles
disabled), dirty-row highlight.

---

## 5. Features (what the editor must do)

1. Select a role from the rail → see its full state.
2. Navigate module-by-module (never more than one module in view).
3. Search across all capabilities (grouped results) and toggle from there.
4. Toggle a single capability (buffered).
5. Bulk **Enable all / Disable all** per module.
6. **Buffered save** with impact ("affects N members") + Discard.
7. **Maker-checker** for enabling critical capabilities (reason → approval; segregation of
   duties enforced server-side: creator ≠ approver).
8. Per-capability **last-changed** (date + who) from audit.
9. New Role / Role details open the create-edit wizard.
10. Superadmin is read-only.
11. Every mutation emits `app_events` + `audit_logs` (already wired via the set-role-perm
    route) and raises a toast.

---

## 6. Ideas to make it EASIER (for Codex to evaluate / plan)

These are the levers to reduce effort — Codex should assess feasibility against §2 and
propose which to include:

- **Group-level toggles.** `PERMISSION_META.group` exists — offer Enable/Disable per
  sub-group inside a module, not just per module and per capability.
- **Per-module presets.** "View-only" (enable the low-risk/view caps) / "Full" quick sets.
- **Diff-before-save.** A review step listing exactly what will change (added ✓ / removed ✗,
  counts, which need approval) before committing — safer for role-wide edits.
- **Clone from role.** New custom role starts by copying an existing role's grant set.
- **Compare with another role.** Side-by-side to see how this role differs (needs live
  cross-role perms — a per-role fetch; call out the cost).
- **Bulk by risk.** e.g. "disable all critical", "enable all low-risk in this module".
- **High-risk lens.** A quick filter/tab to show only critical/high capabilities for review.
- **Least-privilege hints.** Flag capabilities enabled here that peers of the same tier
  don't have (advisory only).
- **Keyboard + sticky headers** for fast scanning of a large module.
- **Persist last-open role/module** so re-entry lands where you left off.

---

## 7. Non-negotiables / constraints

- No fabricated data — only the fields in §2. Anything richer needs a backend change first.
- Criticals → maker-checker (central workflow/approvals), creator ≠ approver, enforced
  server-side.
- Role-wide changes must be **explicitly committed** (buffered save), never silent.
- Superadmin immutable.
- §2 backbone: each mutation writes business row → `app_events` → `audit_logs` (+ approval
  when required) → toast.
- Enterprise-clean, reusable, no band-aids; ship with an E2E suite asserting the above.

---

## 8. Out of scope (for this pass)

- Editing the capability catalogue itself (adding/removing permission keys).
- Per-user overrides (that's the separate **User Access** page).
- Members / approvals management panels (may live behind their own tabs later).
