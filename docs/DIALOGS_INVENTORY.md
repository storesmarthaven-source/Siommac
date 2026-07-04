# SIOMAC — Dialogs & Modals Inventory

_Complete catalogue of every dialog/modal in the frontend, why some read as "basic",
and which ones are candidates for enrichment._

Generated 2026-07-03. Paths are clickable (`file:line`).

---

## TL;DR — why some dialogs feel thin

There are **two dialog systems**, and the "basic" feeling comes from actions using the
lighter one for jobs that deserve the richer one:

| System | Renders | Good for | Not capable of |
|---|---|---|---|
| **`@lib/dialog`** (cpop / SweetAlert-style) — [src/lib/dialog.ts](src/lib/dialog.ts) | icon + title + **one line of text** + **at most one input** (text / number / textarea) + OK/Cancel | quick yes/no confirms, one-line reason capture, toasts | multi-field forms, showing the record's fields, tables, status pills, "what happens next" |
| **`@ui` Modal toolkit** — `Modal`, `Wizard`, `WizardShell`, `Drawer`, `SidePanel` + `Field`/`TextInput`/`SelectInput`/`TextareaInput`/`FormGrid`, `FieldList`/`MiniTable`/`Pill`/`Callout`/`SystemActionsPanel` ([src/ui/index.ts](src/ui/index.ts)) | full modal: record context, multiple fields, status pills, warnings, workflow-preview panel | — |

**Rule of thumb in the codebase today:**
- **Create / edit / decision** flows → almost always a **rich custom modal** (e.g. `NewCaseModal`, `UploadModal`, `UnitModal`, `ReviewDialog`).
- **Lifecycle actions** (reject / cancel / reopen / verify / retire / activate / waive) → almost always a **basic cpop dialog** — a title + a single reason box, with **no record context**.

So e.g. **"Reject pay item"** ([CompensationOverview.tsx:106](src/components/sections/HR/CompensationOverview.tsx)) shows only:

> **Reject pay item**
> Reason: `[__________]`

…with no employee name, component, amount, effective dates, or current status.

**App-wide counts:** 37 `dialog.confirm` · 32 `dialog.prompt` (= **69 basic interactive dialogs**) · 33 `dialog.error` · 18 `dialog.success` · 2 `dialog.warning` · 1 `dialog.info` · 1 `dialog.alert` · 1 `dialog.loading`. Plus **~90 rich `@ui` modals/wizards/drawers** across the app.

**Legend:** 🟩 Rich (`@ui`/custom modal) · 🟨 Basic (cpop confirm/prompt)

---

## HR module

### Employee Master — 🟩 fully rich (the reference implementation)
[ActionDialogs.tsx](src/components/sections/HR/ActionDialogs.tsx) composes on `@ui` (`ModalSection`, `SystemActionsPanel`):
- 🟩 `ContactDialog` (:96) · `StatusDialog` (:153) · `OffboardingDialog` (:187) · `ChangeRequestDialog` (:217) · `DocumentDialog` (:281) · `StatutoryDialog` (:317)
- 🟩 `CreateEmployeeWizard` (Wizard) · `ImportWizard` · `ProfileDrawer` (SidePanel)

### Organization — 🟩 rich create/edit
[OrgStructureOverview.tsx](src/components/sections/HR/OrgStructureOverview.tsx): 🟩 `ImpactModal` (:43) · `UnitModal` (:79) · `MoveModal` (:129) · `PositionModal` (:150) · `CostCenterModal` (:209)

### Documents
[HRDocumentsOverview.tsx](src/components/sections/HR/HRDocumentsOverview.tsx):
- 🟩 `UploadModal` (:247) · `RequirementModal` (:508)
- 🟨 **Verify document?** (:112 confirm) · **Archive document?** (:123 confirm) — no doc name/type/expiry/owner shown

### Offboarding
[OffboardingOverview.tsx](src/components/sections/HR/OffboardingOverview.tsx):
- 🟩 `NewCaseModal` (:90)
- 🟨 **Reason for cancelling this case?** (:141 prompt) — no case #, employee, or reason-for-leaving context

