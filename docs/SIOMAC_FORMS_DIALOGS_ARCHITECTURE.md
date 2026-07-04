# SIOMAC — Forms & Dialogs Architecture Catalogue

_Discovery + architecture pass. No UI was changed for this document. Every route, hook,
permission key, status, and DTO field below was read from the repository; anything not
verified in code is marked **UNKNOWN — needs confirmation**._

Companion docs: [DIALOGS_INVENTORY.md](docs/DIALOGS_INVENTORY.md) (what exists),
[DIALOGS_AND_FORMS_DESIGN_SPEC.md](docs/DIALOGS_AND_FORMS_DESIGN_SPEC.md) (target design),
[ONBOARDING_IMPLEMENTATION_REFERENCE.md](docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md) (conventions).

---

## 1. Executive summary

The app has **two dialog systems already built** and partially rolled out:
- **`EnterpriseFormModal` + `DialogContextPanel`** (`src/components/common/dialogs/`) — two-pane create/edit.
- **`ActionModal`** (`src/components/common/actions/`, imperative `openActionModal()`, host in AppShell) — lifecycle decisions.

Migrated so far: **HR Organization** (Unit/Position/Cost Centre/Move create-edit + Documents Verify/Archive) and
**Finance/Compensation/Overtime lifecycle actions** (reject/retire/verify/lock/reopen/activate). Retire/archive/delete
in Organization deliberately keep the richer server-backed **`ImpactModal`**.

Remaining work is **breadth, not new architecture**: ~40 more create/edit forms and lifecycle dialogs across 11 modules
need to move onto the two systems, plus a small number of **preview endpoints** for context the client cannot compute
(affected-employee counts, replaces-existing, leave balances, PAYE preview).

**Enforcement is solid at the backend** (every route is `requirePermission`-gated, mutations write audit via
`writeHrAudit` which throws on failure, and emit `app_events`); the gaps are almost entirely **frontend richness**,
plus a few **client-side-only validations** that should also exist server-side.

---

## 2. Global patterns found

- **Request/response envelope:** `apiPost(path, args)` → `POST /api/<path>` with body `{ args }`; routes read
  `body.args ?? {}`, validate with Zod (`zv`), return `c.json({success,data})` / `{success:false,message}` (HTTP 200).
- **Auth:** `const actor = await requirePermission(c, '<key>')` — one call, returns actor. `app_users.id` is TEXT.
- **Mutation side-effects (order):** DB write → `emitAppEvent({...})` (void) → `writeHrAudit({...})` (awaited, THROWS on
  failure → fails the mutation). Idempotent creates go through `runModuleMutation` with a content-derived key;
  status transitions do not.
- **Workflow/approval:** central engine — `module_workflow_bindings` + published `workflow_template_versions` +
  registered adapter; `startWorkflowForRecord`; SoD via `assertDifferentApprover`. HR sensitive changes ride
  `hr_employee_change_requests` (maker-checker). Org mutations return `OrgMutationResult` (`mode: 'applied' | 'pendingApproval'`).
- **Frontend nav:** no URL router; module shells switch on a `siomac:section` window event; drill-ins are
  `useState` conditional renders. Dashboards use `@ui/widgets` `WidgetBoard`; admin CRUD uses plain `.obx-*` tables + modals.
- **Shared UI available (`@ui`):** `Modal/HseModal/ModalSection`, `Wizard`, `WizardShell` (+ info panel), `Drawer/DetailDrawer`,
  `SidePanel`, `Field/TextInput/SelectInput/TextareaInput/FormGrid`, `Tabs/PanelTabs`, `EntityHead/PanelStats`,
  `InfoCard/FieldList/FieldRow/MiniTable/Pill/Callout/ActivityList`.
- **New systems (`@/components/common`):** `EnterpriseFormModal`, `DialogContextPanel`, presets; `ActionModal`,
  `openActionModal`, `ActionModalHost`, presets (reject/cancel/archive/verify/lock/reopen/retire), `toActionRecord`, `statusBadge`.

**Route file map** (endpoint counts): `hr.ts` 98 (employees 19, organization 14, documents 12, positions 5, cost-centers 4,
employee-change-requests 3, transfers 2, sites 1, dashboard 1), `hrOnboarding.ts` 63, `hrLeave.ts` 22, `hrAttendance.ts` 21,
`financePayroll.ts` 21, `financeStatutory.ts` 17, `hrOffboarding.ts` 13, `hrCompensation.ts` 9, `hrRequests.ts` 9,
`hrOvertime.ts` 8, `financeNis.ts` 5, `hrStatutoryProfile.ts` 4, `settings.ts` 16, `adminSecurity.ts` 9, `superadmin.ts` 32,
`trustedDevices.ts`/`webauthn.ts`/`auth2fa.ts`/`authStepUp.ts` (security).

---

## 3. Module-by-module catalogue

> Legend — Current/Target UI: EFM = EnterpriseFormModal, AM = ActionModal, WZ = Wizard, DR = Drawer/SidePanel,
> IM = ImpactModal (keep), DLG = @lib/dialog. ✅ = already migrated.

