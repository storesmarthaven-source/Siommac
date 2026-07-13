# SIOMAC ERP — Project Migration Summary

> Structured handoff to restore full context in a new session/project. Companion to the
> persistent-memory file `project-statutory-drawer-kpi-uikit.md`. Last updated: session end,
> branch `claude/wonderful-panini-34b331`.

## 1. Project Purpose

**SIOMAC ERP** — an enterprise ERP system for a Trinidad & Tobago organization. Modules: **HR**
(employee master, onboarding/offboarding, attendance, leave), **Finance/Payroll** (statutory
config, pay runs, remittances, disbursements, expenses, budgets), **HSE** (incidents, risk, PTW,
PPE), and a shared **platform backbone** (central workflow engine, notifications, messaging,
tickets, calendar, RBAC, audit).

- **Frontend:** Preact + Vite + TypeScript (`@/`→`src/`, `@ui`, `@lib`, `@api`), TanStack Query,
  `noUncheckedIndexedAccess`.
- **Backend:** Netlify Functions / Hono (POST-only, `requirePermission()`, body = `args ?? body`),
  Supabase (Postgres). `app_users.id` is TEXT.
- **Canonical spec:** "SIOMAC ERP Build-Ready Technical Implementation Specification."
  Orientation map: `docs/REPO_MAP.md`. Page-build standard: `src/ui/PAGE_GUIDE.md`.
- **Current focus:** Finance ▸ Statutory Configuration dashboard polish + promoting patterns into
  the UI kit.

## 2. Custom Instructions (project non-negotiables — from `CLAUDE.md`)

- **No band-aids.** Fix root causes; no accept-and-drop, patch-on-top, swallowed errors, ceremony,
  copy-stale, or assume-don't-verify. Prefer build-new → delete-legacy; reuse over duplication.
- **Feature completeness.** No dead buttons, navigate-only stubs, or one-field dialogs. Every
  control wired to a real endpoint + the §2 backbone (app_events + audit_logs + toast +
  notifications/handoffs where rules require).
- **Testing standard.** Every module ships a live E2E suite (`scripts/e2e/suites/<module>.mjs`)
  asserting endpoints, flows, both access-control paths, response shape, and §2 side-effects.
- **Test cadence.** Use `tsc --noEmit` while iterating; run full suites (E2E/jest/vitest) only once
  at the end. 229+ frontend tests must stay green (currently vitest **272/272**).
- **Worktree rule.** Work ONLY in `…/.claude/worktrees/wonderful-panini-34b331` (branch
  `claude/wonderful-panini-34b331`); never touch the main production copy.
- **Commit messages** end with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
  Commit/push only when asked.
- **Build order** — don't skip phases; dashboards / HSE full-wiring are last.
- **DB naming** — module-prefixed snake_case, `id uuid default gen_random_uuid()`,
  `created_at`/`updated_at`, RLS on every table.
- **Known pitfalls** — `dev:netlify` serves compiled `dist/` (backend changes need `build:backend`
  + restart); supabase-js pinned exactly `2.105.3`; permission keys must match the catalogue
  exactly.
- **User working style** — extremely pixel-precise (pastes exact CSS to apply verbatim), demands
  faithful adoption not reskins, wants UI-kit standards over page-local one-offs, approves
  visualize-tool mockups before builds, and works **without subagents**.

## 3. Work in Progress

**State:** branch `claude/wonderful-panini-34b331`; gates green throughout (typecheck FE+BE,
vitest 272/272). Check `git status` for what's committed.

### Done this session
- `KpiTile` promoted to the UI kit (`@ui`, `.ui-kpi*` in `assets/styles/uikit-layout.css`) as the
  standard **plain** KPI card (icon chip + number + name + sub + optional drill link;
  `variant="text"` for a label value). Distinct from the rich chart cards (`StatsCard` / Aurora
  `KpiCard`, left alone).
- KPI strip = its **own single-row RGL grid** (`finance.statutory.kpis.v2`), NOT on the main board,
  locked to horizontal via new `WidgetBoard`/`WidgetBoardZone` props `maxRows={6}` + `isBounded`
  + `resizable={false}` (RGL has no per-item drag-axis lock — this is the technique).
