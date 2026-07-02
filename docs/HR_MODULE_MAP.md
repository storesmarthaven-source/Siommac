# HR Module Map — scope, reuse, and build sequence

For planning/Codex. The 17-item HR list is not 17 greenfield builds — in this codebase a
lot already exists (Employee Master + Onboarding are done; there's a reusable case/task/
handoff/blocker/workflow backbone) and several "new" areas already have a **legacy
implementation** you absorb rather than rebuild. This map states, per sub-module: what to
REUSE, what's genuinely NEW, rough size, dependencies, and a phased order so it's tractable.

Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` first — it documents the conventions
every HR sub-module must follow (envelope, camelCase contract, `app_users.id` is TEXT,
permission model, mutation side-effects, no-router nav, widget boards, test cadence).

---

## 0. Already built (items 1–2)

- **Employee Master** — people register, profiles, statutory/payroll readiness, documents
  (in-drawer), change-requests (maker-checker), status history, transfers, audit. Done + E2E-green.
- **Onboarding** — cases, tasks, handoffs, blockers, packages + templates, custom actions,
  communications, timeline, audit, reports, account provisioning. Done + E2E-green (UI styling deferred).

## The reusable HR foundation (build ON this, don't reinvent)

Every remaining sub-module should compose these existing pieces:

| Capability | What exists | Reuse for |
|---|---|---|
| **People backbone** | `app_users` (TEXT id), `supervisor_id`, departments, sites | every module |
| **Case/task/handoff/blocker engine** | `hr_onboarding_*` pattern + `runModuleMutation` + state machine | Offboarding, Disciplinary, Requests, Performance |
| **Central workflow engine** | `workflow_templates/instances`, `startWorkflowByTemplate`, bindings/versions, maker-checker | any approval chain (leave, transfer, disciplinary, benefits) |
| **Change-request (maker-checker)** | `hr_employee_change_requests` + decide/apply | HR Requests, Transfers & Promotions |
| **Handoff model** | `hr_onboarding_handoffs` + `handoff_outbox` + `emitAppEvent` | cross-module (IT/Finance/HSE) from any HR flow |
| **Documents** | `hr_employee_documents` + presigned upload + verify/archive | HR Documents page, Recruitment offers, Offboarding clearance |
| **Settings/policy** | manifest-driven catalog (`*.manifest.ts`) + `resolveSettingValue` | every module's rules (item 17 is per-area manifests, not one build) |
| **Comms + notifications** | notifications/threads/tickets + `emitAppEvent` notification | reminders, approvals, escalations |
| **Orchestration timeline** | `orchestration/timeline/get` (events/audit/handoffs/wf per record) | any record's history tab |
| **Audit** | `writeHrAudit` (throws on failure) | every mutation |
| **UI** | `@ui` design system + widget board + `.obx-*`/`.obw-*`/`.ocw-*` families | every page (see mockup guide) |
| **Reports** | `onboardingReports.ts` shape (catalog → run → audited export) | every module's reporting |

**Legacy already in the app (ABSORB/modernize into the HR module, don't greenfield):**
Leave (`getMyLeaves`/`listAllLeaves`/approve), Attendance (`getLiveAttendance`/daily log/
geo-attendance), Payroll (`payroll.run`/approve/export, hourly rates, statutory readiness),
Departments/Sites (`listDepartments`/`listProjectSites`). These have working backends; the
HR work is to bring them under the HR module + role model + `@ui`, not rewrite them.

---

## The 17 sub-modules — reuse / new / size / priority

Legend — **Size:** S (days), M (~1 week), L (multi-week). **Reuse:** how much existing infra carries it.

### Item 3 — Organization Structure
- **Reuse (high):** departments + sites (legacy), `supervisor_id` hierarchy, `hr.organization.*`/`hr.positions.*` perms already catalogued.
- **New:** Positions/job-titles table + cost centres + locations; an org-tree UI; reporting-line editor.
- **Size:** M · **Priority:** B (absorb legacy + add positions/cost-centres).

### Item 4 — HR Requests
- **Reuse (high):** `hr_employee_change_requests` (maker-checker) + central workflow + notifications.
- **New:** a request *type* registry (profile change, letter, transfer, schedule issue, doc request…) generalising the existing change-request into a self-service Request Center; employee-facing submit UI.
- **Size:** M · **Priority:** A (generalises something that already exists).

### Item 5 — Leave & Absence
- **Reuse (high):** legacy leave backend + central workflow (approvals) + settings (policies) + calendar data.
- **New:** balances/accruals engine, leave-policy manifest, calendar UI, attachment support, HR-manager approval views.
- **Size:** L · **Priority:** B (absorb + modernise; balances are the real new work).

### Item 6 — Attendance & Timekeeping
- **Reuse (high):** legacy geo-attendance (core app feature) + daily logs + device/location data.
- **New:** timesheet review, exceptions/late rules, manager approval queue, attendance-policy manifest.
- **Size:** L · **Priority:** B.

### Item 7 — Shift / Roster Scheduling
- **Reuse (low):** sites/locations, `app_users`, notifications for publish.
- **New:** schedules/shifts/rotations tables, coverage-gap logic, publish workflow, roster UI. Mostly greenfield.
- **Size:** L · **Priority:** C.

### Item 8 — HR Documents
- **Reuse (very high):** `hr_employee_documents` + presigned upload + verify/archive already exist (in the profile drawer).
- **New:** a standalone Documents page (cross-employee list/filter), expiry alerts + renewal reminders (settings + notifications), document-requirement policy.
- **Size:** S–M · **Priority:** A (promote existing backend to a page + add expiry).

### Item 9 — Performance Management
- **Reuse (medium):** case/task engine (review cycles as cases), workflow (approvals), documents (review files), notifications.
- **New:** review templates, KPI/goal tables, probation-review scheduling, feedback/rating capture.
- **Size:** L · **Priority:** C.

### Item 10 — Disciplinary & Grievance
- **Reuse (high):** case/task/blocker engine + workflow (corrective-action approval) + documents (statements/evidence) + audit (sensitive).
- **New:** warning/complaint types, confidentiality/access model, corrective-action tracking.
- **Size:** M–L · **Priority:** C (sensitive — needs careful access model).

### Item 11 — Compensation / Payroll Prep
- **Reuse (high):** legacy payroll (run/approve/export, hourly rates) + statutory readiness + workflow (approvals) + lock periods.
- **New:** salary/allowance/deduction records, overtime approval, payroll-lock period, export refinement under the HR role model.
- **Size:** L · **Priority:** B (absorb legacy; sensitive).

### Item 12 — Benefits Administration
- **Reuse (medium):** `app_users` + dependents (new), workflow (enrolment approval), documents.
- **New:** benefit plans, enrolment/eligibility, dependent records, benefit-change requests. Mostly greenfield.
- **Size:** L · **Priority:** C.

### Item 13 — Recruitment / Applicant Tracking
- **Reuse (medium):** documents (CVs/offers), workflow (offer approval), and **conversion → Onboarding** (calls `startOnboardingCase`).
- **New:** job openings, applicants, interview/stage pipeline, offer records. Greenfield but with a clean onboarding hand-off.
- **Size:** L · **Priority:** C (precedes onboarding in the lifecycle; build once onboarding is proven — it is).

### Item 14 — Transfers & Promotions
- **Reuse (very high):** `hr.employees.transfer`/`role_change`/`supervisor_change` + change-request + status history + workflow all exist.
- **New:** a transfer/promotion *request* wrapper (salary+dept+manager change bundled) + approval + effective-dating.
- **Size:** S–M · **Priority:** A (thin layer over existing capability).

### Item 15 — Offboarding
- **Reuse (very high):** the ENTIRE onboarding backbone — cases, tasks, handoffs, blockers, packages+templates, custom actions, communications, timeline, audit, reports. It's the mirror image.
- **New:** offboarding-specific package templates (clearance checklist, asset return, access removal, exit interview, final docs), a "reason=termination/resignation" variant, and the **access-removal handoff** (the inverse of account provisioning).
- **Size:** M · **Priority:** A (highest leverage — near-clone of onboarding; completes the lifecycle bookend).

### Item 16 — HR Analytics Dashboard
- **Reuse (high):** widget board + `dashboard-stats` pattern + onboarding reports shape.
- **New:** cross-module HR KPIs (headcount, turnover, leave trends, attendance issues, contract expiry, pending approvals).
- **Size:** M · **Priority:** D (dashboards LAST, per the build order — needs the other modules emitting data first).

### Item 17 — HR Settings & Policy Engine
- **Reuse (very high):** the manifest-driven settings catalog already powers onboarding + employees settings.
- **New:** NOT one build — it grows as each module lands (a `*.manifest.ts` per area: leave rules, approval chains, probation, doc requirements, attendance policies, numbering, statuses).
- **Size:** S per area · **Priority:** cross-cutting — ship each area's manifest WITH that module, not as a separate phase.

---

## Recommended sequence (so it's not "too much")

Do it in tiers, not all at once. Each tier is a shippable chunk.

**Tier A — high-leverage, mostly reuse existing engines (do first):**
1. **Offboarding** (#15) — clone the onboarding backbone; completes the lifecycle. Biggest bang for least new code.
2. **Transfers & Promotions** (#14) — thin layer over transfer/change-request/workflow that already exist.
3. **HR Documents** (#8) — promote the existing document backend to a standalone page + expiry alerts.
4. **HR Requests** (#4) — generalise the change-request into a self-service Request Center.

**Tier B — absorb & modernise legacy into the HR module:**
5. **Organization Structure** (#3) — departments/sites/hierarchy + positions + cost centres.
6. **Leave & Absence** (#5) — absorb legacy leave + balances/policies.
7. **Attendance & Timekeeping** (#6) — absorb legacy attendance + timesheet review/exceptions.
8. **Compensation / Payroll Prep** (#11) — absorb legacy payroll under the HR role model.

**Tier C — greenfield (larger, later):**
9. Recruitment/ATS (#13) → feeds Onboarding · Performance (#9) · Disciplinary & Grievance (#10) · Benefits (#12) · Shift/Roster (#7).

**Tier D — last:**
10. **HR Analytics Dashboard** (#16) — after the modules above emit data.
- **HR Settings/Policy (#17)** is not a tier — each module ships its own settings manifest as it lands.

**Rule for every item:** follow `ONBOARDING_IMPLEMENTATION_REFERENCE.md` conventions, reuse the foundation table above, add the module's E2E suite (`scripts/e2e/suites/<module>.mjs`) per the testing standard, and ship UI functional-first (style later, per the current mandate).

---

## Suggested starting point

**Offboarding (#15)** — it reuses ~90% of the onboarding code (a new package set + an
access-removal handoff + a termination/resignation reason), so it's the fastest way to add
a whole HR sub-module, and it closes the employee-lifecycle loop (Recruitment → Onboarding
→ … → Offboarding). Everything after it gets easier because the case/workflow patterns are
by then battle-tested twice.