### 3.1 HR Organization / Structure
- **Purpose:** reference-data console — org unit tree, positions, cost centres, org change requests.
- **Frontend:** `src/components/sections/HR/OrgStructureOverview.tsx`
- **API hooks:** `src/api/hr/organization.ts`
- **Backend routes:** `routes/hr.ts` (`/organization/*` ×14, `/positions/*` ×5, `/cost-centers/*` ×4, `/employee-change-requests/*` ×3)
- **Entities/tables:** `departments` (org tree), `hr_positions`, `finance_cost_centers` (shared), `hr_employee_change_requests`
- **Statuses:** unit `isActive` (active/archived); position `isActive`; org change request `pending_approval → approved | rejected | applied | cancelled`
- **Permissions:** `hr.organization.*` (11), `hr.positions.*` (7), `hr.cost_centers.*` (7)
- **Audit/event:** via `writeHrAudit` + `emitAppEvent` (exact action strings **UNKNOWN — verify in `lib/hr/organization*`**)
- **Workflow:** risk-gated — `OrgMutationResult.mode` = applied vs pendingApproval (Phase B change-request engine)
- **Shared engines reused:** central workflow (change requests), `previewOrgChange` impact endpoint, `runModuleMutation`

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields (have → should add) | Validation | Context panel | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| New/Edit **Unit** ✅ | EFM | name, code, type, manager, site, cost-centre, desc | name req; dup-code (client) | breadcrumb·preview·siblings·inherited site/CC·what-next | — | `hr/organization/units/{create,update}` | `hr.organization.manage` | P1 |
| New/Edit **Position** ✅ | EFM | key, title, grade, budget, unit, site, supervisor, reports-to, safety-critical | title+key req; dup-key | reporting line·**filled/budget/vacancy**·safety callout | — | `hr/organization/positions/{create,update}` (via hr.ts) | `hr.positions.manage` | P1 |
| New/Edit **Cost Centre** ✅ | EFM | code, name, currency, budget, owning-unit, manager | name req; dup-code | owning-unit·units/positions using·what-next | — | `hr/organization/cost-centers/{create,update}` | `hr.cost_centers.manage` | P1 |
| **Move Unit** ✅ | EFM | new-parent | cycle detection (client) | before→after·subtree impact·approval routing | — | `hr/organization/units/move` | `hr.organization.manage` | P1 |
| **Archive/Delete Unit**, **Retire Position/Cost Centre** | IM (keep) | impact preview + blockers | server blockers | affected employees/positions/child-units/finance refs | active→archived/retired | `.../{archive,delete,retire}` | `hr.*.manage` | P2 (already rich) |
| **Cancel org change request** | DLG→AM | — | — | request·before→after·SoD | pending_approval→cancelled | `hr/organization/change-requests/cancel` UNKNOWN | `hr.organization.manage` | P3 |

Fields that **should exist** (from API but not surfaced): position `grade` shown but no validation; cost-centre `annualBudget`
has no vs-actual context (needs preview). **Preview endpoint** proposed §5.

### 3.2 HR Documents
- **Purpose:** cross-employee document register, expiry tracking, requirement policies.
- **Frontend:** `src/components/sections/HR/HRDocumentsOverview.tsx`
- **API hooks:** `src/api/hr/documents.ts` (re-exports employee doc hooks)
- **Backend routes:** `routes/hr.ts` (`/documents/*` ×12)
- **Entities:** `hr_employee_documents`, `hr_document_requirements`
- **Statuses:** document `uploaded → verified | rejected | archived`; expiry state (valid/expiring/expired)
- **Permissions:** `hr.employee_documents.*` (23)
- **Audit/event:** `writeHrAudit`/`emitAppEvent` (action strings **UNKNOWN — verify `lib/hr/documents*`**)

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields (have → add) | Validation | Context panel | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **Upload Document** ✅ | EFM | employee(picker), type, title, confidentiality, expiry, file | employee+type+title+file req; file>15MB warn | employee·requirement match·expiry preview·file valid | — | `hr/documents/upload` (+ presign) | `hr.employee_documents.upload` | P1 |
| **New/Edit Requirement** ✅ | EFM | type, label, scope, scope-value, requires-expiry, reminder-days | type+label req; dup-requirement | scope·requires-expiry·satisfied-by·**affected count (needs endpoint)** | — | `hr/documents/requirements/{create,update}` | `hr.employee_documents.requirements.manage` UNKNOWN key | P2 |
| **Verify Document** ✅ | AM | — (approve) | — | doc·employee·confidentiality·expiry·what-next | uploaded→verified | `hr/documents/verify` | `hr.employee_documents.verify` UNKNOWN key | P1 |
| **Archive Document** ✅ | AM | — | — | doc·employee·what-next | *→archived | `hr/documents/archive` | `hr.employee_documents.archive` UNKNOWN key | P2 |
| **Run Expiry Sweep** | DLG (keep) | — | — | — (batch job) | — | `hr/documents/expiry-sweep` | `hr.employee_documents.view` | P4 |

