# SIOMAC — Forms & Dialogs Backend Mapping (Discovery Pass 2)

_Resolves the UNKNOWNs and enforcement gaps in [SIOMAC_FORMS_DIALOGS_ARCHITECTURE.md](docs/SIOMAC_FORMS_DIALOGS_ARCHITECTURE.md).
No code changed. All routes, permissions, `eventType`/`action` strings, Zod schemas, and enforcement below were read
from the repo. Remaining gaps are marked **UNKNOWN — needs confirmation**._

Files inspected: `netlify/functions/routes/*` (hr, hrOffboarding, hrOnboarding, hrRequests, hrLeave, hrAttendance,
hrCompensation, hrOvertime, hrStatutoryProfile, financeStatutory, financePayroll, financeNis), `netlify/functions/lib/hr/*`
(organizationCore/Mutations, compensationMutations, offboardingCore, documents*), `netlify/functions/lib/finance/*`
(statutoryConfig, payrollComponents), `src/api/hr/*`, `src/api/finance/*`.

---

## 0. Cross-cutting findings (apply to every module)

- **Reason is NOT server-enforced on most reject/cancel actions.** Almost every `reason` Zod field is
  `z.string().max(500).optional()` (or `.nullable().optional()`). Only **two** sites use `.min(1)` (required).
  → The `ActionModal` "reason required" is a **client-side UX convention only**. If a mandatory reason is a policy
  requirement (audit), it must ALSO be enforced server-side (currently a gap).
- **Dedupe + hierarchy cycles ARE server-enforced (HTTP 409).** Confirmed in `organizationMutations.ts` /
  `statutoryConfig.ts` / `payrollComponents.ts`:
  - org unit name/code unique (`23505` → 409), position key unique, cost-centre code unique
  - `assertNoOrgCycle` (move) + `assertNoPositionCycle` (reports-to) → 409
  - statutory version (effective_from + jurisdiction) unique, pay-component code unique, NIS class `onConflict(version,class_no)`
  → The client dedupe/cycle checks in the migrated modals are **UX niceties over real server enforcement** (good).
- **File-size is NOT server-enforced** for document upload (only list `pageSize` caps found). The 15 MB check is client-only → **gap**.
- **Pay-item effective-date overlap is NOT enforced** server-side (no overlap check found in `compensationMutations.ts`) → **gap**.
- **Mutation side-effects** use `emitAppEvent({ eventType, sourceModule, sourceEntityType, sourceEntityId, actorUserId, severity, payload })`
  (void) + `writeHrAudit({ submoduleKey, recordId, actorId, action, previousState, newState })` (awaited, throws).
- **Existing preview endpoints:** `/organization/change/preview` (impact — powers ImpactModal; covers archive/delete/retire/move),
  `/onboarding/preview-package`, `/onboarding/communications/preview`. **No other preview endpoints exist.**