### Onboarding
- 🟩 Add Task / Reassign Task / Add Custom Action modals (`@ui`) across [OnboardingCaseDetail.tsx](src/components/sections/HR/OnboardingCaseDetail.tsx), [OnboardingTasksWorkspace.tsx](src/components/sections/HR/OnboardingTasksWorkspace.tsx), [OnboardingHandoffsWorkspace.tsx](src/components/sections/HR/OnboardingHandoffsWorkspace.tsx), [OnboardingPackageManager.tsx](src/components/sections/HR/OnboardingPackageManager.tsx)
- 🟨 in [OnboardingCaseDetail.tsx](src/components/sections/HR/OnboardingCaseDetail.tsx): **Reason for pausing this case?** (:149) · **Resume this onboarding case?** (:150) · **Mark this case as ready for activation?** (:151) · **Complete this onboarding case?** (:152) · **Reason for cancelling this case?** (:153) · **Provision a work email & login for this employee?** (:155) — all context-free confirms

### Leave — 🟩 rich
[LeaveOverview.tsx](src/components/sections/HR/LeaveOverview.tsx): 🟩 `SubmitLeaveDialog` (:45) · `ReviewDialog` (:102)

### HR Requests
[HRRequestsOverview.tsx](src/components/sections/HR/HRRequestsOverview.tsx):
- 🟩 `NewRequestModal` (:41) · `DecideModal` (:176) · `FulfillModal` (:235)
- 🟨 **Cancel Request** (:117 confirm)

### Transfers & Promotions
[TransfersOverview.tsx](src/components/sections/HR/TransfersOverview.tsx):
- 🟩 `NewRequestModal` (:136)
- 🟨 **Cancel this request?** (:257 confirm)

### Shift Roster
[RosterOverview.tsx](src/components/sections/HR/RosterOverview.tsx):
- 🟩 `NewRosterModal` (:528) · `NewShiftTemplateModal` (:575)
- 🟨 **Reason for reopening this roster?** (:190 prompt)

### Attendance & Timekeeping — 🟨 basic-only
[AttendanceOverview.tsx](src/components/sections/HR/AttendanceOverview.tsx): 🟨 **Waive exception** (:64 prompt) · **Resolve exception** (:69 prompt) — no employee/date/exception-type context

### Compensation (new) — 🟨 lifecycle basic
[CompensationOverview.tsx](src/components/sections/HR/CompensationOverview.tsx): inline create form; 🟨 **Reject pay item** (:106 prompt) · **Retire pay item** (:109 confirm)

### Overtime (new) — 🟨 lifecycle basic
[OvertimeOverview.tsx](src/components/sections/HR/OvertimeOverview.tsx): inline log form; 🟨 **Reject overtime** (:99 prompt) · **Cancel overtime** (:103 confirm)

---

## Finance module (new)

### Statutory Configuration
[StatutoryConfigOverview.tsx](src/components/sections/Finance/StatutoryConfigOverview.tsx): inline create/upsert forms; 🟨 **Reject version** (:142) · **Activate version** (:150) · **Retire version** (:156) · **Retire component** (:299) · **Verify NIS profile** (:367) · **Reject NIS profile** (:372)

### Payroll
[PayrollOverview.tsx](src/components/sections/Finance/PayrollOverview.tsx): inline new-run + report forms; 🟨 **Lock run** (:200 confirm) · **Reopen run** (:203 prompt)

> The new Finance/Compensation/Overtime pages use **inline panel forms** for creation
> (not modals) and **cpop** for every lifecycle action — so they sit on the thinner end.

---

## Other areas (for completeness)

### HSE — 🟩 richest area (dozens of `@ui` modals/wizards/drawers)
- Risk/JSA: `NewJsaWizard`, `NewAssessmentWizard`, `NewHazardDialog` (Wizards); `ApprovalDecisionDialog`, `AddControlDialog`, `EditDetailsDialog`, `GenerateJsaDialog`, `ExportDialog`, `LinkCapaDialog`, `SubmitForReviewDialog`, `ReviewRenewDialog`, `VerifyControlButton`, `TemplateDialog` (Modals); `HazardDrawer`, `JsaDrawer`, `RiskAssessmentDrawer` (Drawers); `RiskJsaRightPanel` (SidePanel) — [src/components/sections/HSE/risk-jsa/](src/components/sections/HSE/risk-jsa/)
- PTW: `PermitLifecycleDialogs` (5 modals), `PermitTemplateDialog` — [src/components/sections/HSE/ptw/dialogs/](src/components/sections/HSE/ptw/dialogs/)
- Training: `TrainingDialogs` (4 `HseModal`), `WorkerProfileDrawer`, `CertificateDetailDrawer`

### Superadmin Console — 🟩
`RolesTab` (:279), `PermissionsTab` (:118, :709), `ApprovalsTab` (:76) — all `@ui` Modals