### 3.3 Offboarding
- **Purpose:** employee exits — cases, tasks, handoffs, blockers, finalize→terminate.
- **Frontend:** `src/components/sections/HR/OffboardingOverview.tsx` (+ case detail surfaces)
- **API hooks:** `src/api/hr/offboarding.ts`
- **Backend routes:** `routes/hrOffboarding.ts` (13)
- **Entities:** `hr_offboarding_cases/_tasks/_handoffs/_blockers/_packages/_action_templates/_case_actions`
- **Statuses:** case `draft|open|in_progress|blocked|paused|ready_for_exit|completed|cancelled`; task `pending|in_progress|completed|skipped|blocked`; handoff `pending|delivered|cancelled`; blocker `open|resolved|waived`
- **Permissions:** `hr.offboarding.*` (24)
- **Workflow:** finalize sets employee status `terminated` (existing status machine, auth→inactive) + raises IT access-removal handoff

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **New Case** | plain modal→EFM | employee, package, reason, last-working-day | employee+reason req | employee(dept/mgr/tenure)·package preview·LWD→exit timeline·what-next | →open | `hrOffboarding/cases/start` UNKNOWN exact | `hr.offboarding.start` | P1 |
| **Finalize Case** | DLG→AM | — | confirm | case·open items·"**terminates employee, disables login, raises IT handoff**" | ready_for_exit→completed | `hrOffboarding/cases/finalize` | `hr.offboarding.complete` | **P1** (high-impact) |
| **Cancel Case** | DLG→AM | reason | reason req | case·open tasks/handoffs voided | *→cancelled | `hrOffboarding/cases/cancel` | `hr.offboarding.cancel` | P2 |
| **Pause/Resume/Mark-ready** | DLG→AM | — / reason | — | case·stage | status transitions | `hrOffboarding/cases/{pause,resume,mark-ready}` UNKNOWN | `hr.offboarding.case.manage` | P2 |
| Task complete/block/unblock, handoff FSM, blocker resolve/escalate/waive | DLG→AM | reason where applicable | — | record·what-next | per-FSM | `hrOffboarding/{tasks,handoffs,blockers}/*` | `hr.offboarding.task.manage` | P3 |

### 3.4 Onboarding lifecycle actions
- **Purpose:** onboarding cases, tasks, handoffs, blockers, packages, custom actions, comms.
- **Frontend:** `OnboardingOverview.tsx`, `OnboardingCaseDetail.tsx`, `OnboardingTasksWorkspace.tsx`, `OnboardingHandoffsWorkspace.tsx`, `OnboardingBlockedBoard.tsx`, `OnboardingPackageManager.tsx`, `OnboardingPackageDetail.tsx`, `OnboardingWizard.tsx`, `OnboardingReportsWorkspace.tsx`
- **API hooks:** `src/api/hr/onboarding.ts`
- **Backend routes:** `routes/hrOnboarding.ts` (63)
- **Entities:** `hr_onboarding_cases/_tasks/_handoffs/_blockers/_packages/_task_templates/_handoff_templates/_action_templates/_case_actions/_communications`
- **Statuses:** case `open|in_progress|blocked|paused|ready_for_activation|completed|cancelled`; case-action `open|in_progress|completed|cancelled|blocked`; communication `draft|queued|sent|failed|cancelled`
- **Permissions:** `hr.onboarding.*` (57)

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|
| **Start Case (Wizard)** | WZ (keep/enrich) | employee, package, custom-actions, start-date | readiness·package plan preview | →open | `hrOnboarding/cases/start` | `hr.onboarding.start` | P1 |
| **Pause / Resume / Mark ready / Complete / Cancel / Provision** | DLG→**AM** ×6 | reason where applicable | case #·stage·blocking-task count·(Ready: readiness checklist; Provision: mailbox/login; Complete: open items) | status transitions | `hrOnboarding/cases/{pause,resume,mark-ready,complete,cancel,provision}` | `hr.onboarding.case.manage` / `.complete` / `.cancel` | **P1** |
| **Add Task / Reassign / Add Custom Action** ✅ rich | Modal (keep) / EFM | — | insertion point·blocking?·handoff target | — | `hrOnboarding/tasks/*`, `.../case-actions/*` | `hr.onboarding.task.manage` | P3 |
| Handoff FSM retry/accept/complete/cancel, blocker resolve/escalate/waive | DLG→AM | reason | record·what-next | per-FSM | `hrOnboarding/{handoffs,blockers}/*` | `hr.onboarding.*` | P3 |

### 3.5 HR Requests
- **Purpose:** employee self-service requests + HR triage/decide/fulfill.
- **Frontend:** `HRRequestsOverview.tsx`; **API:** `src/api/hr/requests.ts`; **routes:** `hrRequests.ts` (9)
- **Entities:** `hr_requests` (+ types/config); **Statuses:** `submitted|in_review|approved|rejected|fulfilled|cancelled`
- **Permissions:** `hr.requests.*` (9)

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **New Request** | rich modal→EFM | type, subject, details, attachments? | type+subject req | request type description·routing·what-next | →submitted | `hrRequests/create` UNKNOWN | `hr.requests.create` | P2 |
| **Decide** (approve/reject) | rich modal→AM | decision, reason | reason on reject | request·requester·SoD | submitted/in_review→approved/rejected | `hrRequests/decide` | `hr.requests.decide` | P2 |
| **Fulfill** | rich modal→EFM/AM | fulfilment note | — | request·what-next | approved→fulfilled | `hrRequests/fulfill` | `hr.requests.fulfill` UNKNOWN | P3 |
| **Cancel Request** | DLG→AM | reason (optional) | — | request·title | *→cancelled | `hrRequests/cancel` | `hr.requests.cancel` UNKNOWN | P3 |

