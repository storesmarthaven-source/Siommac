# SIOMAC — Final Forms & Dialogs Implementation Blueprint

_The single implementation-ready consolidation of the discovery series. No code changed. Legacy is excluded
(only cleanup-dependency references noted). Field-level detail lives in the JSON appendices; this blueprint is
the build plan + status of record._

Sources consolidated: [ACTIVE_MODULE_...CATALOGUE](docs/SIOMAC_ACTIVE_MODULE_FORMS_DIALOGS_BUILD_CATALOGUE.md),
[HSE_PLATFORM_...FIELD_CATALOGUE](docs/SIOMAC_HSE_PLATFORM_FORMS_DIALOGS_FIELD_CATALOGUE.md),
[BACKEND_MAPPING](docs/SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md), `FORM_DIALOG_MATRIX.json` (65),
`FIELD_MATRIX.json` (110), `DATA_DEPENDENCY_MATRIX.json` (32), [BACKEND_HARDENING_TODO](docs/DIALOGS_BACKEND_HARDENING_TODO.md).

---

## 1. Final Active Module List

**HR** (module `sections/HR/module.ts`): Employee Master · Organization · Documents · Onboarding · Offboarding ·
HR Requests · Transfers & Promotions · Leave & Absence · Attendance & Timekeeping · Shift Roster · Compensation · Overtime
(Statutory Profile = surface inside Compensation).
**Finance** (`sections/Finance/module.ts`): Statutory Configuration · Payroll (Pay Components, NIS Verification, Payroll Runs, Payslips/Exports are surfaces within these two).
**HSE** (`sections/HSE/module.ts`): Dashboard · PPE · Incidents · Risk/JSA · Permit to Work · Training · Inspections · CAPA.
**Platform**: Settings & Security · Superadmin Console (Roles/Permissions/Approvals) · My Profile · Messages · Notifications · Tickets.

## 2. Excluded Legacy Modules (NOT part of this initiative)

`sections/{Employees,Attendance,AttendanceDashboard,AdminLeave,Payroll,HourlyRates,AdminDashboard}/**`;
`src/api/{employees,attendance,leave,payroll}.ts`; routers `employeesRouter/departmentsRouter/attendanceRouter/leavesRouter`.
These are still wired into the app (AppShell→AdminSections, SECTION_DEFS nav, api.ts mounts) — see the active catalogue §3.1
"Legacy Dead Code Candidates" for the evidence and the separate deletion-pass plan. **They do not appear in the forms tables below.**

## 3. Legacy Helper Cleanup Items (active code importing legacy)

| Active file | Legacy import | Fix |
|---|---|---|
| `HSE/inspections/useEmployeeOptions.ts:7` | `listActiveEmployees` from `@api/employees` | repoint to `useHrEmployees` (`@api/hr/employees`) — the legacy Employees module stays excluded |

(No other active-module imports of legacy `@api/{attendance,leave,payroll}` were found outside the legacy sections themselves.)

## 4–8. Forms/Dialogs by Active Module — status + exact target component

Legend: **DONE** = migrated ✅ · **KEEP** = already rich, leave as-is · **TODO** = to migrate. Target: EFM=EnterpriseFormModal,
AM=ActionModal, WZ=Wizard/WizardShell, DR=Drawer/SidePanel, IM=ImpactModal, DLG=@lib/dialog.

