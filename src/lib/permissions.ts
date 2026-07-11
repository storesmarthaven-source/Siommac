/**
 * src/lib/permissions.ts
 *
 * Role-Based Access Control (RBAC) with per-user permission overrides.
 *
 * DESIGN (per docs/ARCHITECTURE.md §9-Authentication-&-Session):
 *   Resolution order (first match wins):
 *     1. Per-user DB override (granted: true/false)  ← highest priority
 *     2. Role defaults defined in ROLE_PERMISSIONS below
 *     3. Deny (false)                                 ← safe default
 *
 *   This means a superadmin can grant an employee access to a specific
 *   capability without changing their role, or revoke a capability from a
 *   manager without demoting them.
 *
 * PERMISSION KEY FORMAT: `resource.action`
 *   e.g. `employees.view`, `employees.add`, `leaves.approve`, `payroll.export`
 *   All valid keys are listed in the PERMISSION_KEYS constant below.
 *   Using an unregistered key logs a warning and returns false.
 *
 * USAGE:
 *   import { can } from '@lib/permissions';
 *
 *   // In a component (reads from store):
 *   if (can('employees.add')) { ... }
 *
 *   // With explicit role + overrides (e.g. tests):
 *   can('leaves.approve', { role: 'manager', overrides: [] })
 *
 * PERFORMANCE:
 *   The overrides array is loaded once at login and cached in the session store.
 *   `can()` is synchronous and O(n) on the overrides array — negligible at scale
 *   since a user will rarely have more than ~20 overrides.
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/CODING_STANDARDS.md §7-State-Management-Rules
 * @see docs/SECURITY.md §3-RBAC
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import { logger } from '@lib/logger';
import { useSessionStore } from '@store/session';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';

// ── Permission key catalogue ──────────────────────────────────────────────────

/**
 * All valid permission keys. Format: `resource.action`.
 *
 * Adding a new permission:
 *   1. Add the key string here.
 *   2. Add the appropriate role defaults to ROLE_PERMISSIONS.
 *   3. Update docs/SECURITY.md §RBAC with the description.
 */