### Settings — 🟨 mostly basic
[ManifestReviewPanel.tsx](src/components/sections/Settings/ManifestReviewPanel.tsx): **Deprecate manifest?** (:77 confirm) · **Return manifest** (:81 prompt).
[SettingsSection.tsx](src/components/sections/Settings/SettingsSection.tsx): **Remove trusted device?** (:221) · **Name this passkey** (:847) · **Rename passkey** (:863) · **Remove passkey?** (:875).
[SwzCard.tsx](src/components/sections/Settings/SwzCard.tsx): **Reset to inherited value** (:81)

### Messages / Notifications / Profile / Project Sites — 🟩
`ComposeThreadDialog`, `AccessThreadDialog`; `BroadcastComposer`, `NotificationPreferencesPanel`; 3× `Modal` in `MyProfileSection`; 3× `Modal` in `ProjectSitesSection`

### Widgets
[WidgetLibraryModal.tsx](src/ui/widgets/WidgetLibraryModal.tsx) 🟩; 🟨 **Uninstall package?** (:81) and a 🟨 **Resolution note** prompt in [registry.hrOnboardingCase.tsx:462](src/ui/widgets/registry.hrOnboardingCase.tsx)

### Legacy sections (pending removal) — 🟩 original modals
`EmployeeModal`, `DepartmentModal`, `LeaveRequestModal`, `PayslipViewModal` (Employees); `EmployeeDetailModal`, `PhotoModal` (Attendance); `LeaveDocModal` (AdminLeave); `PayslipModal`, `PayrollSettingsModal`, `ConstantsModal` (Payroll); `ImportModal` (HourlyRates)

---

## The "thin list" — every basic lifecycle dialog (enrichment candidates)

These 🟨 cpop dialogs carry no record context and are the ones that read as basic:

| # | Dialog | Where |
|---|---|---|
| 1 | Verify document? | [HRDocumentsOverview.tsx:112](src/components/sections/HR/HRDocumentsOverview.tsx) |
| 2 | Archive document? | [HRDocumentsOverview.tsx:123](src/components/sections/HR/HRDocumentsOverview.tsx) |
| 3 | Reason for cancelling this case? (offboarding) | [OffboardingOverview.tsx:141](src/components/sections/HR/OffboardingOverview.tsx) |
| 4–9 | Pause / Resume / Ready / Complete / Cancel / Provision (onboarding) | [OnboardingCaseDetail.tsx:149-155](src/components/sections/HR/OnboardingCaseDetail.tsx) |
| 10 | Cancel Request | [HRRequestsOverview.tsx:117](src/components/sections/HR/HRRequestsOverview.tsx) |
| 11 | Cancel this request? (transfer) | [TransfersOverview.tsx:257](src/components/sections/HR/TransfersOverview.tsx) |
| 12 | Reason for reopening this roster? | [RosterOverview.tsx:190](src/components/sections/HR/RosterOverview.tsx) |
| 13–14 | Waive / Resolve exception | [AttendanceOverview.tsx:64,69](src/components/sections/HR/AttendanceOverview.tsx) |
| 15–16 | Reject / Retire pay item | [CompensationOverview.tsx:106,109](src/components/sections/HR/CompensationOverview.tsx) |
| 17–18 | Reject / Cancel overtime | [OvertimeOverview.tsx:99,103](src/components/sections/HR/OvertimeOverview.tsx) |
| 19–24 | Reject / Activate / Retire version, Retire component, Verify / Reject NIS | [StatutoryConfigOverview.tsx](src/components/sections/Finance/StatutoryConfigOverview.tsx) |
| 25–26 | Lock run / Reopen run | [PayrollOverview.tsx:200,203](src/components/sections/Finance/PayrollOverview.tsx) |
| 27–31 | Deprecate/Return manifest, trusted device, passkeys, SWZ reset | Settings (see above) |

---

## Recommendation

Build one reusable **`ActionModal`** on `@ui Modal` that every lifecycle action routes
through, showing:
- the record's identity + key fields (`FieldList` / `MiniTable`),
- a current-status `Pill`,
- a `Callout` warning for destructive/irreversible steps,
- an optional reason `TextareaInput`,
- an optional "what happens next" line (mirror `SystemActionsPanel` from Employee Master).

Then migrate the ~25–31 basic dialogs above onto it. Employee Master's `ActionDialogs.tsx`
already proves the pattern; this just extends it to the rest of HR + Finance (+ optionally Settings).
