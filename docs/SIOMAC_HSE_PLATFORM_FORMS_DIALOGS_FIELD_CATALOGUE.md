# SIOMAC — HSE & Platform Forms/Dialogs Field Catalogue

_Discovery only. Fills the "defer" gaps from the active-module catalogue with field-level specs for HSE and
Platform. Field labels/steps were extracted from the components; exact per-endpoint permission keys, audit
`action` and `eventType` strings, and server validation are marked **UNKNOWN — needs targeted read** where not
verified. **HSE + Platform forms are already rich `@ui` Modals/Wizards/Drawers → target = KEEP**; only bare
`dialog.confirm/prompt` (found: **HSE = 0**) would migrate to ActionModal._

Routes: `hseIncidents`(11), `hseInvestigations`(12), `hseCapa`(8), `hseRiskJsa`(62), `hsePtw`(74), `hseTraining`(48),
`hseInspections`(54); `settings`(16), `settingsCatalog`, `adminSecurity`(9), `superadmin`(32), `trustedDevices`,
`webauthn`, `auth2fa`, `authStepUp`, `permissionApprovals`. Perms confirmed present: `hse.{ptw,risk,inspections,training,
incidents,ppe,workflows,toolbox,environmental,emergency}.*`; `settings.<domain>.{view,manage}` (audit_policy, file_policy,
critical, command_center, global, incidents, inspections, investigations, jsa, capa, documents, employees, files, admin…),
`permissions.manage`, `roles.manage`, `settings.edit`.

---

## HSE

### H1. HSE ▸ Incidents (`HSE/Incidents.tsx`, `api/hse/incidents.ts`, routes `hseIncidents.ts` + `hseInvestigations.ts` + `hseCapa.ts`)
Purpose: incident report → investigation → CAPA. Perms `hse.incidents.*`. Statuses UNKNOWN (reported→investigating→closed). Bare dialogs: **0** (rich modals). Target: **KEEP** (rich), document fields.

**FORM: Report Incident** (rich modal, keep) — Entity `hse_incidents`. FIELDS (extracted):
- **Full name** `fullName` text required; **Employee/Staff ID** `employeeId` text/picker; **Employee / Contractor** `personType` select; **Company name / Contractor company** `companyName` text (conditional contractor); **Contact number** `contactNumber` text; **Department / site** `siteId/departmentId` select; **Area / Unit** `area` text; **Date reported** `dateReported` date; **Description** `description` textarea required (helper: "sequence of events, conditions, contributing factors, exact location"); **Body part affected** `bodyPart` select; **Estimated lost days** `lostDays` number; **Expected return to work** `expectedReturn` date; **Equipment / plant involved** `equipment` text; **Estimated quantity (litres)** `spillQty` number (environmental); **Containment measures** `containment` textarea; **Additional immediate actions / notes** `immediateActions` textarea.
- CONTEXT/target: keep as rich modal; could add a `DialogContextPanel` (site/area breadcrumb, severity preview, "creates investigation + CAPA" whatNext). Route `hse/incidents/create` perm `hse.incidents.manage` (verify). Audit/event UNKNOWN.

**FORM: Root Cause / Investigation** (rich) — FIELDS: **Describe the confirmed root cause** `rootCause` textarea; CAPA linkage.
**FORM: CAPA (Corrective/Preventive Action)** (rich) — FIELDS: **CAPA type** `capaType` select; **Action title** `title` text required; **Action owner** `ownerId` picker; **Due date** `dueDate` date required; **Description** `description` textarea (helper "action detail, expected outcomes, acceptance criteria"). Route `hse/capa/*` perm `hse.incidents.*`/`settings.capa.*`.
**FORM: Close Finding / Verify closure** (rich) — FIELDS: **closure verification** textarea (helper "reference evidence, inspection, confirmation").
Lifecycle actions (assign/close/verify) currently rich modals — **KEEP**; migrate to AM only if any are bare (none found).

