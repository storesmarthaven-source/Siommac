# RBAC — Modules · Permissions · Roles Audit

Triggered by two reported bugs: "failed to set permission" for a Finance Manager, and
"modules are not added to the settings." Verified against the live DB + code, 2026-07-10.

## F1 — CRITICAL (root cause of "failed to set permission") — FIXED in source
`user_permissions` and `role_permissions` each carry a CHECK constraint
`*_key_format CHECK (permission ~ '^[a-z_]+\.[a-z_]+$')` — it only accepts **two**
dot-separated segments. **348** of the current catalogue keys have 3–5 segments
(`finance.statutory.approve`, `finance.payroll.nis.verify`,
`hr.attendance.timesheets.view`, `communications.messages.download_attachment`, …), so
every attempt to grant/deny one as a per-user override (or a role grant) fails with
SQLSTATE 23514 and the route returns `"Failed to set permission."`

Fix: widened both regexes to `^[a-z_]+(\.[a-z_]+)+$` (2+ segments).
- Source corrected: `supabase/phase8-user-permissions.sql`, `supabase/phase12-roles.sql`.
- **Operator action:** run `supabase/apply-permission-key-format-fix.sql` in the Supabase
  SQL editor (drops + re-adds both constraints; idempotent). No app deploy needed.

## F2 — HIGH (root cause of "modules not added to settings") — needs a decision
The Console **Modules** tab (`ModulesTab.tsx`) hard-codes a `MODULES` list of only **5**
legacy modules: `dashboard, employees, attendance, payroll, live_map`. The three module
lists in the app disagree:

| Source | Modules |
|---|---|
| `ModuleKey` type (`superadminApi.ts`) | dashboard, employees, payroll, live_map, attendance, **hse, hr, finance, operations** |
| Console `MODULES` UI list | dashboard, employees, attendance, payroll, live_map |
| `module_permissions` DB (distinct) | dashboard, employees, attendance, payroll, live_map, **hse** |

So HSE / HR / Finance / Operations cannot be toggled per role/manager in the Console, and
hr/finance/operations aren't in the `module_permissions` table at all.

**Why:** the module matrix is a **legacy coarse on/off** system built for the original 5
modules. The ERP modules built since (HSE, HR, Finance) gate access through the
**permission catalogue** (`requirePermission('finance.statutory.view')`, etc.) — a
finer-grained, per-capability model — not the coarse matrix. The Console tab was never
brought forward.

**Decision needed** before fixing (it's a model choice, not a list edit):
- **(A) Retire the legacy matrix** and make the Console "Modules" tab a read-only rollup of
  the catalogue (each module = its capability group), so module access is governed by one
  system (the catalogue) end to end. Recommended — no dual authority.
- **(B) Extend the coarse matrix** to all 9 modules (add hse/hr/finance/operations to the
  `MODULES` UI + seed `module_permissions` + wire the sidebar to honour it). Keeps two
  overlapping access systems (coarse matrix + fine catalogue) — risks drift and the
  "which one wins" ambiguity.

## F3 — MEDIUM — `module_permissions` DB drift
The DB has `hse` seeded but not `hr/finance/operations`, and the UI lists neither. Resolves
naturally under F2 (A) or (B).

## F4 — Roles: OK
All expected roles exist in the `roles` table: `admin, employee, finance_manager,
finance_staff, hr_manager, hr_staff, hse_staff, manager, superadmin`. The finance roles
carry the correct catalogue keys (`finance.statutory.approve` etc. — verified earlier).
Minor: `admin`, `manager`, `hr_manager`, `hr_staff`, `hse_staff` are `is_system=false`
while the finance roles are `is_system=true` — cosmetic inconsistency, not a functional gap.

## F5 — Catalogue drift: guarded
Enforced-key ↔ catalogue drift is covered by `src/lib/permissions.test.ts` (build-failing
drift guard); the frontend suite is green. No uncatalogued enforced key.

## Priority
1. **F1** — apply the SQL (unblocks all permission grants). ← do first.
2. **F2** — pick (A) or (B); (A) recommended. Then F3 falls out of it.
3. F4 cosmetic; F5 already guarded.