### HR
| Form/Dialog | Target | Status | Route | Hook | Permission |
|---|---|---|---|---|---|
| Org New/Edit Unit | EFM | DONE | hr/organization/unit/{create,update} | useCreate/UpdateOrgUnit | hr.organization.manage |
| Org New/Edit Position | EFM | DONE | hr/positions/{create,update} | useCreate/UpdatePosition | hr.positions.manage |
| Org New/Edit Cost Centre | EFM | DONE | hr/cost-centers/{create,update} | useCreate/UpdateCostCenter | hr.cost_centers.manage |
| Org Move Unit | EFM | DONE | hr/organization/unit/move | useMoveOrgUnit | hr.organization.manage |
| Org Archive/Delete/Retire | IM | KEEP | hr/organization/unit/{archive,delete}; hr/{positions,cost-centers}/retire | useArchive/Delete/Retire* | hr.*.{manage,delete} |
| Org Cancel Change Request | AM | TODO(P3) | hr/organization/change/cancel | useCancelOrgChange | hr.organization.manage |
| Doc Upload | EFM | DONE | hr/employees/documents/{upload-url,commit} | useUploadHrDocument | hr.employee_documents.upload |
| Doc New/Edit Requirement | EFM | DONE | hr/documents/requirements/{create,update} | useCreate/UpdateRequirement | hr.employee_documents.requirements.manage |
| Doc Verify / Archive | AM | DONE | hr/documents/{verify,archive} | useVerify/ArchiveHrDocument | hr.employee_documents.{verify,archive} |
| Onboarding Start | WZ | KEEP | hrOnboarding/onboarding/start | useOnboardingStartCase | hr.onboarding.start |
| Onboarding Pause/Resume/Ready/Complete/Cancel/Provision | AM | DONE | hrOnboarding/onboarding/{pause,resume,ready,complete,cancel,provision-account} | useOnboarding* | hr.onboarding.{case.manage,complete,cancel,provision_account} |
| Onboarding Block/Resolve/Escalate/Waive/CancelAction | AM | TODO(P3) | hrOnboarding/{tasks,blockers,case-actions}/* | useOnboarding* | hr.onboarding.{task.manage,case.manage} |
| Onboarding Add Task/Reassign/Add Action | Modal | KEEP | hrOnboarding/* | useOnboarding* | hr.onboarding.task.manage |
| Offboarding New Case | EFM | DONE | hrOffboarding/offboarding/start | hrOffboardingApi.start | hr.offboarding.start |
| Offboarding Finalize/Cancel/Pause/Resume/MarkReady/Complete | AM | DONE | hrOffboarding/offboarding/{finalize,cancel,pause,resume,mark-ready,complete} | useOffboardingMutation | hr.offboarding.{finalize,cancel,case.manage,complete} |
| Requests New Request | EFM | TODO(P2) | hrRequests/requests/submit | useRequestsMutation(submit) | hr.requests.submit_own |
| Requests Decide | AM | TODO(P2) | hrRequests/requests/decide | useRequestsMutation(decide) | hr.requests.manage |
| Requests Fulfill | EFM/AM | TODO(P2) | hrRequests/requests/fulfill | useRequestsMutation(fulfill) | hr.requests.manage |
| Requests Cancel (my+admin) | AM | DONE | hrRequests/requests/cancel | hrRequestsApi.cancel | hr.requests.submit_own |
| Transfers New | EFM | DONE | hr/transfers/request | hrTransfersApi.submit | hr.transfers.request |
| Transfers Decide/Cancel | AM | DONE | hr/employee-change-requests/{decide,cancel} | hrTransfersApi.{decide,cancel} | requireUser+SoD / hr.view |
| Leave Submit | EFM | DONE | hrLeave/leave/request/submit | useSubmitLeave | hr.leave.submit |
| Leave Approve/Reject/Cancel | AM | DONE | hrLeave/leave/request/{approve,reject,cancel} | useApprove/Reject/CancelLeave | hr.leave.{approve,cancel_own} |
| Leave type/accrual admin | EFM/AM | TODO(P3) | hrLeave/{types,accruals,balances}/* | hrLeaveApi.* | hr.leave.{types.manage,accruals.run,balances.adjust} |
| Attendance Waive/Resolve | AM | DONE | hrAttendance/attendance/exceptions/{waive,resolve} | useWaive/ResolveException | hr.attendance.exceptions.manage |
| Attendance Timesheet Submit/Reopen | AM | DONE | hrAttendance/attendance/timesheets/{submit,reopen} | useSubmit/ReopenTimesheet | hr.attendance.timesheets.{submit,approve} |
| Attendance Correction/manual punch | EFM | TODO(P3) | hrAttendance/attendance/records/correct | useCorrect | hr.attendance.correct |
| Comp New Pay Item | EFM | TODO(P2) | hr/compensation/pay-items/create | hrCompensationApi.createPayItem | hr.compensation.manage |
| Comp Reject/Retire Pay Item | AM | DONE | hr/compensation/pay-items/{reject,retire} | hrCompensationApi.* | hr.compensation.{approve,manage} |
| Comp Statutory Profile capture/submit | EFM | TODO(P2) | hr/employee-statutory/{capture,submit} | hrStatutoryProfileApi.* | hr.employee.statutory.capture |
| Overtime Log | EFM | TODO(P2) | hr/overtime/submit | hrOvertimeApi.submitOvertime | hr.overtime.submit |
| Overtime Reject/Cancel | AM | DONE | hr/overtime/{reject,cancel} | hrOvertimeApi.* | hr.overtime.{approve,submit} |
| Roster New Roster / Shift Template | EFM | TODO(P3) | hr/roster/{rosters/create,templates/upsert} | hrRosterApi.* | hr.roster.manage |
| Roster Publish/Reopen/Deactivate | AM | TODO(P3) | hr/roster/{rosters/publish,rosters/reopen,templates/remove} | hrRosterApi.* | hr.roster.manage |
| Employee Master Create Wizard + ActionDialogs | WZ+Modal | KEEP | hr/employees/{create,status-change,change-request,statutory/update,documents/*} | useCreateEmployee/useChangeHrStatus/… | hr.employees.{create,status_change,statutory.update} |

### Finance
| Form/Dialog | Target | Status | Route | Hook | Permission |
|---|---|---|---|---|---|
| New Rate Version | EFM | TODO(P2) | finance/statutory/versions/create | financeStatutoryApi.createVersion | finance.statutory.manage |
| NIS Class upsert / New Component | EFM | TODO(P3) | finance/statutory/nis-classes/upsert; finance/payroll/components/create | financeStatutoryApi.* | finance.statutory.manage; finance.payroll.components.manage |
| Version Reject/Activate/Retire, Component Retire, NIS Verify/Reject | AM | DONE | finance/statutory/versions/{reject,activate,retire}; components/retire; nis/{verify,reject} | financeStatutoryApi.*, financePayrollApi.* | finance.statutory.{approve,manage}; finance.payroll.{components.manage,nis.verify} |
| New Pay Run | EFM | TODO(P2) | finance/payroll/runs/create | financePayrollApi.createRun | finance.payroll.run.manage |
| Lock/Reopen Run | AM | DONE | finance/payroll/runs/{lock,reopen} | financePayrollApi.{lockRun,reopenRun} | finance.payroll.lock |
| Submit/Calculate/Export/Generate Payslips | AM | TODO(P2) | finance/payroll/runs/{submit,calculate,export}; payslips/generate | financePayrollApi.* | finance.payroll.{run.manage,export,view_all} |
| Payslips/Exports view | DR/table | KEEP | finance/payroll/{payslips,exports}/* | financePayrollApi.* | finance.payroll.view_* |

### HSE — all KEEP (rich Wizards/Modals/Drawers, 0 bare dialogs)
Incidents (Report Incident, Root Cause, CAPA, Close Finding) · PPE (Assign, Request, Inspection) · Risk/JSA (New JSA WZ, New Assessment WZ,
New Hazard, Add Control, Link CAPA, Approval/Submit/Review/Export/Template + Hazard/JSA/RA Drawers) · PTW (New Permit WZ, 9 lifecycle
modals, Template, Custom Hazard, PermitDetail Drawer) · Training (Add/Renew Cert, Assign Training, Role Requirement + Worker/Cert Drawers) ·
Inspections (Record Finding, Assign Action, Complete, Close, Reschedule, Template + Inspection/Finding Drawers). Perms `hse.{incidents,ppe,risk,ptw,training,inspections}.*`.
**Fields documented in HSE_PLATFORM_FIELD_CATALOGUE + FIELD_MATRIX.json.** Optional future: `DialogContextPanel` on Incident Report / New Permit / New JSA; PTW/JSA/Inspection lifecycle modals → AM for record+status parity (they already carry the reason/note fields).

### Platform
| Form/Dialog | Target | Status | Route | Permission |
|---|---|---|---|---|
| Settings governed fields (SwzCard) | inline | KEEP | settings/settingsCatalog | settings.<domain>.manage |
| SWZ reset to inherited | AM | TODO(P3) | settings reset | settings.<domain>.manage |
| Manifest Deprecate/Return | AM | TODO(P3) | settingsCatalog/manifests/{deprecate,return} | governance UNKNOWN |
| Remove Passkey | AM | TODO(P3) | webauthn/delete | self (admin: auth.passkeys.admin_revoke) |
| Name/Rename Passkey | DLG | KEEP | webauthn/rename | self |
| Remove Trusted Device | AM | TODO(P3) | trustedDevices/remove | self (admin: auth.trusted_devices.admin_revoke) |
| Security policy (MFA/step-up) | inline | KEEP | adminSecurity/auth2fa/authStepUp | auth.security.{view,manage_policy} |
| Console Roles/Permissions/Approvals | Modal(2-pane) | KEEP+enrich | superadmin/*, permissionApprovals/* | roles.manage, permissions.manage |
| My Profile (photo editor + notif toggles) | Modal | KEEP | settings/profile* | self |
| Messages Compose / Access Thread | Modal | KEEP | communications/* | messaging.* (Access = reason-required, audited) |
| Notifications Broadcast / Preferences | Modal/inline | KEEP | notify/notifications/* | broadcast UNKNOWN |
| Tickets Compose (subject/category/description) | Modal | KEEP | tickets/* | self |

## 9. Field-Level Specs

Complete in **`FIELD_MATRIX.json`** (110 rows). Closed gaps this pass:
- **Tickets Compose:** `subject` (text, req), `category` (select), `description` (textarea "Describe your issue…", req). 0 bare dialogs.
- **My Profile:** photo editor (upload / crop / zoom / AI photo revisions) + notification toggles (`Leave notifications`, `System alerts`, `Workflow notifications`, some "Managed system-wide"). Rich modals — KEEP.
- **Security perm keys:** `auth.security.{view,manage_policy}`, `auth.passkeys.admin_revoke`, `auth.trusted_devices.admin_revoke`; self-service passkey/device is self-scoped.

## 10. Data Dependencies

Complete in **`DATA_DEPENDENCY_MATRIX.json`** (32 rows). All HR/Finance/HSE pickers resolve to existing hooks
(`useHrEmployees`, `useOrgUnits`, `usePositions`, `useCostCenters`, `useHrSites`, `useLeaveTypes/Balances`, `usePayComponents`,
`useStatutoryVersions`, `api/hse/*`). Only server-only context needs endpoints (§13).

## 11. Backend Routes / Hooks / Permissions

Per-form in the tables above + `FORM_DIALOG_MATRIX.json`; fully resolved in BACKEND_MAPPING §12.

## 12. Audit / Event Mapping

Resolved `eventType` + `action` strings per action in BACKEND_MAPPING §0/§7 (e.g. `hr.leave.approved`/`hr.leave.approved`,
`finance.statutory.version.activated`, `offboarding.finalized`). Remaining UNKNOWNs (offboarding pause/resume/cancel/complete;
onboarding cancel; request decide; document verify/upload; statutory-profile capture; finance run lock/submit/export;
org unit update/move/archive; HSE per-endpoint) → close by reading the specific `lib/*` mutation **only where a mapping is needed**.

## 13. Preview Endpoints

**Exist (reuse now):** `hr/leave/balances/get` (Submit-Leave), `hr/organization/change/preview` (Move/Archive/Delete/Retire).
**Optional NEW** (richer context; none block a build): `hr/organization/{position,cost-center}/preview`, `hr/documents/{upload,requirements}/preview`,
`finance/statutory/paye-preview`, `finance/payroll/runs/scope-preview`, `hr/leave/preview` (coverage). Details/shapes in BACKEND_MAPPING §13/§5.

## 14. Backend Enforcement Gaps (deferred — DIALOGS_BACKEND_HARDENING_TODO.md)

1. Document upload **file-size** not server-enforced. 2. Pay-item **effective-date overlap** not enforced.
3. **Reason** on reject/cancel mostly `.optional()` server-side (UI-only). 4. Document-requirement **duplicate** guard unconfirmed.
(Dedupe + hierarchy cycles ARE enforced 409 ✅.) These are a separate hardening task, not part of the UI migration.

## 15. Implementation Phases

**Done / keep** (no work): HR Organization forms; HR Documents forms/actions; Onboarding core lifecycle; Offboarding new case +
lifecycle; Transfers new/decide/cancel; Leave submit/approve/reject/cancel; Attendance waive/resolve/timesheet; Employee Master
wizard/action dialogs; HSE rich modals/wizards/drawers; Platform rich modals where adequate.

**P2 next:** Requests New → EFM · Requests Fulfill → EFM/AM · New Pay Item → EFM · Statutory Profile → EFM · Log Overtime → EFM ·
New Rate Version → EFM · New Pay Run → EFM · Payroll Submit/Calculate/Export/Generate-Payslips → AM.

**P3:** Roster New Roster/Shift Template → EFM · Roster Publish/Reopen/Deactivate → AM · Attendance Correction/Manual Punch → EFM ·
Onboarding blocker/task/case-action sub-actions → AM · NIS Class / New Component → EFM · Settings manifest/passkey/device/SWZ
lifecycle actions → AM.

**P4 / keep:** HSE as-is unless a bare dialog is found (none found) · My Profile rich modals · Messages rich modals ·
Notifications broadcast/preferences · passkey rename stays `@lib/dialog`.

**Recommended sequencing when implementation is approved:**
1. P2 Finance/Comp forms (New Pay Item, Statutory Profile, Log Overtime, New Rate Version, New Pay Run) + Payroll run AM actions —
   all client-computable context; add `paye-preview`/`runs/scope-preview` only if richer context is wanted.
2. P2 Requests (New/Fulfill/Decide).
3. P3 Roster + Attendance Correction + Onboarding FSM sub-actions + NIS/Component + Settings security AMs.
4. Cleanup: repoint HSE `useEmployeeOptions` off `@api/employees`; component tests for `DialogContextPanel`/`EnterpriseFormModal`.
5. Separate track (not this initiative): backend hardening (§14) and the legacy deletion pass (active catalogue §3.1).

---

## Remaining small gaps (all non-blocking)

- HSE per-endpoint audit/event strings — read `lib/hse/*` **only if** a specific backend mapping is needed.
- Manifest-governance + broadcast permission keys — targeted grep before wiring those AMs.
- Tickets/Profile fields — **closed above** (Tickets: subject/category/description; Profile: photo + notif toggles).
- Repoint HSE inspection employee picker off legacy `@api/employees` — cleanup dependency (§3).

**This blueprint is implementation-ready for the P2/P3 items. No code, routes, migrations, or preview endpoints were created.
Awaiting approval to begin implementation.**
