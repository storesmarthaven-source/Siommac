# SIOMAC — Active-Module Forms & Dialogs Build Catalogue

_Discovery + specification. No code changed. Every route/hook/permission/status/audit/event below was read from
the repo across the prior discovery passes; anything unverified is **UNKNOWN — needs confirmation**._

Companions: [SIOMAC_FORMS_DIALOGS_ARCHITECTURE.md](docs/SIOMAC_FORMS_DIALOGS_ARCHITECTURE.md),
[SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md](docs/SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md),
[DIALOGS_AND_FORMS_DESIGN_SPEC.md](docs/DIALOGS_AND_FORMS_DESIGN_SPEC.md), [DIALOGS_INVENTORY.md](docs/DIALOGS_INVENTORY.md).
Machine-readable appendices: `docs/FORM_DIALOG_MATRIX.json`, `docs/FIELD_MATRIX.json`, `docs/DATA_DEPENDENCY_MATRIX.json`.

---

## 1. Executive Summary

The **active** SIOMAC app is three self-registered feature modules — **HR**, **Finance**, **HSE** (via
`src/components/sections/{HR,Finance,HSE}/module.ts` → `registerModule`) — plus platform surfaces
(**Settings/Security**, **Superadmin Console**, **My Profile**, **Messages/Notifications/Tickets**). A parallel
**legacy** workforce/finance system (Employees, Departments, Attendance, Leaves, Hourly Rates, Payroll admin
sections + their routers/APIs) still ships but is the deprecated duplicate; it is **excluded** here (§3).

Two dialog systems already exist and are largely rolled out across HR + Finance:
- **EnterpriseFormModal + DialogContextPanel** (`src/components/common/dialogs/`) — create/edit/submit.
- **ActionModal** (`src/components/common/actions/`, `openActionModal()`) — lifecycle decisions.

This catalogue gives **full field-level specs** for the HR + Finance forms (the migration target, all data verified),
and **module + form inventories** for HSE and Platform (already built on rich `@ui` Modals/Wizards/Drawers — not the
migration priority; field-level marked *defer/see component* where a per-file read is still needed).

---

## 2. Active Module List