### 3.6 Transfers & Promotions
- **Purpose:** bundled dept/role/pay change requests (maker-checker) over `hr_employee_change_requests`.
- **Frontend:** `TransfersOverview.tsx`; **API:** `src/api/hr/transfers.ts`; **routes:** `hr.ts` (`/transfers/*` ×2, `/employee-change-requests/*` ×3)
- **Entities:** `hr_employee_change_requests`, `hr_employee_status_history`; **Statuses:** `draft|pending_approval|approved|applied|rejected|cancelled`
- **Permissions:** `hr.transfers.*` (14), plus `hr.employees.{transfer,role_change,supervisor_change}`

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **New Transfer/Promotion** | rich modal→EFM | employee, new dept, new manager, new position, new pay, effective-date, reason | employee+effective req | employee·**from→to diff** (dept/mgr/pos/pay)·SoD·risk | →pending_approval | `hr/transfers/create` UNKNOWN | `hr.transfers.create` | P1 |
| **Decide** (approve/reject) | DLG→AM | reason | reason on reject | request·from→to·SoD | pending_approval→approved/rejected | `hr/employee-change-requests/decide` | `hr.transfers.approve` | P1 |
| **Cancel** | DLG→AM | — | confirm | request·from→to | *→cancelled | `hr/employee-change-requests/cancel` | `hr.transfers.manage` UNKNOWN | P3 |

### 3.7 Leave & Absence
- **Purpose:** leave requests, balances, accruals, calendar, review.
- **Frontend:** `LeaveOverview.tsx`; **API:** `src/api/hr/leave.ts` (+ legacy `src/api/leave.ts`); **routes:** `hrLeave.ts` (22)
- **Entities:** `hr_leave_requests/_types/_balances/_accruals` (exact names **UNKNOWN — verify `lib/hr/leave*`**); **Statuses:** `pending_approval|approved|rejected|cancelled`
- **Permissions:** `hr.leave.*` (57)

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields (have→add) | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **Submit Leave** | rich modal→EFM | type, from, to, half-day?, reason | dates req; end≥start | **live balance (entitled/taken/remaining)**·working-days computed·overlap·coverage·approval chain | →pending_approval | `hrLeave/requests/submit` UNKNOWN | `hr.leave.submit`/`request` | **P1** |
| **Review** (approve/reject) | rich modal→AM | decision, reason | reason on reject | requester·dates/days·remaining after·team coverage | pending→approved/rejected | `hrLeave/requests/decide` | `hr.leave.approve` | P1 |
| **Cancel leave** | DLG→AM | reason? | — | request·dates | *→cancelled | `hrLeave/requests/cancel` UNKNOWN | `hr.leave.cancel` UNKNOWN | P3 |
| Leave-type / accrual admin | plain→EFM | — | — | usage counts | — | `hrLeave/types/*`, `/accruals/*` | `hr.leave.config.*` UNKNOWN | P3 |

### 3.8 Attendance & Timekeeping
- **Purpose:** punch capture (geofence/selfie), daily log, timesheets, exceptions, corrections, reports.
- **Frontend:** `AttendanceOverview.tsx`; **API:** `src/api/hr/attendance.ts`; **routes:** `hrAttendance.ts` (21)
- **Entities:** `hr_attendance_records/_timesheets/_exceptions/_corrections` + `project_sites` (geofence); **Statuses:** exception `open|waived|resolved`; timesheet (submitted/approved/rejected — **UNKNOWN exact**); record status (present/absent/late/on_leave/holiday/missing_punch)
- **Permissions:** `hr.attendance.*` (61) + legacy `attendance.*`

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **Waive Exception** | DLG(prompt)→AM | reason | reason req | employee·date·exception type·what-next | open→waived | `hrAttendance/exceptions/waive` | `hr.attendance.exceptions.manage` | P2 |
| **Resolve Exception** | DLG(prompt)→AM | note | note req | employee·date·exception type | open→resolved | `hrAttendance/exceptions/resolve` | `hr.attendance.exceptions.manage` | P2 |
| **Submit/Reopen Timesheet** | DLG→AM | reason on reopen | — | period·hours·exceptions | submitted/approved transitions | `hrAttendance/timesheets/{submit,reopen}` | `hr.attendance.timesheets.{submit,approve}` | P2 |
| **Correction / manual punch** | inline/DLG→EFM | punch times, reason | time order | employee·day·geofence | — | `hrAttendance/corrections/*` | `hr.attendance.corrections.manage` UNKNOWN | P3 |