### H2. HSE ▸ PPE Manager (`HSE/PPEManager.tsx`) · Perms `hse.ppe.*` · Bare dialogs **0** · Target KEEP
Surfaces: inventory, assignments, requests, inspections, POs, suppliers. FIELDS (extracted across forms):
- **Assign/Issue PPE**: **Employee** `employeeId` picker (search employee/role/site); **PPE item** `itemId` select (search item/brand/model); **Site** `siteId` select; condition/serials/hazard-task/training-evidence notes.
- **New Request**: **Request type** `requestType` select (new issue/replacement/lost); **Reason** `reason` textarea (helper "need, hazard exposure, replacement reason"); employee/item.
- **Inspection**: harness/respirator inspection due tracking.
- Dashboards: Compliance/Audit Score/Critical Stock/Low Stock/Open Requests/Open POs (read tiles). Routes `hse/ppe/*` (verify exact). Audit/event UNKNOWN.

### H3. HSE ▸ Risk Assessment / JSA (`HSE/risk-jsa/**`) · Perms `hse.risk.*` · Target KEEP (Wizards + Drawers)
**WIZARD: New JSA** (`NewJsaWizard.tsx`, WizardShell) — Entity JSA. Steps (extracted): Step1 **Job/Task Title** `title` required, **Description** `description`, **Site** `siteId` required, **Department** `departmentId`, **Location/Area** `location`, **Review Due Date** `reviewDueDate`; Step2 **task steps** (add/reorder/remove); Step3 per-step **hazards** + **Likelihood** `likelihood` select + **Severity** `severity` select; Step4 **controls** (add/remove). Route `hse/riskjsa/jsa/*` perm `hse.risk.*`. **KEEP WizardShell.**
**WIZARD: New Risk Assessment** (`NewAssessmentWizard.tsx`) — FIELDS: **Title** required, **Description**, **Site**, **Department**, **Location**, **Review Cycle** `reviewCycle` select, **Review Due Date** `reviewDueDate`, **Control Notes** `controlNotes` optional; + **hazards** (category/description, add/remove). **KEEP.**
**DIALOG: New Hazard** (`NewHazardDialog.tsx`, Wizard/Modal) — FIELDS: **Hazard Title** required, **Description** required, **Category** required (select), **Site** required, **Department** optional, **Location** optional. **KEEP.**
**DIALOG: Add Control** (`AddControlDialog.tsx`, Modal) — FIELDS: **Control Description** required, **Control Type** select required, **Due Date** date, **Verification Required** toggle, **Notes** optional. **KEEP.**
**DIALOG: Link CAPA** (`LinkCapaDialog.tsx`) — FIELDS: **CAPA Title** required, **Description** required, **Priority** select required, **Due date** date; linked-to context. **KEEP.**
**DIALOGS (lifecycle, rich Modal — KEEP/could be AM):** `ApprovalDecisionDialog` (approve/reject + note), `SubmitForReviewDialog`, `ReviewRenewDialog`, `EditDetailsDialog`, `GenerateJsaDialog`, `ExportDialog`, `TemplateDialog`, `VerifyControlButton`.
**DRAWERS (review/detail — KEEP):** `HazardDrawer`, `JsaDrawer`, `RiskAssessmentDrawer`, `RiskJsaRightPanel` (SidePanel), `LibraryDrawers`. Content: record header + tabs (details/hazards/controls/approvals/timeline).

### H4. HSE ▸ Permit to Work (`HSE/ptw/**`) · Perms `hse.ptw.*` · Target KEEP (Wizard + lifecycle Modals + Drawer)
**WIZARD: New Permit** (`NewPermitWizard.tsx`, WizardShell) — Entity permit. FIELDS (extracted): **Permit title** `title` required; **Description** `description`; **Site** `siteId` required; **Specific location** `location`; **Risk level** `riskLevel` select; **Planned start** `plannedStart` datetime required; **Planned end** `plannedEnd` datetime required; **Work supervisor (name/ID)** `supervisor`; **Search approved Risk Assessment** `riskAssessmentId` (linked RA search); **SIMOPS note** `simopsNote`; **Isolations** (repeatable: **Isolation type** select, **Isolation point** required, **Tag number**); **custom hazards** (add/remove). **KEEP WizardShell.** Route `hse/ptw/permits/create` perm `hse.ptw.*`.
**DIALOGS: Permit Lifecycle** (`PermitLifecycleDialogs.tsx`, rich Modals — candidate AM but already rich, KEEP) — actions + fields:
- Approve (**Approval note** optional) · Reject (**Reason for rejection** required, **Required changes** required) · Activate (**Activation note** optional) · Override (**Override justification** required) · Suspend (**Reason for suspension** required) · Revalidate (**Revalidation note** optional) · Extend (**New end date/time** required, **Reason for extension** required) · Complete (**Completion notes** required) · Cancel (**Reason for cancellation** required). Routes `hse/ptw/permits/{approve,reject,activate,override,suspend,revalidate,extend,complete,cancel}` perms `hse.ptw.*`. **These already show reason/notes; if migrated to AM, add record + status pill.**
**DIALOG: Permit Template** (`PermitTemplateDialog.tsx`), **Custom Hazard** (`CustomHazardDialog.tsx`). **DRAWER: PermitDetail** (`PermitDetailDrawer.tsx`). **KEEP.**