| # | Group | Module | Nav id(s) | Frontend root | Status |
|---|---|---|---|---|---|
| 1 | HR | Employee Master | `s-hr-employees` | HR/EmployeeMaster.tsx | active |
| 2 | HR | Onboarding | `s-hr-onboarding` | HR/Onboarding*.tsx | active |
| 3 | HR | Organization | `s-hr-organization` | HR/OrgStructureOverview.tsx | active |
| 4 | HR | Documents | `s-hr-documents` | HR/HRDocumentsOverview.tsx | active |
| 5 | HR | Offboarding | `s-hr-offboarding` | HR/OffboardingOverview.tsx | active |
| 6 | HR | Leave & Absence | `s-hr-leave` | HR/LeaveOverview.tsx | active |
| 7 | HR | Transfers & Promotions | `s-hr-transfers` | HR/TransfersOverview.tsx | active |
| 8 | HR | Attendance & Timekeeping | `s-hr-attendance` | HR/AttendanceOverview.tsx | active |
| 9 | HR | HR Requests | `s-hr-requests` | HR/HRRequestsOverview.tsx | active |
| 10 | HR | Shift Roster | `s-hr-roster` | HR/RosterOverview.tsx | active |
| 11 | HR | Compensation | `s-hr-compensation` | HR/CompensationOverview.tsx | active |
| 12 | HR | Overtime | `s-hr-overtime` | HR/OvertimeOverview.tsx | active |
| 13 | Finance | Statutory Configuration | `s-finance-statutory` | Finance/StatutoryConfigOverview.tsx | active |
| 14 | Finance | Payroll | `s-finance-payroll` | Finance/PayrollOverview.tsx | active |
| 15 | HSE | HSE Dashboard / PPE / Incidents / Risk-JSA / PTW / Training / Inspections / CAPA | `s-hse*` | HSE/** | active (rich `@ui`) |
| 16 | Platform | Settings & Security | `s-settings` | Settings/SettingsSection.tsx | active |
| 17 | Platform | Superadmin Console | `s-*console*` | SuperadminConsole/tabs/* | active |
| 18 | Platform | My Profile | `s-profile` | Profile/MyProfileSection.tsx | active |
| 19 | Platform | Messages / Notifications / Tickets | — | Messages/, NotificationCenter/, Tickets/ | active |

> Statutory Profile is a **surface inside Compensation** (`s-hr-compensation`), not a standalone nav item.

---

## 3. Excluded Legacy / Deprecated Items

| File / path | Why excluded | Replaced by |
|---|---|---|
| `src/components/sections/Employees/**` | Legacy admin employee CRUD (action-dispatch `listEmployees` etc.) | HR **Employee Master** (`api/hr/employees.ts`) |
| `src/components/sections/Attendance/**`, `AttendanceDashboard/**` | Legacy selfie/GPS admin attendance | HR **Attendance** (`api/hr/attendance.ts`, `hrAttendance.ts`) |
| `src/components/sections/AdminLeave/**` | Legacy admin leave | HR **Leave** (`api/hr/leave.ts`, `hrLeave.ts`) |
| `src/components/sections/Payroll/**`, `HourlyRates/**` | Legacy payroll/rates admin | Finance **Payroll** (`api/finance/payroll.ts`, `financePayroll.ts`) |
| `src/components/sections/AdminDashboard/**` | Legacy attendance dashboard | (n/a — HSE/HR dashboards) |
| `src/api/payroll.ts` | Legacy **direct `supabase.from()` browser reads** (pre-§2) | `src/api/finance/{payroll,statutory}.ts` |
| `src/api/attendance.ts`, `src/api/leave.ts`, `src/api/employees.ts` | Legacy action-dispatch clients | `src/api/hr/{attendance,leave,employees}.ts` |
| routers `employeesRouter`, `attendanceRouter`, `leavesRouter`, `departmentsRouter` (mounted in `api.ts`) | Legacy `/api` action endpoints; also power ESS/manager/LiveMap (removal blocked — see finance-ui memo) | `hr.ts` (`/employees`,`/organization`), `hrAttendance.ts`, `hrLeave.ts` |
| `src/components/sections/{LiveMap,ProjectSites,Dashboard}` | Original attendance product surfaces (not ERP module forms) | — (kept live; out of this initiative) |

### 3.1 Legacy Dead Code Candidates (usage verified by grep/import tracing)

The forms/dialog initiative does **not** touch legacy — but the claim "legacy is unused" was **checked and is false**:
every legacy module is still **actively rendered, navigable, and mounted**, and one **active HSE module imports a legacy
API**. Evidence (file:line):
- `src/shell/AppShell.tsx:143` renders `<AdminSections/>` → `AdminSections.tsx:595–643` renders `<AppSection id="s-adm-employees|departments|attendance|leaves|rates">` + `s-payroll`.
- `src/config/index.ts` `SECTION_DEFS` lists Employees/Attendance/Leaves/Hourly Rates/Payroll in the **active** admin/manager/superadmin nav.
- `netlify/functions/api.ts:175–193` mounts `employeesRouter/departmentsRouter/attendanceRouter/leavesRouter`.
- `src/api/index.ts:26–29` re-exports `employees/attendance/leave/payroll`.
- **`src/components/sections/HSE/inspections/useEmployeeOptions.ts:7`** → `import { listActiveEmployees } from '@api/employees'` (**active HSE → legacy API**).

| Legacy item | Active refs found | Active replacement | Safe to ignore for forms initiative | Safe to delete |
|---|---|---|---|---|
| `sections/Employees/**` | **YES** (AdminSections render + nav + Employees/api → employeesRouter) | HR Employee Master | yes | **NO — needs deletion pass** (unwire AdminSections + SECTION_DEFS first) |
| `sections/Attendance/**`, `AttendanceDashboard/**` | **YES** (AdminSections render + nav) | HR Attendance | yes | **NO — needs deletion pass** |
| `sections/AdminLeave/**` | **YES** (AdminSections `s-adm-leaves`) | HR Leave | yes | **NO — needs deletion pass** |
| `sections/Payroll/**`, `HourlyRates/**` | **YES** (AdminSections `s-payroll`/`s-adm-rates` + nav) | Finance Payroll | yes | **NO — needs deletion pass** |
| `sections/AdminDashboard/**` | needs check (grep for render) | HSE/HR dashboards | yes | **needs deletion pass** |
| `src/api/{employees,attendance,leave,payroll}.ts` | **YES** (re-exported by `api/index.ts`; **employees imported by active HSE inspections**) | `api/hr/*`, `api/finance/*` | yes | **NO** — repoint HSE `useEmployeeOptions` to `useHrEmployees` first |
| `employeesRouter/departmentsRouter/attendanceRouter/leavesRouter` | **YES** (mounted in `api.ts`) | `hr.ts`/`hrAttendance.ts`/`hrLeave.ts` | yes | **NO — needs deletion pass** |

**Verdict:** none are `legacy_dead_code_candidate` — all have proven active references. They are **excluded from the forms/dialog
initiative** (correct) but are **NOT safe to delete** as-is. A **separate legacy-deletion pass** must first: (1) remove the legacy
`<AppSection>`s from `AdminSections.tsx` + the legacy entries from `SECTION_DEFS`, (2) repoint HSE `inspections/useEmployeeOptions.ts`
off `@api/employees`, (3) unmount the four routers + drop the `api/index.ts` re-exports, then (4) delete the dirs. (The earlier
"blocked by ESS/manager/LiveMap" phrasing is superseded by this evidence-based list — the blockers are the specific active
references above, which are enumerable and fixable.)

---

## 4. Global Form/Dialog Standards

- **Create/edit/submit** → `EnterpriseFormModal` (two-pane: `FormGrid` fields left, `DialogContextPanel` right, `size lg`/1080px).
- **Lifecycle decisions** (reject/cancel/archive/verify/lock/reopen/retire/waive/resolve/activate/finalize/provision) → `ActionModal` via `openActionModal(cfg)`.
- **3+ logical-group creates** → `Wizard`/`WizardShell` (e.g. Create Employee, Onboarding start).
- **Record review/detail** → `Drawer`/`SidePanel`/`DetailDrawer`.
- **Tiny low-risk** (rename passkey, run sweep) → `@lib/dialog`.
- **Envelope:** `apiPost(path,args)` → `{args}` → route reads `body.args`; returns `{success,data}`. Auth `requirePermission(c,key)`.
- **Side-effects order:** DB write → `emitAppEvent({eventType,...})` → `writeHrAudit({action,...})` (awaited, throws).
- **Honesty:** never collect a `reason` the backend drops (`.optional()` schema + `requestId`-only mutations); never show a fake `0` for a not-yet-computed server count (use "—/Computed on save").

## 5. Global Field Types & Reusable Pickers

| Picker | Data source (hook) | Notes |
|---|---|---|
| Employee picker | `useHrEmployees({limit})` → `{id, display_name/full_name, department_id, ...}` | id is TEXT |
| Org-unit picker/tree | `useOrgUnits()` → `OrgUnit[]` (parentId, siteName, costCenterName, childCount, employeeCount, positionCount) | |
| Position picker | `usePositions()` → `Position[]` (incumbentCount, headcountBudget, vacancy) | |
| Cost-centre picker | `useCostCenters()` → `CostCenter[]` (assignedUnitCount) | shared `finance_cost_centers` |
| Site picker | `useHrSites()` | |
| Leave type | `useLeaveTypes()` → `LeaveType[]` | |
| Leave balances | `useLeaveBalances(employeeId)` → `LeaveBalance[]` (entitled/accrued/taken/pending/available) | powers Submit-Leave context |
| Pay component | `usePayComponents({activeOnly})` → `PayComponent[]` (kind/isTaxable/reducesChargeable) | |
| Statutory version | `useStatutoryVersions()` → `StatutoryVersion[]` | |
| Field primitives | `Field/TextInput/SelectInput/TextareaInput/FormGrid` (`@ui`) | |

## 6. Global Context-Panel Patterns (`DialogContextPanelConfig`)

`eyebrow · title · description · breadcrumb[] · preview{icon,title,subtitle,badges,meta} · inherited/derived{title,fields[]}
· metrics[] · validation[{message,tone}] · impact{title,fields[]} · approval{required,risk,message} · whatNext[{label,description}]`.
Pick the elements that fit; tones `default|muted|info|success|warning|danger`.

## 7. Global ActionModal Patterns (`ActionModalConfig`)

`title · subtitle · icon · tone(default|danger|warning|info|success) · record(toActionRecord{title,subtitle,icon,badges[],fields[]})
· warning · reason{required,label,type} · whatNext[] · confirmLabel`. Result `{confirmed, reason}`. `statusBadge(status)` maps status→tone.
Reason required in UI **only where the backend accepts it** (see §12 enforcement).

---

## 8. Module-by-Module Full Catalogue

> Legend for status/UI: EFM=EnterpriseFormModal ✅=already migrated · AM=ActionModal · IM=ImpactModal(keep) · WZ=Wizard · DR=Drawer.

### 8.1 HR ▸ Organization
Pages: OrgStructureOverview (Structure/Positions/Cost Centres/Change Requests). Files: `HR/OrgStructureOverview.tsx`,
`api/hr/organization.ts`, routes `hr.ts` (`/organization`,`/positions`,`/cost-centers`,`/employee-change-requests`).
Entities: `departments`, `hr_positions`, `finance_cost_centers`, `hr_employee_change_requests`. Perms `hr.organization.*`,
`hr.positions.*`, `hr.cost_centers.*`. Events `org.unit.created/deleted`, `org.position.created`, `org.cost_center.created`,
`org.change.requested`; audit `hr.org_unit.*`, `hr.position.created`, `hr.cost_center.created`, `hr.org_change.{requested,cancelled}`.

**FORM: New/Edit Org Unit** ✅ EFM · file `OrgStructureOverview.tsx` (UnitModal) · role admin/superadmin/hr_manager · Priority P1
- Entity: `departments` row · before: n/a → after: active (or draft change request when risk-gated)
- FIELDS:
  - **Name** `name` · text · required · create+edit · placeholder "e.g. Field Operations" · source manual · client: non-empty; server: unique name/code 409 ✅ · controls preview
  - **Code** `code` · text · optional · placeholder "e.g. OPS" · client: dup-code warning (vs `useOrgUnits`); server: unique 409 ✅
  - **Type** `orgUnitType` · select · required · enum company/division/department/team/crew/site_department · controls type-blurb + pill
  - **Manager** `managerId` · employee-picker · optional · source `useHrEmployees`
  - **Site** `siteId` · select · optional · source `useHrSites` · placeholder shows inherited site from parent
  - **Cost centre** `costCenterId` · select · optional · source `useCostCenters` · placeholder shows inherited CC from parent
  - **Description** `description` · textarea · optional
  - **Parent** (create only) · derived from `defaultParentId` (read-only)
- CONTEXT PANEL: breadcrumb (ancestor chain → new unit) · preview (type pill + code chip + type blurb) · derived: inherited site/CC from parent · metrics: sibling count · validation: dup-code · whatNext: attach positions/assign/nest; large changes route for approval
- BACKEND: hook `useCreateOrgUnit/useUpdateOrgUnit` · route `hr/organization/unit/{create,update}` · body `{name,code,orgUnitType,parentId,siteId,managerId,costCenterId,description[,unitId,expectedUpdatedAt]}` · resp `OrgMutationResult{mode,riskLevel,...}` · perm `hr.organization.manage` · audit `hr.org_unit.created`/(update UNK) · event `org.unit.created` · workflow: risk-gated change request (`mode:pendingApproval`) · server validations: unique+concurrency ✅
- PREVIEW/DATA: `useOrgUnits` already on page (breadcrumb/siblings/inherited) · new endpoint: **no** (client-computed)
- ACCEPTANCE: location✅ preview✅ inherited✅ validation✅ impact(via change req) approval✅ whatNext✅ tone-primary reason-n/a not-bare✅

**FORM: New/Edit Position** ✅ EFM (PositionModal) · Priority P1
- Entity `hr_positions` · FIELDS: **positionKey** `positionKey` text required(create) dup-key(client)+unique 409(server); **title** text required; **grade** text optional; **headcountBudget** number optional; **departmentId** org-unit-picker; **siteId** site-picker; **defaultSupervisorId** employee-picker; **reportsToPositionId** position-picker (cycle-guarded server 409); **isSafetyCritical** toggle
- CONTEXT: reporting-line preview · **Filled/Budget/Vacancy** metrics (from `Position.incumbentCount/headcountBudget/vacancy`) · safety-critical callout · dup-key validation · headcount impact
- BACKEND: `useCreate/UpdatePosition` · `hr/positions/{create,update}` · perm `hr.positions.manage` · audit `hr.position.created` · event `org.position.created` · server: key-unique + reports-to cycle 409 ✅

**FORM: New/Edit Cost Centre** ✅ EFM (CostCenterModal) · Priority P1
- Entity `finance_cost_centers` · FIELDS: **code** text (dup-code client + unique 409 server); **name** text required; **currency** text default TTD; **annualBudget** number; **departmentId** (owning unit) org-picker; **managerId** employee-picker
- CONTEXT: owning-unit breadcrumb · metrics units/positions using · dup-code validation · "shared with Finance — reuse, don't duplicate" whatNext
- BACKEND: `useCreate/UpdateCostCenter` · `hr/cost-centers/{create,update}` · perm `hr.cost_centers.manage` · audit `hr.cost_center.created` · event `org.cost_center.created` · server: code-unique 409 ✅

**FORM: Move Org Unit** ✅ EFM (MoveModal) · Priority P1 · FIELD: **newParentId** unit-picker (blocked=self+descendants). CONTEXT: from→after breadcrumb · subtree impact metrics (childCount/employeeCount/positionCount) · cycle validation · approval routing (requiresApproval when employees/positions>0). BACKEND `useMoveOrgUnit` `hr/organization/unit/move` perm `hr.organization.manage` audit `move` server cycle 409 ✅. Existing preview `hr/organization/change/preview` can back it server-side.

**ACTION: Archive/Delete Unit, Retire Position/Cost Centre** — **keep ImpactModal** (server `change/preview` impact + blockers; richer than generic AM). Priority P2. Route `.../{archive,delete,retire}` perms `hr.*.{manage,delete}`.

**ACTION: Cancel Org Change Request** — AM · route `hr/organization/change/cancel` perm `hr.organization.manage` audit `hr.org_change.cancelled` · reason optional (server). Priority P3.

### 8.2 HR ▸ Documents
Pages: HRDocumentsOverview (Register/Expiring/Requirements). Entities `hr_employee_documents`, `hr_document_requirements`.
Perms `hr.employee_documents.*`. Statuses doc `uploaded→verified|rejected|archived`.

**FORM: Upload Document** ✅ EFM · Priority P1
- FIELDS: **employeeId** employee-picker required (`useHrEmployees`); **documentType** text required; **title** text required; **confidentiality** select (internal/confidential/restricted_hr/legal/medical) default internal; **expiryDate** date optional; **file** file required (client warn >15 MB; **server size NOT enforced** ⚠)
- CONTEXT: employee breadcrumb · requirement-match (from `useDocumentRequirements` by type) · expiry preview · file-size validation · replaces-existing (needs endpoint) whatNext
- BACKEND: `useUploadHrDocument` · `hr/employees/documents/{upload-url,commit}` · perm `hr.employee_documents.upload` · server file-size **missing** ⚠ · PREVIEW: `documents/upload/preview` optional (replacesExisting/description)

**FORM: New/Edit Requirement** ✅ EFM · Priority P2
- FIELDS: **documentType** text required (readonly on edit); **label** text required; **appliesToScope** select all/role/employment_type/department; **appliesToValue** text conditional (when scope≠all); **requiresExpiry** toggle; **reminderDays** text (csv, e.g. 30,7,0)
- CONTEXT: scope label · requires-expiry badge · satisfied-by · **affectedEmployees** shown "—/Computed on save" (needs endpoint) · dup-requirement validation (client vs `useDocumentRequirements`; server dedupe **UNKNOWN**)
- BACKEND: `useCreate/UpdateRequirement` · `hr/documents/requirements/{create,update}` · perm `hr.employee_documents.requirements.manage` · audit `hr.document_requirement.{created,updated}` · PREVIEW: `documents/requirements/preview` (affectedEmployees) — can partly reuse `useComplianceOverview`

**ACTION: Verify Document** ✅ AM · route `hr/documents/verify` perm `.verify` · record shows doc/employee/confidentiality/expiry · reason no · Priority P1.
**ACTION: Archive Document** ✅ AM · route `hr/documents/archive` perm `.archive` · audit `archive` · reason no · Priority P2.
**ACTION: Run Expiry Sweep** — keep `@lib/dialog` (batch, low-risk) · route `hr/documents/expiry/run-sweep` · Priority P4.

### 8.3 HR ▸ Onboarding
Pages: Overview (widget board), CaseDetail, Tasks/Handoffs/Blocked/Reports workspaces, Package Manager/Detail, Wizard.
Entities `hr_onboarding_*`. Perms `hr.onboarding.*`. Statuses case `open|in_progress|blocked|paused|ready_for_activation|completed|cancelled`.

**WIZARD: Start Onboarding Case** WZ (keep/enrich) · Priority P1 · FIELDS: **employeeId** (picker), **packageId** (package picker `onboarding/preview-package`), **customActions** (multi), **startDate** date. CONTEXT/steps: readiness + package plan preview. Route `hrOnboarding/onboarding/start` perm `.start` audit `hr.onboarding.started`.

**ACTIONS (AM, Priority P1)** ✅ migrated:
- Pause `onboarding/pause` `.case.manage` audit `hr.onboarding.paused` · reason optional
- Resume `onboarding/resume` `.case.manage` audit `hr.onboarding.resumed`
- Mark Ready `onboarding/ready` `.case.manage` audit `hr.onboarding.ready_for_activation`
- Complete `onboarding/complete` `.complete` audit `hr.onboarding.completed`
- Cancel `onboarding/cancel` `.cancel` audit (UNK, likely `hr.onboarding.cancelled`) · reason required(UI)/optional(server)
- Provision `onboarding/provision-account` `.provision_account` audit `hr.onboarding.account_provisioned` · resp `{employeeId,workEmail,accountStatus,inviteSent,inviteLink}`

**MODALS (keep @ui, P3):** Add Task, Reassign Task, Add Custom Action (already rich). **P3 to migrate to AM:** Block Task, Resolve/Escalate/Waive Blocker, Cancel Action (currently `dialog.prompt`).

### 8.4 HR ▸ Offboarding
Pages: Overview (board) + CaseDetail. Entities `hr_offboarding_*`. Perms `hr.offboarding.*`. Statuses `draft|open|in_progress|blocked|paused|ready_for_exit|completed|cancelled`.

**FORM: New Offboarding Case** ✅ EFM · Priority P1 · FIELDS: **employeeId** employee-picker required; **reason** select resignation/termination/redundancy/end_of_contract/retirement; **ownerId** employee-picker optional (defaults to actor); **lastWorkingDay** date optional. CONTEXT: employee + reason + last-day badge · whatNext = exit tasks + 3 handoffs (IT access-removal, finance final-pay, HSE PPE-return) + finalize terminates. BACKEND `hrOffboardingApi.start` `hrOffboarding/offboarding/start` perm `.start` audit `hr.offboarding.started` event `offboarding.started` handoffs = `STANDARD_EXIT_HANDOFFS`.

**ACTIONS (AM, migrated ✅):** Finalize (danger; `.../finalize` `.finalize` audit `hr.offboarding.finalized`; terminates employee + login disabled), Cancel (reason required; `.../cancel` `.cancel`), Pause/Resume/Mark-Ready/Complete (`.../{pause,resume,mark-ready,complete}` `.case.manage`/`.complete`). Priority P1–P2. (pause/resume/cancel/complete audit strings UNK — verify.)

### 8.5 HR ▸ HR Requests
Pages: My Requests + All Requests. Entity `hr_requests`. Perms `hr.requests.{submit_own,manage}`. Statuses `submitted|in_review|approved|rejected|fulfilled|cancelled`.
- **FORM: New Request** (rich modal → EFM candidate, P2): FIELDS **requestType** select (`useRequestTypes`), **subject/title** text required, **details** textarea, (attachments? UNKNOWN). Route `hrRequests/requests/submit` perm `.submit_own` audit/event `hr.request.submitted`.
- **Decide** — kept on existing rich `DecideModal` (P2; could move to AM): route `.../decide` perm `.manage` event `hr.request.decided`.
- **Fulfill** (EFM/AM, P3): `.../fulfill` perm `.manage` audit `hr.request.fulfilled`.
- **Cancel** ✅ AM (both views): `.../cancel` perm `.submit_own` audit `hr.request.cancelled` · reason required (server accepts `reason`).

### 8.6 HR ▸ Transfers & Promotions
Page: TransfersOverview + RequestDetail. Entity `hr_employee_change_requests` + `hr_employee_status_history`. Perms `hr.transfers.*`. Statuses `draft|pending_approval|approved|applied|rejected|cancelled`.

**FORM: New Transfer/Promotion** ✅ EFM · Priority P1
- FIELDS: **employeeId** employee-picker required; **effectiveDate** date required; **departmentId** text (leave blank=keep); **siteId** text; **positionId** text; **supervisorId** employee-picker; **role** text; **monthlySalary** number; **hourlyRate** number; **reason** text optional. Rule: ≥1 change field required (client).
- CONTEXT: employee + effective date · **Requested changes** derived list (only changed fields) · fields-changing metric · maker-checker approval notice · validation employee/effective/≥1-change
- BACKEND: `hrTransfersApi.submit` `hr/transfers/request` perm `hr.transfers.request` event `org.change.requested` · workflow maker-checker (SoD). DATA gap: from→to *previous* values not loaded (only requested shown) — a `useHrEmployee` snapshot or a preview would enable a true diff (optional).

**ACTIONS (AM, migrated ✅):** Decide approve/reject/return (`hr/employee-change-requests/decide`, requireUser+SoD, `comment` reason; reject/return require reason), Cancel (`.../cancel` perm `hr.view`; **reason NOT accepted → confirm-only**, honest).

### 8.7 HR ▸ Leave & Absence
Page: LeaveOverview. Entities `hr_leave_types/_requests/_balances/_accruals`. Perms `hr.leave.*`. Statuses `pending_approval|approved|rejected|cancelled`.

**FORM: Submit Leave** ✅ EFM · Priority P1
- FIELDS: **leaveTypeId** select required (`useLeaveTypes`, controls balance context); **fromDate** date required; **toDate** date required (≥from); **reason** text optional
- CONTEXT: preview (type + dates + **working-days** Mon–Fri) · **Requested/Available/After** metrics (`useLeaveBalances`) · validation end<start, exceeds-available, **overlap** (`useMyLeaveRequests`) · approval routing · "reserved from balance while pending" whatNext
- BACKEND: `useSubmitLeave` `hrLeave/leave/request/submit` perm `hr.leave.submit` audit/event `hr.leave.submitted`. PREVIEW: reuse `hr/leave/balances/get` (exists ✅); optional combined `leave/preview` for coverage.

**ACTIONS (AM, migrated ✅):** Approve (`.../approve` `.approve` audit `hr.leave.approved`; notes optional), Reject (`.../reject` `.approve` audit `hr.leave.rejected`; **reason required**), Cancel (`.../cancel` `.cancel_own` audit `hr.leave.cancelled`; `reason` accepted → required in UI). Record shows type/dates/days/status.

**Leave-type / accrual admin** (EFM/AM, P3): `leave/types/{create,update,retire}` `.types.manage`; `accruals/run` `.accruals.run`; `balances/adjust` `.balances.adjust`.

### 8.8 HR ▸ Attendance & Timekeeping
Page: AttendanceOverview (Log/Timesheets/Exceptions). Entities `hr_attendance_records/_timesheets/_exceptions/_corrections` + `project_sites` (geofence). Perms `hr.attendance.*`.

**ACTIONS (AM, migrated ✅):** Waive Exception (`attendance/exceptions/waive` `.exceptions.manage` audit `exception.waived`; **reason required**), Resolve Exception (`.../resolve`; **note required**), Timesheet Submit/Reopen (`.../timesheets/{submit,reopen}` `.timesheets.{submit,approve}`; reopen reason optional).
**FORM: Correction / manual punch** (EFM, P3): FIELDS punch-in/out times, reason; route `attendance/records/correct` `.correct` audit `attendance.correction`. Statuses exception `open|waived|resolved`.

### 8.9 HR ▸ Compensation & Overtime
Page: CompensationOverview (Pay Items + Statutory Profile), OvertimeOverview. Entities `hr_pay_items`, `hr_overtime_entries`, `hr_employee_statutory_profiles`. Perms `hr.compensation.*`, `hr.overtime.*`, `hr.employee.statutory.*`.

**FORM: New Pay Item** (inline → EFM, P2): FIELDS **employeeId** picker required; **componentId** select required (`usePayComponents` active); **amount** number OR **percent** number (mode toggle); **effectiveFrom** date required; **effectiveTo** date optional; **note** text. CONTEXT: employee + component (taxable?) · gross/net effect · **effective overlap** (server NOT enforced ⚠) · maker-checker. Route `hr/compensation/pay-items/create` perm `.manage` audit `pay_item.created` event `hr.compensation.item.created`.
**FORM: Statutory Profile capture** (inline → EFM, P2): FIELDS **employeeId** picker; **nisNumber** text; **nisApplicable** toggle; **previousEmployerName** text; **previousEmployerEndDate** date; **openingYtdInsurableEarnings/openingYtdNisEmployee/openingYtdNisEmployer** numbers; **openingBalanceAsOf** date. CONTEXT: "HR captures; **Finance verifies**" · submit effect. Route `hr/employee-statutory/{capture,submit}` perm `.capture`.
**FORM: Log Overtime** (inline → EFM, P2): FIELDS **workDate** date; **hours** number>0; **multiplier** select 1/1.5/2; **reason** text. CONTEXT: payable-hours preview · "immutable once paid". Route `hr/overtime/submit` perm `.submit`.
**ACTIONS (AM, migrated ✅):** Pay-item Reject/Retire; Overtime Reject/Cancel; NIS not here (Finance). SoD on pay-item approve.

### 8.10 HR ▸ Shift Roster
Page: RosterOverview. Entities `hr_roster_*`. Perms `hr.roster.*`. Statuses `draft|pending_approval|returned|published|archived`.
- **FORM: New Roster** (modal → EFM, P3): FIELDS period (from/to), siteId, departmentId, patternId. CONTEXT: coverage requirements vs projected. Route `hr/roster/rosters/create`.
- **FORM: New Shift Template** (modal → EFM, P3): FIELDS name, start/end time, break, siteId. CONTEXT: net-paid-hours preview. Route `hr/roster/templates/upsert`.
- **ACTIONS (AM, P3):** Publish (`rosters/publish`), Reopen (`rosters/reopen`, reason), Deactivate template (`templates/remove`). Audit `hr.roster.*`.

### 8.11 HR ▸ Employee Master
Page: EmployeeMaster (widget board + register). Files `EmployeeMaster.tsx`, `ActionDialogs.tsx`, `CreateEmployeeWizard.tsx`, `ImportWizard.tsx`, `ProfileDrawer.tsx`. Perms `hr.employees.*`.
- **WIZARD: Create Employee** (WZ, keep — reference impl): 7 steps (Identity, Employment, Org, Contact, Statutory & Payroll, …, Review). Route `hr/employees/create` perm `hr.employees.create`. **Field-level: see `CreateEmployeeWizard.tsx`** (already rich; full port from v36).
- **DRAWER: Profile** (SidePanel, keep) — `ProfileDrawer.tsx`.
- **DIALOGS (ActionDialogs.tsx, keep @ui — reference):** Contact (`useUpdateHrContact` / change-request), Change Status (`useChangeHrStatus` `hr/employees/status-change` `.status_change`), Offboarding (status→terminated), Request Change (maker-checker `hr/employees/change-request`), Document (`useUploadHrDocument`), Statutory (`useUpdateHrStatutory` `hr/employees/statutory/update` `.statutory.update`). These already use `ModalSection`+`SystemActionsPanel` (the "what workflow will do" pattern). Priority P3 (already compliant).

### 8.12 Finance ▸ Statutory Configuration
Page: StatutoryConfigOverview (Versions/NIS Classes/Components/NIS Verification/History). Entities `finance_statutory_versions/_nis_classes`, `finance_pay_components`, `hr_employee_statutory_profiles`. Perms `finance.statutory.*`, `finance.payroll.components.*`, `finance.payroll.nis.*`.

**FORM: New Rate Version** (inline → EFM, P2): FIELDS **effectiveFrom** date; **label** text; **payePersonalAllowance/payeBand1Ceiling** number; **payeBand1Rate/payeBand2Rate** number 0–1; **hsMonthlyThreshold/hsWeeklyHigh/hsWeeklyLow** number; **nisMonthyCeiling** number optional. CONTEXT: vs current active · **PAYE band preview** (needs `paye-preview`) · maker-checker (2nd finance_manager) · overlap warning. Route `finance/statutory/versions/create` perm `.manage` event `finance.statutory.version.created` server unique 409 ✅.
**FORM: NIS Class upsert** (inline → EFM, P3): FIELDS classNo, weeklyMin, weeklyMax, employeeWeekly, employerWeekly (draft-only). Route `finance/statutory/nis-classes/upsert`.
**FORM: New Component** (inline → EFM, P3): FIELDS code (unique 409), name, kind earning/deduction, isTaxable toggle, reducesChargeable toggle. Route `finance/payroll/components/create` event `finance.payroll.component.created`.
**ACTIONS (AM, migrated ✅):** Version Reject/Activate/Retire (SoD), Component Retire, **NIS Verify/Reject** (`finance/payroll/nis/{verify,reject}` `.nis.verify`; P1).

### 8.13 Finance ▸ Payroll
Page: PayrollOverview (Runs + RunDetail Lines/Warnings/Payslips/Exports + Reports). Entities `finance_payroll_runs/_run_inputs/_run_lines/_run_warnings/_payslips/_exports`. Perms `finance.payroll.*`. Run state `draft→input_locked→calculated→pending_approval→approved→locked→exported`.

**FORM: New Pay Run** (inline → EFM, P2): FIELDS **periodMonth** month required; **payFrequency** select monthly/fortnightly/weekly; (**weeksInPeriod** number optional). CONTEXT: active statutory version · inputs pulled (approved pay items + approved overtime + statutory profiles) · eligible-employee count (needs `runs/scope-preview`). Route `finance/payroll/runs/create` perm `.run.manage` event `finance.payroll.run.created`.
**ACTIONS (AM, migrated ✅):** Lock (`runs/lock` `.lock`), Reopen (`runs/reopen` `.lock`, reason). **P2 to AM:** Submit/Calculate/Export/Generate-payslips (`runs/{submit,calculate,export}`, `payslips/generate`) — currently inline buttons; confirm-style AM showing totals + warnings. Payslips/Exports are read surfaces (Drawer/table), not forms.

### 8.14 HSE (Dashboard / PPE / Incidents / Risk-JSA / PTW / Training / Inspections / CAPA)
**Already the richest area** — dozens of `@ui` `Modal`/`Wizard`/`Drawer`/`SidePanel` (e.g. `NewJsaWizard`, `NewAssessmentWizard`,
`NewHazardDialog`, `PermitLifecycleDialogs`, `TrainingDialogs`, risk drawers). Routes `hseIncidents/hseRiskJsa/hsePtw/hseTraining/hseInspections/hseCapa`.
Perms `hse.*`. **These already meet the design bar** (rich modals/wizards/drawers). **Field-level specs: defer — read the specific
`HSE/**` component per form** (not the migration priority). Any bare `dialog.confirm/prompt` inside HSE → AM in a later pass.
**UNKNOWN — needs targeted read** for exhaustive HSE field specs.

### 8.15 Platform ▸ Settings / Security / Console
Files `Settings/SettingsSection.tsx`, `Settings/ManifestReviewPanel.tsx`, `Settings/SwzCard.tsx`, `SuperadminConsole/tabs/*`.
Routes `settings.ts`, `settingsCatalog.ts`, `adminSecurity.ts`, `superadmin.ts`, `trustedDevices.ts`, `webauthn.ts`, `auth2fa.ts`, `authStepUp.ts`, `permissionApprovals.ts`.
Perms: `hr.settings.*` confirmed; **security/superadmin/governance keys UNKNOWN — targeted grep of `permissions.ts` needed**.
- **AM candidates:** Remove Passkey, Remove Trusted Device, Deprecate Manifest, Return Manifest, SWZ reset.
- **Keep @lib/dialog:** Name/Rename Passkey (tiny).
- **Keep 2-pane @ui Modal (enrich with "N users affected"):** Console Roles/Permissions/Approvals.
- **Field-level: defer** — needs a per-file read + the missing permission keys.

### 8.16 Platform ▸ My Profile / Messages / Notifications / Tickets
`MyProfileSection.tsx` (3 Modals — already rich, recently redesigned), `Messages/ComposeThreadDialog + AccessThreadDialog`,
`NotificationCenter/BroadcastComposer + PreferencesPanel` — all rich `@ui` Modals. Priority P4 (compliant). Field-level defer.

---

## 9. Complete Field Matrix

Full field-level rows for HR + Finance forms are in **`docs/FIELD_MATRIX.json`** (field name, type, required, source, validation,
server-enforced, dependencies per form). Summary above (§8) mirrors it. HSE/Platform field rows are marked `defer` there.

## 10. Complete Data Dependency Matrix

See **`docs/DATA_DEPENDENCY_MATRIX.json`**. Highlights: every employee-picker → `useHrEmployees` (exists); org pickers →
`useOrgUnits/usePositions/useCostCenters/useHrSites` (exist); leave → `useLeaveTypes`+`useLeaveBalances`+`useMyLeaveRequests`
(all exist); transfer from→to *previous* values → **not loaded** (optional `useHrEmployee` snapshot or preview); payroll run
eligible count / PAYE preview / doc replaces-existing / requirement affected-count → **new preview endpoints** (§13).

## 11. Complete Route / Hook / Permission Matrix

See §8 per module and `docs/FORM_DIALOG_MATRIX.json`. All routes/permissions resolved in
[SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md](docs/SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md) §12.

## 12. Complete Audit / Event Matrix

Resolved `eventType` + `action` strings per action are in BACKEND_MAPPING §0/§7 and embedded in §8 above. Remaining UNKNOWNs:
offboarding pause/resume/cancel/complete; onboarding cancel; request decide; document verify/upload; statutory-profile capture;
finance run lock/submit/export; org unit update/move/archive — small targeted reads to close.

## 13. Preview Endpoint Requirements (all NEW unless noted)

| Endpoint | Feeds | Necessity |
|---|---|---|
| `hr/leave/balances/get` (**exists ✅**) | Submit-Leave balance | reuse now |
| `hr/organization/change/preview` (**exists ✅**) | Move/Archive/Delete/Retire impact | reuse now |
| `hr/organization/{position,cost-center}/preview` | position/CC inherited + counts | optional |
| `hr/documents/upload/preview` | replacesExisting + description | optional |
| `hr/documents/requirements/preview` | affectedEmployees | optional (partial reuse `useComplianceOverview`) |
| `finance/statutory/paye-preview` | PAYE band sample (wraps existing `computePaye`) | optional (New Rate Version) |
| `finance/payroll/runs/scope-preview` | active version + inputs + employee count | optional (New Pay Run) |
| `hr/leave/preview` | working-days + overlap + coverage | optional (client already assembles) |

## 14. Backend Enforcement Gaps (deferred hardening — see docs/DIALOGS_BACKEND_HARDENING_TODO.md)

1. Document upload **file-size** not server-enforced. 2. Pay-item **effective-date overlap** not enforced. 3. **Reason** on
reject/cancel mostly `.optional()` server-side (UI-only). 4. Document-requirement **duplicate** guard unconfirmed.
(Dedupe + cycle checks ARE enforced 409 ✅.)

## 15. Implementation Priority Plan

- **Done ✅:** Org (Unit/Position/CostCentre/Move), Documents (Upload/Requirement/Verify/Archive), Offboarding (New Case + lifecycle),
  Onboarding (6 lifecycle), Requests (cancel), Transfers (New + decide/cancel), Leave (submit + approve/reject/cancel), Attendance
  (waive/resolve), Compensation/Overtime (reject/retire/cancel), Finance (version/component/NIS/run lifecycle).
- **P2 next:** New Pay Item, Statutory Profile, Log Overtime → EFM; New Rate Version / New Pay Run → EFM (+ optional previews);
  Payroll Submit/Calculate/Export/Payslips → AM; Requests New/Decide → EFM/AM.
- **P3:** Roster forms + actions; NIS class / Component forms; Onboarding/Offboarding FSM sub-actions; Leave-type/accrual admin;
  Attendance correction; Employee Master dialogs (already rich).
- **P4 / keep:** HSE (already rich), Settings/Console (needs perm-key read), My Profile/Messages/Notifications, tiny `@lib/dialog` actions.

## 16. Open Questions

1. Exhaustive **HSE** + **Settings/Console** field-level specs — do a targeted per-file read pass, or accept "already rich `@ui`,
   migrate only bare dialogs"?
2. Missing **security/superadmin/governance permission keys** — confirm via `permissions.ts` grep before wiring those AMs.
3. **Transfers from→to** true diff — load current employee snapshot (`useHrEmployee`) on the New Transfer form, or add a preview?
4. Build the **optional preview endpoints** (§13) now (richer context) or ship client-computed context first?
5. Remaining **UNKNOWN audit strings** (§12) — close by reading each `lib/*` mutation, or accept "reuse module pattern"?
6. **Legacy removal** (Employees/Departments/Attendance/Leaves/Payroll/HourlyRates) — separate initiative; blocked on ESS/manager/LiveMap replacements.

---

**End of catalogue. No code changed. JSON appendices: `docs/FORM_DIALOG_MATRIX.json`, `docs/FIELD_MATRIX.json`,
`docs/DATA_DEPENDENCY_MATRIX.json`. Awaiting approval before any implementation.**