export const PERMISSION_KEYS = [
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
  'hr.employees.restricted_contact.update',
  'hr.employees.photo_approve',
  'hr.employees.import',
  'hr.employees.import.upload',
  'hr.employees.import.map',
  'hr.employees.import.validate',
  'hr.employees.import.commit',
  'hr.employees.import.report.download',
  'hr.onboarding.view',
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
  // ── Employees ───────────────────────────────────────────────────────────────
  'employees.view',         // see the employee list
  'employees.view_detail',  // see an individual employee's full profile
  'employees.add',          // create a new employee
  'employees.edit',         // edit employee details
  'employees.delete',       // deactivate an employee
  'employees.view_pay',     // see pay rates / payroll info

  // ── Departments ─────────────────────────────────────────────────────────────
  'departments.view',
  'departments.add',
  'departments.edit',
  'departments.delete',

  // ── Attendance ──────────────────────────────────────────────────────────────
  'attendance.view_own',    // see own attendance history
  'attendance.view_all',    // see all employees' attendance
  'attendance.edit',        // correct an attendance record
  'attendance.export',      // download CSV/PDF

  // ── Leave ───────────────────────────────────────────────────────────────────
  'leaves.view_own',        // see own leave requests
  'leaves.submit',          // submit a leave request
  'leaves.view_all',        // see all leave requests
  'leaves.approve',         // approve / reject a request
  'leaves.delete',          // hard-delete a request (admin only)

  // ── Payroll ─────────────────────────────────────────────────────────────────
  'payroll.view_own',       // see own payslips
  'payroll.view_all',       // see all payroll runs
  'payroll.run',            // create a payroll run
  'payroll.approve',        // approve a payroll run
  'payroll.export',         // download payroll reports

  // ── Hourly Rates ────────────────────────────────────────────────────────────
  'hourly_rates.view',
  'hourly_rates.edit',

  // ── Project Sites ────────────────────────────────────────────────────────────
  'sites.view',
  'sites.add',
  'sites.edit',
  'sites.delete',
  'sites.assign_employees',

  // ── Live Map ─────────────────────────────────────────────────────────────────
  'map.view',               // see the live employee map

  // ── Reports / Dashboard ──────────────────────────────────────────────────────
  'dashboard.view',
  'reports.export',

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.view',
  'settings.edit',
  'settings.statutory_rates', // edit NIS / PAYE statutory constants

  // ── User management (superadmin) ─────────────────────────────────────────────
  'permissions.manage',     // grant / revoke per-user overrides
  'sessions.manage',        // view active sessions and force-revoke them
  'audit.view',             // view the audit log
  'roles.manage',           // create / edit / delete roles + their permission sets

  // ── HSE module ───────────────────────────────────────────────────────────────
  'hse.incidents.view',     'hse.incidents.manage',
  'hse.incidents.create',   // submit a new incident report (distinct from manage)
  'hse.investigations.manage', // manage investigation records
  'hse.risk.view',          'hse.risk.manage',
  'hse.risk.approve',       // approve risk assessments
  'hse.risk.library.manage', // curate the master hazard / control libraries
  // ── PTW (Permit-to-Work) ─────────────────────────────────────────────────────
  'hse.ptw.view',           // view permits in the register
  'hse.ptw.create',         // create / draft a new permit
  'hse.ptw.approve',        // approve a submitted permit
  'hse.ptw.activate',       // activate an approved permit (on-site gate)
  'hse.ptw.manage',         // admin actions: extend, close, cancel, void
  // ── CAPA ─────────────────────────────────────────────────────────────────────
  'hse.capa.view',          // see CAPAs (own actions for non-managers; all for manager+)
  'hse.capa.manage',        // manage corrective/preventive actions
  'hse.inspections.view',   'hse.inspections.create', 'hse.inspections.manage', 'hse.inspections.review',
  'hse.training.view',      'hse.training.manage', 'hse.training.verify',
  'hse.toolbox.view',       'hse.toolbox.manage',
  'hse.documents.view',     'hse.documents.manage',
  'hse.contractors.view',   'hse.contractors.manage',
  'hse.legal.view',         'hse.legal.manage',
  'hse.emergency.view',     'hse.emergency.manage',
  'hse.environmental.view', 'hse.environmental.manage',
  'hse.ppe.view',           'hse.ppe.manage',
  'hse.dashboard.view',
  'hse.workflows.view',     'hse.workflows.manage',

  // ── Platform workflow ─────────────────────────────────────────────────────────
  'workflow.submit', 'workflow.approve', 'workflow.audit',
  'workflow.view',          // view workflow tasks and status

  // ── Communications / Messaging ─────────────────────────────────────────────────
  // Access model: participant-default. NO broad "read everything" key.
  'communications.view',            // use messaging; see threads you participate in
  'communications.thread_create',   // start direct / group / record-linked threads
  'communications.thread_manage_own', // add/remove participants in threads you own
  'communications.record_thread_read', // read a record-linked thread IF you can view that record
  'communications.moderate',        // hide/remove inappropriate posts (audited)
  'communications.admin',           // messaging settings, retention, broadcast, blocked users
  'communications.compliance_read', // controlled, audited read of private threads (per-user grant)
  'communications.compliance_export', // export message history for approved investigations
  // Granular message/participant capabilities (rich Message Center add-on)
  'communications.messages.post',                 // send a message in a thread you participate in
  'communications.messages.attach',               // attach files to a message
  'communications.messages.download_attachment',  // fetch a signed URL for an attachment
  'communications.messages.delete_own_attachment',// remove an attachment you uploaded
  'communications.messages.pin_own',              // pin/unpin for yourself (personal pin)
  'communications.messages.pin_thread',           // pin for everyone in the thread
  'communications.messages.unpin_own',            // remove your own pins
  'communications.messages.unpin_any',            // remove anyone's pins (moderation)
  'communications.participants.add',              // add participants to a thread you can manage
  'communications.participants.remove',           // remove participants from a thread you can manage
  'communications.participants.change_role',      // change a participant's role
  // ── Tickets ────────────────────────────────────────────────────────────────────
  'tickets.manage',                 // create, assign, resolve, and close support/work tickets
  // ── Account Security (admin cross-user management) ──────────────────────────────
  'auth.security.view',             // view another user's security status (MFA, passkeys, trusted devices)
  'auth.security.manage_policy',    // update the organisation-wide security policy
  'auth.passkeys.admin_revoke',     // revoke all passkeys for another user (admin action)
  'auth.trusted_devices.admin_revoke', // revoke all trusted devices for another user (admin action)
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
  'ui.layout.manage',
  'ui.layout.default.manage',
  'ui.widgets.packages.view',
  'ui.widgets.packages.manage',
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
  // ── Finance NIS Profile Verification ─────────────────────────────────────────
  'finance.payroll.nis.view',       // Finance: view pending and verified NIS profiles
  'finance.payroll.nis.verify',     // Finance Manager: verify a NIS profile (set status=verified)
  'finance.payroll.nis.manage',     // Finance Manager: manage NIS profiles (reject, re-open)
  // ── Finance Payroll Runs (Phase 3 Stage 2) ───────────────────────────────────
  'finance.payroll.view_own',       // employee: view own payslip line (self-scope enforced server-side)
  'finance.payroll.view_all',       // finance staff/manager: view all payroll run data
  'finance.payroll.run.manage',     // finance staff/manager: create, lock-inputs, calculate runs
  'finance.payroll.reports.view',   // finance staff/manager: view payroll reports
  'finance.payroll.reports.export', // finance manager/admin: export payroll reports
  // ── Finance Payroll Runs (Phase 3 Stage 3 — approve / lock / export) ─────────
  'finance.payroll.approve',        // finance manager: approve a submitted payroll run via workflow (SoD: creator cannot approve)
  'finance.payroll.lock',           // finance manager: lock an approved run (lines immutable, payslips generatable) + reopen
  'finance.payroll.export',         // finance manager: export a locked run to CSV/JSON artifact
  'finance.payroll.payslips.generate', // finance: generate + render payslip PDFs for a locked run
  'finance.payroll.payslips.distribute', // finance: email payslips (password-protected) to employees
  'finance.payroll.gl.preview',     // finance: preview the GL journal for a run (read-only)
  'finance.payroll.gl.post',        // finance: post/reverse a run's GL journal (ledger write)
  'finance.payroll.paygroups.manage', // finance: create pay groups + assign employees
  'finance.payroll.worksheet.override', // finance: add/remove per-employee run overrides
  'finance.payroll.overtime.rules.manage', // finance: manage overtime rule engine (multipliers)
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
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Critical-grant keys (require dual superadmin approval) ──────────────────
// MIRROR of netlify/functions/lib/permissions.ts — kept in sync by
// tests/unit/criticalGrants.sync.test.ts.
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

// ── Role defaults ─────────────────────────────────────────────────────────────

/**
 * Default permissions for each role.
 * A role listed here grants ALL keys in its set by default.
 * Roles are additive downward — superadmin includes everything admin has, etc.
 *
 * Convention: list what the role CAN do, not what it cannot.
 */
// Employee baseline — shared by every module-staff role (flat; no inheritance).
const EMPLOYEE_BASELINE: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'workflow.my_tasks.view', 'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
  'settings.own_preferences.view', 'settings.own_preferences.manage',
  'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own', 'dashboard.view',
  'hr.overtime.submit',
  'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view', 'hse.inspections.create',
  'hse.training.view', 'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
  'hse.legal.view', 'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
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
  'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
]);

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {

  // ── Module staff roles (flat; employee baseline + module keys) ───────────────
  hr_staff: new Set<PermissionKey>([
    ...EMPLOYEE_BASELINE,
    // HR Compensation — manage pay items
    'hr.compensation.view', 'hr.compensation.manage',
    // HR Overtime — view + admin manage
    'hr.overtime.view', 'hr.overtime.manage', 'hr.overtime.reports.view',
    // HR statutory profile capture (NIS)
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    // HR Contract Management — day-to-day lifecycle
    'hr.contracts.view', 'hr.contracts.manage',
  ]),
  hr_manager: new Set<PermissionKey>([
    'calendar.manage', 'calendar.task.assign',
    ...EMPLOYEE_BASELINE,
    // HR Compensation — full
    'hr.compensation.view', 'hr.compensation.manage', 'hr.compensation.approve',
    'hr.compensation.reports.view', 'hr.compensation.reports.export',
    // HR Overtime — full
    'hr.overtime.view', 'hr.overtime.approve', 'hr.overtime.manage',
    'hr.overtime.reports.view', 'hr.overtime.reports.export',
    // HR statutory profile capture (NIS)
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    // HR Contract Management — full (incl. terminate + templates)
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
  ]),
  hse_staff: new Set<PermissionKey>([...EMPLOYEE_BASELINE]),

  // Finance roles — mirrors 20260802000000 + 20260802000003 + 20260802000011
  finance_staff: new Set<PermissionKey>([
    ...EMPLOYEE_BASELINE,
    'finance.statutory.view',
    'finance.payroll.components.view',
    'finance.payroll.nis.view',
    // payroll run keys (stage 2)
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
    'finance.payroll.reports.view',
    // Remittances (F1)
    'finance.remittances.view',
    'finance.remittances.manage',
    'finance.remittances.receipt.upload',
    // Expenses (F4)
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
    'calendar.manage', 'calendar.task.assign',
    ...EMPLOYEE_BASELINE,
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
    // payroll run keys (stage 2 + stage 3) — all eight
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
    'finance.payroll.reports.view',
    'finance.payroll.reports.export',
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export',
    // Remittances (F1)
    'finance.remittances.view',
    'finance.remittances.manage',
    'finance.remittances.approve',
    'finance.remittances.reports.view',
    'finance.remittances.reports.export',
    'finance.remittances.receipt.upload',
    // Expenses (F4)
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
    'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
    // Workflow — my tasks + decide when assigned (Spec §22)
    'workflow.my_tasks.view', 'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
    // Settings — own personal preferences only (Spec §4)
    'settings.own_preferences.view', 'settings.own_preferences.manage',
    'hr.overtime.submit',
    'attendance.view_own',
    'leaves.view_own',
    'leaves.submit',
    'payroll.view_own',
    'finance.payroll.view_own',
    'finance.expenses.submit',
    'finance.bank_accounts.view',
    'finance.bank_accounts.manage',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view', 'hse.inspections.create',
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
  ]),

  manager: new Set<PermissionKey>([
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    // Workflow — run approvals + manage instances (Spec §22)
    'workflow.dashboard.view', 'workflow.my_tasks.view', 'workflow.register.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject', 'workflow.tasks.delegate',
    'workflow.instances.view', 'workflow.instances.reassign', 'workflow.instances.escalate', 'workflow.instances.cancel',
    'workflow.handoffs.view', 'workflow.audit.view',
    // Settings — own preferences + view module notification/message settings
    'settings.own_preferences.view', 'settings.own_preferences.manage',
    'settings.notifications.view', 'settings.messages.view',
    // HR — view-only for managers (changes go through admin/HR)
    'hr.view', 'hr.employees.view', 'hr.dashboard.view', 'hr.organization.view', 'hr.positions.view',
    'hr.cost_centers.view',
    'hr.employee_documents.view', 'hr.employee_documents.download',
    'attendance.view_own', 'attendance.view_all', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve',
    'payroll.view_own',
    'employees.view', 'employees.view_detail',
    'sites.view', 'map.view', 'dashboard.view', 'reports.export',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.create','hse.inspections.manage','hse.inspections.review',
    'hse.training.view',  'hse.training.manage', 'hse.training.verify',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.emergency.view',   'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any',
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
  ]),

  admin: new Set<PermissionKey>([
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    // Workflow — full except superadmin-only admin_override (Spec §22)
    'workflow.dashboard.view', 'workflow.my_tasks.view', 'workflow.register.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject', 'workflow.tasks.delegate',
    'workflow.instances.view', 'workflow.instances.reassign', 'workflow.instances.escalate', 'workflow.instances.cancel', 'workflow.instances.migrate',
    'workflow.templates.view', 'workflow.templates.create', 'workflow.templates.update', 'workflow.templates.publish', 'workflow.templates.clone', 'workflow.templates.deprecate',
    'workflow.bindings.view', 'workflow.bindings.create', 'workflow.bindings.update', 'workflow.bindings.activate', 'workflow.bindings.deactivate',
    'workflow.handoffs.view', 'workflow.handoffs.retry', 'workflow.handoffs.cancel',
    'workflow.audit.view', 'workflow.audit.export',
    // Settings — module policy + non-critical governance (critical/safety/security/
    // audit + manifest approval are superadmin-only, Spec §16)
    'settings.manage',
    'settings.own_preferences.view', 'settings.own_preferences.manage',
    'settings.user_preferences.view', 'settings.user_preferences.manage',
    'settings.global.view', 'settings.global.manage',
    'settings.system.view', 'settings.system.manage',
    'settings.critical.view', 'settings.security.view',
    'settings.notification_policy.view', 'settings.notification_policy.manage',
    'settings.message_policy.view', 'settings.message_policy.manage',
    'settings.workflow.view', 'settings.workflow.manage',
    'settings.file_policy.view', 'settings.file_policy.manage',
    'settings.audit_policy.view', 'settings.safety_rules.view',
    'settings.notifications.view', 'settings.notifications.manage',
    'settings.messages.view', 'settings.messages.manage',
    'settings.files.view', 'settings.files.manage',
    'settings.employees.view', 'settings.employees.manage',
    'settings.incidents.view', 'settings.incidents.manage',
    'settings.investigations.view', 'settings.investigations.manage',
    'settings.capa.view', 'settings.capa.manage',
    'settings.jsa.view', 'settings.jsa.manage',
    'settings.ptw.view', 'settings.ptw.manage',
    'settings.inspections.view', 'settings.inspections.manage',
    'settings.training.view', 'settings.training.manage',
    'settings.documents.view', 'settings.documents.manage',
    'settings.sds.view', 'settings.sds.manage',
    'settings.ppe.view', 'settings.ppe.manage',
    'settings.command_center.view', 'settings.command_center.manage',
    'settings.admin.view', 'settings.admin.manage',
    'settings.manifests.view', 'settings.manifests.create',
    'settings.manifests.update', 'settings.manifests.submit',
    // Everything manager can do, plus:
    // HR — full people management
    'hr.view', 'hr.dashboard.view', 'hr.audit.view', 'hr.settings.view', 'hr.settings.manage',
    'hr.employees.view', 'hr.employees.create', 'hr.employees.update', 'hr.employees.statutory.view', 'hr.employees.statutory.update',
    'hr.employees.payroll_readiness.view', 'hr.employees.restricted_contact.update',
    'hr.employees.import', 'hr.employees.import.upload', 'hr.employees.import.map', 'hr.employees.import.validate', 'hr.employees.import.commit', 'hr.employees.import.report.download',
    'hr.onboarding.view', 'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete', 'hr.onboarding.audit.view',
    'hr.onboarding.custom_actions.view', 'hr.onboarding.custom_actions.create', 'hr.onboarding.custom_actions.update', 'hr.onboarding.custom_actions.retire',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update', 'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'hr.onboarding.provision_account', 'hr.onboarding.packages.manage', 'hr.onboarding.reports.view', 'hr.onboarding.reports.export',
    'hr.offboarding.view', 'hr.offboarding.start', 'hr.offboarding.task.manage', 'hr.offboarding.case.manage', 'hr.offboarding.complete', 'hr.offboarding.finalize', 'hr.offboarding.cancel', 'hr.offboarding.audit.view',
    'hr.employees.status_change', 'hr.employees.transfer', 'hr.employees.role_change',
    'hr.employees.supervisor_change', 'hr.employees.sensitive_view',
    'hr.organization.view', 'hr.organization.manage', 'hr.positions.view', 'hr.positions.manage',
    'hr.cost_centers.view', 'hr.cost_centers.manage', 'hr.organization.delete',
    'hr.employee_documents.view', 'hr.employee_documents.upload', 'hr.employee_documents.verify',
    'hr.employee_documents.archive', 'hr.employee_documents.download', 'hr.employee_documents.sensitive_view',
    'hr.employee_documents.requirements.manage',
    'hr.leave.view', 'hr.leave.view_all', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.approve', 'hr.leave.manage', 'hr.leave.types.manage', 'hr.leave.balances.view', 'hr.leave.balances.adjust', 'hr.leave.accruals.run', 'hr.leave.calendar.view', 'hr.leave.reports.view', 'hr.leave.reports.export',
    'hr.attendance.view', 'hr.attendance.view_all', 'hr.attendance.punch', 'hr.attendance.correct',
    'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.timesheets.approve',
    'hr.attendance.exceptions.view', 'hr.attendance.exceptions.manage', 'hr.attendance.compute.run',
    'hr.attendance.policy.manage', 'hr.attendance.reports.view', 'hr.attendance.reports.export',
    // Roster keys
    'hr.roster.view', 'hr.roster.view_own', 'hr.roster.manage', 'hr.roster.publish', 'hr.roster.templates.manage',
    'attendance.view_own',
    'attendance.view_all',
    'attendance.edit',
    'attendance.export',
    'leaves.view_own',
    'leaves.submit',
    'leaves.view_all',
    'leaves.approve',
    'leaves.delete',
    'payroll.view_own',
    'payroll.view_all',
    'payroll.run',
    'payroll.approve',
    'payroll.export',
    'hourly_rates.view',
    'hourly_rates.edit',
    'employees.view',
    'employees.view_detail',
    'employees.add',
    'employees.edit',
    'employees.delete',
    'employees.view_pay',
    // departments.* are superadmin-only — no admin/manager department access.
    'sites.view',
    'sites.add',
    'sites.edit',
    'sites.delete',
    'sites.assign_employees',
    'map.view',
    'dashboard.view',
    'reports.export',
    'settings.view', 'settings.edit', 'settings.statutory_rates',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.create','hse.inspections.manage','hse.inspections.review',
    'hse.training.view',  'hse.training.manage', 'hse.training.verify',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.legal.manage',
    'hse.emergency.view', 'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read', 'communications.moderate', 'communications.admin',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view', 'auth.security.manage_policy',
    'auth.passkeys.admin_revoke', 'auth.trusted_devices.admin_revoke',
    'ui.layout.manage', 'ui.layout.default.manage', 'ui.widgets.packages.view', 'ui.widgets.packages.manage',
    'hr.transfers.view', 'hr.transfers.request', 'hr.transfers.approve', 'hr.transfers.cancel',
    'hr.requests.submit_own', 'hr.requests.manage',
    // Roster keys
    'hr.roster.view', 'hr.roster.view_own', 'hr.roster.manage', 'hr.roster.publish', 'hr.roster.templates.manage',
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
    // HR Contract Management — ALL keys
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
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
    'finance.payroll.reports.view',
    'finance.payroll.reports.export',
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export',
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

  superadmin: new Set<PermissionKey>([
    // Workflow — full governance incl. admin_override (Spec §22)
    'workflow.dashboard.view', 'workflow.my_tasks.view', 'workflow.register.view',
    'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject', 'workflow.tasks.delegate',
    'workflow.instances.view', 'workflow.instances.reassign', 'workflow.instances.escalate', 'workflow.instances.cancel', 'workflow.instances.admin_override', 'workflow.instances.migrate',
    'workflow.templates.view', 'workflow.templates.create', 'workflow.templates.update', 'workflow.templates.publish', 'workflow.templates.clone', 'workflow.templates.deprecate',
    'workflow.bindings.view', 'workflow.bindings.create', 'workflow.bindings.update', 'workflow.bindings.activate', 'workflow.bindings.deactivate',
    'workflow.handoffs.view', 'workflow.handoffs.retry', 'workflow.handoffs.cancel',
    'workflow.audit.view', 'workflow.audit.export',
    // Settings & Preferences — full governance (Spec §8)
    'settings.manage',
    'settings.own_preferences.view', 'settings.own_preferences.manage',
    'settings.user_preferences.view', 'settings.user_preferences.manage',
    'settings.global.view', 'settings.global.manage',
    'settings.system.view', 'settings.system.manage',
    'settings.critical.view', 'settings.critical.manage',
    'settings.security.view', 'settings.security.manage',
    'settings.notification_policy.view', 'settings.notification_policy.manage',
    'settings.message_policy.view', 'settings.message_policy.manage',
    'settings.workflow.view', 'settings.workflow.manage',
    'settings.file_policy.view', 'settings.file_policy.manage',
    'settings.audit_policy.view', 'settings.audit_policy.manage',
    'settings.safety_rules.view', 'settings.safety_rules.manage',
    'settings.notifications.view', 'settings.notifications.manage',
    'settings.messages.view', 'settings.messages.manage',
    'settings.files.view', 'settings.files.manage',
    'settings.employees.view', 'settings.employees.manage',
    'settings.incidents.view', 'settings.incidents.manage',
    'settings.investigations.view', 'settings.investigations.manage',
    'settings.capa.view', 'settings.capa.manage',
    'settings.jsa.view', 'settings.jsa.manage',
    'settings.ptw.view', 'settings.ptw.manage',
    'settings.inspections.view', 'settings.inspections.manage',
    'settings.training.view', 'settings.training.manage',
    'settings.documents.view', 'settings.documents.manage',
    'settings.sds.view', 'settings.sds.manage',
    'settings.ppe.view', 'settings.ppe.manage',
    'settings.command_center.view', 'settings.command_center.manage',
    'settings.admin.view', 'settings.admin.manage',
    'settings.manifests.view', 'settings.manifests.create',
    'settings.manifests.update', 'settings.manifests.submit',
    'settings.manifests.review', 'settings.manifests.approve',
    'settings.manifests.return', 'settings.manifests.deprecate',
    'settings.manifests.review.product', 'settings.manifests.review.module_owner',
    'settings.manifests.review.engineering', 'settings.manifests.review.super_admin',
    'settings.manifests.review.compliance', 'settings.manifests.review.hse',
    'settings.manifests.review.security',
    'communications.participants.remove_required', 'notifications.required_delivery.manage',
    // Everything — explicit list ensures PERMISSION_KEYS stays in sync
    'hr.view', 'hr.dashboard.view', 'hr.audit.view', 'hr.settings.view', 'hr.settings.manage',
    'hr.employees.view', 'hr.employees.create', 'hr.employees.update', 'hr.employees.statutory.view', 'hr.employees.statutory.update',
    'hr.employees.payroll_readiness.view', 'hr.employees.restricted_contact.update',
    'hr.employees.import', 'hr.employees.import.upload', 'hr.employees.import.map', 'hr.employees.import.validate', 'hr.employees.import.commit', 'hr.employees.import.report.download',
    'hr.onboarding.view', 'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete', 'hr.onboarding.audit.view',
    'hr.onboarding.custom_actions.view', 'hr.onboarding.custom_actions.create', 'hr.onboarding.custom_actions.update', 'hr.onboarding.custom_actions.retire',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update', 'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'hr.onboarding.provision_account', 'hr.onboarding.packages.manage', 'hr.onboarding.reports.view', 'hr.onboarding.reports.export',
    'hr.offboarding.view', 'hr.offboarding.start', 'hr.offboarding.task.manage', 'hr.offboarding.case.manage', 'hr.offboarding.complete', 'hr.offboarding.finalize', 'hr.offboarding.cancel', 'hr.offboarding.audit.view',
    'hr.employees.status_change', 'hr.employees.transfer', 'hr.employees.role_change',
    'hr.employees.supervisor_change', 'hr.employees.sensitive_view',
    'hr.organization.view', 'hr.organization.manage', 'hr.positions.view', 'hr.positions.manage',
    'hr.cost_centers.view', 'hr.cost_centers.manage', 'hr.organization.delete',
    'hr.employee_documents.view', 'hr.employee_documents.upload', 'hr.employee_documents.verify',
    'hr.employee_documents.archive', 'hr.employee_documents.download', 'hr.employee_documents.sensitive_view',
    'hr.employee_documents.requirements.manage',
    'hr.leave.view', 'hr.leave.view_all', 'hr.leave.submit', 'hr.leave.cancel_own', 'hr.leave.approve', 'hr.leave.manage', 'hr.leave.types.manage', 'hr.leave.balances.view', 'hr.leave.balances.adjust', 'hr.leave.accruals.run', 'hr.leave.calendar.view', 'hr.leave.reports.view', 'hr.leave.reports.export',
    'hr.attendance.view', 'hr.attendance.view_all', 'hr.attendance.punch', 'hr.attendance.correct',
    'hr.attendance.timesheets.view', 'hr.attendance.timesheets.submit', 'hr.attendance.timesheets.approve',
    'hr.attendance.exceptions.view', 'hr.attendance.exceptions.manage', 'hr.attendance.compute.run',
    'hr.attendance.policy.manage', 'hr.attendance.reports.view', 'hr.attendance.reports.export',
    'attendance.view_own',
    'attendance.view_all',
    'attendance.edit',
    'attendance.export',
    'leaves.view_own',
    'leaves.submit',
    'leaves.view_all',
    'leaves.approve',
    'leaves.delete',
    'payroll.view_own',
    'payroll.view_all',
    'payroll.run',
    'payroll.approve',
    'payroll.export',
    'hourly_rates.view',
    'hourly_rates.edit',
    'employees.view',
    'employees.view_detail',
    'employees.add',
    'employees.edit',
    'employees.delete',
    'employees.view_pay',
    'departments.view',
    'departments.add',
    'departments.edit',
    'departments.delete',
    'sites.view',
    'sites.add',
    'sites.edit',
    'sites.delete',
    'sites.assign_employees',
    'map.view',
    'dashboard.view',
    'reports.export',
    'settings.view',
    'settings.edit',
    'settings.statutory_rates',
    'permissions.manage', 'sessions.manage', 'audit.view', 'roles.manage',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.create','hse.inspections.manage','hse.inspections.review',
    'hse.training.view',  'hse.training.manage', 'hse.training.verify',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.legal.manage',
    'hse.emergency.view', 'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read', 'communications.moderate', 'communications.admin',
    'communications.compliance_read', 'communications.compliance_export',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view', 'auth.security.manage_policy',
    'auth.passkeys.admin_revoke', 'auth.trusted_devices.admin_revoke',
    'ui.layout.manage', 'ui.layout.default.manage', 'ui.widgets.packages.view', 'ui.widgets.packages.manage',
    'hr.transfers.view', 'hr.transfers.request', 'hr.transfers.approve', 'hr.transfers.cancel',
    'hr.requests.submit_own', 'hr.requests.manage',
    // Roster keys
    'hr.roster.view', 'hr.roster.view_own', 'hr.roster.manage', 'hr.roster.publish', 'hr.roster.templates.manage',
    // Finance Phase-1 keys
    'finance.statutory.view',
    'finance.statutory.manage',
    'finance.statutory.approve',
    'finance.statutory.reports.view',
    'finance.statutory.reports.export',
    'finance.payroll.components.view',
    'finance.payroll.components.manage',
    // HR Compensation + Overtime — ALL keys
    'hr.compensation.view', 'hr.compensation.manage', 'hr.compensation.approve',
    'hr.compensation.reports.view', 'hr.compensation.reports.export',
    'hr.overtime.view', 'hr.overtime.submit', 'hr.overtime.approve', 'hr.overtime.manage',
    'hr.overtime.reports.view', 'hr.overtime.reports.export',
    // HR Contract Management — ALL keys
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
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
    'finance.payroll.reports.view',
    'finance.payroll.reports.export',
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export',
    // Budgets (F5) -- superadmin has all
    'finance.budgets.view', 'finance.budgets.manage',
    'finance.budgets.reports.view', 'finance.budgets.reports.export',
    // Bank Accounts & Disbursements (F2) -- superadmin: all
    'finance.bank_accounts.view', 'finance.bank_accounts.manage',
    'finance.disbursement.view', 'finance.disbursement.manage', 'finance.disbursement.approve',
    // Overview + Accounts Payable -- superadmin: all
    'finance.overview.view', 'finance.overview.export', 'finance.overview.kpi.drill', 'finance.overview.approvals.inline',
    'finance.ap.view', 'finance.ap.manage', 'finance.ap.approve',
    'finance.ap.vendors.create', 'finance.ap.vendors.update',
    'finance.ap.bills.create', 'finance.ap.bills.edit', 'finance.ap.bills.submit', 'finance.ap.bills.approve', 'finance.ap.bills.void',
    'finance.ap.payment.record', 'finance.ap.payment.run.manage', 'finance.ap.payment.run.process',
    'finance.ap.duplicate.resolve', 'finance.ap.reports.export', 'finance.ap.bills.import',
    // Calendar & Tasks (platform) — superadmin: all
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
  ]),
};

// ── Context type ──────────────────────────────────────────────────────────────

export interface PermissionContext {
  role:            UserRole;
  /** The role's default permission set, loaded from the DB at login (phase 12). */
  rolePermissions: readonly string[];
  overrides:       PermissionOverride[];
}

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve whether a permission is granted for a given context.
 *
 * Resolution order (first match wins):
 *   1. superadmin → always allow
 *   2. per-user override (granted true → allow, false → deny)
 *   3. role default (the rolePermissions set loaded at login)
 *   4. deny
 *
 * The role→permissions mapping is DB-driven (roles-as-data). This resolver is
 * pure/synchronous: it reads the pre-loaded `rolePermissions` snapshot from the
 * session rather than any hardcoded table.
 */
export function resolvePermission(
  key: string,
  ctx: PermissionContext,
): boolean {
  // Warn on unknown keys — catches typos at dev time (P4: fail loudly in dev)
  if (import.meta.env.DEV && !(PERMISSION_KEYS as readonly string[]).includes(key)) {
    logger.warn(`[permissions] Unknown permission key: "${key}"`, { key, role: ctx.role });
  }

  // 1. superadmin is allow-all by definition.
  if (ctx.role === 'superadmin') return true;

  // 2. Per-user override wins.
  const override = ctx.overrides.find((o) => o.permission === key);
  if (override !== undefined) {
    return override.granted;
  }

  // 3. Role default (DB-loaded set).
  return ctx.rolePermissions.includes(key);
}

/**
 * Whether a role grants a permission by default — DB-driven: pass the role's
 * permission set (fetched from the backend, roles-as-data). superadmin = allow-all.
 */
export function roleDefaultGranted(roleSet: readonly string[], key: string, role?: UserRole): boolean {
  if (role === 'superadmin') return true;
  return roleSet.includes(key);
}

/** Tri-state source of a permission for the grant-matrix UI. */
export type PermissionState = 'default' | 'grant' | 'deny';

/**
 * Classify a permission for one user as default (no override), explicit grant,
 * or explicit deny — used by the superadmin permission matrix.
 */
export function permissionState(
  key: string,
  overrides: PermissionOverride[],
): PermissionState {
  const override = overrides.find(o => o.permission === key);
  if (override === undefined) return 'default';
  return override.granted ? 'grant' : 'deny';
}

/** Permission keys grouped by their `resource` prefix, in catalogue order. */
export function permissionGroups(): { resource: string; keys: PermissionKey[] }[] {
  const groups: { resource: string; keys: PermissionKey[] }[] = [];
  for (const key of PERMISSION_KEYS) {
    const resource = key.split('.')[0] ?? key;
    let group = groups.find(g => g.resource === resource);
    if (!group) { group = { resource, keys: [] }; groups.push(group); }
    group.keys.push(key);
  }
  return groups;
}

// ── Store-integrated shorthand ────────────────────────────────────────────────

/**
 * Check a permission using the current session store state.
 *
 * This is the preferred API for components:
 *   import { can } from '@lib/permissions';
 *   if (can('employees.add')) { ... }
 */
export function can(key: string): boolean {
  const state = useSessionStore.getState();
  if (!state.role) return false;
  return resolvePermission(key, {
    role:            state.role,
    rolePermissions: state.rolePermissions,
    overrides:       state.permissionOverrides,
  });
}

/**
 * React/Preact hook variant — subscribes to store changes.
 * Use this inside components so they re-render when permissions change.
 *
 *   const canApprove = useCan('leaves.approve');
 */
export function useCan(key: string): boolean {
  return useSessionStore((s) => {
    if (!s.role) return false;
    return resolvePermission(key, {
      role:            s.role,
      rolePermissions: s.rolePermissions,
      overrides:       s.permissionOverrides,
    });
  });
}