### 3.9 Compensation / Overtime
- **Purpose:** recurring pay items (maker-checker), employee NIS statutory profile capture, overtime submit/approve.
- **Frontend:** `CompensationOverview.tsx`, `OvertimeOverview.tsx`; **API:** `src/api/hr/{compensation,overtime,statutoryProfile}.ts`; **routes:** `hrCompensation.ts` (9), `hrOvertime.ts` (8), `hrStatutoryProfile.ts` (4)
- **Entities:** `hr_pay_items`, `hr_overtime_entries`, `hr_employee_statutory_profiles`; **Statuses:** pay-item `draft|pending_approval|approved|active|retired|rejected`; overtime `submitted|approved|rejected|paid|cancelled`; profile `pending_verification|verified|not_available|not_applicable|exempt`
- **Permissions:** `hr.compensation.*` (22), `hr.overtime.*` (31), `hr.employee.statutory.*`

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **New Pay Item** | inline form→EFM | employee, component, amount/percent, effective-from/to, note | employee+component req | employee·component (taxable?)·effect on gross/net·effective overlap·maker-checker | →draft | `hr/compensation/pay-items/create` | `hr.compensation.manage` | P2 |
| **Reject / Retire Pay Item** ✅ | AM | reason (reject) | — | employee·component·amount·dates·status | draft→rejected / active→retired | `hr/compensation/pay-items/{reject,retire}` | `hr.compensation.{approve,manage}` | P2 |
| **Statutory Profile capture** | inline→EFM | NIS #, applicable, prev employer, opening YTD ×3, as-of | — | employee·"HR captures; **Finance verifies**"·submit effect | →pending_verification | `hr/employee-statutory/{capture,submit}` | `hr.employee.statutory.capture` | P2 |
| **Log Overtime** | inline→EFM | work-date, hours, multiplier, reason | hours>0 | date×multiplier→payable hours·"feeds payroll; immutable once paid" | →submitted | `hr/overtime/submit` | `hr.overtime.submit` | P2 |
| **Reject / Cancel Overtime** ✅ | AM | reason (reject) | — | employee·hours·date·reason | submitted→rejected/cancelled | `hr/overtime/{reject,cancel}` | `hr.overtime.approve` | P2 |

### 3.10 Payroll / Statutory Finance
- **Purpose:** statutory rate versions (maker-checker), pay-component catalogue, NIS verification, payroll runs → payslips/exports.
- **Frontend:** `Finance/StatutoryConfigOverview.tsx`, `Finance/PayrollOverview.tsx`; **API:** `src/api/finance/{statutory,payroll}.ts`; **routes:** `financeStatutory.ts` (17), `financePayroll.ts` (21), `financeNis.ts` (5)
- **Entities:** `finance_statutory_versions/_nis_classes`, `finance_pay_components`, `finance_payroll_runs/_run_inputs/_run_lines/_run_warnings/_payslips/_exports`, `hr_employee_statutory_profiles`
- **Statuses:** version `draft|pending_approval|approved|active|retired`; run `draft|input_locked|calculated|pending_approval|approved|locked|exported`; profile as §3.9
- **Permissions:** `finance.statutory.*` (21), `finance.payroll.*` (59), `finance.payroll.nis.*`

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Validation | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|---|
| **New Rate Version** | inline→EFM | effective-from, label, PAYE (allowance/ceiling/rates), HS (threshold/hi/lo), NIS ceiling | rates 0–1; nonneg | vs current active·**PAYE band preview**·"draft→maker-checker (2nd finance_manager)"·overlap warning | →draft | `finance/statutory/versions/create` | `finance.statutory.manage` | P2 |
| **NIS Class upsert** | inline→EFM | class#, weekly min/max, EE/ER weekly | draft-only | version·band continuity (no gaps)·EE/ER split | — | `finance/statutory/nis-classes/upsert` | `finance.statutory.manage` | P3 |
| **New Component** | inline→EFM | code, name, kind, taxable, reduces-chargeable | code+name req; dup-code | kind implications·"used by N pay items" | — | `finance/payroll/components/create` | `finance.payroll.components.manage` | P3 |
| **Reject / Activate / Retire Version** ✅ | AM | reason (reject) | — | label·bands·"active will be retired" | maker-checker + activate/retire | `finance/statutory/versions/{reject,activate,retire}` | `finance.statutory.{approve,manage}` | P2 |
| **Retire Component** ✅ | AM | — | — | name·code·kind | active→retired | `finance/payroll/components/retire` | `finance.payroll.components.manage` | P3 |
| **Verify / Reject NIS Profile** ✅ | AM | note/reason | — | employee·NIS #·prev employer·opening YTD | pending_verification→verified/rejected | `finance/payroll/nis/{verify,reject}` | `finance.payroll.nis.verify` | P1 |
| **New Pay Run** | inline→EFM | pay-month, frequency | month req | active statutory version·inputs pulled·employee scope | →draft | `finance/payroll/runs/create` | `finance.payroll.run.manage` | P2 |
| **Lock / Reopen Run** ✅ | AM | reason (reopen) | — | run·period·employees·gross/net/employer-NIS·warnings | approved→locked / locked→draft | `finance/payroll/runs/{lock,reopen}` | `finance.payroll.{lock,run.manage}` | P1 |
| Submit / Calculate / Export / Generate payslips | inline buttons→AM (confirm-style) | — | state guards | run totals·warnings | state machine | `finance/payroll/runs/{submit,calculate,export}`, `/payslips/generate` | `finance.payroll.*` | P2 |

