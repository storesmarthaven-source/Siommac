# F-02 Pay-Policy-to-Run — branch ancestry & coherent-stack merge plan

**Branch:** `wf/payroll-f02` · **HEAD:** `5bacd61d` (chore index) / `2902047a` (feat: full-page run
workspace) · **Verified:** 2026-07-20 (read-only `git` inspection; main NOT touched).

This records the verified ancestry so the eventual merge to `main` lands the whole stack — **F-01
pay-policy + F-CAL work-calendar + F-02 backend + migrations + tests + UI** — as one coherent unit, and
flags the one real merge hazard (Calendar-module divergence). **Do not merge/rebase/alter `main` until the
operator disposable-DB gate is available.**

## 1. Base & scope
- **merge-base(`main`, `wf/payroll-f02`) = `f4659c3f`** (`fix(compliance): reliable post-commit delivery…`).
- **`main` tip = `5884522a`** (`fix(tickets): unread badge…`) at time of writing — main has advanced past the
  merge-base independently.
- **30 commits** on `wf/payroll-f02` not in `main` (`git rev-list --count main..wf/payroll-f02` = 30). The
  branch is a **single linear stack**: F-01 → F-CAL → F-02 backend → F-02 UI. F-01
  (`codex/payroll-policy-setup`) **is an ancestor** of the branch (`--is-ancestor` = 0) and is **not on main**
  — so F-01 rides in with this branch automatically. No separate F-01 merge is needed.

## 2. The stack, by layer (bottom → top)
- **F-01 pay-policy setup** (~10): `3a91afd0` contract · `a8087e5c` feat setup · `11fab9a9` · `7064b055` ·
  `e2265596` · `41bdd2b2` · `1c264014` · `f24b95f7` grants · `490bf6af` harden RPCs · `cd7a94c0`.
- **F-CAL shared work calendar** (~5): `34ec52a1` mig/backend/E2E · `1dcd6694` admin UI · `45601299` calendar
  workspace · `9d659d9f` · `3c917002` index. ⚠ **see §4 — overlaps main's own Calendar lineage.**
- **F-02 backend** (~13): `aa1fbf5d`/`5e25a8ba` contract Rev 4/4.1 · `b9c77b8a` **mig 710** (pins + evidence
  tables) · `b814ae1c` · `227876a6`/`99b769bf` **mig 711** (create/lock/calc/publish RPCs) · `141c854f`
  RPC+TS enforcement · `f7c94c31` fixture + 8 legacy conversions + acceptance suite · `53668086` gate doc ·
  `3af75849` · `efc4bf43` calendar-failure E2E · `10df90f2` browser-QA checklist · `6bafc544` **API-PPR-004**.
- **F-02 UI** (top, this session): `2902047a` full-page run workspace + **API-PPR-005** + wizard blockers +
  drawer retirement + E2E T13/T14 + vitest UT-PPR · `5bacd61d` index.

## 3. Migrations the merge introduces to `main` (apply IN THIS ORDER, after the gate)
| mig | on branch | on main | note |
|---|---|---|---|
| `…600_finance_pay_policy_setup` (F-01) | yes | **NO** | apply |
| `…700_shared_work_calendar` (F-CAL) | yes | **yes (byte-identical)** | already on main — no re-apply |
| `…710_finance_pay_policy_run_pin` (F-02) | yes | **NO** | apply |
| `…711_finance_pay_policy_run_rpc` (F-02) | yes | **NO** | apply |

`git diff main wf/payroll-f02 -- …700….sql` is **empty** → F-CAL's DB migration is identical on both sides;
`git diff --name-only --diff-filter=A main wf/payroll-f02 -- supabase/migrations/` lists only **600, 710, 711**
as new. So only three migrations land; 711 is the one that changes `create_run_tx` **unconditionally**
(DEC-PPR-008) and breaks the 8 policy-less-run suites until the whole stack is coordinated — hence the gate.

## 4. ⚠ THE MERGE HAZARD — F-CAL / Calendar module divergence (must reconcile, do NOT regress main)
F-CAL was built on **two independent lineages**: the branch's (`34ec52a1`, **not** on main) and main's
(`wf/fcal-calendar` `1b3d7102`, an ancestor of main but **not** of the branch). mig 700 is identical, but
**main has advanced the broader Calendar module past the branch's snapshot.** `git diff --stat main
wf/payroll-f02` on calendar paths shows main-only content the branch lacks (all-minus = present on main,
absent on branch):
- `supabase/migrations/…358_calendar_reminders_and_attendee_responses.sql` (**main-only**, 483 lines)
- `netlify/functions/lib/calendarReminderSweep.ts` (main-only) · `netlify/functions/calendar-reminder-sweep.ts`
- `netlify/functions/routes/calendar.ts` · `scripts/e2e/suites/calendar.mjs` · `src/api/calendar.ts`
- `src/components/sections/Calendar/{CalendarItemDialog.tsx,CalendarItemDialog.test.tsx,calendar.css}`
- `types/calendar.ts` · `docs/PAYROLL_WORK_CALENDAR_UI_RELEASE_EVIDENCE.md`

**Implication:** a 3-way merge (base `f4659c3f` had neither lineage's calendar) will conflict on these
Calendar files. **Resolve in favour of main's newer Calendar state** (keep the reminders/attendee-responses
migration + calendarReminderSweep + the newer calendar workspace). **F-02 does NOT depend on any of these** —
it consumes only `work_calendar_resolve` / `work_calendar_working_days` (in the identical mig 700), so taking
main's Calendar side is safe for F-02. Do **not** let the merge delete main's `…358…` migration or the sweep.

Recommended mechanic when the gate day comes: rather than a raw `merge`, consider **rebasing the F-02-only
commits onto a main that already has F-CAL**, or a merge that explicitly `-X ours`/manual-resolves the Calendar
paths to main — verify `calendar.mjs` + Calendar vitest stay green afterward.

## 5. Coherent-stack merge checklist (blocked on the OPERATOR gate — do not start early)
1. Operator disposable-DB gate: apply F-01 + F-CAL + 710 + 711 to a disposable DB, reload PostgREST, run the
   focused `payrollPayPolicyRun` suite ×2 + the 8 converted legacy suites + combined regression. Fix real
   failures at source. (No Docker/psql/DB in the agent env — operator-run.)
2. Only when green: apply **600, 710, 711** to the shared dev DB (700 already present), reload PostgREST.
3. Browser QA (passkey-gated, operator): verify the full-page run workspace vs `mockups/payroll-enterprise/
   run.html` per `…-browser-qa-checklist.md` — every tab, chips, evidence panel, wizard blockers, lifecycle
   actions.
4. Un-feature-gate the Pay-Policy UI (F-01 item 9).
5. Merge `wf/payroll-f02` → `main`, resolving the §4 Calendar conflicts in main's favour; re-run FULL
   `npm run test:e2e` + vitest + `npm run typecheck` + payroll-contract-gate + coverage-gate.

## 6. Current branch state (green, committed, not pushed)
typecheck (BE+FE) 0 · vitest 390 · payroll-contract-gate PASS · coverage-gate 0 new gaps. Committed to
`wf/payroll-f02`; **not** on main; **not** pushed. `--no-verify` used for pre-existing eslint debt in
`payrollRuns.ts` / `PayrollCommandCenter.tsx` / `loadingGate.test.tsx` (new code is clean).
