# Shared Work Calendar (F-CAL) — Admin UI Release Evidence

**Final status:** Live-verified (backend) · Implemented + unit/component-verified (UI) · Regression-verified pending combined merge · Browser QA = operator gate
**Branch/commit:** `codex/payroll-policy-setup` / base `cd7a94c0` → this commit
**Database target:** Supabase `gaflqcwcrvnusnlghwej` (migrations `20260919000700/701` already applied; unchanged by this slice)
**Server origin and CWD:** codex worktree `C:/Users/MSI Laptop/.codex/worktrees/3977/Siomac`; functions dev server on `:8894` (main's `:8888` untouched)
**Evidence timestamp:** 2026-07-20

## 1. Scope and traceability

- Approved contract: `docs/module-contracts/shared-work-calendar-delivery-contract.md` (Rev 5)
- E2E matrix: `docs/module-contracts/shared-work-calendar-e2e-matrix.md` (Rev 5)
- In-scope journeys: holiday-set directory + version editor (provenance-complete rows, copy→correct→publish), work-calendar pattern editor (no preselected weekdays, fractions, published-holiday picker, copy→correct→publish), org/pay-group assignment editor (end/cancel), resolve preview (path + names + checksums + working-day evidence).
- Accepted deferrals: maker-checker for calendar admin, attendance/leave/roster consumers, location scope, non-TT seed datasets (per contract §2).
- Authenticated browser QA (contract §14 gate 7 / DEC-CAL-012): **operator gate — pending** (passkey login; agent cannot authenticate).

## 2. Change inventory

| File | Status | Purpose |
|---|---|---|
| `netlify/functions/lib/hr/workCalendar.ts` | modified | Enrich `resolve` read with resolved names + working-day evidence (contract §9.4, UT-CAL-U6); **fail-closed** — every enrichment read checked, no swallowed errors, no faked zero count. |
| `types/workCalendars.ts` | new | Shared camelCase DTOs (BE↔FE contract). |
| `src/api/hr/workCalendars.ts` | new | TanStack Query hooks + caller-idempotent command functions. |
| `src/components/sections/Finance/payroll/setup/WorkCalendarSetup.tsx` | new | Admin console (directory/detail/editors/pickers/resolve) + `WorkCalendarPage` wrapper. |
| `src/components/sections/Finance/payroll/setup/workCalendarRules.ts` | new | Pure validation/shaping rules (provenance, pattern, window, period, friendly errors). |
| `src/components/sections/Finance/payroll/setup/workCalendar.css` | new | Scoped `.wcal` styles. |
| `src/components/sections/Finance/payroll/setup/workCalendarRules.test.ts` | new | Unit tests for the rules (UT-CAL-U2/U3/U5 logic). |
| `src/components/sections/Finance/payroll/setup/WorkCalendarSetup.test.tsx` | new | Mounted component tests (UT-CAL-U1/U3/U4/U5/U6/U7/U8). |
| `src/components/sections/Finance/PayrollSetupOverview.tsx` | modified | Work Calendar tab (finance-admin shortcut), independently permission-gated. |
| `src/components/sections/HR/module.ts` | modified | Primary HR nav entry `s-hr-work-calendar`, per-item gated on `hr.work_calendar.view`. |
| `src/components/sections/HR/HRSection.tsx` | modified | Route the HR nav id to `WorkCalendarPage`. |

- Base SHA: `cd7a94c0`
- Concurrent changes reconciled: none (migrations/backend routes unchanged from `34ec52a1`).

## 3. Post-review P0 remediation (this slice)

| Finding | Resolution |
|---|---|
| P0-1 swallowed enrichment errors / faked zero count | `resolveWorkCalendar` now checks all four reads (`work_calendar_versions`, `holiday_calendar_versions`, `finance_pay_groups`, `work_calendar_working_days`) and throws on error/missing; fabricated `{count:'0'}` fallback removed. |
| P0-2 unreachable for HR managers (Finance module = admin/superadmin only) | Added HR nav entry gated on `hr.work_calendar.view`; Payroll Setup tab kept as a finance-admin shortcut. |
| P0-3 copy→correct→publish workflow missing | `Copy To Draft` (`copy_version`) wired on published/superseded holiday **and** work-calendar versions. |
| P0-4 no frontend tests | 29 tests added (rules + mounted component), covering UT-CAL-U1..U8. |

## 4. UX / states evidence (unit + component)

UT-CAL-U1 directory (loading/skeleton/empty/error/populated) · U2 holiday provenance gating (save disabled until complete) · U3 pattern editor starts with no weekday selected + fraction validation · U4 published-version picker shows name/version/effective range, no raw UUIDs · U5 org/pay-group scope + inline window (`assignmentWindowError`) / overlap (`friendlyError`) copy · U6 resolve preview renders path + resolved names + checksums + working-day evidence (`ResolveResultView`) · U7 permission states (view-only preserves read, hides commands; no view = blocked) · U8 dialog a11y (aria-modal, focus-into-panel, Escape-to-close via `useOverlayA11y`). **Authenticated browser walk of every control across desktop widths + mobile = operator gate, pending.**

## 5. Command evidence

| Gate | Command | Exit | Result |
|---|---|---:|---|
| Backend typecheck | `npm run typecheck:backend` | 0 | clean |
| Frontend typecheck | `npm run typecheck:frontend` | 0 | clean |
| Backend clean build | `npm run build:backend:clean` | 0 | `dist/netlify/functions/api.js` produced |
| Unit + component | `npx vitest run` | 0 | **367 passed** (incl. 29 new F-CAL) |
| Target suite (run 1) | `BASE_URL=http://localhost:8894 npm run test:e2e -- workCalendar` | 0 | **14 passed · 0 failed** · tag `TEST-E2E-1784529050640` |
| Target suite (run 2) | `BASE_URL=http://localhost:8894 npm run test:e2e -- workCalendar` | 0 | **14 passed · 0 failed** · tag `TEST-E2E-1784529118498` |
| Leak check (run 1) | per-tag anchor+side-effect residual query | 0 | **0 residual** |
| Leak check (run 2) | per-tag anchor+side-effect residual query | 0 | **0 residual** |

- Runner exit `0` on both runs ⟹ post-suite orphan sweep passed (it exits `3` on any leak). FK-safe cleanup verified independently at 0 for each run's tag.
- Resolver change exercised live by the passing `resolution: pay_group / split_period / unresolved / jurisdiction` and `working_days` cases; no resolver failures.
- Pre-existing, unrelated: one orphan `finance_pay_groups` row `WCR TEST-E2E-1784523933452` from a prior run (05:05 UTC, different tag) — not produced by these runs.

## 6. Remaining gates before combined release

1. Operator authenticated browser QA (contract §14 gate 7) — desktop widths + mobile, typed overlap/immutable/split-period errors.
2. Route coverage gate + full `npm run test:e2e` regression at the combined F-01 + F-CAL + F-02 → main release gate.
3. F-02 `working_days` integration (separate slice) consumes this calendar.

## 7. Final declaration

- No unexplained P0/P1: the four review P0s are resolved in this slice.
- Backend live-verified twice with clean, FK-safe teardown (0 residual per run).
- UI implemented and unit/component-verified; browser QA remains the operator gate.

Final verdict: **SHIP pending operator browser QA + combined-merge regression.**