### 3.11 Settings / Security / Console
- **Purpose:** company/appearance settings, catalog-driven preferences & governance, security (passkeys/trusted devices/step-up/MFA), superadmin console (roles/permissions/approvals/modules).
- **Frontend:** `Settings/SettingsSection.tsx`, `Settings/ManifestReviewPanel.tsx`, `Settings/SwzCard.tsx`, `SuperadminConsole/tabs/*`
- **API/routes:** `settings.ts` (16), `settingsCatalog.ts`, `adminSecurity.ts` (9), `superadmin.ts` (32), `trustedDevices.ts`, `webauthn.ts`, `auth2fa.ts`, `authStepUp.ts`, `permissionApprovals.ts`
- **Permissions:** `hr.settings.*` (6) + security/superadmin keys (**UNKNOWN exact set — verify `permissions.ts`**)

**Forms / Dialogs:**
| Dialog | Cur→Tgt | Fields | Context | Lifecycle | Route | Perm | Priority |
|---|---|---|---|---|---|---|---|
| **Deprecate manifest** | DLG→AM | — | manifest·usages | active→deprecated | `settingsCatalog/manifests/deprecate` UNKNOWN | governance key UNKNOWN | P3 |
| **Return manifest** | DLG(prompt)→AM | reason | manifest·submitter | submitted→returned | `settingsCatalog/manifests/return` UNKNOWN | P3 |
| **Remove trusted device** | DLG→AM | — | device·last-seen·"logs out that device" | — | `trustedDevices/remove` | security key UNKNOWN | P3 |
| **Name/Rename passkey** | DLG(prompt)→EFM/keep | label | passkey·created | — | `webauthn/rename` | self | P4 |
| **Remove passkey** | DLG→AM | — | passkey·"cannot sign in with it after" | — | `webauthn/delete` | self | P3 |
| **SWZ reset to inherited** | DLG→AM | — | setting·inherited value | override→inherited | `settings/reset` UNKNOWN | governance key UNKNOWN | P4 |
| **Console: Roles/Permissions/Approvals** | Modal (2-pane, keep) → enrich | — | +"N users affected"·diff preview | — | `superadmin/*` | superadmin | P3 |

---

## 4. Full form/dialog table (roll-up)

| # | Module | Dialog | Current | Target | Priority |
|---|---|---|---|---|---|
| 1 | Organization | New/Edit Unit | EFM ✅ | EFM | P1 |
| 2 | Organization | New/Edit Position | EFM ✅ | EFM | P1 |
| 3 | Organization | New/Edit Cost Centre | EFM ✅ | EFM | P1 |
| 4 | Organization | Move Unit | EFM ✅ | EFM | P1 |
| 5 | Organization | Archive/Delete/Retire | ImpactModal | keep IM | P2 |
| 6 | Documents | Upload | EFM ✅ | EFM | P1 |
| 7 | Documents | New/Edit Requirement | EFM ✅ | EFM | P2 |
| 8 | Documents | Verify / Archive | AM ✅ | AM | P1/P2 |
| 9 | Offboarding | New Case | plain modal | EFM | P1 |
| 10 | Offboarding | Finalize | dialog.confirm | AM | **P1** |
| 11 | Offboarding | Cancel/Pause/Resume/Ready | dialog | AM | P2 |
| 12 | Offboarding | Task/Handoff/Blocker FSM | dialog | AM | P3 |
| 13 | Onboarding | Start (Wizard) | Wizard | WZ | P1 |
| 14 | Onboarding | Pause/Resume/Ready/Complete/Cancel/Provision | dialog ×6 | AM | **P1** |
| 15 | Onboarding | Add Task/Reassign/Custom Action | Modal ✅ | keep/EFM | P3 |
| 16 | Requests | New Request | rich modal | EFM | P2 |
| 17 | Requests | Decide/Fulfill/Cancel | modal/dialog | AM/EFM | P2/P3 |
| 18 | Transfers | New Transfer | rich modal | EFM | P1 |
| 19 | Transfers | Decide/Cancel | dialog | AM | P1/P3 |
| 20 | Leave | Submit Leave | rich modal | EFM | **P1** |
| 21 | Leave | Review/Cancel | modal/dialog | AM | P1/P3 |
| 22 | Attendance | Waive/Resolve exception | dialog.prompt | AM | P2 |
| 23 | Attendance | Timesheet submit/reopen | dialog | AM | P2 |
| 24 | Compensation | New Pay Item | inline | EFM | P2 |
| 25 | Compensation | Reject/Retire | AM ✅ | AM | P2 |
| 26 | Compensation | Statutory Profile | inline | EFM | P2 |
| 27 | Overtime | Log | inline | EFM | P2 |
| 28 | Overtime | Reject/Cancel | AM ✅ | AM | P2 |
| 29 | Finance Statutory | New Version/NIS class/Component | inline | EFM | P2/P3 |
| 30 | Finance Statutory | Reject/Activate/Retire/Verify NIS | AM ✅ | AM | P1/P2 |
| 31 | Finance Payroll | New Run | inline | EFM | P2 |
| 32 | Finance Payroll | Lock/Reopen | AM ✅ | AM | P1 |
| 33 | Finance Payroll | Submit/Calculate/Export/Payslips | inline | AM | P2 |
| 34 | Settings/Security | Manifest/Device/Passkey/SWZ | dialog | AM/EFM | P3/P4 |
| 35 | Console | Roles/Permissions/Approvals | Modal | keep+enrich | P3 |