### H5. HSE ▸ Training (`HSE/training/**`) · Perms `hse.training.*` · Target KEEP (HseModal + Drawers)
**DIALOGS (`TrainingDialogs.tsx`, 4 HseModal — KEEP):**
- **Add Certificate**: **Worker** `workerId` picker; **Competency** `competencyId` select; **Course** `courseId` select; **Course name** `courseName` text; **Provider** `provider` text; **Certificate number** `certNumber` text; **Issued date** `issuedDate` date; **Expiry date** `expiryDate` date.
- **Renew Certificate**: **New issued date**, **New expiry date**, **Certificate number**.
- **Assign Training**: **Worker**, **Competency**, **Priority** select, **Due date** date, **Reason** textarea.
- **Create Role Requirement**: **Competency**, **Role**, **Requirement level** select.
Routes `hse/training/*` perms `hse.training.*`. **DRAWERS:** `WorkerProfileDrawer`, `CertificateDetailDrawer` (KEEP).

### H6. HSE ▸ Inspections (`HSE/inspections/**`) · Perms `hse.inspections.*` · Target KEEP · **NOTE: imports legacy `@api/employees`** (see Legacy §)
**DIALOGS (`InspectionDialogs.tsx`, rich Modal — KEEP):**
- **Record Finding**: **Finding title** required; **Severity** select; **Category** select; **Location/area** text; **Owner** picker; **Due date** date; **Description** textarea.
- **Assign Corrective Action**: **Corrective action** text; **Owner** picker; **Due date** date.
- **Complete Inspection**: **Completion notes** textarea.
- **Close Finding**: **Closure notes** textarea.
- **Reschedule Inspection**: **New due date** date; **Reason** textarea.
- **New Checklist Template**: **Template name** text; **Inspection type** select.
Routes `hse/inspections/*` perms `hse.inspections.*`. **DRAWERS:** `InspectionDetailDrawer`, `FindingDetailDrawer` (KEEP).
Data dependency: **`useEmployeeOptions.ts` imports `listActiveEmployees` from `@api/employees` (LEGACY)** → should repoint to `useHrEmployees` in a cleanup.

### H7. HSE ▸ CAPA
CAPA is created from Incidents (H1) and JSA (`LinkCapaDialog`, H3). Routes `hseCapa.ts` (8) perms `hse.incidents.*`/`settings.capa.*`. Fields as H1/H3. Target KEEP.

### H8. HSE ▸ Dashboard / PPE tiles
Read-only KPI tiles/widget boards; **no forms** beyond drill-in actions covered above.

---

## Platform

### P1. Settings & Security (`Settings/SettingsSection.tsx`, `Settings/ManifestReviewPanel.tsx`, `Settings/SwzCard.tsx`)
Catalog-driven settings — `settings.<domain>.{view,manage}` (audit_policy, file_policy, critical, command_center, global,
incidents, inspections, investigations, jsa, capa, documents, employees, files, admin…) + `settings.edit`. Routes `settings.ts`,
`settingsCatalog.ts`. Most settings are **inline governed fields** (SwzCard) not modal forms.
- **ACTION: SWZ reset to inherited** — `SwzCard.tsx` `dialog.confirm` → **AM** (record=setting, from override→inherited). P4.
- **ACTION: Deprecate manifest / Return manifest** — `ManifestReviewPanel.tsx` (`dialog.confirm`/`prompt`) → **AM** (record=manifest, Return requires reason). Routes `settingsCatalog/manifests/*` perm governance key **UNKNOWN — verify**. P3.
- **Security** (`adminSecurity.ts`, `auth2fa.ts`, `authStepUp.ts`): MFA/step-up config — mostly inline toggles. FIELDS UNKNOWN (read `SettingsSection` security panel). P3.

