/**
 * netlify/functions/lib/permissions.ts
 *
 * Server-side RBAC: the authoritative permission catalogue + resolver.
 *
 * This MIRRORS the frontend catalogue in `src/lib/permissions.ts`. The frontend
 * copy gates UI affordances; THIS copy is the security boundary — it decides
 * whether a mutating request is allowed, regardless of what the client shows.
 *
 * Resolution order (first match wins):
 *   1. Per-user DB override (user_permissions.granted true/false)
 *   2. Role default (ROLE_PERMISSIONS)
 *   3. Deny
 *
 * The two catalogues are kept in sync by `tests/unit/permissions.sync.test.ts`,
 * which fails if the key sets or role defaults diverge.
 *
 * @see src/lib/permissions.ts
 * @see docs/SECURITY.md §3-RBAC
 */

import type { UserRole } from '../../../types/db';
import { sb } from './db';

// ── Permission key catalogue (format: resource.action) ────────────────────────
export const PERMISSION_KEYS = [
  'employees.view', 'employees.view_detail', 'employees.add', 'employees.edit',
  'employees.delete', 'employees.view_pay',
  'departments.view', 'departments.add', 'departments.edit', 'departments.delete',
  'attendance.view_own', 'attendance.view_all', 'attendance.edit', 'attendance.export',
  'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve', 'leaves.delete',
  'payroll.view_own', 'payroll.view_all', 'payroll.run', 'payroll.approve', 'payroll.export',
  'hourly_rates.view', 'hourly_rates.edit',
  'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'sites.assign_employees',
  'map.view',
  'dashboard.view', 'reports.export',
  'settings.view', 'settings.edit', 'settings.statutory_rates',
  'permissions.manage',
  'sessions.manage',
  'audit.view',
  'roles.manage',
  // ── HSE module ──────────────────────────────────────────────────────────────
  'hse.incidents.view',    'hse.incidents.manage',
  'hse.incidents.create',  // submit a new incident report (distinct from manage)
  'hse.investigations.manage', // manage investigation records
  'hse.risk.view',         'hse.risk.manage',
  'hse.risk.approve',      // approve risk assessments
  'hse.risk.library.manage',
  // ── PTW (Permit-to-Work) ───────────────────────────────────────────────────
  'hse.ptw.view',          // view permits in the register
  'hse.ptw.create',        // create / draft a new permit
  'hse.ptw.approve',       // approve a submitted permit
  'hse.ptw.activate',      // activate an approved permit (on-site gate)
  'hse.ptw.manage',        // admin actions: extend, close, cancel, void
  // ── CAPA ──────────────────────────────────────────────────────────────────
  'hse.capa.view',         // see CAPAs (own actions for non-managers; all for manager+)
  'hse.capa.manage',       // manage corrective/preventive actions
  'hse.inspections.view',  'hse.inspections.manage', 'hse.inspections.create', 'hse.inspections.review',
  'hse.training.view',     'hse.training.manage', 'hse.training.verify',
  'hse.toolbox.view',      'hse.toolbox.manage',
  'hse.documents.view',    'hse.documents.manage',
  'hse.contractors.view',  'hse.contractors.manage',
  'hse.legal.view',        'hse.legal.manage',
  'hse.emergency.view',    'hse.emergency.manage',
  'hse.environmental.view','hse.environmental.manage',
  'hse.ppe.view',          'hse.ppe.manage',
  'hse.dashboard.view',
  'hse.workflows.view',    'hse.workflows.manage',
  // ── Platform workflow ────────────────────────────────────────────────────────
  'workflow.submit', 'workflow.approve', 'workflow.audit',
  'workflow.view',         // view workflow tasks and status
  // ── Communications / Messaging (participant-default; NO broad read-all key) ────
  'communications.view',
  'communications.thread_create',
  'communications.thread_manage_own',
  'communications.record_thread_read',
  'communications.moderate',
  'communications.admin',
  'communications.compliance_read',
  'communications.compliance_export',
  'communications.compliance_approve',
  // Granular message/participant capabilities (rich Message Center add-on)
  'communications.messages.post',
  'communications.messages.attach',
  'communications.messages.download_attachment',
  'communications.messages.delete_own_attachment',
  'communications.messages.pin_own',
  'communications.messages.pin_thread',
  'communications.messages.unpin_own',
  'communications.messages.unpin_any',
  'communications.messages.delete_any',
  'communications.participants.add',
  'communications.participants.remove',
  'communications.participants.change_role',
  // ── Tickets ────────────────────────────────────────────────────────────────
  'tickets.manage',        // create, assign, resolve, and close support/work tickets
  'tickets.create_self',        // raise a ticket for yourself (self-service)
  'tickets.create_team',        // raise a ticket for an active direct report
  'tickets.create_on_behalf',   // raise a ticket on behalf of another employee (reason required)
  'tickets.create_internal',    // raise internal work for a service queue (no employee requester)
  'tickets.view_all',           // view all support tickets in the queue (not just own)
  'tickets.reply_internal',     // post staff-only internal notes on support tickets
  // ── Account Security (admin cross-user management) ──────────────────────────
  'auth.security.view',          // view another user's security status (MFA, passkeys, trusted devices)
  'auth.security.manage_policy', // update the organisation-wide security policy
  'auth.passkeys.admin_revoke',  // revoke all passkeys for another user (admin action)
  'auth.trusted_devices.admin_revoke', // revoke all trusted devices for another user (admin action)
  // ── Employee Account Access (capability-routed service-request queue) ─────────
  'employees.access.view',               // view an employee's account/access status
  'employees.access.request',            // submit an account support service request (self-service)
  'employees.access.reset_password',     // reset a user's password (step-up required)
  'employees.access.resend_activation',  // resend account activation email
  'employees.access.suspend',            // suspend a user account (step-up required)
  'employees.access.restore',            // restore a suspended account (step-up required)
  'employees.access.revoke_sessions',    // revoke all active sessions for a user (step-up required)
  'employees.access.revoke_devices',     // revoke all trusted devices for a user (step-up required)
  'employees.access.require_mfa',        // force MFA enrollment for a user (step-up required)
  'employees.access.permissions.view',   // view a user's current permission grants
  'employees.access.permissions.manage', // modify a user's permission overrides (step-up required)
  // ── HR (people backbone) ─────────────────────────────────────────────────────
  'hr.view',
  'hr.dashboard.view',
  'hr.audit.view',
  'hr.settings.view',
  'hr.settings.manage',
  'hr.employees.view',
  'hr.employees.create',
  'hr.employees.update',
  'hr.employees.status_change',
  'hr.employees.transfer',
  'hr.employees.role_change',
  'hr.employees.supervisor_change',
  'hr.employees.sensitive_view',
  'hr.employees.statutory.view',
  'hr.employees.statutory.update',
  'hr.employees.payroll_readiness.view',
  'hr.employees.readiness.view',
  'hr.employees.readiness.follow_up',
  'hr.employees.readiness.review',
  'hr.employees.access_assignments.view',
  'hr.employees.access_assignments.manage',
  'hr.employees.restricted_contact.update',
  'hr.employees.photo_approve',
  'hr.employees.import',
  'hr.employees.import.upload',
  'hr.employees.import.map',
  'hr.employees.import.validate',
  'hr.employees.import.commit',
  'hr.employees.import.report.download',
  'hr.employees.import.manage_all',
  'hr.access_profiles.view',
  'hr.employees.wizard.draft',
  // Onboarding read SCOPE ladder. Base `view` resolves to own/assigned/participant rows
  // ("My Work") inside the read models; these two widen the SERVER-returned set. Scope is
  // never applied by hiding rows in the client.
  'hr.onboarding.view',
  'hr.onboarding.self.view',
  'hr.onboarding.view_team',
  'hr.onboarding.view_all',
  'hr.onboarding.start',
  'hr.onboarding.task.manage',
  'hr.onboarding.cancel',
  'hr.onboarding.case.manage',
  'hr.onboarding.complete',
  'hr.onboarding.audit.view',
  'hr.onboarding.custom_actions.view',
  'hr.onboarding.custom_actions.create',
  'hr.onboarding.custom_actions.update',
  'hr.onboarding.custom_actions.retire',
  'hr.onboarding.custom_actions.case_add',
  'hr.onboarding.custom_actions.case_update',
  'hr.onboarding.custom_actions.case_complete',
  'hr.onboarding.custom_actions.case_cancel',
  'hr.onboarding.provision_account',
  'hr.onboarding.documents.waive',
  'hr.onboarding.packages.manage',
  'hr.onboarding.reports.view',
  'hr.onboarding.reports.export',
  'hr.offboarding.view',
  'hr.offboarding.start',
  'hr.offboarding.task.manage',
  'hr.offboarding.case.manage',
  'hr.offboarding.complete',
  'hr.offboarding.finalize',
  'hr.offboarding.cancel',
  'hr.offboarding.audit.view',
  // ── HR Transfers & Promotions ────────────────────────────────────────────────
  'hr.transfers.view',
  'hr.transfers.request',
  'hr.transfers.approve',
  'hr.transfers.cancel',
  'hr.organization.view',
  'hr.organization.manage',
  'hr.positions.view',
  'hr.positions.manage',
  'hr.work_calendar.view',   // shared work calendar: read holiday sets, patterns, assignments, resolve preview
  'hr.work_calendar.manage', // shared work calendar: admin holiday/pattern/assignment commands + publish
  'hr.cost_centers.view',
  'hr.cost_centers.manage',
  'hr.organization.delete',
  'hr.organization.override_approval',
  'hr.employee_documents.view',
  'hr.employee_documents.upload',
  'hr.employee_documents.verify',
  'hr.employee_documents.archive',
  'hr.employee_documents.download',
  'hr.employee_documents.sensitive_view',
  'hr.employee_documents.requirements.manage',
  // ── HR Leave & Absence ──────────────────────────────────────────────────────
  'hr.leave.view',
  'hr.leave.view_all',
  'hr.leave.submit',
  'hr.leave.cancel_own',
  'hr.leave.approve',
  'hr.leave.types.manage',
  'hr.leave.balances.view',
  'hr.leave.balances.adjust',
  'hr.leave.accruals.run',
  'hr.leave.calendar.view',
  'hr.leave.reports.view',
  'hr.leave.reports.export',
  'hr.leave.manage',
  // ── HR Attendance ────────────────────────────────────────────────────────────
  'hr.attendance.view',
  'hr.attendance.view_all',
  'hr.attendance.punch',
  'hr.attendance.correct',
  'hr.attendance.timesheets.view',
  'hr.attendance.timesheets.submit',
  'hr.attendance.timesheets.approve',
  'hr.attendance.exceptions.view',
  'hr.attendance.exceptions.manage',
  'hr.attendance.compute.run',
  'hr.attendance.policy.manage',
  'hr.attendance.reports.view',
  'hr.attendance.reports.export',
  // ── HR Requests (Request Center) ────────────────────────────────────────────
  'hr.requests.submit_own', // submit + track own HR service requests (self-scope enforced server-side)
  'hr.requests.manage',     // HR triage: view all, decide (approve/reject/return), fulfill
  // ── HR Roster (Shift Scheduling) ─────────────────────────────────────────────
  'hr.roster.view',              // view rosters for their scope
  'hr.roster.view_own',          // employee self-view of own published shifts
  'hr.roster.manage',            // create/edit/assign/generate roster entries
  'hr.roster.publish',           // lock + notify assignees (publish a roster)
  'hr.roster.templates.manage',  // manage shift templates, rotation patterns & coverage requirements
  // ── HR Contract Management ───────────────────────────────────────────────────
  'hr.contracts.view',            // view contracts, templates and the contract dashboard
  'hr.contracts.manage',          // create/issue/sign/activate/renew/cancel contracts
  'hr.contracts.terminate',       // terminate an active contract (sensitive employment action)
  'hr.contracts.template.manage', // manage contract templates
  // ── Settings & Preferences (Spec §8) ─────────────────────────────────────────
  'settings.manage',
  'settings.own_preferences.view',
  'settings.own_preferences.manage',
  'settings.user_preferences.view',
  'settings.user_preferences.manage',
  'settings.global.view',
  'settings.global.manage',
  'settings.system.view',
  'settings.system.manage',
  'settings.critical.view',
  'settings.critical.manage',
  'settings.security.view',
  'settings.security.manage',
  'settings.notification_policy.view',
  'settings.notification_policy.manage',
  'settings.message_policy.view',
  'settings.message_policy.manage',
  'settings.workflow.view',
  'settings.workflow.manage',
  'settings.file_policy.view',
  'settings.file_policy.manage',
  'settings.audit_policy.view',
  'settings.audit_policy.manage',
  'settings.safety_rules.view',
  'settings.safety_rules.manage',
  'settings.notifications.view',
  'settings.notifications.manage',
  'settings.messages.view',
  'settings.messages.manage',
  'settings.files.view',
  'settings.files.manage',
  'settings.employees.view',
  'settings.employees.manage',
  'settings.incidents.view',
  'settings.incidents.manage',
  'settings.investigations.view',
  'settings.investigations.manage',
  'settings.capa.view',
  'settings.capa.manage',
  'settings.jsa.view',
  'settings.jsa.manage',
  'settings.ptw.view',
  'settings.ptw.manage',
  'settings.inspections.view',
  'settings.inspections.manage',
  'settings.training.view',
  'settings.training.manage',
  'settings.documents.view',
  'settings.documents.manage',
  'settings.sds.view',
  'settings.sds.manage',
  'settings.ppe.view',
  'settings.ppe.manage',
  'settings.command_center.view',
  'settings.command_center.manage',
  'settings.admin.view',
  'settings.admin.manage',
  'settings.manifests.view',
  'settings.manifests.create',
  'settings.manifests.update',
  'settings.manifests.submit',
  'settings.manifests.review',
  'settings.manifests.approve',
  'settings.manifests.return',
  'settings.manifests.deprecate',
  'settings.manifests.review.product',
  'settings.manifests.review.module_owner',
  'settings.manifests.review.engineering',
  'settings.manifests.review.super_admin',
  'settings.manifests.review.compliance',
  'settings.manifests.review.hse',
  'settings.manifests.review.security',
  'communications.participants.remove_required',
  'notifications.required_delivery.manage',
  // ── Central Workflow Engine (Spec §22) ───────────────────────────────────────
  'workflow.dashboard.view',
  'workflow.my_tasks.view',
  'workflow.register.view',
  'workflow.tasks.approve',
  'workflow.tasks.return',
  'workflow.tasks.reject',
  'workflow.tasks.delegate',
  'workflow.instances.view',
  'workflow.instances.reassign',
  'workflow.instances.escalate',
  'workflow.instances.cancel',
  'workflow.instances.admin_override',
  'workflow.instances.migrate',
  'workflow.templates.view',
  'workflow.templates.create',
  'workflow.templates.update',
  'workflow.templates.publish',
  'workflow.templates.clone',
  'workflow.templates.deprecate',
  'workflow.bindings.view',
  'workflow.bindings.create',
  'workflow.bindings.update',
  'workflow.bindings.activate',
  'workflow.bindings.deactivate',
  'workflow.handoffs.view',
  'workflow.handoffs.retry',
  'workflow.handoffs.cancel',
  'workflow.audit.view',
  'workflow.audit.export',
  // ── UI / dashboard boards + installable widgets ──
  'ui.layout.manage',           // customize (save) a dashboard board layout
  'ui.layout.default.manage',   // set the org-wide default board layout
  'ui.widgets.packages.view',   // read installed widget packages (needed to render boards)
  'ui.widgets.packages.manage', // install / uninstall widget packages (org-wide)
  'ui.widgets.governance.view',
  'ui.widgets.governance.manage',
  'ui.widgets.sources.view',
  'ui.widgets.sources.manage',
  // ── Finance statutory configuration ─────────────────────────────────────────
  'finance.statutory.view',         // view statutory versions and NIS class tables
  'finance.statutory.manage',       // create and edit draft statutory versions
  'finance.statutory.approve',      // approve submitted statutory versions (creator ≠ approver)
  'finance.statutory.reports.view', // view statutory history and approval-audit reports
  'finance.statutory.reports.export', // export statutory reports (audited data egress)
  'finance.statutory.nis_class.delete', // delete a single NIS class from a draft version (Wave 2B)
  'finance.statutory.nis_class.import', // CSV-import NIS class bands into a draft version (Wave 2B)
  // ── Finance pay-component catalogue ─────────────────────────────────────────
  'finance.payroll.components.view',   // view the pay-component catalogue
  'finance.payroll.components.manage', // submit create/update/retire change requests
  'finance.payroll.components.approve', // approve change requests (creator ≠ approver SoD)
  // ── HR Compensation (pay items — allowances / deductions) ────────────────────
  'hr.compensation.view',           // view compensation pay items for employees
  'hr.compensation.manage',         // create, submit and retire compensation pay items
  'hr.compensation.approve',        // approve submitted pay items (creator ≠ approver)
  'hr.compensation.reports.view',   // view compensation history and change reports
  'hr.compensation.reports.export', // export compensation reports
  // ── HR Overtime ───────────────────────────────────────────────────────────────
  'hr.overtime.view',               // view overtime entries (own or team by scope)
  'hr.overtime.submit',             // submit own overtime entry
  'hr.overtime.approve',            // approve/reject overtime entries
  'hr.overtime.manage',             // HR admin: manage all overtime entries
  'hr.overtime.reports.view',       // view overtime register and summary reports
  'hr.overtime.reports.export',     // export overtime reports
  // ── HR Employee Statutory Profile (NIS capture) ───────────────────────────────
  'hr.employee.statutory.view',     // view the NIS / statutory profile section of an employee
  'hr.employee.statutory.capture',  // create or update NIS / statutory profile data (HR side)
  // ── HR Employee Probation Correction ─────────────────────────────────────────
  'hr.employee.probation.correct',  // governed correction of an employee's probation end date
  // ── Finance NIS Profile Verification ─────────────────────────────────────────
  'finance.payroll.nis.view',       // Finance: view pending and verified NIS profiles
  'finance.payroll.nis.verify',     // Finance Manager: verify a NIS profile (set status=verified)
  'finance.payroll.nis.manage',     // Finance Manager: manage NIS profiles (reject, re-open)
  // ── Finance Payroll Runs (Phase 3 Stage 2) ───────────────────────────────────
  'finance.payroll.view_own',       // employee: view own payslip line (self-scope enforced server-side)
  'finance.payroll.view_all',       // finance staff/manager: view all payroll run data
  'finance.payroll.run.manage',          // finance staff/manager: create, lock-inputs, calculate runs
  'finance.payroll.run_views.manage_team', // finance manager: publish/edit/delete team-scope saved filter views
  'finance.payroll.reports.view',   // finance staff/manager: view payroll reports
  'finance.payroll.reports.export', // finance manager/admin: export payroll reports
  'finance.payroll.reports.maintain', // system operator ONLY: drive report generation/purge workers + retention cleanup (never a regular exporter)
  // ── Finance Payroll Runs (Phase 3 Stage 3 — approve / lock / export) ─────────
  'finance.payroll.approve',        // finance manager: approve a submitted payroll run via workflow (SoD: creator cannot approve)
  'finance.payroll.lock',           // finance manager: lock an approved run (lines immutable, payslips generatable) + reopen
  'finance.payroll.export',         // finance manager: export a locked run to CSV/JSON artifact
  'finance.payroll.certify',        // finance preparer: certify a reviewed immutable calculation version
  'finance.payroll.funding.approve', // finance manager: confirm payroll funding against net pay
  'finance.payroll.release',        // finance manager: release a locked, funded payroll under three-way SoD
  'finance.payroll.sod_policy.view',    // read the active payroll segregation-of-duties policy + history
  'finance.payroll.sod_policy.propose', // propose an SoD level change (draft -> submit for approval)
  'finance.payroll.sod_policy.approve', // approve a proposed SoD change (maker != checker, activates it)
  'finance.payroll.sod_policy.manage_roles', // SUPERADMIN-ONLY: edit which roles may propose/approve SoD changes
  'finance.payroll.finding.assign', // payroll operator: assign an operational control finding
  'finance.payroll.finding.resolve', // payroll operator: resolve a finding with evidence
  'finance.payroll.finding.waive',  // payroll approver: waive an eligible warning
  'finance.payroll.finding.reopen', // payroll operator: reopen a resolved or waived finding
  'finance.payroll.payslips.generate', // finance: generate + render payslip PDFs for a locked run
  'finance.payroll.payslips.distribute', // finance: email payslips (password-protected) to employees
  'finance.payroll.gl.preview',     // finance: preview the GL journal for a run (read-only)
  'finance.payroll.gl.post',        // finance: post/reverse a run's GL journal (ledger write)
  'finance.payroll.paygroups.manage', // finance: create pay groups + assign employees
  'finance.payroll.policies.view',
  'finance.payroll.policies.draft',
  'finance.payroll.policies.submit',
  'finance.payroll.policies.source_approve',
  'finance.payroll.policies.statutory_approve',
  'finance.payroll.policies.activate',
  'finance.payroll.policies.assign',
  'finance.payroll.crew.assignments.manage', // crew: manage effective crew assignments (offshore/marine)
  'finance.payroll.crew.movements.record',   // crew: record embark/disembark/transfer movements
  'finance.payroll.crew.movements.correct',  // crew: reasoned correction of a movement (never overwrites)
  'finance.payroll.crew.evidence.view',      // crew: view employee-level crew pay evidence
  'finance.payroll.worksheet.override', // finance: add/remove per-employee run overrides
  'finance.payroll.overtime.rules.manage', // finance: manage overtime rule engine (multipliers)
  'finance.payroll.loans.manage',     // finance: create/submit/settle employee loans & salary advances
  'finance.payroll.statutory_forms.generate', // finance: generate TD4/NI184/NI187 statutory forms + set the employer profile
  'finance.payroll.statutory_forms.view',     // finance: view/download generated statutory forms + read the employer profile
  'finance.payroll.templates.view',    // finance: list/open saved payslip layout templates (Payslip Studio)
  'finance.payroll.templates.manage',  // finance: create/update/set-default/archive payslip layout templates
  'finance.payroll.templates.approve', // finance manager: approve submitted templates (SoD: creator cannot approve)
  // ── Finance Statutory Remittances & Filing (F1) ──────────────────────────────────────
  'finance.remittances.view',         // view remittances and per-employee lines
  'finance.remittances.manage',       // create, submit and cancel remittances
  'finance.remittances.approve',      // approve submitted remittances + mark paid/filed (SoD: creator cannot approve)
  'finance.remittances.reports.view', // view remittance history and filing reports
  'finance.remittances.reports.export', // export remittance reports (audited data egress)
  'finance.remittances.receipt.upload', // upload filing receipts / support docs to a remittance (Wave 2B)
  'finance.remittances.mark_filed',    // mark a remittance filed with the authority (filed date + receipt ref) (Wave 2B)
  // -- Finance Expenses (F4) --------------------------------------------------
  'finance.expenses.view',         // view expense claims
  'finance.expenses.submit',       // submit own expense claims
  'finance.expenses.manage',       // manage claims (finance_staff+)
  'finance.expenses.approve',      // approve submitted claims (SoD)
  'finance.expenses.reports.view', // view expense reports
  'finance.expenses.reports.export', // export expense reports
  'finance.expenses.receipt.upload', // upload receipt files to expense claim lines (Wave 2B)
  'finance.expenses.handoff.create_reimbursement', // trigger the cross-module payroll reimbursement handoff for an approved claim (Wave 2B)
  // -- Finance Budgeting & Budget-vs-Actual (F5) ----------------------------------
  'finance.budgets.view',             // view budget lines and computed actuals/variance
  'finance.budgets.manage',           // create, update, delete budget lines
  'finance.budgets.reports.view',     // view budget variance and summary reports
  'finance.budgets.reports.export',   // export budget reports (audited data egress)
  'finance.budgets.bulk_upsert',       // bulk create/update budget lines in one submit (Wave 2B)
  'finance.budgets.copy_last_year',     // copy prior-year budget lines into a new fiscal year (Wave 2B)
  'finance.budgets.attachments.upload', // upload budget supporting documents (Wave 2B)
  'finance.budgets.attachments.delete', // remove budget supporting documents (Wave 2B)
  // -- Finance Bank Accounts & Disbursements (F2) --------------------------------
  'finance.bank_accounts.view',       // view employee bank accounts (masked number)
  'finance.bank_accounts.manage',     // add/edit/deactivate own (employee) or any (finance+) bank account
  'finance.disbursement.view',        // view disbursement register and lines
  'finance.disbursement.manage',      // create disbursements from payroll runs + submit for approval
  'finance.disbursement.approve',     // approve / generate bank file / mark paid (SoD: creator cannot approve)
  'finance.disbursement.bank_file.download', // download the generated EFT/CSV bank file (sensitive) (Wave 2B)
  // -- Finance Overview dashboard ------------------------------------------------
  'finance.overview.view',            // view the finance overview command dashboard
  'finance.overview.export',          // export dashboard data (CSV) — audited data egress
  'finance.overview.kpi.drill',       // drill into KPI cards → filtered register
  'finance.overview.approvals.inline',// inline approve/reject items in the overview approvals queue
  // -- Finance Accounts Payable (vendor bills → approval → payment) --------------
  'finance.ap.view',                  // view AP bills, vendors, payments, aging
  'finance.ap.manage',                // legacy coarse alias — kept for role-bundle mapping; new routes use granular keys
  'finance.ap.approve',               // legacy coarse alias — kept for role-bundle mapping; new routes use granular keys
  // Granular AP keys (Wave 2A)
  'finance.ap.vendors.create',        // create new vendors
  'finance.ap.vendors.update',        // edit existing vendors
  'finance.ap.bills.create',          // create bill drafts
  'finance.ap.bills.edit',            // edit draft bills
  'finance.ap.bills.submit',          // submit bills for approval
  'finance.ap.bills.approve',         // approve/reject submitted bills (SoD: creator cannot approve)
  'finance.ap.bills.void',            // void bills in any non-paid state (SoD)
  'finance.ap.payment.record',        // record a payment against an approved bill
  'finance.ap.payment.run.manage',    // create and manage payment runs (batch)
  'finance.ap.payment.run.process',   // process/execute a payment run (SoD: creator cannot process)
  'finance.ap.duplicate.resolve',     // resolve duplicate bill risk reviews
  'finance.ap.reports.export',        // export AP registers / reports (audited data egress)
  'finance.ap.bills.import',          // import bills from CSV/XLSX

  // ── Calendar & Tasks (platform) ──────────────────────────────────────────────
  'calendar.view',                    // see the calendar + own/team/org dated items (scope server-side)
  'calendar.manage',                  // manage team/org calendar items (scope server-side)
  'calendar.task.manage_own',         // create / update / complete own tasks
  'calendar.task.assign',             // assign a task to a permitted team member
  'calendar.activity.manage_own',     // create / update own activities (meetings, site visits…)

  // ── Weather (platform) ───────────────────────────────────────────────────────
  'platform.weather.view',            // read the server-proxied weather snapshot (widget)
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Critical-grant keys (require dual superadmin approval) ──────────────────
/**
 * Permission keys that are so sensitive that granting them (effect=allow) to any
 * role or user requires a different authorized reviewer to approve before it
 * takes effect.
 * Revokes and deny-overrides are never intercepted — only grants are gated.
 */
export const CRITICAL_GRANT_KEYS = new Set<string>([
  'communications.compliance_read',
  'communications.compliance_export',
  'auth.security.manage_policy',
  'auth.passkeys.admin_revoke',
  'auth.trusted_devices.admin_revoke',
  'permissions.manage',
  'roles.manage',
  'communications.admin',
]);

/** Returns true when granting this permission key requires dual-superadmin approval. */
export function isCriticalGrant(key: string): boolean {
  return CRITICAL_GRANT_KEYS.has(key);
}

/**
 * Subset of CRITICAL_GRANT_KEYS: the compliance data-access keys that require an
 * explicit maker-checker approval even for superadmin.
 *
 * The 6 operational critical keys (permissions.manage, roles.manage,
 * auth.security.manage_policy, auth.passkeys.admin_revoke,
 * auth.trusted_devices.admin_revoke, communications.admin) remain in the superadmin
 * default set — they are inherent admin capabilities whose gating would cause
 * bootstrap lockouts and are already held by the regular admin role.
 *
 * Slice 2 will extend this with the §7.2 compliance keys:
 *   compliance_case_approve, compliance_grant_revoke,
 *   compliance_legal_hold, compliance_audit_view.
 *
 * MIRROR — kept in sync with src/lib/permissions.ts by the criticalGrants.sync test.
 */
export const COMPLIANCE_GATED_KEYS = new Set<string>([
  'communications.compliance_read',
  'communications.compliance_export',
]);

// ── Role defaults ─────────────────────────────────────────────────────────────
// Source of truth for role→permissions is now the `role_permissions` table
// (phase 12). This constant remains the seed and the pure resolver's reference
// catalogue; runtime DB failures never restore grants from it.
const ROLE_PERMISSIONS: Record<string, ReadonlySet<PermissionKey>> = {
  // HR module staff roles (flat; employee baseline + HR keys).
  // Mirrors 20260802000007_hr_compensation_overtime_permissions.sql.
  hr_staff: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    // HR Onboarding — execution tier. Mirrors 20260714000013_hr_staff_onboarding_permissions.sql.
    // Deliberately EXCLUDES audit.view, template authoring, packages.manage, provision_account,
    // reports.view and reports.export. Insights is manager-only per 20261002000000.
    // Read scope stays at base `view` = own/assigned/participant
    // ("My Work"); hr_staff must never hold view_team or view_all.
    'hr.onboarding.view',
    'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete',
    'hr.onboarding.custom_actions.view',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update',
    'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'tickets.create_self', 'tickets.create_internal',
    'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
    'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.balances.view', 'hr.leave.calendar.view',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.punch', 'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.exceptions.view',
    'hr.roster.view_own',
    'hr.overtime.submit',
    // hr_staff compensation + overtime + statutory-capture keys
    'hr.compensation.view', 'hr.compensation.manage',
    'hr.overtime.view', 'hr.overtime.manage', 'hr.overtime.reports.view',
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    'hr.contracts.view', 'hr.contracts.manage',
    // Account access — staff: view status, submit requests, resend activation, view permissions
    'employees.access.view', 'employees.access.request',
    'employees.access.resend_activation', 'employees.access.permissions.view',
    // Ticket queue management (HR manages the account support queue)
    'tickets.view_all', 'tickets.reply_internal',
  ]),
  hr_manager: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    // HR Onboarding — oversight tier. Mirrors the cumulative onboarding grant migrations
    // plus 20260930000001_hr_onboarding_view_scope_permissions.sql (view_team/view_all).
    'hr.onboarding.view', 'hr.onboarding.view_team', 'hr.onboarding.view_all',
    'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete', 'hr.onboarding.audit.view',
    'hr.onboarding.custom_actions.view', 'hr.onboarding.custom_actions.create',
    'hr.onboarding.custom_actions.update', 'hr.onboarding.custom_actions.retire',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update',
    'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'hr.onboarding.provision_account', 'hr.onboarding.documents.waive', 'hr.onboarding.packages.manage',
    'hr.onboarding.reports.view', 'hr.onboarding.reports.export',
    'tickets.create_self', 'tickets.create_internal',
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
    'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.balances.view', 'hr.leave.calendar.view',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.punch', 'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.exceptions.view',
    'hr.roster.view_own',
    'hr.overtime.submit',
    // hr_manager compensation + overtime + statutory-capture keys (ALL)
    'hr.compensation.view', 'hr.compensation.manage', 'hr.compensation.approve',
    'hr.compensation.reports.view', 'hr.compensation.reports.export',
    'hr.overtime.view', 'hr.overtime.approve', 'hr.overtime.manage',
    'hr.overtime.reports.view', 'hr.overtime.reports.export',
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    'finance.payroll.policies.view', 'finance.payroll.policies.source_approve',
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
    // Account access — hr_manager: view, request, resend activation, manage permissions
    // (reset_password / revoke_sessions / revoke_devices / require_mfa are admin-only;
    //  HR may REQUEST assistance but does not inherit sensitive account-control authority)
    'employees.access.view', 'employees.access.request',
    'employees.access.resend_activation',
    'employees.access.permissions.view', 'employees.access.permissions.manage',
    // Ticket queue management (HR manages the account support queue)
    'tickets.view_all', 'tickets.reply_internal',
  ]),
  // Finance roles (flat; each carries the employee baseline + finance keys).
  // Mirrors 20260802000000_finance_roles.sql + 20260802000003_finance_statutory_permissions.sql.
  finance_staff: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    'tickets.create_self', 'tickets.create_internal',
    'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
    // employee baseline (same keys as employee role)
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
    'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.balances.view', 'hr.leave.calendar.view',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.punch', 'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.exceptions.view',
    'hr.roster.view_own',
    // finance_staff keys
    'finance.statutory.view',
    'finance.payroll.components.view',
    'finance.payroll.nis.view',
    // payroll run keys (stage 2)
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.certify',
    'finance.payroll.finding.assign',
    'finance.payroll.finding.resolve',
    'finance.payroll.finding.reopen',
    'finance.payroll.payslips.generate',
    'finance.payroll.payslips.distribute',
    'finance.payroll.gl.preview',
    'finance.payroll.gl.post',
    'finance.payroll.paygroups.manage',
    'finance.payroll.policies.view',
    'finance.payroll.policies.draft',
    'finance.payroll.policies.submit',
    'finance.payroll.worksheet.override',
    'finance.payroll.overtime.rules.manage',
    'finance.payroll.loans.manage',
    'finance.payroll.statutory_forms.generate',
    'finance.payroll.statutory_forms.view',
    'finance.payroll.templates.view',
    'finance.payroll.templates.manage',
    'finance.payroll.reports.view',
    // Remittances (F1) — staff can view and manage (create/submit/cancel)
    'finance.remittances.view',
    'finance.remittances.manage',
    'finance.remittances.receipt.upload',
    // Expenses (F4) -- staff: view, submit, manage
    'finance.expenses.view',
    'finance.expenses.submit',
    'finance.expenses.manage',
    'finance.expenses.receipt.upload',
    // Budgets (F5) -- staff: view only
    'finance.budgets.view',
    // Bank Accounts & Disbursements (F2)
    'finance.bank_accounts.view',
    'finance.disbursement.view',
    'finance.disbursement.manage',
    // Overview + Accounts Payable — staff: view + manage (create/submit bills, record payments)
    'finance.overview.view',
    'finance.overview.export',
    'finance.ap.view',
    'finance.ap.manage',
    'finance.ap.vendors.create',
    'finance.ap.bills.create',
    'finance.ap.bills.edit',
    'finance.ap.bills.submit',
    'finance.ap.payment.record',
  ]),
  finance_manager: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    'tickets.create_self', 'tickets.create_internal',
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    // employee baseline (same keys as employee role)
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
    'workflow.my_tasks.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
    'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.balances.view', 'hr.leave.calendar.view',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.punch', 'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.exceptions.view',
    'hr.roster.view_own',
    // finance_manager keys (Phase-1 + NIS verification)
    'finance.statutory.view',
    'finance.statutory.manage',
    'finance.statutory.approve',
    'finance.statutory.reports.view',
    'finance.statutory.reports.export',
    'finance.payroll.components.view',
    'finance.payroll.components.manage',
    'finance.payroll.components.approve',
    'finance.payroll.nis.view',
    'finance.payroll.nis.verify',
    'finance.payroll.nis.manage',
    // payroll run keys (stage 2 + stage 3) — all eight + run-views team management
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.run_views.manage_team',
    'finance.payroll.payslips.generate',
    'finance.payroll.payslips.distribute',
    'finance.payroll.gl.preview',
    'finance.payroll.gl.post',
    'finance.payroll.paygroups.manage',
    'finance.payroll.policies.view',
    'finance.payroll.policies.draft',
    'finance.payroll.policies.submit',
    'finance.payroll.policies.statutory_approve',
    'finance.payroll.policies.activate',
    'finance.payroll.policies.assign',
    'finance.payroll.crew.assignments.manage',
    'finance.payroll.crew.movements.record',
    'finance.payroll.crew.movements.correct',
    'finance.payroll.crew.evidence.view',
    'finance.payroll.worksheet.override',
    'finance.payroll.overtime.rules.manage',
    'finance.payroll.loans.manage',
    'finance.payroll.statutory_forms.generate',
    'finance.payroll.statutory_forms.view',
    'finance.payroll.templates.view',
    'finance.payroll.templates.manage',
    'finance.payroll.templates.approve',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export',
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export',
    'finance.payroll.certify',
    'finance.payroll.funding.approve',
    'finance.payroll.release',
    'finance.payroll.finding.assign',
    'finance.payroll.finding.resolve',
    'finance.payroll.finding.waive',
    'finance.payroll.finding.reopen',
    // SoD policy: a finance manager may view/propose/approve a level change (the
    // service additionally enforces the configurable eligible-roles list and
    // maker != checker). manage_roles is deliberately NOT granted — editing the
    // eligible-role list stays superadmin-only, so this role cannot make itself
    // the sole approver and defeat maker-checker.
    'finance.payroll.sod_policy.view',
    'finance.payroll.sod_policy.propose',
    'finance.payroll.sod_policy.approve',
    // Remittances (F1) — manager has full lifecycle incl approve
    'finance.remittances.view',
    'finance.remittances.manage',
    'finance.remittances.approve',
    'finance.remittances.reports.view',
    'finance.remittances.reports.export',
    'finance.remittances.receipt.upload',
    // Expenses (F4) -- manager: all
    'finance.expenses.view',
    'finance.expenses.submit',
    'finance.expenses.manage',
    'finance.expenses.approve',
    'finance.expenses.reports.view',
    'finance.expenses.reports.export',
    'finance.expenses.receipt.upload',
    'finance.expenses.handoff.create_reimbursement',
    // Budgets (F5) -- manager: full
    'finance.budgets.view',
    'finance.budgets.manage',
    'finance.budgets.reports.view',
    'finance.budgets.reports.export',
    // Bank Accounts & Disbursements (F2) -- manager: all
    'finance.bank_accounts.view',
    'finance.bank_accounts.manage',
    'finance.disbursement.view',
    'finance.disbursement.manage',
    'finance.disbursement.approve',
    // Wave 2B page-fleet keys (Statutory / Remittances / Disbursements / Budgets)
    'finance.statutory.nis_class.delete', 'finance.statutory.nis_class.import',
    'finance.remittances.mark_filed',
    'finance.disbursement.bank_file.download',
    'finance.budgets.bulk_upsert', 'finance.budgets.copy_last_year',
    'finance.budgets.attachments.upload', 'finance.budgets.attachments.delete',
    // Overview + Accounts Payable — manager: full (incl. approve/reject/void/payment-run/SoD)
    'finance.overview.view',
    'finance.overview.export',
    'finance.overview.kpi.drill',
    'finance.overview.approvals.inline',
    'finance.ap.view',
    'finance.ap.manage',
    'finance.ap.approve',
    'finance.ap.vendors.create',
    'finance.ap.vendors.update',
    'finance.ap.bills.create',
    'finance.ap.bills.edit',
    'finance.ap.bills.submit',
    'finance.ap.bills.approve',
    'finance.ap.bills.void',
    'finance.ap.payment.record',
    'finance.ap.payment.run.manage',
    'finance.ap.payment.run.process',
    'finance.ap.duplicate.resolve',
    'finance.ap.reports.export',
    'finance.ap.bills.import',
  ]),
  employee: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    'tickets.create_self',
    'employees.access.request',           // self-service: submit own account support request
    'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'hr.overtime.submit',
    'finance.payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
    'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.balances.view', 'hr.leave.calendar.view',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.punch', 'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.exceptions.view',
    'hr.roster.view_own',
    'finance.bank_accounts.view',
    'finance.bank_accounts.manage',
  ]),
  manager: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    'tickets.create_self', 'tickets.create_team',
    'finance.payroll.view_own',   // self-service: view/print own payslips (self-scoped server-side)
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    'attendance.view_own', 'attendance.view_all', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve',
    'payroll.view_own', 'employees.view', 'employees.view_detail',
    'sites.view', 'map.view', 'dashboard.view', 'reports.export',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.manage',
    'hse.training.view',  'hse.training.manage',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.emergency.view',   'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
    'workflow.my_tasks.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any', 'communications.messages.delete_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view',
    'ui.layout.manage', 'ui.widgets.packages.view',
    'hr.leave.view', 'hr.leave.view_all', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.approve', 'hr.leave.balances.view', 'hr.leave.calendar.view', 'hr.leave.reports.view',
    'hr.transfers.view', 'hr.transfers.request',
    'hr.requests.submit_own',
    'hr.attendance.view', 'hr.attendance.view_all', 'hr.attendance.punch', 'hr.attendance.correct',
    'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.timesheets.approve',
    'hr.attendance.exceptions.view', 'hr.attendance.exceptions.manage', 'hr.attendance.compute.run',
    'hr.attendance.reports.view', 'hr.attendance.reports.export',
    'hr.roster.view', 'hr.roster.manage', 'hr.roster.publish', 'hr.roster.templates.manage',
    // Overtime — managers approve team OT
    'hr.overtime.view', 'hr.overtime.approve', 'hr.overtime.reports.view',
    // Account access — managers can view status and submit requests
    'employees.access.view', 'employees.access.request',
    // Ticket queue management
    'tickets.view_all', 'tickets.reply_internal',
  ]),
  admin: new Set<PermissionKey>([
    'hr.onboarding.self.view',
    'tickets.create_self', 'tickets.create_team', 'tickets.create_on_behalf', 'tickets.create_internal',
    'tickets.view_all', 'tickets.reply_internal',
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    'attendance.view_own', 'attendance.view_all', 'attendance.edit', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve', 'leaves.delete',
    'payroll.view_own', 'payroll.view_all', 'payroll.run', 'payroll.approve', 'payroll.export',
    'hourly_rates.view', 'hourly_rates.edit',
    'employees.view', 'employees.view_detail', 'employees.add', 'employees.edit',
    'employees.delete', 'employees.view_pay',
    // departments.* are superadmin-only — no admin/manager department access.
    'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'sites.assign_employees',
    'map.view', 'dashboard.view', 'reports.export',
    'settings.view', 'settings.edit', 'settings.statutory_rates',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.manage',
    'hse.training.view',  'hse.training.manage',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.legal.manage',
    'hse.emergency.view', 'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
    'workflow.my_tasks.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read', 'communications.moderate', 'communications.admin',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any', 'communications.messages.delete_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view', 'auth.security.manage_policy',
    'auth.passkeys.admin_revoke', 'auth.trusted_devices.admin_revoke',
    // Account access — admin has all 11 keys (step-up required at each elevated endpoint)
    'employees.access.view', 'employees.access.request',
    'employees.access.reset_password', 'employees.access.resend_activation',
    'employees.access.suspend', 'employees.access.restore',
    'employees.access.revoke_sessions', 'employees.access.revoke_devices',
    'employees.access.require_mfa',
    'employees.access.permissions.view', 'employees.access.permissions.manage',
    'ui.layout.manage', 'ui.layout.default.manage', 'ui.widgets.packages.view', 'ui.widgets.packages.manage',
    'hr.leave.view', 'hr.leave.view_all', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.approve', 'hr.leave.manage', 'hr.leave.types.manage', 'hr.leave.balances.view', 'hr.leave.balances.adjust', 'hr.leave.accruals.run', 'hr.leave.calendar.view', 'hr.leave.reports.view', 'hr.leave.reports.export',
    'hr.transfers.view', 'hr.transfers.request', 'hr.transfers.approve', 'hr.transfers.cancel',
    'hr.requests.submit_own', 'hr.requests.manage',
    'hr.attendance.view', 'hr.attendance.view_all', 'hr.attendance.punch', 'hr.attendance.correct',
    'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.timesheets.approve',
    'hr.attendance.exceptions.view', 'hr.attendance.exceptions.manage', 'hr.attendance.compute.run',
    'hr.attendance.policy.manage', 'hr.attendance.reports.view', 'hr.attendance.reports.export',
    // Roster Phase keys
    'hr.roster.view', 'hr.roster.view_own', 'hr.roster.manage', 'hr.roster.publish', 'hr.roster.templates.manage',
    // HR Contract Management — ALL keys
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
    // Finance Phase-1 keys
    'finance.statutory.view',
    'finance.statutory.manage',
    'finance.statutory.approve',
    'finance.statutory.reports.view',
    'finance.statutory.reports.export',
    'finance.payroll.components.view',
    'finance.payroll.components.manage',
    'finance.payroll.components.approve',
    // HR Compensation + Overtime — ALL keys
    'hr.compensation.view', 'hr.compensation.manage', 'hr.compensation.approve',
    'hr.compensation.reports.view', 'hr.compensation.reports.export',
    'hr.overtime.view', 'hr.overtime.submit', 'hr.overtime.approve', 'hr.overtime.manage',
    'hr.overtime.reports.view', 'hr.overtime.reports.export',
    // HR statutory capture + Finance NIS verification — ALL keys
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    'finance.payroll.nis.view', 'finance.payroll.nis.verify', 'finance.payroll.nis.manage',
    // Finance payroll run keys — ALL eight (stage 2 + stage 3)
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.payslips.generate',
    'finance.payroll.payslips.distribute',
    'finance.payroll.gl.preview',
    'finance.payroll.gl.post',
    'finance.payroll.paygroups.manage',
    'finance.payroll.worksheet.override',
    'finance.payroll.overtime.rules.manage',
    'finance.payroll.loans.manage',
    'finance.payroll.statutory_forms.generate',
    'finance.payroll.statutory_forms.view',
    'finance.payroll.templates.view',
    'finance.payroll.templates.manage',
    'finance.payroll.templates.approve',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export',
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export',
    'finance.payroll.certify',
    'finance.payroll.funding.approve',
    'finance.payroll.release',
    'finance.payroll.finding.assign',
    'finance.payroll.finding.resolve',
    'finance.payroll.finding.waive',
    'finance.payroll.finding.reopen',
    // SoD policy — admin may view/propose/approve; manage_roles stays superadmin-only.
    'finance.payroll.sod_policy.view',
    'finance.payroll.sod_policy.propose',
    'finance.payroll.sod_policy.approve',
    // Remittances (F1) -- admin has all
    'finance.remittances.view', 'finance.remittances.manage',
    'finance.remittances.approve', 'finance.remittances.reports.view', 'finance.remittances.reports.export',
    'finance.remittances.receipt.upload',
    // Budgets (F5) -- admin has all
    'finance.budgets.view', 'finance.budgets.manage',
    'finance.budgets.reports.view', 'finance.budgets.reports.export',
    // Bank Accounts & Disbursements (F2) -- admin: all
    'finance.bank_accounts.view', 'finance.bank_accounts.manage',
    'finance.disbursement.view', 'finance.disbursement.manage', 'finance.disbursement.approve',
    // Wave 2B page-fleet keys (Statutory / Remittances / Disbursements / Budgets)
    'finance.statutory.nis_class.delete', 'finance.statutory.nis_class.import',
    'finance.remittances.mark_filed',
    'finance.disbursement.bank_file.download',
    'finance.budgets.bulk_upsert', 'finance.budgets.copy_last_year',
    'finance.budgets.attachments.upload', 'finance.budgets.attachments.delete',
    // Overview + Accounts Payable -- admin: all
    'finance.overview.view', 'finance.overview.export', 'finance.overview.kpi.drill', 'finance.overview.approvals.inline',
    'finance.ap.view', 'finance.ap.manage', 'finance.ap.approve',
    'finance.ap.vendors.create', 'finance.ap.vendors.update',
    'finance.ap.bills.create', 'finance.ap.bills.edit', 'finance.ap.bills.submit', 'finance.ap.bills.approve', 'finance.ap.bills.void',
    'finance.ap.payment.record', 'finance.ap.payment.run.manage', 'finance.ap.payment.run.process',
    'finance.ap.duplicate.resolve', 'finance.ap.reports.export', 'finance.ap.bills.import',
  ]),
  // Superadmin holds every key EXCEPT the COMPLIANCE_GATED_KEYS. Those two keys
  // (compliance_read/export) require an explicit maker-checker grant even for superadmin.
  // All other CRITICAL_GRANT_KEYS (permissions.manage, roles.manage, auth.*, etc.)
  // remain in the default set — they are inherent superadmin capabilities.
  superadmin: new Set<PermissionKey>(PERMISSION_KEYS.filter(k => !COMPLIANCE_GATED_KEYS.has(k))),
};