---

## 5. Required preview endpoints (context the client cannot safely compute)

| Endpoint | Request | Response (shape) | Feeds |
|---|---|---|---|
| `POST /api/hr/organization/position/preview` | `{positionId?, title, positionKey, orgUnitId, reportsToPositionId?, headcountBudget?, isSafetyCritical?}` | `{duplicateKey, incumbentCount, headcountBudget, vacancy, reportsToTitle, inheritedSiteName, inheritedCostCenterName, warnings[]}` | Position EFM (currently client-approximated) |
| `POST /api/hr/organization/cost-center/preview` | `{costCenterId?, code, name, owningUnitId?}` | `{duplicateCode, owningUnitName, ownerName, assignedUnitCount, positionCount}` | Cost Centre EFM |
| `POST /api/hr/organization/unit/move-preview` | `{unitId, newParentId}` | `{fromPath, toPath, cycleWarning, childCount, employeeCount, positionCount, requiresApproval, risk}` | Move EFM (now client-computed from OrgUnit counts; server preferred for auth-scoped accuracy) |
| `POST /api/hr/documents/upload/preview` | `{employeeId, documentType, fileName?, fileSize?, mimeType?, expiryDate?}` | `{employeeName, departmentName, documentTypeDescription, satisfiesRequirement, requiresExpiry, replacesExisting, fileWarning, expiryPreview}` | Upload EFM (`replacesExisting`/description currently omitted) |
| `POST /api/hr/documents/requirements/preview` | `{requirementId?, documentType, appliesToScope, appliesToValue?, requiresExpiry}` | `{affectedEmployees, duplicateRequirement, exampleSatisfiedBy}` | Requirement EFM (`affectedEmployees` currently "— / Computed on save") |
| `POST /api/hr/leave/preview` | `{employeeId, leaveTypeId, from, to, halfDay?}` | `{entitled, taken, remaining, workingDays, overlaps[], coverage[]}` | Submit Leave EFM (**needed for P1**) |
| `POST /api/finance/statutory/paye-preview` | `{versionId?, sampleGross, weeksInPeriod}` | `{band1, band2, paye, chargeable}` | New Rate Version EFM |
| `POST /api/finance/payroll/runs/scope-preview` | `{periodMonth, payFrequency, weeksInPeriod?}` | `{activeStatutoryVersionLabel, employeeCount, inputsPulled:{payItems, overtime, statutoryProfiles}}` | New Pay Run EFM |

