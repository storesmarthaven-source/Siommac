# F-02 Pay-Policy-to-Run — Operator Browser-QA Checklist (UI-PPR-001..005)

**Status / dependency (READ FIRST):** the surfaces below are **NOT yet built** on `wf/payroll-f02` — they are
F-02 delivery-plan REMAINING item 5. This document is therefore BOTH (a) the **acceptance spec** the build must
satisfy, and (b) the **operator QA procedure** to run once built. The three build prerequisites are:

- **API-PPR-004** — `/payroll/runs/get` (`toRunDto`) enriched to return the pinned `payPolicy` block (+ `workCalendar`
  block when the run is calendar-pinned). *Today `toRunDto` returns neither.*
- **API-PPR-005** — new `/payroll/runs/policy-evidence` route reading `finance_payroll_run_policy_evidence` +
  `finance_payroll_run_calendar_evidence` for a run's `current_input_snapshot_id`, name-resolved (no raw UUID),
  with the `calendar` block. *Today this route does not exist.*
- **UI** — `PayRunDrawer.tsx` pinned-policy chip + work-calendar chip + evidence panel; `PayNewRunWizard.tsx`
  `payGroupId` required + inline typed policy/calendar blocker; vitest **UT-PPR-U1..U5**.

DB/runtime + the live E2E acceptance ARE done and passing the disposable-DB gate is their proof. **This browser
gate runs AFTER those are built and AFTER the disposable-DB gate + shared-dev apply (sequence §9).**

---

## 1. Required operator accounts + permissions

Provision (or reuse) two REAL users — passkey login is operator-only, which is why this gate is not agent-automatable:

| Role in QA | App role | Permission keys needed | Used for |
|---|---|---|---|
| **Payroll operator** | `finance_manager` | `finance.payroll.run.manage` **and** `finance.payroll.view_all` | create/lock/calc a run; view run detail + evidence |
| **Read-only negative** | `finance_staff` (or a role with neither key) | *lacks* `finance.payroll.run.manage` and `finance.payroll.view_all` | confirm 403 on create + on policy-evidence |

Verify keys match the catalogue EXACTLY (`finance.payroll.run.manage`, `finance.payroll.view_all`). Both users
must have MFA/passkey enrolled (super-admin MFA landmine — do not QA as the superadmin harness account).

## 2. Exact setup data (seed once, via the real F-01/F-CAL routes — never direct table writes)

1. **Pay group** `QA-PPR` (frequency `monthly`, `statutory_country = TT`).
2. **F-01 policy** with **one `working_days` `salary_period` component** + at least one source rule and the
   `cost_centre` costing rule; take it through create-draft → submit → HR approve → Finance approve → **activate**
   → **assign** to `QA-PPR` covering the whole test period. (This makes the run **calendar-pinned** so UI-PPR-004/005 apply.)
3. **F-CAL** published holiday set (TT) + published work calendar (working weekdays Mon–Fri) **assigned** to `QA-PPR`
   over the test period.
4. **≥3 salaried employees** assigned to `QA-PPR`; give **one** employee a mid-period `start_date` (partial
   employment → `numerator < denominator`) and set each employee's required sources so lock succeeds.
5. Create ONE run scoped to `QA-PPR` for a period the calendar covers → **lock-inputs** → **calculate** (so policy
   evidence + per-employee calendar evidence exist for UI-PPR-002/005). Record the `runId` as `QA_RUN`.
6. Note the DB values to check against (service-role query, read-only):
   - `select pay_policy_version_id, pay_policy_checksum, work_calendar_version_id, holiday_calendar_checksum, calendar_resolution from finance_payroll_runs where id = '<QA_RUN>';`
   - `select checksum, manifest from finance_payroll_run_policy_evidence where run_id = '<QA_RUN>';`
   - `select employee_id, numerator, period_denominator, clamp_from, clamp_to from finance_payroll_run_calendar_evidence where run_id = '<QA_RUN>';`

## 3. URLs / navigation

- App base: shared **dev** deployment (the env 711 was applied to per sequence §9), authenticated.
- **Run detail**: Finance → Payroll → Runs → open `QA_RUN` (`PayRunDrawer`).
- **Create run**: Finance → Payroll → Runs → **New Run** (`PayNewRunWizard`).
- Perform every visual check at a **supported desktop width AND a mobile width** (responsive requirement §12).

## 4. UI-PPR checks — actions + expected results

| ID | Surface | Operator action | Expected result (acceptance) |
|---|---|---|---|
| **UI-PPR-001** | Run detail — **pinned-policy chip** | Open `QA_RUN` | Chip shows **policy name + version no + SHORT checksum** (first ~8 of `pay_policy_checksum`). Values match `finance_payroll_runs.pay_policy_version_id`/`pay_policy_checksum`. No raw UUID. |
| **UI-PPR-002** | Run detail — **policy-evidence panel** | Open the evidence panel | Renders the manifest **components[], sourceRules[], costingRules[]** + statutory block, with a checksum matching `finance_payroll_run_policy_evidence.checksum`. Loading + empty + error states behave. |
| **UI-PPR-004** | Run detail — **work-calendar chip** | Same run (working_days-pinned) | Chip shows **calendar name + version + SHORT holiday checksum + resolution scope**; matches `work_calendar_version_id`/`holiday_calendar_checksum`/`calendar_resolution.scope`. **On a non-working_days run the chip is HIDDEN** (verify with a second, non-working_days run). |
| **UI-PPR-005** | Run detail — **working-days evidence rows** | Evidence panel → calendar section | One row per working_days employee: **numerator / denominator / period / excluded-count**, **names resolved (no raw UUID)**. The partial-employment employee shows `numerator < denominator`; a fully-employed one shows `numerator == denominator`. Values match `finance_payroll_run_calendar_evidence`. |
| **UI-PPR-003** | Create-run — **typed blockers** | See §6 | Inline, per-field typed reason; submit disabled/blocked; NO run row created. |