// ── Per-user override row (mirrors PermissionOverrideSchema) ──────────────────
export interface PermissionOverrideRow {
  permission:  string;
  granted:     boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  revoked_at?: string | null;
  // Audit provenance — who set the override and when. Surfaced to the client so the
  // Account Security / RBAC views can show the grant's origin (not used by resolveWithSet).
  set_by?:     string | null;
  set_at?:     string | null;
}

/**
 * Resolve a permission against a PRE-LOADED role permission set + user overrides.
 *   1. user override (true → allow, false → deny)
 *   2. role default (the loaded set)
 *   3. deny
 * Pure + synchronous — the role set is loaded once (loadRolePermissions) by the
 * caller, so this can also be unit-tested without a DB.
 */
export function resolveWithSet(
  key: string,
  roleSet: ReadonlySet<string>,
  overrides: PermissionOverrideRow[],
  now = new Date(),
): boolean {
  const override = overrides.find(o => o.permission === key);
  if (override !== undefined) {
    if (!override.granted) return false;
    if (!COMPLIANCE_GATED_KEYS.has(key)) return true;

    if (override.revoked_at || !override.valid_from || !override.valid_until) return false;
    const validFrom = Date.parse(override.valid_from);
    const validUntil = Date.parse(override.valid_until);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) return false;
    return validFrom <= now.getTime() && validUntil > now.getTime();
  }
  if (COMPLIANCE_GATED_KEYS.has(key)) return false;
  return roleSet.has(key);
}

