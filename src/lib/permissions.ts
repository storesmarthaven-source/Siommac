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
  // Onboarding read SCOPE is a three-tier ladder, enforced server-side in the read models.
  // Base `view` is own/assigned/participant only ("My Work"); the two scope keys widen the
  // server-returned set. The frontend never fetches all cases and hides rows after the fact.
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
  'hr.work_calendar.view',
  'hr.work_calendar.manage',
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
  'communications.compliance_approve', // approve/reject time-boxed compliance access grants
  // Granular message/participant capabilities (rich Message Center add-on)
  'communications.messages.post',                 // send a message in a thread you participate in
  'communications.messages.attach',               // attach files to a message
  'communications.messages.download_attachment',  // fetch a signed URL for an attachment
  'communications.messages.delete_own_attachment',// remove an attachment you uploaded
  'communications.messages.pin_own',              // pin/unpin for yourself (personal pin)
  'communications.messages.pin_thread',           // pin for everyone in the thread
  'communications.messages.unpin_own',            // remove your own pins
  'communications.messages.unpin_any',            // remove anyone's pins (moderation)
  'communications.messages.delete_any',           // soft-delete anyone's message (moderation; requires a reason)
  'communications.participants.add',              // add participants to a thread you can manage
  'communications.participants.remove',           // remove participants from a thread you can manage
  'communications.participants.change_role',      // change a participant's role
  // ── Tickets ────────────────────────────────────────────────────────────────────
  'tickets.manage',                 // create, assign, resolve, and close support/work tickets
  'tickets.create_self',            // raise a ticket for yourself (self-service)
  'tickets.create_team',            // raise a ticket for an active direct report
  'tickets.create_on_behalf',       // raise a ticket on behalf of another employee (reason required)
  'tickets.create_internal',        // raise internal work for a service queue (no employee requester)
  'tickets.view_all',               // view all support tickets in the queue (not just own)
  'tickets.reply_internal',         // post staff-only internal notes on support tickets
  // ── Account Security (admin cross-user management) ──────────────────────────────
  'auth.security.view',             // view another user's security status (MFA, passkeys, trusted devices)
  'auth.security.manage_policy',    // update the organisation-wide security policy
  'auth.passkeys.admin_revoke',     // revoke all passkeys for another user (admin action)
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
  'finance.payroll.reports.maintain', // system operator ONLY: drive report generation/purge workers + retention cleanup
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

/**
 * Subset of CRITICAL_GRANT_KEYS: the compliance data-access keys that require an
 * explicit maker-checker approval even for superadmin.
 *
 * The 6 operational critical keys (permissions.manage, roles.manage,
 * auth.security.manage_policy, auth.passkeys.admin_revoke,
 * auth.trusted_devices.admin_revoke, communications.admin) remain in the superadmin
 * default set — they are inherent admin capabilities already held by the regular
 * admin role and whose gating would cause bootstrap lockouts.
 *
 * Slice 2 will extend this with the §7.2 compliance keys:
 *   compliance_case_approve, compliance_grant_revoke,
 *   compliance_legal_hold, compliance_audit_view.
 *
 * MIRROR of netlify/functions/lib/permissions.ts — kept in sync by the
 * criticalGrants.sync test.
 */