All follow the standard envelope (`{success,data}`, `body.args`, `requirePermission` with the module's `*.view` key).

---

## 6. Backend enforcement gaps (verify → fix later)

1. **Client-only validations** that should ALSO be server-enforced: position duplicate-key, cost-centre duplicate-code,
   requirement duplicate, move-cycle. Confirm each `create/move` route rejects these (likely does via unique constraints /
   `previewOrgChange`, but **UNKNOWN — verify**).
2. **Upload file-size limit** is a client warning (15 MB) only — confirm the presign/commit route enforces a max.
3. **Reason-required** on reject/cancel is enforced in the new `ActionModal` (client). Confirm the backend also requires a
   reason where audit/policy needs it (e.g. change-request reject, NIS reject) — **UNKNOWN**.
4. **Exact audit action strings / app_event names / notification triggers** were not opened per-module in this pass — the
   §7 mapping is marked UNKNOWN pending a read of each `lib/hr/*` + `lib/finance/*` service file.
5. **Permission-key exactness:** several keys above are inferred from namespace (`hr.employee_documents.verify`,
   `hr.requests.fulfill`, `hr.leave.cancel`, governance/security keys). Grep the catalogue before wiring — read-gate keys
   are NOT covered by the enforced-key drift guard (per CLAUDE.md).

---

## 7. Permission / audit / event mapping (namespaces confirmed; per-action strings pending)

| Module | Permission namespace(s) (confirmed present in catalogue) | Audit/event mechanism | Per-action audit string |
|---|---|---|---|
| Organization | `hr.organization.*`, `hr.positions.*`, `hr.cost_centers.*` | writeHrAudit + emitAppEvent + change-request workflow | UNKNOWN |
| Documents | `hr.employee_documents.*` | writeHrAudit + emitAppEvent | UNKNOWN |
| Offboarding | `hr.offboarding.*` | writeHrAudit + emitAppEvent + handoff_outbox + status machine | UNKNOWN |
| Onboarding | `hr.onboarding.*` | writeHrAudit + emitAppEvent + runModuleMutation | UNKNOWN |
| Requests | `hr.requests.*` | writeHrAudit + emitAppEvent | UNKNOWN |
| Transfers | `hr.transfers.*`, `hr.employees.{transfer,role_change,supervisor_change}` | change-request maker-checker + status_history | UNKNOWN |
| Leave | `hr.leave.*` | writeHrAudit + emitAppEvent | UNKNOWN |
| Attendance | `hr.attendance.*`, `attendance.*` | writeHrAudit + emitAppEvent | UNKNOWN |
| Compensation/Overtime | `hr.compensation.*`, `hr.overtime.*`, `hr.employee.statutory.*` | writeHrAudit + emitAppEvent + central workflow | UNKNOWN |
| Payroll/Statutory | `finance.statutory.*`, `finance.payroll.*`, `finance.payroll.nis.*` | audit + app_events + workflow (SoD) | UNKNOWN |
| Settings/Security/Console | `hr.settings.*`, security/superadmin keys UNKNOWN | audit_logs + permission approvals | UNKNOWN |

> **Next discovery step (if approved):** open each `netlify/functions/lib/<module>/*.ts` mutation and record the exact
> `emitAppEvent({type})` and `writeHrAudit({action})` strings + any `notify`/`handoff` calls, to complete this table.

---

## 8. Migration priority list

- **P1 (critical enterprise workflow):** Offboarding **Finalize**; Onboarding **6 case-lifecycle** actions;
  **Submit Leave** + Review; **Transfers** New + Decide; Finance **Lock/Reopen run** ✅, **Verify/Reject NIS** ✅;
  Organization create/edit ✅; Documents Upload ✅ + Verify ✅.
- **P2 (important module workflow):** New Offboarding Case; Attendance Waive/Resolve + Timesheet; New Pay Item; Statutory
  Profile; Log Overtime; New Rate Version; New Pay Run + Submit/Calculate/Export; Requests New/Decide; Documents Requirement ✅ + Archive ✅.
- **P3 (polish/consistency):** all remaining FSM sub-actions (task/handoff/blocker), NIS class / component forms, Cancel
  actions, Settings/Console manifest/device/passkey, Console enrich.
- **P4 (can stay `@lib/dialog`):** rename passkey, run expiry sweep, SWZ reset, other tiny low-risk confirms/toasts.

**Already done:** Organization (4 forms) + Documents (Upload/Requirement/Verify/Archive) + Finance/Comp/Overtime lifecycle actions.

---

## 9. Recommended implementation phases

1. **Phase A — P1 lifecycle sweep:** Onboarding (6) + Offboarding (Finalize/Cancel) + Transfers (Decide) + Attendance
   (Waive/Resolve) onto `ActionModal`. Pure frontend; no new endpoints. Highest visible win.
2. **Phase B — P1 forms needing preview:** Submit Leave (needs `leave/preview`), Transfers New, New Offboarding Case →
   `EnterpriseFormModal`; build the 2–3 preview endpoints they require (§5).
3. **Phase C — P2 Finance/Comp forms:** New Pay Item, Statutory Profile, Log Overtime, New Rate Version, New Pay Run →
   EFM; add `paye-preview` + `runs/scope-preview`.
4. **Phase D — remaining preview endpoints** for Organization/Documents (position/cost-center/upload/requirement) to
   replace the current client approximations + "Computed on save" placeholders.
5. **Phase E — P3 polish:** FSM sub-actions, Settings/Security/Console, NIS class/component forms.
6. **Cross-cutting:** component tests for `DialogContextPanel` + `EnterpriseFormModal` (spec §16); per-module audit/event
   string discovery to complete §7.

---

## 10. Open questions

1. Exact **audit action** + **app_event** strings per mutation (§7) — confirm by reading each `lib/*` service, or accept
   "reuse the module's existing pattern"?
2. Exact **permission keys** for: documents verify/archive/requirements, requests fulfill/cancel, leave cancel/config,
   attendance corrections, settings governance, security (device/passkey), superadmin. Grep-confirm before wiring.
3. Should **Move Unit** rely on the client-computed impact (current) or a **server `move-preview`** for auth-scoped accuracy?
4. **Leave balance** source — is there an existing balance query/endpoint to power the Submit-Leave preview, or must one be built?
5. Do **Requests / Transfers** already have a from→to **diff** payload, or must the preview assemble it?
6. Should **New Rate Version** show a real **PAYE preview** (needs a compute endpoint) or a static explainer for now?
7. Confirm whether **backend** enforces the client-only validations in §6 (dedupe, file-size, reason-required).
8. **Settings/Security/Console** dialogs — in scope for this initiative, or a separate security-UX pass?

---

**End of discovery. No components, routes, or migrations were changed. Awaiting approval before implementing
`EnterpriseFormModal` / `DialogContextPanel` / `ActionModal` migrations or any preview endpoints.**