/**
 * @deprecated Use loadRolePermissions + resolveWithSet. Kept for the hardcoded
 * fallback path and existing tests. Resolves against ROLE_PERMISSIONS_FALLBACK.
 */
export function resolvePermission(
  key: string,
  role: UserRole,
  overrides: PermissionOverrideRow[],
): boolean {
  const set = ROLE_PERMISSIONS[role] ?? new Set<PermissionKey>();
  return resolveWithSet(key, set, overrides);
}

// ── Role permission set: DB-backed with a short cache ─────────────────────────
const ROLE_CACHE_TTL_MS = 30_000;
const _roleCache = new Map<string, { set: Set<string>; at: number }>();

/** Invalidate the cached permission set for a role (call after edits). */
export function invalidateRolePermissions(roleName?: string): void {
  if (roleName) _roleCache.delete(roleName);
  else _roleCache.clear();
}

/**
 * Load a role's effective default permission set from `role_permissions`.
 * superadmin gets every key except COMPLIANCE_GATED_KEYS in-memory (no DB query).
 * Those two keys (compliance_read/export) are deliberately absent so that
 * requirePermission / userCan fall through to the user_permissions DB check,
 * enforcing the fail-closed compliance-access grant model introduced in Slice 1.
 * Operational critical keys (permissions.manage, roles.manage, auth.*, etc.) remain
 * in the set — they are inherent superadmin capabilities.
 * A failed lookup raises a 503-class error. An empty role has no permissions;
 * neither condition may restore hardcoded grants.
 */