### P2. Passkeys & Trusted Devices (`SettingsSection.tsx`, routes `webauthn.ts`, `trustedDevices.ts`)
- **Name passkey** `dialog.prompt` (label) → **KEEP @lib/dialog** (tiny) or small EFM. FIELD: **label** text. Route `webauthn/rename`. P4.
- **Rename passkey** — same. P4.
- **Remove passkey** `dialog.confirm` → **AM** (record=passkey name+created; "cannot sign in with it after"). Route `webauthn/delete`. P3.
- **Remove trusted device** `dialog.confirm` → **AM** (record=device+last-seen; "logs out that device"). Route `trustedDevices/remove`. P3.
Permissions: self-scoped (own passkeys/devices). Audit `audit_logs` (UNKNOWN).

### P3. Superadmin Console (`SuperadminConsole/tabs/{RolesTab,PermissionsTab,ApprovalsTab,ModulesTab}.tsx`) · Perms `roles.manage`, `permissions.manage`
Already 2-pane `@ui` Modals — **KEEP, enrich with "N users affected" + diff**.
- **RolesTab**: search accounts/sort; assign role modal. FIELDS: **role** select, **account** search. Route `superadmin/*`.
- **PermissionsTab**: matrix — Filter by module/risk, Search permissions/users, per-cell Enabled toggle; **critical permission → approval required** (maker-checker). "Awaiting a second superadmin's approval". FIELDS: role, permission, enabled toggle. Route `superadmin/*`, `permissionApprovals.ts`.
- **ApprovalsTab**: **Reject permission grant** (reason) → could be AM. Route `permissionApprovals/*`.
Audit/event UNKNOWN (platform `audit_logs`). P3.

### P4. My Profile (`Profile/MyProfileSection.tsx`) — 3 rich Modals, recently redesigned. **KEEP.** FIELDS: avatar upload, contact edit, password/security — **read component for exact fields** (redesign complete). P4.

### P5. Messages (`Messages/ComposeThreadDialog.tsx`, `Messages/AccessThreadDialog.tsx`) · KEEP (rich Modals)
- **New Message / Compose**: FIELDS **recipients** picker, **subject/title** text, **message** textarea, module/record link. Route `communications/*`.
- **Access Employee Message Thread** (compliance access): FIELDS **Reason for access** required, **Case/reference number** text, **Notes** textarea. Audited time-boxed access. Route `communications/access`. **KEEP** (already shows reason).

### P6. Notifications (`NotificationCenter/BroadcastComposer.tsx`, `NotificationPreferencesPanel.tsx`) · KEEP
- **Broadcast Notification**: FIELDS **Title** required, **Message** required, **Audience** select, **Severity** select, **Action link** optional. Route `notify/*`/`notifications/*`. Perm broadcast (UNKNOWN — verify). **KEEP.**
- **Preferences**: inline toggles.

### P7. Tickets (`Tickets/TicketsSection.tsx`) · routes `tickets.ts`
Create/assign/resolve ticket forms — **FIELDS UNKNOWN — read `TicketsSection.tsx`** (labels not surfaced by grep; likely subject/category/priority/description/assignee). Target KEEP/EFM. Perm `tickets.*` (verify). P3.

---

## Summary verdicts

- **HSE (all 8):** already rich Wizards/Modals/Drawers, **0 bare dialogs** → **KEEP**. Optional enrichment: add `DialogContextPanel`
  to the big wizards (Incident report, New Permit, New JSA) and convert PTW/JSA/Inspection **lifecycle modals** to `ActionModal`
  for record+status consistency (they already carry the right reason/note fields).
- **Platform:** Settings/Console/Profile/Messages/Notifications already rich → **KEEP** (enrich Console with impact); the small
  **security lifecycle actions** (remove passkey/device, deprecate/return manifest, SWZ reset) → **ActionModal**; passkey rename →
  keep `@lib/dialog`. Permission keys resolved: `settings.*`, `roles.manage`, `permissions.manage`.
- **Open questions:** exact HSE per-endpoint perms + audit/event strings (targeted read of `lib/hse/*`); Tickets + Profile exact
  fields (read the two components); manifest-governance + broadcast permission keys; repoint `HSE inspections useEmployeeOptions`
  off legacy `@api/employees`.

JSON appendices updated with HSE + Platform entries: `FORM_DIALOG_MATRIX.json`, `FIELD_MATRIX.json`, `DATA_DEPENDENCY_MATRIX.json`.