- Board page keys bumped to `.v2` (`finance.statutory.v2`, `finance.statutory.kpis.v2`) to retire
  stale saved layouts — root cause of the large KPI↔content gap. `--kpi-strip-gap: 18px` token
  (`base.css`) standardizes the KPI-strip→content gap (used by AC `.kpi-row` + statutory
  `.sdb-kpi-board`). Phantom-gap fix: collapsed edit-banner wrapper carries `margin-bottom:-18px`.
- Edit banner (`WidgetBoard`): green `#61ac68`, `grid-template-rows` slide, in-banner **Set as
  default** (dirty-gated, disabled + "Saving…" via `savingDefault`) + **Done**; combines both
  boards' dirty flags; toast fires immediately (background invalidate) + 8s undo window.
- **`resolveEmployees` root fix** (`netlify/functions/lib/finance/lookups.ts`) — no more raw UUIDs
  shown as names: `full_name → "first last" → email-local → "Unknown"`.
- **Rate Version drawer fully redesigned** (`.svd-*`, purpose-built — NOT the employee-profile
  layout): document header + status Pill, header **Retire** (red), status-aware "in force" ribbon,
  headline rate tiles (kit `.ui-stat-tile`), `PanelTabs`, **Summary = full lifecycle stepper**
  (`SvdRail`: Created→Submitted→Approved→Activated→Retired; done filled+dated, pending hollow;
  Activated falls back to today), config grid, PAYE/HS tile grids, NIS `MiniTable`, History/Timeline
  rails, Audit table. On `<Drawer rich>`.
- `<Drawer rich>` / `.ui-rdrawer` documented as THE standard detail-drawer (navy = future dark mode).
- Shared `Menu` → Lucide icons (no chip) + portalled to `<body>`; `PanelTabs` separator before More.
- `DataTable` rowActions → single ⋮ + portalled dropdown; NIS-Verify inline buttons moved into it.
- Toast countdown merged into the action-band; **Reports tab locked**; **Dark-Mode toggle**
  placeholder in AccountPill.

### Pending / gotchas
- **More ▾ menu may still be hidden** — needs a live devtools check (does a `.ui-menu` element
  appear + where positioned).
- **Two changes need a `dev:netlify` restart** (serves `dist/`): the `resolveEmployees` name fix,
  and the precise Set-as-default org-default dirty check (`getInstanceLayout` now returns raw
  `default` in `routes/uiPrefs.ts`).
- Dark mode / light theme system = future build (navy drawer is the dark look; toggle is a stub).

## 4. Recommended Starting Prompt

Paste this into a fresh session to restore context:

```
I'm resuming the SIOMAC ERP project. Work only in the worktree
C:\Users\MSI Laptop\Desktop\Siomac\.claude\worktrees\wonderful-panini-34b331
(branch claude/wonderful-panini-34b331); never touch the main copy.

First: read CLAUDE.md, docs/REPO_MAP.md, src/ui/PAGE_GUIDE.md, docs/PROJECT_MIGRATION_SUMMARY.md,
and the memory file project-statutory-drawer-kpi-uikit.md (linked at the top of MEMORY.md) — that
is the handoff for where we stopped.

Non-negotiables: no band-aids (root fixes only), full feature-wiring + §2 backbone side-effects,
UI-kit standards over page-local CSS, tsc --noEmit while iterating and full vitest/E2E only at the
end (272 vitest must stay green), work without subagents, and confirm pixel/design choices with a
mockup before building large UI changes.

We've been polishing Finance ▸ Statutory Configuration and standardizing UI-kit pieces. Immediate
next steps: (1) verify the Rate Version drawer's "More ▾" overflow menu actually opens (inspect the
live DOM if not); (2) confirm the resolveEmployees name fix and the Set-as-default org-default
dirty check work after build:backend + a dev:netlify restart. Run npm run typecheck:frontend to
confirm a clean baseline, then tell me what you'd like to tackle.
```