export async function loadRolePermissions(roleName: string): Promise<Set<string>> {
  if (roleName === 'superadmin') {
    // Return all keys except COMPLIANCE_GATED_KEYS in-memory.
    // Compliance keys must be present in user_permissions to take effect.
    return new Set<string>(PERMISSION_KEYS.filter(k => !COMPLIANCE_GATED_KEYS.has(k)));
  }

  const cached = _roleCache.get(roleName);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.set;

  const { data, error } = await sb
    .from('role_permissions')
    .select('permission')
    .eq('role_name', roleName);
  if (error) {
    console.error('[permissions] role permission lookup failed', {
      roleName,
      code: error.code,
      message: error.message,
    });
    throw Object.assign(new Error('Authorization service unavailable'), {
      status: 503,
      code: 'authorization_unavailable',
    });
  }
  const set = new Set(data.map(r => r.permission as string));
  _roleCache.set(roleName, { set, at: Date.now() });
  return set;
}

/**
 * Whether a role is a "clocking employee" (gets the self-service Personal
 * sections). superadmin is never an employee. Defaults true if the row is
 * missing, so existing users keep their self-service.
 */
export async function loadRoleIsEmployee(roleName: string): Promise<boolean> {
  if (roleName === 'superadmin') return false;
  try {
    const { data } = await sb.from('roles').select('is_employee').eq('name', roleName).maybeSingle<{ is_employee: boolean }>();
    return data ? data.is_employee : true;
  } catch {
    return true;
  }
}

