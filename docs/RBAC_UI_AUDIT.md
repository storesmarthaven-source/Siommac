# RBAC UI Audit — Roles · Modules · Permissions

Goal: the current access-control interface is confusing. This audits the three RBAC tabs in
the Superadmin Console and proposes one coherent interface to build.

## Current interface
Three separate Console tabs, all presenting "capabilities grouped by Module → Group":

| Tab | Subject | Editable? | What it does |
|---|---|---|---|
| **Roles** | a role | yes | Edit a role's DEFAULT capability set; create/delete custom roles. |
| **Modules** | (all) | no (read-only, just rebuilt) | Rollup of module × role coverage. |
| **Permissions** | a user | yes | Grant/deny/clear per-user capability OVERRIDES; filters (module/search/risk). |

Effective access resolves as: **user override → role default → deny.**

## Why it's confusing
- **C1 — Three tabs, one concept.** Roles, Modules, and Permissions are three views of the
  same thing (capabilities per module). Nothing tells you *which tab to use for which job*;
  you must already understand the RBAC model to navigate. There's no "Access Control" home.
- **C2 — The same editor is duplicated, split only by subject.** Roles and Permissions are
  the identical Module → Group → capability list, differing only in role-vs-user. Two places
  to learn and maintain; easy to edit the wrong subject.
- **C3 — The resolution is invisible.** The Permissions tab edits overrides but never shows
  the role-default baseline beside them, so "why can this user do X — their role, or an
  override?" can't be answered in one place. This is the single biggest source of confusion.
- **C4 — "Modules" is ambiguous and its description is stale.** Post-rebuild it's a read-only
  rollup, but the tab still reads "control which modules are visible… changes take effect at
  next login." The word also collides with sidebar-modules and settings-modules.
- **C5 — No subject overview.** You pick a role/user then scroll a long flat capability list —
  no summary (total, high-risk grants, # overrides) to orient first.
- **C6 — Terminology drift.** module / permission / capability / group / role are used
  loosely; even PERMISSION_META's own module labels are inconsistent (`auth` vs `System`,
  `Workflow` vs `Workflows`).

## Proposed interface — one "Access Control" area (subject-first)
Consolidate to a clear model: **overview to orient → pick a subject → one shared editor.**

1. **Overview** (landing) — the module × role coverage rollup (read-only). Answers "who can
   touch what" at a glance. Click a cell → drill into that role's capabilities for that module.
2. **Roles** — left: role list (member count, system/custom badge). Right: a summary header
   (total capabilities · high-risk count) + the shared capability editor. Editing sets the
   role DEFAULT.
3. **Users** (rename "Permissions") — left: user list (role, # overrides). Right: the shared
   editor showing, per capability, the **role-default baseline**, the **override**, and the
   **effective result**, with a source badge (`Role default` / `Override`) and one-click
   *reset to role default*. Filters retained.

**Shared building blocks (kill the duplication):**
- One `CapabilityList` (Module → Group → rows), `mode = role | user`. In `user` mode each row
  shows baseline + override + a source badge; in `role` mode a single default toggle.
- One `SubjectSummary` header (counts · high-risk · overrides).
- Critical capabilities flagged inline (they route through the existing Approvals maker-checker).
- Cross-links: Role editor → "N users have this role"; User editor → "Role: X — changes here
  create an override, not a role change."

**Terminology (standardise):** **Module** = area (HR, Finance…) · **Group** = capabilities
within a module · **Capability** = one action ("Approve statutory version") · **Role** = a
named default capability set · **Override** = a per-user exception. Prefer "capability" over
"permission" in the UI. Normalise the PERMISSION_META module labels at source.

## Build plan (phased, after design sign-off)
1. Extract the shared `CapabilityList` + `SubjectSummary` from the duplicated Roles/Permissions widgets.
2. Rebuild **Users** (ex-Permissions): baseline + override + effective, source badges, reset.
3. Make **Modules → Overview** the landing view; fix the stale description; add cell drill-through.
4. Add the subject summary headers to Roles + Users.
5. Normalise PERMISSION_META module labels at source (fixes the duplicate/case cards).