## 5. Chip value spot-checks (record actual vs expected)

| Field | Expected source | Actual (operator fills) |
|---|---|---|
| Policy name / version | F-01 policy + `version_no` | |
| Policy short checksum | first 8 of `pay_policy_checksum` | |
| Calendar name / version | F-CAL calendar + version | |
| Holiday short checksum | first 8 of `holiday_calendar_checksum` | |
| Resolution scope | `calendar_resolution.scope` (`pay_group`/org default) | |
| Period denominator (panel) | `calendar_resolution.periodDenominator` | |

## 6. Typed create-run blockers (UI-PPR-003) — must show the exact code inline, NO run row created

Drive each in `PayNewRunWizard`; confirm the inline typed reason **and** that `finance_payroll_runs` gains no row.

| Trigger | Expected typed reason | HTTP |
|---|---|---|
| Submit with **no pay group** | `policy.pay_group_required` | 422 |
| Pay group with **no active policy** covering the period | `policy.missing` | 422 |
| (defensive) >1 covering active policy | `policy.ambiguous` | 409 |
| working_days policy, pay group **no covering calendar** | `calendar.unresolved` | 422 |
| working_days policy, **two adjacent** calendars (neither covers) | `calendar.split_period` | 422 |
| working_days policy, **non-TT holiday-set** calendar | `calendar.jurisdiction_mismatch` | 422 |
| working_days policy, **all-non-working** period | `calendar.zero_working_days` | 422 |

(These map to E2E-PPR-006b/003/007-neg/034/035/037/038 — already proven backend-side in `payrollPayPolicyRun.mjs`
T12; this gate proves the UI surfaces the typed reason inline.)

## 7. Network + DB evidence to capture (per run detail load)

- **Network:** `runs/get` response contains the `payPolicy` block (and `workCalendar` block for the pinned run);
  `runs/policy-evidence` returns `{components,sourceRules,costingRules,statutory,calendar{...,employees[]}}` with
  **no raw UUIDs**. Read-only negative user → **403** on both `runs/create` and `runs/policy-evidence`.
- **DB (service-role, read-only):** the three queries in §2.6 — confirm the chip/panel values equal the pinned
  columns + evidence rows exactly; confirm each failed create in §6 left **zero** new `finance_payroll_runs` rows.

## 8. Required screenshots (attach to release evidence)

1. Pinned-policy chip (UI-PPR-001) — desktop + mobile.
2. Work-calendar chip (UI-PPR-004) — and one showing it **hidden** on a non-working_days run.
3. Policy-evidence panel (UI-PPR-002) with component/source/costing arrays.
4. Working-days evidence rows (UI-PPR-005) incl. the partial-employment `numerator<denominator` row.
5. Each typed create-run blocker inline (UI-PPR-003) — at minimum `policy.pay_group_required`, `policy.missing`,
   `calendar.unresolved`, `calendar.zero_working_days`.
6. The 403 for the read-only negative user on `runs/policy-evidence`.

## 9. Sequence (where this gate sits)

1. Disposable-DB gate green (focused suite ×2 + 8 legacy suites + regression).
2. Apply 711 to shared **dev** + rebuild backend/frontend + restart the server.
3. **Build** API-PPR-004/005 + the UI-PPR-001..005 surfaces + UT-PPR-U1..U5 (this checklist is their acceptance).
4. **Run this browser QA** on shared dev.
5. Enable (un-feature-gate) the Pay-Policy UI **only after** both the regression gate AND this browser gate pass.
6. Merge F-01/F-CAL/F-02.

## 10. Cleanup

Delete in FK-safe order: `QA_RUN` (+ its findings/lines/warnings/calc versions/evidence/snapshots/inputs) →
work-calendar assignment (cancel via F-CAL route) → policy assignment + policy → pay group + employee source rows →
QA users. Leave no orphan `finance_payroll_run_policy_evidence` / `finance_payroll_run_calendar_evidence` rows.

## 11. Pass/Fail sign-off

| Check | Pass/Fail | Operator | Date | Env | Browser + width | Notes / screenshot ref |
|---|---|---|---|---|---|---|
| UI-PPR-001 pinned-policy chip | | | | | | |
| UI-PPR-002 policy-evidence panel | | | | | | |
| UI-PPR-004 work-calendar chip (shown + hidden) | | | | | | |
| UI-PPR-005 working-days evidence rows | | | | | | |
| UI-PPR-003 blocker: policy.pay_group_required | | | | | | |
| UI-PPR-003 blocker: policy.missing | | | | | | |
| UI-PPR-003 blocker: calendar.unresolved | | | | | | |
| UI-PPR-003 blocker: calendar.split_period | | | | | | |
| UI-PPR-003 blocker: calendar.jurisdiction_mismatch | | | | | | |
| UI-PPR-003 blocker: calendar.zero_working_days | | | | | | |
| Access-control 403 (read-only user) create + evidence | | | | | | |
| Mobile-width render (chips + panel) | | | | | | |

**Gate result (all rows must Pass):** ☐ PASS ☐ FAIL — operator: __________ date: __________