// ── Department data-scoping (phase 13) ────────────────────────────────────────

export type RoleScope = 'own' | 'all';
const _scopeCache = new Map<string, { scope: RoleScope; at: number }>();

/** Invalidate a role's cached scope (call after editing it). */
export function invalidateRoleScope(roleName?: string): void {
  if (roleName) _scopeCache.delete(roleName);
  else _scopeCache.clear();
}

/**
 * A role's data scope: 'all' (org-wide) or 'own' (own department only).
 * superadmin/admin default to 'all'; everything else defaults to 'own' — the
 * safe default if the column/row is missing.
 */
export async function loadRoleScope(roleName: string): Promise<RoleScope> {
  if (roleName === 'superadmin' || roleName === 'admin') return 'all';
  const cached = _scopeCache.get(roleName);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.scope;
  let scope: RoleScope = 'own';
  try {
    const { data } = await sb.from('roles').select('scope').eq('name', roleName).maybeSingle<{ scope: string }>();
    scope = data?.scope === 'all' ? 'all' : 'own';
  } catch { /* default own */ }
  _scopeCache.set(roleName, { scope, at: Date.now() });
  return scope;
}

export type DeptScope = { all: true } | { all: false; departmentId: string };

/**
 * Resolve the caller's department scope for a request. The single source of
 * truth for "whose records can this user see". Org-wide roles → { all: true };
 * department-bound roles → { all: false, departmentId }. A scoped user with no
 * department is restricted to an impossible id (sees nothing but their own).
 */
export async function deptScopeFilter(actor: { role: string; department_id?: string | null }): Promise<DeptScope> {
  const scope = await loadRoleScope(actor.role);
  if (scope === 'all') return { all: true };
  return { all: false, departmentId: actor.department_id ?? '__none__' };
}

/**
 * Throw 403 if a scoped caller tries to act on a record outside their
 * department. Org-wide callers always pass. A null target dept (unassigned)
 * is treated as in-scope for everyone (e.g. unassigned project sites).
 */
export async function assertInScope(
  actor: { role: string; department_id?: string | null },
  targetDepartmentId: string | null | undefined,
): Promise<void> {
  const s = await deptScopeFilter(actor);
  if (s.all) return;
  if (targetDepartmentId == null) return;            // unassigned → visible to all
  if (targetDepartmentId !== s.departmentId) {
    throw Object.assign(new Error('Forbidden: outside your department'), { status: 403 });
  }
}