- **Some SoD "action" strings in grep are `assertDifferentApprover` messages, not audit actions** (e.g. "approve a pay item
  they created") — distinguished below.

---

## 1. HR Organization

- **Files:** `routes/hr.ts` (`/organization/*`, `/positions/*`, `/cost-centers/*`), `lib/hr/organizationCore.ts` + `organizationMutations.ts`, `src/api/hr/organization.ts`
- **Resolved routes / perms:**
  - `hr/organization/unit/{create,update,move,archive}` → `hr.organization.manage`; `.../unit/delete` → `hr.organization.delete`; `.../unit/get`,`/tree`,`/stats`,`/health` → `hr.organization.view`
  - `hr/organization/change/preview` → `hr.organization.view`; `.../changes/list`,`/change/get` → view; `.../change/cancel` → `hr.organization.manage`; `.../changes/apply-due` → (requireUser, cron)
  - `hr/positions/{create,update,retire}` → `hr.positions.manage`; `list/get` → `hr.positions.view`
  - `hr/cost-centers/{create,update,retire}` → `hr.cost_centers.manage`; `list` → `hr.cost_centers.view`
- **Hooks:** `src/api/hr/organization.ts` — `useCreateOrgUnit/useUpdateOrgUnit/useMoveOrgUnit/useArchiveOrgUnit/useDeleteOrgUnit`, `useCreatePosition/useUpdatePosition/useRetirePosition`, `useCreateCostCenter/useUpdateCostCenter/useRetireCostCenter`, `useOrgChangeRequests/useCancelOrgChange`, `hrOrganizationApi`
- **Statuses:** unit/position/cost-centre `isActive`; change request `pending_approval → approved | rejected | applied | cancelled`
- **Audit/event strings:** events `org.unit.created`, `org.unit.deleted`, `org.position.created`, `org.cost_center.created`, `org.change.requested`; audit `hr.org_unit.created`, `hr.org_unit.deleted`, `hr.position.created`, `hr.cost_center.created`, `hr.org_change.requested`, `hr.org_change.cancelled`, plus short actions `move` / `archive` / `delete` (update/move/archive audit action exactness **UNKNOWN — verify `organizationMutations.ts`**)
- **Server validations confirmed:** unit name/code unique (409), position key unique (409), cost-centre code unique (409), move cycle (409), reports-to cycle (409), optimistic concurrency (`expectedUpdatedAt`)
- **Server validations missing:** none material for these forms
- **Preview existing:** `hr/organization/change/preview` (impact + blockers) — **already powers ImpactModal and can back Move**
- **Preview required:** position/cost-centre "inherited + counts" previews are **optional enhancements** (client already approximates; server preferred for accuracy) — NOT required for correctness
- **Remaining UNKNOWN:** exact update/move/archive audit action strings
- **Risk:** LOW — create/edit/move already migrated ✅; enforcement solid.

## 2. HR Documents

- **Files:** `routes/hr.ts` (`/documents/*`, `/employees/documents/*`), `lib/hr/documents*`, `src/api/hr/documents.ts`
- **Resolved routes / perms:**
  - `hr/employees/documents/upload-url` + `.../commit` → `hr.employee_documents.upload`
  - `hr/documents/verify` → `hr.employee_documents.verify`; `.../archive` → `hr.employee_documents.archive`; `.../download-url` → `.download`; `list/stats/expiring/compliance` → `.view`
  - `hr/documents/requirements/{create,update,retire}` → `hr.employee_documents.requirements.manage`; `.../requirements/list` → `.view`
  - `hr/documents/expiry/run-sweep` → `.view` (batch)
- **Hooks:** `useUploadHrDocument`, `useVerifyHrDocument`, `useArchiveHrDocument`, `useCreateRequirement/useUpdateRequirement/useRetireRequirement`, `useComplianceOverview`, `getHrDocumentDownloadUrl`, `useRunExpirySweep`
- **Statuses:** document `uploaded → verified | rejected | archived`; expiry state valid/expiring/expired
- **Audit/event strings:** events `hr.document_requirement.{created,updated,retired}`, `hr.document.expiry_reminder`; audit `hr.document_requirement.{created,updated,retired}`, `archive`. Verify/upload audit action **UNKNOWN — verify `lib/hr/documents*`**
- **Server validations confirmed:** requirement uniqueness **UNKNOWN — verify**; permission gating ✅
- **Server validations missing:** **file-size not enforced server-side** (client-only 15 MB); duplicate-requirement enforcement **UNKNOWN**
- **Preview existing:** none for documents
- **Preview required:** `documents/upload/preview` (requirement-match + replacesExisting) and `documents/requirements/preview` (affectedEmployees) — **can partly reuse** `useComplianceOverview` for affected counts; strictly NEW for replacesExisting
- **Risk:** LOW — Upload/Requirement/Verify/Archive already migrated ✅.

## 3. Offboarding

- **Files:** `routes/hrOffboarding.ts`, `lib/hr/offboardingCore.ts` (+ mutations), `src/api/hr/offboarding.ts`
- **Resolved routes / perms:** `hrOffboarding/offboarding/{start→hr.offboarding.start, list/get/dashboard-stats→.view, task/complete→.task.manage, pause/resume/mark-ready/reassign-owner→.case.manage, complete→.complete, cancel→.cancel, finalize→.finalize}`
- **Hooks:** `hrOffboardingApi` + `useOffboardingMutation` wrappers
- **Statuses:** `draft|open|in_progress|blocked|paused|ready_for_exit|completed|cancelled`; task `pending|in_progress|completed|skipped|blocked`; handoff `pending|delivered|cancelled`; blocker `open|resolved|waived`
- **Audit/event strings:** events `offboarding.started`, `offboarding.finalized`, `offboarding.task.completed`, `offboarding.owner.reassigned`, `offboarding.handoff.created`; audit `hr.offboarding.{started,finalized,owner_reassigned,task_completed}`. **pause/resume/mark-ready/cancel/complete audit+event strings UNKNOWN — verify `offboardingMutations.ts`** (only started/finalized surfaced)
- **Handoff/side effects (CONFIRMED):** start creates `STANDARD_EXIT_HANDOFFS` = **it_access_removal, finance_final_pay, hse_ppe_return** (recorded intents); **finalize** sets employee status `terminated` (existing status machine → auth `inactive`, login disabled). Access-removal is a task (`access_removal`, owner `it`, blocking) + handoff intent.
- **Reason server-enforced?** cancel `reason` = `.optional()` (NOT required). finalize = confirm, no reason.
- **Preview existing/required:** none / none
- **Risk:** MEDIUM — **Finalize is high-impact** (terminates employee); AM must clearly show effects. pause/resume/cancel audit strings need one more read.

## 4. Onboarding

- **Files:** `routes/hrOnboarding.ts`, `lib/hr/onboarding*` + `accountProvisioning.ts`, `src/api/hr/onboarding.ts`
- **Resolved routes / perms:** `hrOnboarding/onboarding/{start→.start, pause/resume/ready→.case.manage, complete→.complete, cancel→.cancel, provision-account→.provision_account, task/complete→.task.manage, handoff/complete|cancel→.case.manage}`
- **Hooks:** `hrOnboardingApi`; `useOnboardingProvisionAccount` (returns `{employeeId, workEmail, accountStatus, inviteSent, inviteLink}`), `useOnboardingCancelCase`, `useOnboardingResolveBlocker/EscalateBlocker/NotifyBlockerOwner`, `useOnboardingCompleteHandoff`, etc.
- **Statuses:** case `open|in_progress|blocked|paused|ready_for_activation|completed|cancelled`
- **Audit/event strings:** events `onboarding.started`, `onboarding.completed`, `onboarding.case.paused`, `onboarding.case.resumed`, `onboarding.case.ready_for_activation`, `onboarding.account.provisioned`, `onboarding.account.activated`, handoff/blocker/custom-action events (full set present); audit `hr.onboarding.{started,paused,resumed,ready_for_activation,completed,account_provisioned,account_activated,...}`. **`onboarding.cancel` audit/event string UNKNOWN — verify** (not in grep; likely `hr.onboarding.cancelled`)
- **Reason server-enforced?** cancel `reason` `.optional()` — NOT required
- **Handoff/side effects:** provision-account creates login + optional invite; blocker notify/escalate emit events + notifications
- **Preview existing:** `onboarding/preview-package`, `onboarding/communications/preview`
- **Risk:** MEDIUM — 6 lifecycle actions to AM; **Provision** shows created work-email/login (rich); confirm cancel audit string.

## 5. HR Requests

- **Files:** `routes/hrRequests.ts`, `lib/hr/requests*`, `src/api/hr/requests.ts` (`hrRequestsApi`)
- **Resolved routes / perms:** `hrRequests/requests/{types→.submit_own, submit→.submit_own, my→.submit_own, get→.submit_own, list→.manage, decide→.manage, fulfill→.manage, cancel→.submit_own}`
- **Statuses:** `submitted|in_review|approved|rejected|fulfilled|cancelled`
- **Audit/event strings:** events `hr.request.{submitted,decided,fulfilled,cancelled}`; audit `hr.request.{submitted,fulfilled,cancelled}` (decide audit action **UNKNOWN — verify**, likely `hr.request.decided`)
- **Reason server-enforced?** decide/cancel reason `.optional()` — NOT required
- **Server validations:** type/subject required (Zod) — **verify exact schema**
- **Preview:** none / none
- **Risk:** LOW.

## 6. Transfers & Promotions

- **Files:** `routes/hr.ts` (`/transfers/*`, `/employee-change-requests/*`), `lib/hr/*changeRequest*` / `employeeCore`, `src/api/hr/transfers.ts` (`hrTransfersApi`)
- **Resolved routes / perms:** `hr/transfers/request` → `hr.transfers.request`; `hr/transfers/list` → `hr.transfers.view`; `hr/employee-change-requests/list` → `hr.view`; `.../decide` → **(requireUser)** (self-scoped: assignee acts); `.../cancel` → `hr.view`. Also direct `hr/employees/{transfer→hr.employees.transfer, supervisor-change→hr.employees.supervisor_change, status-change→hr.employees.status_change}`
- **Statuses:** change request `draft|pending_approval|approved|applied|rejected|cancelled`; employee status history via `hr_employee_status_history`
- **from→to diff payload:** the change request stores the proposed change; the diff must be assembled from the request's payload vs current employee (exact field shape **UNKNOWN — verify `hrTransfers` DTO** for a `changes`/`fromTo` object)
- **Audit/event strings:** events `hr.employee.change_applied`, `hr.employee.status_changed`, `org.change.requested`; audit `hr.employee.change_applied`, `hr.employee.status_changed`. Transfer-request-specific audit **UNKNOWN — verify**
- **Workflow:** maker-checker via `hr_employee_change_requests` + central workflow; `decide` is self-scoped (SoD: creator ≠ approver enforced — **verify `assertDifferentApprover`**)
- **Reason server-enforced?** decide reason `.optional()`
- **Risk:** MEDIUM — New Transfer EFM needs the from→to diff payload shape confirmed.

## 7. Leave & Absence

- **Files:** `routes/hrLeave.ts`, `lib/hr/leave*`, `src/api/hr/leave.ts` (`hrLeaveApi`), legacy `src/api/leave.ts`
- **Resolved routes / perms:**
  - `hrLeave/leave/request/{submit→hr.leave.submit, update→.submit, cancel→.cancel_own, approve→.approve, reject→.approve, list→.view, list-all→.view_all, get→.view}`
  - `hrLeave/leave/balances/{get→hr.leave.balances.view, adjust→.balances.adjust}`; `accruals/run→.accruals.run`; `calendar/get→.calendar.view`; `types/{create,update,retire}→.types.manage`; `reports/*→.reports.{view,export}`
- **Entity names:** `hr_leave_types`, `hr_leave_requests`, `hr_leave_balances`, accruals (**exact table names verify `lib/hr/leave*`**)
- **Statuses:** request `pending_approval|approved|rejected|cancelled`
- **Audit/event strings:** events `hr.leave.{submitted,approved,rejected,cancelled}`, `hr.leave_type.{created,updated,retired}`; audit `hr.leave.{submitted,approved,rejected,cancelled,updated}`, `hr.leave.balance.adjusted`, `hr.leave.accruals.run`, `hr.leave.report.exported`, `hr.leave_type.*`
- **Balance source (CONFIRMED):** **`hr/leave/balances/get`** exists (perm `hr.leave.balances.view`) → the Submit-Leave preview can **reuse this** (entitled/taken/remaining). A dedicated combined `leave/preview` (adds working-days + overlap + coverage) would be nicer but is **optional**.
- **Reason server-enforced?** reject reason **UNKNOWN — verify** (approve/reject schema); cancel reason likely optional
- **Preview existing:** balances/get (partial) — **no** combined leave preview
- **Preview required:** `leave/preview` OPTIONAL (working-days + overlap + coverage); balances already available
- **Risk:** MEDIUM — Submit-Leave is P1; the richest context (overlap/coverage) needs either a new preview or client assembly from list + balances.

## 8. Attendance & Timekeeping

- **Files:** `routes/hrAttendance.ts`, `lib/hr/attendance*` (capture/exceptions/corrections/queries/reports/timekeepingCompute), `src/api/hr/attendance.ts`
- **Resolved routes / perms:**
  - `hrAttendance/attendance/exceptions/{waive,resolve}` → `hr.attendance.exceptions.manage`; `.../exceptions/list` → `.exceptions.view`
  - `.../timesheets/{build,submit}` → `.timesheets.submit`; `.../timesheets/reopen` → `.timesheets.approve`; `.../timesheets/list/get` → `.timesheets.view`
  - `.../records/correct` → `hr.attendance.correct`; `.../punch/{in,out}` → `.punch`; `.../compute/run` → `.compute.run`
- **Hooks:** `useWaiveException`, `useResolveException`, `useSubmitTimesheet`, `useReopenTimesheet`, `useAttendanceRecords/Timesheets/Exceptions/Stats`
- **Statuses:** exception `open|waived|resolved`; record status present/absent/late/on_leave/holiday/missing_punch; timesheet status **UNKNOWN — verify** (submitted/approved/reopened)
- **Audit/event strings:** events `hr.attendance.{exception_opened,exception_waived,exception_resolved,correction_applied,punched_in,punched_out,timesheet_built}`, `hr.timesheet.{submitted,approved,reopened}`; audit `exception.waived`, `exception.resolved`, `attendance.correction`
- **Reason/note server-enforced?** waive `reason` / resolve `note` — schema **UNKNOWN — verify `hrAttendance.ts`** (likely `.min(1)` given they are the payload; ONE of the two `.min(1)` sites found may be here)
- **Preview:** none / none
- **Risk:** LOW — Waive/Resolve to AM is straightforward.

## 9. Compensation / Overtime / Statutory Profile

- **Files:** `routes/{hrCompensation,hrOvertime,hrStatutoryProfile}.ts`, `lib/hr/{compensationMutations,overtimeMutations,statutoryProfile*}.ts`, `src/api/hr/{compensation,overtime,statutoryProfile}.ts`
- **Resolved routes / perms:**
  - `hr/compensation/pay-items/{create→hr.compensation.manage, submit→.manage, approve→.approve, reject→.approve, retire→.manage, list/get→.view}`
  - `hr/overtime/{submit→hr.overtime.submit, approve→.approve, reject→.approve, cancel→.submit, list/get→.view}`
  - `hr/employee-statutory/{get→hr.employee.statutory.view, capture→.capture, submit→.capture}`
- **Statuses:** pay-item `draft|pending_approval|approved|active|retired|rejected`; overtime `submitted|approved|rejected|paid|cancelled`; profile `pending_verification|verified|not_available|not_applicable|exempt`
- **Audit/event strings:** events `hr.compensation.item.{created,submitted,approved,rejected,retired}`, `hr.overtime.{submitted,approved,rejected,cancelled}`; audit `pay_item.{created,submitted,approved,rejected,retired}`, `overtime.{submitted,approved,rejected,cancelled}`. Statutory-profile capture/submit audit **UNKNOWN — verify**
- **Workflow (CONFIRMED):** pay-item approve uses **`assertDifferentApprover`** ("approve a pay item they created") — SoD enforced. Statutory version similarly.
- **Server validations missing:** **pay-item effective-date overlap NOT enforced** (no overlap check found) → gap
- **Reason server-enforced?** pay-item/overtime reject reason `.optional()`
- **Preview:** none / gross-net effect + overlap = OPTIONAL new preview
- **Risk:** LOW — reject/retire already migrated ✅; create forms are P2.

## 10. Payroll / Statutory Finance

- **Files:** `routes/{financeStatutory,financePayroll,financeNis}.ts`, `lib/finance/{statutoryConfig,payrollComponents,payrollRuns,payrollStatutory}.ts`, `src/api/finance/{statutory,payroll}.ts`
- **Resolved routes / perms:**
  - Versions: `finance/statutory/versions/{create,update,retire→finance.statutory.manage; submit→.manage; approve,reject,activate→finance.statutory.approve}`; `nis-classes/upsert→.manage`
  - Components: `finance/payroll/components/{create,update,retire}→finance.payroll.components.manage`
  - Runs: `finance/payroll/runs/{create,lock-inputs,calculate,submit→finance.payroll.run.manage; lock,reopen→finance.payroll.lock; export→finance.payroll.export}`; `payslips/generate→view_all`; `payslips/my,get,signed-url→view_own`
  - NIS: `finance/payroll/nis/{verify,reject}→finance.payroll.nis.verify; list,get→.view`
- **Run state machine (CONFIRMED):** `draft →lock-inputs→ input_locked →calculate→ calculated →submit→ pending_approval →[workflow approve]→ approved →lock→ locked →export→ exported`; `reopen` (locked→draft, clears lines+inputs; blocked if exported)
- **Audit/event strings:** events `finance.statutory.version.{created,submitted,approved,rejected,activated,retired}`, `finance.payroll.component.{created,updated,retired}`, `finance.payroll.run.{created,inputs_locked,calculated}`; audit `pay_component.{created,retired}` + SoD messages "approve/activate a statutory version they created", "approve a payroll run". Run lock/submit/export audit action strings **UNKNOWN — verify `payrollRuns.ts`**
- **Server validations confirmed:** version unique (effective+jurisdiction, 409), component code unique (409), NIS class upsert conflict-safe, run state guards (`status !== 'x'` throws)
- **Workflow (CONFIRMED):** version approve + run approve go through central workflow + `assertDifferentApprover` (SoD)
- **PAYE/statutory preview helpers:** compute helpers exist in `lib/finance/payrollStatutory.ts` (`computeNis/computeHealthSurcharge/computePaye/computeRunLine`) but **no HTTP preview endpoint** — a `paye-preview` route would wrap these (NEW)
- **Preview:** none exposed / `paye-preview` + `runs/scope-preview` = NEW (optional for P2 forms)
- **Risk:** LOW — Lock/Reopen/Verify-NIS/version-lifecycle already migrated ✅.

## 11. Settings / Security / Console

- **Files:** `routes/{settings,settingsCatalog,adminSecurity,superadmin,trustedDevices,webauthn,auth2fa,authStepUp,permissionApprovals}.ts`, `SuperadminConsole/tabs/*`, `Settings/*`
- **Resolved perms:** `hr.settings.*` (6) confirmed present; security/superadmin/governance keys **UNKNOWN — needs a targeted grep of `permissions.ts` for `security.*` / `superadmin.*` / `settings.governance.*`** (not completed this pass)
- **Audit/event:** these routes write `audit_logs` (platform) rather than `writeHrAudit`; exact actions **UNKNOWN — verify**
- **Recommendation (UI):** Remove passkey / trusted device / deprecate-manifest / return-manifest → **ActionModal**; rename passkey / SWZ reset → keep **@lib/dialog** (tiny, low-risk); Console role/permission modals → keep 2-pane `@ui Modal`, enrich with "N users affected".
- **Risk:** LOW-MEDIUM — needs a dedicated permission-key + audit read before wiring; treat as a **separate security-UX pass**.

---

## 12. Master table — Action/Form → backend readiness

| Action/Form | Route | Hook | Permission | Audit action | App event | Reason req? | Backend enforces? | Preview needed? | Ready? |
|---|---|---|---|---|---|---|---|---|---|
| Org Unit create/edit ✅ | `hr/organization/unit/{create,update}` | useCreate/UpdateOrgUnit | hr.organization.manage | hr.org_unit.created / (update UNK) | org.unit.created | no | dedupe 409 ✅ | no | **YES** |
| Org Unit move ✅ | `hr/organization/unit/move` | useMoveOrgUnit | hr.organization.manage | `move` | org.change.requested | no | cycle 409 ✅ | reuse `change/preview` | **YES** |
| Org Unit archive/delete/retire pos/CC | `.../{archive,delete,retire}` | useArchive/Delete/Retire* | .manage/.delete | archive/delete/retire | org.unit.deleted… | no | ✅ | uses `change/preview` (IM) | **YES (keep IM)** |
| Position create/edit ✅ | `hr/positions/{create,update}` | useCreate/UpdatePosition | hr.positions.manage | hr.position.created | org.position.created | no | key-unique + cycle 409 ✅ | optional | **YES** |
| Cost Centre create/edit ✅ | `hr/cost-centers/{create,update}` | useCreate/UpdateCostCenter | hr.cost_centers.manage | hr.cost_center.created | org.cost_center.created | no | code-unique 409 ✅ | optional | **YES** |
| Org change cancel | `hr/organization/change/cancel` | useCancelOrgChange | hr.organization.manage | hr.org_change.cancelled | — | no | ✅ | no | YES |
| Doc Upload ✅ | `hr/employees/documents/{upload-url,commit}` | useUploadHrDocument | hr.employee_documents.upload | UNK | — | n/a | **file-size NOT enforced** ⚠ | `upload/preview` (opt) | YES (gap: size) |
| Doc Verify ✅ | `hr/documents/verify` | useVerifyHrDocument | hr.employee_documents.verify | UNK | — | no | ✅ | no | YES |
| Doc Archive ✅ | `hr/documents/archive` | useArchiveHrDocument | hr.employee_documents.archive | archive | — | no | ✅ | no | YES |
| Requirement create/edit ✅ | `hr/documents/requirements/{create,update}` | useCreate/UpdateRequirement | hr.employee_documents.requirements.manage | hr.document_requirement.created/updated | same | no | dup UNK | `requirements/preview` (opt) | YES |
| Offboarding New Case | `hrOffboarding/offboarding/start` | hrOffboardingApi | hr.offboarding.start | hr.offboarding.started | offboarding.started | no | ✅ | no | YES |
| **Offboarding Finalize** | `.../finalize` | hrOffboardingApi | hr.offboarding.finalize | hr.offboarding.finalized | offboarding.finalized | no | ✅ (terminates emp + handoffs) | no | **YES (high-impact)** |
| Offboarding cancel/pause/resume/mark-ready | `.../{cancel,pause,resume,mark-ready}` | hrOffboardingApi | .cancel / .case.manage | UNK (verify) | UNK | cancel reason optional | ✅ | no | YES (audit str UNK) |
| Onboarding pause/resume/ready/complete | `hrOnboarding/onboarding/{pause,resume,ready,complete}` | hrOnboardingApi | .case.manage / .complete | hr.onboarding.{paused,resumed,ready_for_activation,completed} | onboarding.case.* | no | ✅ | no | YES |
| Onboarding cancel | `.../cancel` | useOnboardingCancelCase | hr.onboarding.cancel | UNK (verify) | UNK | optional | ✅ | no | YES (audit str UNK) |
| Onboarding provision | `.../provision-account` | useOnboardingProvisionAccount | hr.onboarding.provision_account | hr.onboarding.account_provisioned | onboarding.account.provisioned | no | ✅ | returns workEmail/invite | YES |
| Requests decide | `hrRequests/requests/decide` | hrRequestsApi | hr.requests.manage | hr.request.decided (verify) | hr.request.decided | no | ✅ | no | YES |
| Requests cancel/fulfill/submit | `.../{cancel,fulfill,submit}` | hrRequestsApi | .submit_own/.manage | hr.request.{cancelled,fulfilled,submitted} | same | no | ✅ | no | YES |
| Transfer request (new) | `hr/transfers/request` | hrTransfersApi | hr.transfers.request | UNK | org.change.requested | no | ✅ | needs from→to diff shape | PARTIAL (diff UNK) |
| Transfer decide | `hr/employee-change-requests/decide` | hrTransfersApi | (requireUser + SoD) | hr.employee.change_applied | hr.employee.change_applied | no | SoD ✅ | no | YES |
| Leave submit | `hrLeave/leave/request/submit` | hrLeaveApi | hr.leave.submit | hr.leave.submitted | hr.leave.submitted | no | ✅ | reuse `balances/get`; `leave/preview` opt | YES |
| Leave approve/reject | `.../request/{approve,reject}` | hrLeaveApi | hr.leave.approve | hr.leave.{approved,rejected} | same | reject UNK | ✅ | no | YES |
| Leave cancel | `.../request/cancel` | hrLeaveApi | hr.leave.cancel_own | hr.leave.cancelled | hr.leave.cancelled | optional | ✅ | no | YES |
| Attendance waive/resolve ✎ | `hrAttendance/attendance/exceptions/{waive,resolve}` | useWaive/ResolveException | hr.attendance.exceptions.manage | exception.waived / exception.resolved | hr.attendance.exception_* | likely `.min(1)` (verify) | ✅ | no | YES |
| Timesheet submit/reopen | `.../timesheets/{submit,reopen}` | useSubmit/ReopenTimesheet | .timesheets.{submit,approve} | UNK | hr.timesheet.* | reopen optional | ✅ | no | YES |
| Pay item create | `hr/compensation/pay-items/create` | hrCompensationApi | hr.compensation.manage | pay_item.created | hr.compensation.item.created | n/a | **overlap NOT enforced** ⚠ | opt | YES (gap: overlap) |
| Pay item reject/retire ✅ | `.../{reject,retire}` | hrCompensationApi | .approve/.manage | pay_item.{rejected,retired} | same | reject optional | SoD ✅ | no | YES |
| Overtime submit/reject/cancel ✅ | `hr/overtime/{submit,reject,cancel}` | hrOvertimeApi | .submit/.approve | overtime.* | hr.overtime.* | optional | ✅ | no | YES |
| Statutory profile capture/submit | `hr/employee-statutory/{capture,submit}` | hrStatutoryProfileApi | hr.employee.statutory.capture | UNK | — | n/a | ✅ | no | YES |
| Rate version create ✅(lifecycle) | `finance/statutory/versions/create` | financeStatutoryApi | finance.statutory.manage | UNK (create) | finance.statutory.version.created | n/a | unique 409 ✅ | `paye-preview` opt | YES |
| Version reject/activate/retire ✅ | `.../versions/{reject,activate,retire}` | financeStatutoryApi | .approve/.manage | (SoD msgs) | finance.statutory.version.* | reject optional | SoD ✅ | no | YES |
| Component create/retire | `finance/payroll/components/{create,retire}` | financeStatutoryApi | finance.payroll.components.manage | pay_component.{created,retired} | finance.payroll.component.* | n/a | code-unique 409 ✅ | no | YES |
| NIS verify/reject ✅ | `finance/payroll/nis/{verify,reject}` | financePayrollApi | finance.payroll.nis.verify | UNK | — | reject optional | ✅ | no | YES |
| Pay run create | `finance/payroll/runs/create` | financePayrollApi | finance.payroll.run.manage | finance.payroll.run.created | same | n/a | state guards ✅ | `runs/scope-preview` opt | YES |
| Run lock/reopen ✅ | `.../runs/{lock,reopen}` | financePayrollApi | finance.payroll.lock | UNK | — | reopen optional | state guards ✅ | no | YES |
| Run submit/calculate/export/payslips | `.../runs/{submit,calculate,export}`,`/payslips/generate` | financePayrollApi | .run.manage/.export/view_all | run.{inputs_locked,calculated} | same | n/a | state guards ✅ | no | YES |
| Settings: passkey/device/manifest | `webauthn/*`,`trustedDevices/*`,`settingsCatalog/*` | (various) | UNKNOWN | audit_logs (UNK) | — | varies | ✅ (assumed) | no | PARTIAL (perms UNK) |

Legend: ✅ already migrated · ✎ verify reason schema · ⚠ enforcement gap · UNK = UNKNOWN.

---

## 13. Enforcement gap summary (for a later hardening task — not this pass)

1. **Document upload file-size** — client-only 15 MB; add a server cap in `upload-url`/`commit`.
2. **Pay-item effective-date overlap** — not checked server-side; add an overlap guard in `compensationMutations.createPayItem`.
3. **Reason-required** — `ActionModal` requires reason on reject/cancel but backend accepts `.optional()`; if policy needs it,
   change the relevant Zod fields to `.min(1)` (candidates: offboarding cancel, onboarding cancel, request/leave/version/NIS reject).
4. **Requirement duplicate** — confirm/adds a uniqueness guard for `(documentType, appliesToScope, appliesToValue)`.

## 14. Remaining UNKNOWNs (small, targeted reads to close)

- Exact audit-action strings for: offboarding pause/resume/mark-ready/cancel/complete; onboarding cancel; request decide;
  document verify/upload; statutory-profile capture/submit; finance run lock/submit/export; org unit update/move/archive.
- Attendance waive/resolve reason/note Zod (`.min(1)`?) — one of the two `.min(1)` sites is likely here; confirm which.
- Transfers `hr_employee_change_requests` DTO **from→to diff** payload shape (for the New Transfer EFM).
- Leave table names + reject-reason schema.
- Settings/Security/Console exact permission keys + audit behavior (separate security-UX pass).

## 15. Readiness verdict

- **Ready to implement now (no backend change):** all P1 lifecycle → ActionModal (Offboarding finalize/cancel/pause/resume,
  Onboarding 6, Requests decide/cancel, Transfers decide, Attendance waive/resolve, Leave approve/reject/cancel) — routes,
  hooks, permissions, statuses all resolved; server enforcement present.
- **Ready with client-only context:** Leave submit (reuse `balances/get`), Transfers new (once diff shape confirmed),
  Offboarding new case — as EnterpriseFormModal.
- **Needs a NEW preview endpoint before full richness (optional):** documents upload/requirement, finance paye/run-scope,
  leave combined preview. None block the P1 lifecycle sweep.
- **Deferred / separate pass:** Settings/Security/Console (permission keys + audit unresolved); the 4 enforcement-gap fixes (§13).

---

**End of backend mapping. No code changed. Awaiting approval before implementing any migration or preview endpoint.**
