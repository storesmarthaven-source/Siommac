# Statutory Configuration — Approval Hardening Plan

Goal: statutory config is sensitive and must be **1000% correct** — every change is approval-gated
(maker-checker) and audited. Two gaps were found and greenlit for closing:

1. **Pay Components** create/edit/retire are audited but **not approval-gated** → add maker-checker.
2. **NIS class / version edits on an `approved` (pre-active) version** apply without re-approval →
   make an edit **bump the version back to `pending_approval`** (re-approval), **governed by a
   Settings policy** the user can change/disable.

Already true (do not rebuild): the version lifecycle `draft → submit → approve → activate` runs
through the **central workflow engine** (`workflow_templates` `finance_statutory_approval` +
`module_workflow_bindings` `finance_statutory`), enforces **segregation of duties**
(`assertDifferentApprover`: creator ≠ approver ≠ activator), and every mutation writes
`audit_logs` + `app_events` (+ notification/message/handoff on approve) via
`emitFinanceMutationBackbone`. Payroll consumes components with `is_active = true` only
(`payrollRuns.ts:473`), so a not-yet-approved component is naturally excluded from payroll.

---

## Phase 1 — Re-approval on edit, governed by a Settings policy (smaller, self-contained)

**Policy (Settings catalog).** New key `finance.statutory.reapproval_on_edit`
(enum: `enforce` | `off`, default **`enforce`**), added via the settings manifest system
(`seedSettingsFromManifests`), resolved with `resolveSetting`, gated for edit by
`assertCanUpdateSetting`, surfaced in the Settings catalog page. `enforce` = an edit to a
non-draft version re-opens approval; `off` = today's behavior (edit stays `approved`).

**Service (`statutoryConfig.ts`).** In `upsertNisClasses` (and `updateStatutoryVersion` if it ever
allows non-draft): when the version status is `approved` and the resolved policy is `enforce`,
after the write set `status = 'pending_approval'`, clear `approved_by`, and re-enter the workflow
(emit `finance.statutory.version.submitted` so the engine re-creates the approval task) — all in
the same backbone call with compensating rollback. Audit action `statutory_version.reopened_by_edit`.

**Frontend.** The drawer/edit surfaces show a warning when editing an approved version
("Saving will send this version back for approval"); the status pill flips to *Awaiting* after save.

**E2E.** Update the existing "upsert on approved version" test: with policy `enforce`, assert the
version returns to `pending_approval` + `approved_by = null` + a fresh workflow task + audit row;
with policy `off`, assert today's behavior. Add a settings-resolve test.

## Phase 2 — Pay Components maker-checker (change-request envelope + central workflow)

**Model — change-request envelope** (mirrors `hr_employee_change_requests`; keeps the live row
untouched until approval, which in-place status cannot for edits). New table
`finance_pay_component_change_requests`:
`id, change_type (create|update|retire), component_id (null for create), payload jsonb,
status (pending_approval|approved|rejected), created_by, approved_by, workflow_id, timestamps`.
RLS on; service-role grants; `updated_at` trigger.

**Workflow binding.** New `workflow_templates` `finance_pay_component_approval` + published v1
(single `finance_manager` approval step) + `module_workflow_bindings` `finance_pay_components`,
trigger `finance.payroll.component.change_submitted`. New adapter `financePayComponentAdapter.ts`
(register in `adapterRegistry.ts`) applying the change on approve.

**Service (`payrollComponents.ts`).** `createPayComponent/updatePayComponent/retirePayComponent`
no longer mutate the component directly — they open a change request (status `pending_approval`),
emit `finance.payroll.component.change_submitted`, and start the workflow. On **approve**
(different finance_manager), the adapter applies the change (insert/update/`is_active=false`),
writes the business row + `audit_logs` + `app_events`, with compensating rollback. On **reject**,
the request closes with no change. All state guards + `assertDifferentApprover`.

**Permissions.** Reuse `finance.payroll.components.manage` (submit) + `finance.payroll.components.approve`
(new catalogue key, granted to `finance_manager`) — drift-guard requires the key in `permissions.ts`.

**Frontend (Pay Components tab).** Create/Edit now "Submit for approval"; a **Pending Changes**
view lists open requests with Approve/Reject (approve hidden for the creator — SoD); toasts on
submit/approve/reject; components in flight show an *Awaiting approval* badge.

**E2E (`financeStatutory.mjs` or new `financePayComponents.mjs`).** Submit→approve applies the
change; creator cannot approve (SoD, correct code); reject leaves the component unchanged;
unauthorized role denied; assert `audit_logs` + `app_events` + `workflow_tasks` + the applied row.

## Sequence
Phase 1 first (contained, immediate correctness win), then Phase 2 (larger). Each phase ends green
on typecheck + its E2E before the next starts (per the build-order rule). Full E2E green to close.