export const COMPLIANCE_GATED_KEYS = new Set<string>([
  'communications.compliance_read',
  'communications.compliance_export',
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
  'hr.onboarding.self.view',       // signed-in worker may read only their own onboarding projection
  'tickets.create_self',            // every authenticated role may raise a self-service ticket
  'employees.access.request',       // every authenticated role may submit own account support request
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
  'platform.weather.view',
]);

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {

  // ── Module staff roles (flat; employee baseline + module keys) ───────────────
  hr_staff: new Set<PermissionKey>([
    ...EMPLOYEE_BASELINE,
    'tickets.create_internal',      // HR service-queue handler
    // HR Onboarding — execution tier. Mirrors 20260714000013_hr_staff_onboarding_permissions.sql.
    // Deliberately EXCLUDES audit.view, template authoring (custom_actions.create/update/retire),
    // packages.manage, provision_account, reports.view and reports.export — all oversight tier.
    // The reports.view removal is the manager-only Insights policy in 20261002000000.
    // Read scope stays at base `view` = own/assigned/participant ("My Work"); hr_staff must
    // never hold view_team or view_all.
    'hr.onboarding.view',
    'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete',
    'hr.onboarding.custom_actions.view',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update',
    'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    // HR Compensation — manage pay items
    'hr.compensation.view', 'hr.compensation.manage',
    // HR Overtime — view + admin manage
    'hr.overtime.view', 'hr.overtime.manage', 'hr.overtime.reports.view',
    // HR statutory profile capture (NIS)
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    // HR Contract Management — day-to-day lifecycle
    'hr.contracts.view', 'hr.contracts.manage',
    // Account access — staff: view, request, resend activation, view permissions
    'employees.access.view', 'employees.access.request',
    'employees.access.resend_activation', 'employees.access.permissions.view',
    // Ticket queue management (HR manages the account support queue)
    'tickets.view_all', 'tickets.reply_internal',
  ]),
  hr_manager: new Set<PermissionKey>([
    'calendar.manage', 'calendar.task.assign',
    ...EMPLOYEE_BASELINE,
    'tickets.create_internal',      // HR service-queue handler
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
    // HR Compensation — full
    'hr.compensation.view', 'hr.compensation.manage', 'hr.compensation.approve',
    'hr.compensation.reports.view', 'hr.compensation.reports.export',
    // HR Overtime — full
    'hr.overtime.view', 'hr.overtime.approve', 'hr.overtime.manage',
    'hr.overtime.reports.view', 'hr.overtime.reports.export',
    // HR statutory profile capture (NIS)
    'hr.employee.statutory.view', 'hr.employee.statutory.capture',
    'finance.payroll.policies.view', 'finance.payroll.policies.source_approve',
    // HR Contract Management — full (incl. terminate + templates)
    'hr.contracts.view', 'hr.contracts.manage', 'hr.contracts.terminate', 'hr.contracts.template.manage',
    // Account access — hr_manager: view, request, resend activation, manage permissions
    // (reset_password / revoke_sessions / revoke_devices / require_mfa are admin-only)
    'employees.access.view', 'employees.access.request',
    'employees.access.resend_activation',
    'employees.access.permissions.view', 'employees.access.permissions.manage',
    // Ticket queue management (HR manages the account support queue)
    'tickets.view_all', 'tickets.reply_internal',
  ]),
  hse_staff: new Set<PermissionKey>([...EMPLOYEE_BASELINE, 'tickets.create_internal']),

  // Finance roles — mirrors 20260802000000 + 20260802000003 + 20260802000011
  finance_staff: new Set<PermissionKey>([
    ...EMPLOYEE_BASELINE,
    'tickets.create_internal',      // Finance service-queue handler
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
    'tickets.create_internal',      // Finance/Payroll service-queue handler
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
    // SoD policy — view/propose/approve only; manage_roles stays superadmin-only so
    // this role cannot make itself the sole approver and defeat maker-checker.
    'finance.payroll.sod_policy.view',
    'finance.payroll.sod_policy.propose',
    'finance.payroll.sod_policy.approve',
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
    'hr.onboarding.self.view',
    'tickets.create_self',
    'calendar.view', 'calendar.task.manage_own', 'calendar.activity.manage_own',
    'platform.weather.view',
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
    'hr.onboarding.self.view',
    'tickets.create_self', 'tickets.create_team',
    'finance.payroll.view_own',   // self-service: view/print own payslips (self-scoped server-side)
    'calendar.view', 'calendar.manage', 'calendar.task.manage_own', 'calendar.task.assign', 'calendar.activity.manage_own',
    'platform.weather.view',
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
    'platform.weather.view',
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
    'hr.onboarding.view', 'hr.onboarding.view_team', 'hr.onboarding.view_all',
    'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete', 'hr.onboarding.audit.view',
    'hr.onboarding.custom_actions.view', 'hr.onboarding.custom_actions.create', 'hr.onboarding.custom_actions.update', 'hr.onboarding.custom_actions.retire',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update', 'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'hr.onboarding.provision_account', 'hr.onboarding.documents.waive', 'hr.onboarding.packages.manage', 'hr.onboarding.reports.view', 'hr.onboarding.reports.export',
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

  superadmin: new Set<PermissionKey>([
    'tickets.create_self', 'tickets.create_team', 'tickets.create_on_behalf', 'tickets.create_internal',
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
    'hr.onboarding.view', 'hr.onboarding.view_team', 'hr.onboarding.view_all',
    'hr.onboarding.start', 'hr.onboarding.task.manage', 'hr.onboarding.cancel',
    'hr.onboarding.case.manage', 'hr.onboarding.complete', 'hr.onboarding.audit.view',
    'hr.onboarding.custom_actions.view', 'hr.onboarding.custom_actions.create', 'hr.onboarding.custom_actions.update', 'hr.onboarding.custom_actions.retire',
    'hr.onboarding.custom_actions.case_add', 'hr.onboarding.custom_actions.case_update', 'hr.onboarding.custom_actions.case_complete', 'hr.onboarding.custom_actions.case_cancel',
    'hr.onboarding.provision_account', 'hr.onboarding.documents.waive', 'hr.onboarding.packages.manage', 'hr.onboarding.reports.view', 'hr.onboarding.reports.export',
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
    'tickets.manage', 'tickets.view_all', 'tickets.reply_internal',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read', 'communications.moderate', 'communications.admin',
    'communications.compliance_read', 'communications.compliance_export',
    'communications.compliance_approve',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any', 'communications.messages.delete_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view', 'auth.security.manage_policy',
    'auth.passkeys.admin_revoke', 'auth.trusted_devices.admin_revoke',
    // Account access — superadmin has all 11 keys
    'employees.access.view', 'employees.access.request',
    'employees.access.reset_password', 'employees.access.resend_activation',
    'employees.access.suspend', 'employees.access.restore',
    'employees.access.revoke_sessions', 'employees.access.revoke_devices',
    'employees.access.require_mfa',
    'employees.access.permissions.view', 'employees.access.permissions.manage',
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
    // SoD policy — superadmin alone may edit the eligible-role list (manage_roles).
    'finance.payroll.sod_policy.view',
    'finance.payroll.sod_policy.propose',
    'finance.payroll.sod_policy.approve',
    'finance.payroll.sod_policy.manage_roles',
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
    'platform.weather.view',
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
 *   1. superadmin + non-critical key → always allow
 *   2. per-user override (granted true → allow, false → deny)
 *   3. role default (the rolePermissions set loaded at login)
 *   4. deny
 *
 * CRITICAL_GRANT_KEYS are excluded from the superadmin short-circuit (step 1).
 * For those keys, even a superadmin must have an explicit approved override row
 * (step 2) or the key present in their loaded rolePermissions set (step 3).
 * After the Slice-1 backend change, the backend sends rolePermissions without
 * critical keys for superadmin, and only approved user_permissions rows appear
 * in overrides — so the UI correctly hides compliance affordances from superadmins
 * without an active grant. This is a UX mirror only; the backend is the security
 * boundary.
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

  // 1. superadmin is allow-all EXCEPT for COMPLIANCE_GATED_KEYS.
  //    Those two keys fall through to the override / role-set checks so the UI
  //    correctly reflects the backend fail-closed compliance-access grant model.
  //    Operational critical keys (permissions.manage, roles.manage, auth.*, etc.)
  //    remain auto-granted — only compliance data-access is gated.
  if (ctx.role === 'superadmin' && !COMPLIANCE_GATED_KEYS.has(key)) return true;

  // 2. Per-user override wins. Mirror the backend resolveWithSet() exactly so the
  //    UI never diverges from the server's authorization decision:
  const override = ctx.overrides.find((o) => o.permission === key);
  if (override !== undefined) {
    if (!override.granted) return false;              // explicit deny
    if (!COMPLIANCE_GATED_KEYS.has(key)) return true; // ordinary grant — no window
    // Compliance grant: enforce the time-box + revocation. A granted row that is
    // revoked, undated, or outside its [valid_from, valid_until) window does NOT
    // grant — so the shield hides the moment a grant is revoked or expires.
    if (override.revoked_at || !override.valid_from || !override.valid_until) return false;
    const from  = Date.parse(override.valid_from);
    const until = Date.parse(override.valid_until);
    if (!Number.isFinite(from) || !Number.isFinite(until)) return false;
    const now = Date.now();
    return from <= now && until > now;
  }

  // 3. Role default (DB-loaded set) — but compliance keys are NEVER role-granted;
  //    they require an explicit per-user grant (matches resolveWithSet()).
  if (COMPLIANCE_GATED_KEYS.has(key)) return false;
  return ctx.rolePermissions.includes(key);
}

/**
 * Whether a role grants a permission by default — DB-driven: pass the role's
 * permission set (fetched from the backend, roles-as-data). superadmin = allow-all
 * except for COMPLIANCE_GATED_KEYS (compliance_read/export), which require an
 * explicit user_permissions grant. Operational critical keys remain auto-granted.
 */
export function roleDefaultGranted(roleSet: readonly string[], key: string, role?: UserRole): boolean {
  if (role === 'superadmin' && !COMPLIANCE_GATED_KEYS.has(key)) return true;
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

/** Reactive OR-gate for pages that support distinct self-service/manage capabilities. */
export function useAnyCan(keys: readonly string[]): boolean {
  return useSessionStore((s) => {
    if (!s.role) return false;
    const context = {
      role:            s.role,
      rolePermissions: s.rolePermissions,
      overrides:       s.permissionOverrides,
    };
    return keys.some(key => resolvePermission(key, context));
  });
}
