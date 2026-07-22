/**
 * src/lib/permissionMeta.ts
 *
 * Human-readable metadata for every permission key in PERMISSION_KEYS.
 *
 * Consumers:
 *   - SuperadminConsole / PermissionsTab — label, description, risk badge, grouping
 *
 * Adding a new permission:
 *   1. Add the key to PERMISSION_KEYS in src/lib/permissions.ts.
 *   2. Add a matching entry here.
 *   3. The drift guard test (tests/unit/permissionMeta.sync.test.ts) will fail
 *      until both sides are consistent.
 *
 * Risk tiers:
 *   low      — view-only / own-data access
 *   medium   — create / edit / manage data
 *   high     — approve / delete / export / admin / system management
 *   critical — compliance-sensitive access (audited, per-user only)
 */

import type { PermissionKey } from '@lib/permissions';

export type PermissionRisk = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionMeta {
  /** Top-level module grouping, e.g. 'HSE', 'Payroll', 'Communications'. */
  module: string;
  /** Sub-group within the module, e.g. 'Permit to Work', 'Incidents'. */
  group: string;
  /** Short human-readable name shown in the matrix row. */
  label: string;
  /** One-line description of what this permission enables. */
  description: string;
  /** Risk tier drives badge colour in the matrix UI. */
  risk: PermissionRisk;
  /**
   * When true, this permission should only be granted by a superadmin and is
   * not included in role-level defaults for standard roles.
   */
  requiresSuperAdmin?: boolean;
}

export const PERMISSION_META: Record<PermissionKey, PermissionMeta> = {

  // ── HR (people backbone) ─────────────────────────────────────────────────────
  'hr.view':                        { module: 'HR', group: 'General',        label: 'Access HR',                description: 'Open the HR module.', risk: 'low' },
  'hr.dashboard.view':              { module: 'HR', group: 'General',        label: 'View HR Dashboard',        description: 'View the HR workforce dashboard and KPIs.', risk: 'low' },
  'hr.audit.view':                  { module: 'HR', group: 'General',        label: 'View HR Audit',            description: 'View the HR audit log.', risk: 'medium' },
  'hr.settings.view':               { module: 'HR', group: 'Settings',       label: 'View HR Settings',         description: 'View HR module settings.', risk: 'low' },
  'hr.settings.manage':             { module: 'HR', group: 'Settings',       label: 'Manage HR Settings',       description: 'Change HR module settings.', risk: 'high' },
  'hr.employees.status_change':     { module: 'HR', group: 'Employee Master', label: 'Change Employment Status', description: 'Change an employee employment status (probation, suspend, terminate, archive).', risk: 'high' },
  'hr.employees.transfer':          { module: 'HR', group: 'Employee Master', label: 'Transfer Employee',       description: 'Transfer an employee between departments or sites.', risk: 'high' },
  'hr.employees.role_change':       { module: 'HR', group: 'Employee Master', label: 'Change Role',             description: 'Request or apply an employee role change.', risk: 'high' },
  'hr.employees.supervisor_change': { module: 'HR', group: 'Employee Master', label: 'Change Supervisor',       description: 'Change an employee reporting supervisor.', risk: 'medium' },
  'hr.employees.sensitive_view':    { module: 'HR', group: 'Employee Master', label: 'View Sensitive HR Data',  description: 'View sensitive HR employee fields.', risk: 'high' },
  'hr.employees.view':              { module: 'HR', group: 'Employee Master', label: 'View Employee Master',    description: 'View the employee register, profiles and stats.', risk: 'low' },
  'hr.employees.create':            { module: 'HR', group: 'Employee Master', label: 'Create Employee',         description: 'Create a new employee via the Employee Master wizard.', risk: 'medium' },
  'hr.employees.update':            { module: 'HR', group: 'Employee Master', label: 'Update Employee',         description: 'Edit employee profile and work-contact fields.', risk: 'medium' },
  'hr.employees.statutory.view':    { module: 'HR', group: 'Employee Master', label: 'View Statutory Data',     description: 'View NIS / BIR / PAYE / health-surcharge statutory fields.', risk: 'high' },
  'hr.employees.statutory.update':  { module: 'HR', group: 'Employee Master', label: 'Update Statutory Data',   description: 'Edit statutory and payroll-readiness fields.', risk: 'high' },
  'hr.employees.payroll_readiness.view': { module: 'HR', group: 'Employee Master', label: 'View Payroll Readiness', description: 'View an employee payroll-readiness status.', risk: 'medium' },
  'hr.employees.restricted_contact.update': { module: 'HR', group: 'Employee Master', label: 'Update Restricted Contact', description: 'Update restricted / sensitive contact fields.', risk: 'high' },
  'hr.employees.photo_approve':      { module: 'HR', group: 'Employee Master', label: 'Approve Profile Photos',   description: 'Approve or reject a submitted profile photo change.', risk: 'medium' },
  'hr.employees.import':                 { module: 'HR', group: 'Employee Master', label: 'Import Employees',        description: 'Access the bulk employee import wizard.', risk: 'medium' },
  'hr.employees.import.upload':          { module: 'HR', group: 'Employee Master', label: 'Import: Upload',          description: 'Upload an import file and stage rows.', risk: 'medium' },
  'hr.employees.import.map':             { module: 'HR', group: 'Employee Master', label: 'Import: Map & Policy',     description: 'Map columns and set import policy.', risk: 'medium' },
  'hr.employees.import.validate':        { module: 'HR', group: 'Employee Master', label: 'Import: Validate',        description: 'Validate staged rows and resolve exceptions.', risk: 'medium' },
  'hr.employees.import.commit':          { module: 'HR', group: 'Employee Master', label: 'Import: Commit',          description: 'Commit an import batch (create/update employees).', risk: 'high' },
  'hr.employees.import.report.download': { module: 'HR', group: 'Employee Master', label: 'Import: Download Report',  description: 'Download the import result/error report.', risk: 'low' },
  'hr.onboarding.view':        { module: 'HR', group: 'Onboarding', label: 'View Onboarding',      description: 'View onboarding cases, tasks and handoffs.', risk: 'low' },
  'hr.onboarding.start':       { module: 'HR', group: 'Onboarding', label: 'Start Onboarding',     description: 'Start an onboarding case from a package.', risk: 'medium' },
  'hr.onboarding.task.manage': { module: 'HR', group: 'Onboarding', label: 'Manage Onboarding Tasks', description: 'Complete or reassign onboarding tasks.', risk: 'medium' },
  'hr.onboarding.cancel':      { module: 'HR', group: 'Onboarding', label: 'Cancel Onboarding',    description: 'Cancel an onboarding case.', risk: 'medium' },
  'hr.onboarding.case.manage': { module: 'HR', group: 'Onboarding', label: 'Manage Onboarding Cases', description: 'Add tasks, pause/resume, reassign owner, mark ready, and resolve/escalate/waive blockers.', risk: 'medium' },
  'hr.onboarding.complete':    { module: 'HR', group: 'Onboarding', label: 'Complete Onboarding',  description: 'Complete an onboarding case once all tasks are cleared.', risk: 'medium' },
  'hr.onboarding.audit.view':  { module: 'HR', group: 'Onboarding', label: 'View Onboarding Audit', description: 'View the onboarding case audit trail.', risk: 'low' },
  'hr.onboarding.custom_actions.view':         { module: 'HR', group: 'Onboarding', label: 'View Custom Actions',         description: 'View package custom-action templates.', risk: 'low' },
  'hr.onboarding.custom_actions.create':       { module: 'HR', group: 'Onboarding', label: 'Create Custom Action',        description: 'Create a package custom-action template.', risk: 'medium' },
  'hr.onboarding.custom_actions.update':       { module: 'HR', group: 'Onboarding', label: 'Update Custom Action',        description: 'Edit a package custom-action template.', risk: 'medium' },
  'hr.onboarding.custom_actions.retire':       { module: 'HR', group: 'Onboarding', label: 'Retire Custom Action',        description: 'Retire a package custom-action template.', risk: 'medium' },
  'hr.onboarding.custom_actions.case_add':     { module: 'HR', group: 'Onboarding', label: 'Add Case Custom Action',      description: 'Add a one-off custom action to an onboarding case.', risk: 'medium' },
  'hr.onboarding.custom_actions.case_update':  { module: 'HR', group: 'Onboarding', label: 'Update Case Custom Action',   description: 'Update a custom action on an onboarding case.', risk: 'medium' },
  'hr.onboarding.custom_actions.case_complete':{ module: 'HR', group: 'Onboarding', label: 'Complete Case Custom Action', description: 'Complete a custom action on an onboarding case.', risk: 'medium' },
  'hr.onboarding.custom_actions.case_cancel':  { module: 'HR', group: 'Onboarding', label: 'Cancel Case Custom Action',   description: 'Cancel a custom action on an onboarding case.', risk: 'medium' },
  'hr.onboarding.provision_account':           { module: 'HR', group: 'Onboarding', label: 'Provision Account',           description: 'Create a work email + login and send the set-password invite.', risk: 'high' },
  'hr.onboarding.packages.manage':             { module: 'HR', group: 'Onboarding', label: 'Manage Packages',             description: 'Create/edit onboarding packages and their task, handoff & custom-action templates.', risk: 'high' },
  'hr.onboarding.reports.view':                { module: 'HR', group: 'Onboarding', label: 'View Onboarding Reports',     description: 'View onboarding analytics and compliance reports.', risk: 'low' },
  'hr.onboarding.reports.export':              { module: 'HR', group: 'Onboarding', label: 'Export Onboarding Reports',   description: 'Export onboarding report data to CSV (audited data egress).', risk: 'medium' },
  'hr.offboarding.view':        { module: 'HR', group: 'Offboarding', label: 'View Offboarding',      description: 'View offboarding cases, tasks and handoffs.', risk: 'low' },
  'hr.offboarding.start':       { module: 'HR', group: 'Offboarding', label: 'Start Offboarding',     description: 'Start an offboarding case for an employee.', risk: 'medium' },
  'hr.offboarding.task.manage': { module: 'HR', group: 'Offboarding', label: 'Manage Offboarding Tasks', description: 'Complete or reassign offboarding tasks.', risk: 'medium' },
  'hr.offboarding.case.manage': { module: 'HR', group: 'Offboarding', label: 'Manage Offboarding Cases', description: 'Pause/resume, reassign owner, mark ready for exit, and manage blockers.', risk: 'medium' },
  'hr.offboarding.complete':    { module: 'HR', group: 'Offboarding', label: 'Complete Offboarding',  description: 'Complete an offboarding case once all tasks are cleared.', risk: 'medium' },
  'hr.offboarding.finalize':    { module: 'HR', group: 'Offboarding', label: 'Finalize Exit',         description: 'Terminate the employee (disables login) and raise the IT access-removal handoff.', risk: 'high' },
  'hr.offboarding.cancel':      { module: 'HR', group: 'Offboarding', label: 'Cancel Offboarding',    description: 'Cancel an offboarding case.', risk: 'medium' },
  'hr.offboarding.audit.view':  { module: 'HR', group: 'Offboarding', label: 'View Offboarding Audit', description: 'View the offboarding case audit trail.', risk: 'low' },
  // ── HR Transfers & Promotions ────────────────────────────────────────────────
  'hr.transfers.view':    { module: 'HR', group: 'Transfers', label: 'View Transfers',           description: 'View transfer and promotion requests.', risk: 'low' },
  'hr.transfers.request': { module: 'HR', group: 'Transfers', label: 'Request Transfer',         description: 'Submit a bundled transfer/promotion request for an employee.', risk: 'medium' },
  'hr.transfers.approve': { module: 'HR', group: 'Transfers', label: 'Approve/Reject Transfer',  description: 'Approve, reject or return a transfer/promotion request (includes role + salary changes).', risk: 'high' },
  'hr.transfers.cancel':  { module: 'HR', group: 'Transfers', label: 'Cancel Transfer',          description: 'Cancel a pending transfer/promotion request.', risk: 'medium' },
  'hr.organization.view':           { module: 'HR', group: 'Organization',   label: 'View Organization',        description: 'View the organization structure and departments tree.', risk: 'low' },
  'hr.organization.manage':         { module: 'HR', group: 'Organization',   label: 'Manage Organization',      description: 'Create or edit org units and reporting lines.', risk: 'high' },
  'hr.positions.view':              { module: 'HR', group: 'Organization',   label: 'View Positions',           description: 'View job positions.', risk: 'low' },
  'hr.positions.manage':            { module: 'HR', group: 'Organization',   label: 'Manage Positions',         description: 'Create or edit job positions.', risk: 'high' },
  'hr.work_calendar.view':          { module: 'HR', group: 'Work Calendar',  label: 'View Work Calendar',       description: 'View holiday sets, work-calendar patterns, assignments and the period-resolution preview.', risk: 'low' },
  'hr.work_calendar.manage':        { module: 'HR', group: 'Work Calendar',  label: 'Manage Work Calendar',     description: 'Draft/publish holiday sets and work patterns, and assign work calendars to pay groups.', risk: 'high' },
  'hr.cost_centers.view':           { module: 'HR', group: 'Organization',   label: 'View Cost Centres',        description: 'View cost centres.', risk: 'low' },
  'hr.cost_centers.manage':         { module: 'HR', group: 'Organization',   label: 'Manage Cost Centres',      description: 'Create or edit cost centres.', risk: 'high' },
  'hr.organization.delete':         { module: 'HR', group: 'Organization',   label: 'Delete Org Units',         description: 'Hard-delete an org unit (guarded; deactivate is preferred).', risk: 'high' },
  'hr.organization.override_approval': { module: 'HR', group: 'Organization', label: 'Override Org Approval',    description: 'Apply a high-risk org change without the approval workflow (audited).', risk: 'high' },
  'hr.employee_documents.view':           { module: 'HR', group: 'Documents', label: 'View HR Documents',        description: 'View HR employee documents.', risk: 'medium' },
  'hr.employee_documents.upload':         { module: 'HR', group: 'Documents', label: 'Upload HR Document',       description: 'Upload an HR employee document.', risk: 'medium' },
  'hr.employee_documents.verify':         { module: 'HR', group: 'Documents', label: 'Verify/Reject HR Document', description: 'Verify or reject an HR employee document.', risk: 'high' },
  'hr.employee_documents.archive':        { module: 'HR', group: 'Documents', label: 'Archive HR Document',      description: 'Archive an HR employee document.', risk: 'medium' },
  'hr.employee_documents.download':       { module: 'HR', group: 'Documents', label: 'Download HR Document',     description: 'Download an HR employee document (audited).', risk: 'high' },
  'hr.employee_documents.sensitive_view':         { module: 'HR', group: 'Documents', label: 'View Restricted HR Docs',          description: 'View restricted / medical / legal HR documents.', risk: 'high' },
  'hr.employee_documents.requirements.manage':    { module: 'HR', group: 'Documents', label: 'Manage Document Requirements',      description: 'Define required document types and expiry policy.', risk: 'high' },
  // ── HR Leave & Absence ───────────────────────────────────────────────────────
  'hr.leave.view':                { module: 'HR', group: 'Leave & Absence', label: 'View Own Leave',      description: 'View own leave requests and balances.', risk: 'low' },
  'hr.leave.view_all':            { module: 'HR', group: 'Leave & Absence', label: 'View All Leave',      description: "View all employees' leave requests.", risk: 'medium' },
  'hr.leave.submit':              { module: 'HR', group: 'Leave & Absence', label: 'Submit Leave Request', description: 'Submit a leave request on behalf of self or a managed employee.', risk: 'low' },
  'hr.leave.cancel_own':          { module: 'HR', group: 'Leave & Absence', label: 'Cancel Own Leave',    description: 'Cancel own pending leave request.', risk: 'low' },
  'hr.leave.approve':             { module: 'HR', group: 'Leave & Absence', label: 'Approve/Reject Leave', description: 'Approve or reject leave requests.', risk: 'medium' },
  'hr.leave.types.manage':        { module: 'HR', group: 'Leave & Absence', label: 'Manage Leave Types',   description: 'Create, update and retire leave type definitions.', risk: 'high' },
  'hr.leave.balances.view':       { module: 'HR', group: 'Leave & Absence', label: 'View Leave Balances',  description: 'View leave balance ledgers for any employee.', risk: 'medium' },
  'hr.leave.balances.adjust':     { module: 'HR', group: 'Leave & Absence', label: 'Adjust Leave Balance', description: 'Manually adjust an employee leave balance (audited).', risk: 'high' },
  'hr.leave.accruals.run':        { module: 'HR', group: 'Leave & Absence', label: 'Run Accruals',          description: 'Trigger the leave accrual engine for a period.', risk: 'high' },
  'hr.leave.calendar.view':       { module: 'HR', group: 'Leave & Absence', label: 'View Leave Calendar',  description: 'View the org-wide leave calendar.', risk: 'low' },
  'hr.leave.reports.view':        { module: 'HR', group: 'Leave & Absence', label: 'View Leave Reports',   description: 'Run and view leave utilization and compliance reports.', risk: 'medium' },
  'hr.leave.reports.export':      { module: 'HR', group: 'Leave & Absence', label: 'Export Leave Reports',  description: 'Export leave report data (audited data egress).', risk: 'high' },
  'hr.leave.manage':              { module: 'HR', group: 'Leave & Absence', label: 'Manage Leave',            description: 'Full leave management: override status, manage any request.', risk: 'high' },

  // ── HR Requests (Request Center) ────────────────────────────────────────────
  'hr.requests.submit_own': { module: 'HR', group: 'Requests', label: 'Submit Own HR Requests', description: 'Submit and track self-service HR requests (letters, copies, corrections, inquiries).', risk: 'low' },
  'hr.requests.manage':     { module: 'HR', group: 'Requests', label: 'Manage HR Requests',      description: 'Triage, approve, reject, return, and fulfill HR service requests for any employee.', risk: 'medium' },

  // ── HR Attendance ─────────────────────────────────────────────────────────────
  'hr.attendance.view':               { module: 'HR', group: 'Attendance', label: 'View Attendance',             description: 'View own attendance records and daily log.', risk: 'low' },
  'hr.attendance.view_all':           { module: 'HR', group: 'Attendance', label: 'View All Attendance',         description: 'View attendance records for all employees.', risk: 'medium' },
  'hr.attendance.punch':              { module: 'HR', group: 'Attendance', label: 'Punch In/Out',                description: 'Record own check-in and check-out times.', risk: 'low' },
  'hr.attendance.correct':            { module: 'HR', group: 'Attendance', label: 'Correct Attendance',          description: 'Apply corrections to attendance records.', risk: 'medium' },
  'hr.attendance.timesheets.view':    { module: 'HR', group: 'Attendance', label: 'View Timesheets',             description: 'View own timesheets.', risk: 'low' },
  'hr.attendance.timesheets.submit':  { module: 'HR', group: 'Attendance', label: 'Submit Timesheet',            description: 'Submit a timesheet for manager approval.', risk: 'low' },
  'hr.attendance.timesheets.approve': { module: 'HR', group: 'Attendance', label: 'Approve Timesheets',          description: 'Approve or reject submitted timesheets.', risk: 'medium' },
  'hr.attendance.exceptions.view':    { module: 'HR', group: 'Attendance', label: 'View Exceptions',             description: 'View attendance exceptions and alerts.', risk: 'low' },
  'hr.attendance.exceptions.manage':  { module: 'HR', group: 'Attendance', label: 'Manage Exceptions',           description: 'Waive or resolve attendance exceptions.', risk: 'medium' },
  'hr.attendance.compute.run':        { module: 'HR', group: 'Attendance', label: 'Run Compute',                 description: 'Trigger recomputation of daily attendance records.', risk: 'medium' },
  'hr.attendance.policy.manage':      { module: 'HR', group: 'Attendance', label: 'Manage Attendance Policy',    description: 'Configure attendance policy settings (shift times, grace, geofence).', risk: 'high' },
  'hr.attendance.reports.view':       { module: 'HR', group: 'Attendance', label: 'View Attendance Reports',     description: 'View attendance reports and analytics.', risk: 'low' },
  'hr.attendance.reports.export':     { module: 'HR', group: 'Attendance', label: 'Export Attendance Reports',   description: 'Export attendance data and reports.', risk: 'high' },

  // ── HR Roster (Shift Scheduling) ─────────────────────────────────────────────
  'hr.roster.view':             { module: 'HR', group: 'Roster', label: 'View Rosters',              description: 'View shift rosters for the accessible scope (dept or org-wide).', risk: 'low' },
  'hr.roster.view_own':         { module: 'HR', group: 'Roster', label: 'View Own Shifts',           description: 'View own published shift assignments (employee self-service).', risk: 'low' },
  'hr.roster.manage':           { module: 'HR', group: 'Roster', label: 'Manage Roster',             description: 'Create, edit, assign and generate roster entries and shift assignments.', risk: 'medium' },
  'hr.roster.publish':          { module: 'HR', group: 'Roster', label: 'Publish Roster',            description: 'Lock and publish a roster period, notifying assigned employees of their shifts.', risk: 'high' },
  'hr.roster.templates.manage': { module: 'HR', group: 'Roster', label: 'Manage Roster Templates',   description: 'Create and update shift templates, rotation patterns and coverage requirements.', risk: 'medium' },

  // ── Employees ────────────────────────────────────────────────────────────────
  'employees.view': {
    module: 'Employees', group: 'Employee Directory',
    label: 'View Employee List',
    description: 'See the employee directory and basic profile information.',
    risk: 'low',
  },
  'employees.view_detail': {
    module: 'Employees', group: 'Employee Directory',
    label: 'View Employee Profile',
    description: "View an individual employee's full profile, history, and documents.",
    risk: 'low',
  },
  'employees.add': {
    module: 'Employees', group: 'Employee Management',
    label: 'Add Employee',
    description: 'Create a new employee account and onboarding record.',
    risk: 'medium',
  },
  'employees.edit': {
    module: 'Employees', group: 'Employee Management',
    label: 'Edit Employee',
    description: "Update an employee's details, role, or employment status.",
    risk: 'medium',
  },
  'employees.delete': {
    module: 'Employees', group: 'Employee Management',
    label: 'Deactivate Employee',
    description: 'Deactivate an employee account (soft delete).',
    risk: 'high',
  },
  'employees.view_pay': {
    module: 'Employees', group: 'Employee Directory',
    label: 'View Pay Info',
    description: "See an employee's pay rate and payroll information.",
    risk: 'medium',
  },

  // ── Departments ──────────────────────────────────────────────────────────────
  'departments.view': {
    module: 'Employees', group: 'Departments',
    label: 'View Departments',
    description: 'View department list and members.',
    risk: 'low',
    requiresSuperAdmin: true,
  },
  'departments.add': {
    module: 'Employees', group: 'Departments',
    label: 'Add Department',
    description: 'Create a new department.',
    risk: 'medium',
    requiresSuperAdmin: true,
  },
  'departments.edit': {
    module: 'Employees', group: 'Departments',
    label: 'Edit Department',
    description: "Rename or re-scope an existing department.",
    risk: 'medium',
    requiresSuperAdmin: true,
  },
  'departments.delete': {
    module: 'Employees', group: 'Departments',
    label: 'Delete Department',
    description: 'Remove a department (requires reassignment of members).',
    risk: 'high',
    requiresSuperAdmin: true,
  },

  // ── Attendance ───────────────────────────────────────────────────────────────
  'attendance.view_own': {
    module: 'Attendance & Leave', group: 'Attendance',
    label: 'View Own Attendance',
    description: 'See your own attendance history and check-in records.',
    risk: 'low',
  },
  'attendance.view_all': {
    module: 'Attendance & Leave', group: 'Attendance',
    label: 'View All Attendance',
    description: "View all employees' attendance logs.",
    risk: 'medium',
  },
  'attendance.edit': {
    module: 'Attendance & Leave', group: 'Attendance',
    label: 'Edit Attendance',
    description: 'Correct or amend attendance records.',
    risk: 'medium',
  },
  'attendance.export': {
    module: 'Attendance & Leave', group: 'Attendance',
    label: 'Export Attendance',
    description: 'Download attendance data as CSV or PDF.',
    risk: 'high',
  },

  // ── Leave ────────────────────────────────────────────────────────────────────
  'leaves.view_own': {
    module: 'Attendance & Leave', group: 'Leave',
    label: 'View Own Leave',
    description: 'See your own leave requests and balances.',
    risk: 'low',
  },
  'leaves.submit': {
    module: 'Attendance & Leave', group: 'Leave',
    label: 'Submit Leave Request',
    description: 'Create and submit a new leave request.',
    risk: 'medium',
  },
  'leaves.view_all': {
    module: 'Attendance & Leave', group: 'Leave',
    label: 'View All Leave',
    description: "See all employees' leave requests.",
    risk: 'medium',
  },
  'leaves.approve': {
    module: 'Attendance & Leave', group: 'Leave',
    label: 'Approve / Reject Leave',
    description: 'Approve or reject leave requests from any employee.',
    risk: 'high',
  },
  'leaves.delete': {
    module: 'Attendance & Leave', group: 'Leave',
    label: 'Delete Leave Request',
    description: 'Permanently delete a leave request (admin only).',
    risk: 'high',
  },

  // ── Payroll ──────────────────────────────────────────────────────────────────
  'payroll.view_own': {
    module: 'Payroll', group: 'Payroll',
    label: 'View Own Payslips',
    description: 'See your own payslips and pay history.',
    risk: 'low',
  },
  'payroll.view_all': {
    module: 'Payroll', group: 'Payroll',
    label: 'View All Payroll',
    description: 'View all payroll runs and employee pay data.',
    risk: 'medium',
  },
  'payroll.run': {
    module: 'Payroll', group: 'Payroll',
    label: 'Run Payroll',
    description: 'Initiate a new payroll run.',
    risk: 'medium',
  },
  'payroll.approve': {
    module: 'Payroll', group: 'Payroll',
    label: 'Approve Payroll',
    description: 'Approve a payroll run for disbursement.',
    risk: 'high',
  },
  'payroll.export': {
    module: 'Payroll', group: 'Payroll',
    label: 'Export Payroll',
    description: 'Download payroll reports and pay summaries.',
    risk: 'high',
  },

  // ── Hourly Rates ─────────────────────────────────────────────────────────────
  'hourly_rates.view': {
    module: 'Payroll', group: 'Hourly Rates',
    label: 'View Hourly Rates',
    description: 'See configured hourly rate bands.',
    risk: 'low',
  },
  'hourly_rates.edit': {
    module: 'Payroll', group: 'Hourly Rates',
    label: 'Edit Hourly Rates',
    description: 'Update or create hourly rate configurations.',
    risk: 'medium',
  },

  // ── Project Sites ─────────────────────────────────────────────────────────────
  'sites.view': {
    module: 'Sites & Map', group: 'Project Sites',
    label: 'View Sites',
    description: 'See the list of project sites and their details.',
    risk: 'low',
  },
  'sites.add': {
    module: 'Sites & Map', group: 'Project Sites',
    label: 'Add Site',
    description: 'Create a new project site.',
    risk: 'medium',
  },
  'sites.edit': {
    module: 'Sites & Map', group: 'Project Sites',
    label: 'Edit Site',
    description: 'Update site details, boundaries, or status.',
    risk: 'medium',
  },
  'sites.delete': {
    module: 'Sites & Map', group: 'Project Sites',
    label: 'Delete Site',
    description: 'Remove a project site from the system.',
    risk: 'high',
  },
  'sites.assign_employees': {
    module: 'Sites & Map', group: 'Project Sites',
    label: 'Assign Employees to Site',
    description: 'Assign or remove employees from a project site.',
    risk: 'medium',
  },

  // ── Live Map ──────────────────────────────────────────────────────────────────
  'map.view': {
    module: 'Sites & Map', group: 'Live Map',
    label: 'View Live Map',
    description: 'See the real-time employee location tracking map.',
    risk: 'low',
  },

  // ── Dashboard / Reports ───────────────────────────────────────────────────────
  'dashboard.view': {
    module: 'Dashboard', group: 'Dashboard',
    label: 'View Dashboard',
    description: 'Access the main dashboard with KPIs and summary charts.',
    risk: 'low',
  },
  'reports.export': {
    module: 'Dashboard', group: 'Reports',
    label: 'Export Reports',
    description: 'Download management reports and analytics exports.',
    risk: 'high',
  },

  // ── Settings ──────────────────────────────────────────────────────────────────
  'settings.view': {
    module: 'Settings', group: 'Settings',
    label: 'View Settings',
    description: 'View system settings and configuration.',
    risk: 'low',
  },
  'settings.edit': {
    module: 'Settings', group: 'Settings',
    label: 'Edit Settings',
    description: 'Change system settings and preferences.',
    risk: 'medium',
  },
  'settings.statutory_rates': {
    module: 'Settings', group: 'Settings',
    label: 'Edit Statutory Rates',
    description: 'Update NIS, PAYE, and other statutory rate constants.',
    risk: 'high',
  },

  // ── User Management (superadmin) ──────────────────────────────────────────────
  'permissions.manage': {
    module: 'User Management', group: 'Access Control',
    label: 'Manage Permissions',
    description: 'Grant or revoke per-user permission overrides.',
    risk: 'high',
    requiresSuperAdmin: true,
  },
  'sessions.manage': {
    module: 'User Management', group: 'Access Control',
    label: 'Manage Sessions',
    description: 'View active sessions and force-revoke them.',
    risk: 'high',
    requiresSuperAdmin: true,
  },
  'audit.view': {
    module: 'User Management', group: 'Access Control',
    label: 'View Audit Log',
    description: 'Access the full system audit log.',
    risk: 'high',
    requiresSuperAdmin: true,
  },
  'roles.manage': {
    module: 'User Management', group: 'Access Control',
    label: 'Manage Roles',
    description: 'Create, edit, or delete roles and their default permission sets.',
    risk: 'high',
    requiresSuperAdmin: true,
  },

  // ── HSE — Incidents ───────────────────────────────────────────────────────────
  'hse.incidents.view': {
    module: 'HSE', group: 'Incidents',
    label: 'View Incidents',
    description: 'View the incident register and incident details.',
    risk: 'low',
  },
  'hse.incidents.manage': {
    module: 'HSE', group: 'Incidents',
    label: 'Manage Incidents',
    description: 'Edit, close, or reclassify incident records.',
    risk: 'medium',
  },
  'hse.incidents.create': {
    module: 'HSE', group: 'Incidents',
    label: 'Report Incident',
    description: 'Submit a new incident report.',
    risk: 'medium',
  },

  // ── HSE — Investigations ──────────────────────────────────────────────────────
  'hse.investigations.manage': {
    module: 'HSE', group: 'Investigations',
    label: 'Manage Investigations',
    description: 'Create, update, and complete incident investigation records.',
    risk: 'medium',
  },

  // ── HSE — Risk & JSA ─────────────────────────────────────────────────────────
  'hse.risk.view': {
    module: 'HSE', group: 'Risk & JSA',
    label: 'View Risk Assessments',
    description: 'View risk assessments and job safety analyses.',
    risk: 'low',
  },
  'hse.risk.manage': {
    module: 'HSE', group: 'Risk & JSA',
    label: 'Manage Risk Assessments',
    description: 'Create and edit risk assessments and JSA records.',
    risk: 'medium',
  },
  'hse.risk.approve': {
    module: 'HSE', group: 'Risk & JSA',
    label: 'Approve Risk Assessments',
    description: 'Sign off on risk assessments and JSAs.',
    risk: 'high',
  },
  'hse.risk.library.manage': {
    module: 'HSE', group: 'Risk & JSA',
    label: 'Manage Hazard Library',
    description: 'Curate the master hazard and control measure libraries.',
    risk: 'medium',
  },

  // ── HSE — Permit to Work ──────────────────────────────────────────────────────
  'hse.ptw.view': {
    module: 'HSE', group: 'Permit to Work',
    label: 'View Permits',
    description: 'View the permit-to-work register and permit details.',
    risk: 'low',
  },
  'hse.ptw.create': {
    module: 'HSE', group: 'Permit to Work',
    label: 'Create Permit',
    description: 'Draft and submit a new permit-to-work.',
    risk: 'medium',
  },
  'hse.ptw.approve': {
    module: 'HSE', group: 'Permit to Work',
    label: 'Approve Permit',
    description: 'Approve a submitted permit for activation.',
    risk: 'high',
  },
  'hse.ptw.activate': {
    module: 'HSE', group: 'Permit to Work',
    label: 'Activate Permit',
    description: 'Activate an approved permit at the physical work site.',
    risk: 'high',
  },
  'hse.ptw.manage': {
    module: 'HSE', group: 'Permit to Work',
    label: 'Manage Permits',
    description: 'Admin actions: extend, close, cancel, or void permits.',
    risk: 'high',
  },

  // ── HSE — CAPA ────────────────────────────────────────────────────────────────
  'hse.capa.view': {
    module: 'HSE', group: 'CAPA',
    label: 'View CAPA',
    description: 'View the CAPA register and CAPA details (own actions for non-managers).',
    risk: 'low',
  },
  'hse.capa.manage': {
    module: 'HSE', group: 'CAPA',
    label: 'Manage CAPA',
    description: 'Create and track corrective and preventive actions.',
    risk: 'medium',
  },

  // ── HSE — Inspections ─────────────────────────────────────────────────────────
  'hse.inspections.view': {
    module: 'HSE', group: 'Inspections & Audits',
    label: 'View Inspections',
    description: 'View inspection and audit records.',
    risk: 'low',
  },
  'hse.inspections.create': {
    module: 'HSE', group: 'Inspections & Audits',
    label: 'Create Inspection',
    description: 'Schedule and draft new inspections and audits.',
    risk: 'medium',
  },
  'hse.inspections.manage': {
    module: 'HSE', group: 'Inspections & Audits',
    label: 'Manage Inspections',
    description: 'Update, execute checklists, record findings, assign corrective actions, and reschedule.',
    risk: 'medium',
  },
  'hse.inspections.review': {
    module: 'HSE', group: 'Inspections & Audits',
    label: 'Review Inspections',
    description: 'Review and complete inspections, and close or reopen findings.',
    risk: 'high',
  },

  // ── HSE — Training ───────────────────────────────────────────────────────────
  'hse.training.view': {
    module: 'HSE', group: 'Training & Competency',
    label: 'View Training',
    description: 'View training records and competency matrices.',
    risk: 'low',
  },
  'hse.training.manage': {
    module: 'HSE', group: 'Training & Competency',
    label: 'Manage Training',
    description: 'Create and update competencies, courses, requirements, certificates, and assignments.',
    risk: 'medium',
  },
  'hse.training.verify': {
    module: 'HSE', group: 'Training & Competency',
    label: 'Verify Certificates',
    description: 'Approve, reject, or revoke worker training certificates.',
    risk: 'high',
  },

  // ── HSE — Toolbox Talks ───────────────────────────────────────────────────────
  'hse.toolbox.view': {
    module: 'HSE', group: 'Toolbox Talks',
    label: 'View Toolbox Talks',
    description: 'Access toolbox talk records and attendance sheets.',
    risk: 'low',
  },
  'hse.toolbox.manage': {
    module: 'HSE', group: 'Toolbox Talks',
    label: 'Manage Toolbox Talks',
    description: 'Create and deliver toolbox talk sessions.',
    risk: 'medium',
  },

  // ── HSE — Documents ───────────────────────────────────────────────────────────
  'hse.documents.view': {
    module: 'HSE', group: 'Documents & SDS',
    label: 'View HSE Documents',
    description: 'Access HSE documents, procedures, and safety data sheets.',
    risk: 'low',
  },
  'hse.documents.manage': {
    module: 'HSE', group: 'Documents & SDS',
    label: 'Manage HSE Documents',
    description: 'Upload, update, and archive HSE documents.',
    risk: 'medium',
  },

  // ── HSE — Contractors ─────────────────────────────────────────────────────────
  'hse.contractors.view': {
    module: 'HSE', group: 'Contractors',
    label: 'View Contractors',
    description: 'View contractor safety records and prequalification status.',
    risk: 'low',
  },
  'hse.contractors.manage': {
    module: 'HSE', group: 'Contractors',
    label: 'Manage Contractors',
    description: 'Register and update contractor HSE compliance records.',
    risk: 'medium',
  },

  // ── HSE — Legal ───────────────────────────────────────────────────────────────
  'hse.legal.view': {
    module: 'HSE', group: 'Legal & Compliance',
    label: 'View Legal Register',
    description: 'View the legal and regulatory compliance register.',
    risk: 'low',
  },
  'hse.legal.manage': {
    module: 'HSE', group: 'Legal & Compliance',
    label: 'Manage Legal Register',
    description: 'Update and maintain the legal and regulatory register.',
    risk: 'medium',
  },

  // ── HSE — Emergency ──────────────────────────────────────────────────────────
  'hse.emergency.view': {
    module: 'HSE', group: 'Emergency Preparedness',
    label: 'View Emergency Plans',
    description: 'View emergency response plans and muster records.',
    risk: 'low',
  },
  'hse.emergency.manage': {
    module: 'HSE', group: 'Emergency Preparedness',
    label: 'Manage Emergency Plans',
    description: 'Update emergency response plans and run drills.',
    risk: 'medium',
  },

  // ── HSE — Environmental ───────────────────────────────────────────────────────
  'hse.environmental.view': {
    module: 'HSE', group: 'Environmental',
    label: 'View Environmental Records',
    description: 'View environmental monitoring and compliance records.',
    risk: 'low',
  },
  'hse.environmental.manage': {
    module: 'HSE', group: 'Environmental',
    label: 'Manage Environmental Records',
    description: 'Record and update environmental monitoring data.',
    risk: 'medium',
  },

  // ── HSE — PPE ────────────────────────────────────────────────────────────────
  'hse.ppe.view': {
    module: 'HSE', group: 'PPE',
    label: 'View PPE Records',
    description: 'View PPE inventory and issue records.',
    risk: 'low',
  },
  'hse.ppe.manage': {
    module: 'HSE', group: 'PPE',
    label: 'Manage PPE',
    description: 'Issue, return, and manage PPE inventory.',
    risk: 'medium',
  },

  // ── HSE — Dashboard & Workflows ───────────────────────────────────────────────
  'hse.dashboard.view': {
    module: 'HSE', group: 'HSE Dashboard',
    label: 'View HSE Dashboard',
    description: 'Access HSE KPIs, charts, and summary statistics.',
    risk: 'low',
  },
  'hse.workflows.view': {
    module: 'HSE', group: 'HSE Workflows',
    label: 'View HSE Workflows',
    description: 'View workflow tasks and statuses within the HSE module.',
    risk: 'low',
  },
  'hse.workflows.manage': {
    module: 'HSE', group: 'HSE Workflows',
    label: 'Manage HSE Workflows',
    description: 'Reassign, escalate, or close HSE workflow tasks.',
    risk: 'medium',
  },

  // ── Platform Workflows ────────────────────────────────────────────────────────
  'workflow.submit': {
    module: 'Workflow', group: 'Workflows',
    label: 'Submit Workflow',
    description: 'Submit items through platform-level approval workflows.',
    risk: 'medium',
  },
  'workflow.approve': {
    module: 'Workflow', group: 'Workflows',
    label: 'Approve Workflow',
    description: 'Approve or reject workflow tasks assigned to you.',
    risk: 'high',
  },
  'workflow.audit': {
    module: 'Workflow', group: 'Workflows',
    label: 'Audit Workflows',
    description: 'View the full workflow history and approval audit trail.',
    risk: 'high',
  },
  'workflow.view': {
    module: 'Workflow', group: 'Workflows',
    label: 'View Workflows',
    description: 'View workflow tasks and their current status.',
    risk: 'low',
  },

  // ── Communications ────────────────────────────────────────────────────────────
  'communications.view': {
    module: 'Communications', group: 'Messaging',
    label: 'Use Messaging',
    description: 'Access the messaging system and view threads you participate in.',
    risk: 'low',
  },
  'communications.thread_create': {
    module: 'Communications', group: 'Messaging',
    label: 'Create Threads',
    description: 'Start direct, group, or record-linked message threads.',
    risk: 'medium',
  },
  'communications.thread_manage_own': {
    module: 'Communications', group: 'Messaging',
    label: 'Manage Own Threads',
    description: 'Add or remove participants in threads you own.',
    risk: 'medium',
  },
  'communications.record_thread_read': {
    module: 'Communications', group: 'Messaging',
    label: 'Read Record Threads',
    description: 'Read message threads linked to records you have access to view.',
    risk: 'low',
  },
  'communications.moderate': {
    module: 'Communications', group: 'Moderation',
    label: 'Moderate Messages',
    description: 'Hide or remove inappropriate posts (audited action).',
    risk: 'high',
  },
  'communications.admin': {
    module: 'Communications', group: 'Moderation',
    label: 'Messaging Admin',
    description: 'Manage messaging settings, retention policies, and broadcast messages.',
    risk: 'high',
  },
  'communications.compliance_read': {
    module: 'Communications', group: 'Compliance',
    label: 'Read Compliance Cases',
    description: 'Requires time-boxed approval. Opens the Compliance workspace to read private message threads for approved investigations (fully audited); this is the access that shows the Compliance shield. Reviewed by a different user — it is never a role default and does not grant approval.',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'communications.compliance_export': {
    module: 'Communications', group: 'Compliance',
    label: 'Export Compliance Evidence',
    description: 'Requires approved read access and export permission. Exports message history/evidence (PDF/JSON) for an approved compliance investigation; layered on top of read access and separately time-boxed.',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'communications.compliance_approve': {
    module: 'Communications', group: 'Compliance',
    label: 'Approve Compliance Requests',
    description: "Shows the compliance Approvals queue in Access Control. Lets the holder review and approve/reject other users' compliance Read/Export requests (a scoped reviewer, without full permission management). Does NOT grant any compliance access itself.",
    risk: 'high',
    requiresSuperAdmin: true,
  },
  'communications.messages.post': {
    module: 'Communications', group: 'Messaging',
    label: 'Send Messages',
    description: 'Post messages in threads you participate in.',
    risk: 'low',
  },
  'communications.messages.attach': {
    module: 'Communications', group: 'Messaging',
    label: 'Attach Files',
    description: 'Attach files to messages.',
    risk: 'low',
  },
  'communications.messages.download_attachment': {
    module: 'Communications', group: 'Messaging',
    label: 'Download Attachments',
    description: 'Fetch signed URLs to view or download message attachments.',
    risk: 'low',
  },
  'communications.messages.delete_own_attachment': {
    module: 'Communications', group: 'Messaging',
    label: 'Delete Own Attachments',
    description: 'Remove attachments you uploaded.',
    risk: 'low',
  },
  'communications.messages.pin_own': {
    module: 'Communications', group: 'Messaging',
    label: 'Personal Pins',
    description: 'Pin conversations or messages for yourself.',
    risk: 'low',
  },
  'communications.messages.pin_thread': {
    module: 'Communications', group: 'Messaging',
    label: 'Pin For Everyone',
    description: 'Pin a conversation or message for all participants in a thread.',
    risk: 'medium',
  },
  'communications.messages.unpin_own': {
    module: 'Communications', group: 'Messaging',
    label: 'Remove Own Pins',
    description: 'Remove pins you created.',
    risk: 'low',
  },
  'communications.messages.unpin_any': {
    module: 'Communications', group: 'Moderation',
    label: 'Remove Any Pin',
    description: 'Remove pins created by anyone (moderation).',
    risk: 'medium',
  },
  'communications.messages.delete_any': {
    module: 'Communications', group: 'Moderation',
    label: 'Delete Any Message',
    description: 'Soft-delete a message posted by anyone (moderation); requires a reason and is audited.',
    risk: 'high',
  },
  'communications.participants.add': {
    module: 'Communications', group: 'Messaging',
    label: 'Add Participants',
    description: 'Add participants to a thread you can manage.',
    risk: 'medium',
  },
  'communications.participants.remove': {
    module: 'Communications', group: 'Messaging',
    label: 'Remove Participants',
    description: 'Remove participants from a thread you can manage.',
    risk: 'medium',
  },
  'communications.participants.change_role': {
    module: 'Communications', group: 'Messaging',
    label: 'Change Participant Roles',
    description: 'Change a participant’s role within a thread.',
    risk: 'medium',
  },

  // ── Tickets ───────────────────────────────────────────────────────────────────
  'tickets.manage': {
    module: 'Tickets', group: 'Tickets',
    label: 'Manage Tickets',
    description: 'Create, assign, resolve, and close support or work tickets.',
    risk: 'medium',
  },
  'tickets.create_self': {
    module: 'Tickets', group: 'Tickets',
    label: 'Raise Ticket (Self)',
    description: 'Raise a support or work ticket for yourself (self-service).',
    risk: 'low',
  },
  'tickets.create_team': {
    module: 'Tickets', group: 'Tickets',
    label: 'Raise Ticket (Team Member)',
    description: 'Raise a ticket for one of your active direct reports.',
    risk: 'low',
  },
  'tickets.create_on_behalf': {
    module: 'Tickets', group: 'Tickets',
    label: 'Raise Ticket (On Behalf)',
    description: 'Raise a ticket on behalf of another employee; a reason is required.',
    risk: 'medium',
  },
  'tickets.create_internal': {
    module: 'Tickets', group: 'Tickets',
    label: 'Raise Ticket (Internal Work)',
    description: 'Raise internal work for a service queue without impersonating an employee.',
    risk: 'medium',
  },

  // ── Account Security ──────────────────────────────────────────────────────────
  'auth.security.view': {
    module: 'Auth', group: 'Account Security',
    label: 'View User Security Status',
    description: "View another user's MFA enrollment, registered passkeys, and trusted device count.",
    risk: 'high',
  },
  'auth.security.manage_policy': {
    module: 'Auth', group: 'Account Security',
    label: 'Manage Security Policy',
    description: 'Update organisation-wide account security policy (MFA requirements, trusted device TTLs, passkey rules).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'auth.passkeys.admin_revoke': {
    module: 'Auth', group: 'Account Security',
    label: 'Admin Revoke Passkeys',
    description: 'Revoke all registered passkeys for another user (requires step-up authentication).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'auth.trusted_devices.admin_revoke': {
    module: 'Auth', group: 'Account Security',
    label: 'Admin Revoke Trusted Devices',
    description: 'Revoke all trusted devices for another user, forcing re-authentication on their next login (requires step-up).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  // ── Settings & Preferences (Spec §8) ─────────────────────────────────────────
  'settings.manage': { module: 'Settings', group: 'Governance', label: 'Manage Settings', description: 'Manage platform settings.', risk: 'high' },
  'settings.own_preferences.view': { module: 'Settings', group: 'Preferences', label: 'View Own Preferences', description: 'View your own personal preferences.', risk: 'low' },
  'settings.own_preferences.manage': { module: 'Settings', group: 'Preferences', label: 'Manage Own Preferences', description: 'Change your own personal preferences.', risk: 'high' },
  'settings.user_preferences.view': { module: 'Settings', group: 'Preferences', label: 'View User Preferences', description: "View another user's preferences.", risk: 'low' },
  'settings.user_preferences.manage': { module: 'Settings', group: 'Preferences', label: 'Manage User Preferences', description: "Change another user's preferences.", risk: 'high' },
  'settings.global.view': { module: 'Settings', group: 'Governance', label: 'View Global Settings', description: 'View system-wide settings.', risk: 'low' },
  'settings.global.manage': { module: 'Settings', group: 'Governance', label: 'Manage Global Settings', description: 'Change system-wide settings.', risk: 'high' },
  'settings.system.view': { module: 'Settings', group: 'Governance', label: 'View System Settings', description: 'View system settings.', risk: 'low' },
  'settings.system.manage': { module: 'Settings', group: 'Governance', label: 'Manage System Settings', description: 'Change system settings.', risk: 'high' },
  'settings.critical.view': { module: 'Settings', group: 'Governance', label: 'View Critical Settings', description: 'View critical settings.', risk: 'low' },
  'settings.critical.manage': { module: 'Settings', group: 'Governance', label: 'Manage Critical Settings', description: 'Change critical settings (elevated).', risk: 'critical' },
  'settings.security.view': { module: 'Settings', group: 'Governance', label: 'View Security Settings', description: 'View security settings.', risk: 'low' },
  'settings.security.manage': { module: 'Settings', group: 'Governance', label: 'Manage Security Settings', description: 'Change security settings.', risk: 'critical' },
  'settings.notification_policy.view': { module: 'Settings', group: 'Governance', label: 'View Notification Policy', description: 'View notification delivery policy.', risk: 'low' },
  'settings.notification_policy.manage': { module: 'Settings', group: 'Governance', label: 'Manage Notification Policy', description: 'Change notification delivery policy.', risk: 'high' },
  'settings.message_policy.view': { module: 'Settings', group: 'Governance', label: 'View Message Policy', description: 'View message delivery policy.', risk: 'low' },
  'settings.message_policy.manage': { module: 'Settings', group: 'Governance', label: 'Manage Message Policy', description: 'Change message delivery policy.', risk: 'high' },
  'settings.workflow.view': { module: 'Settings', group: 'Governance', label: 'View Workflow Settings', description: 'View workflow rules.', risk: 'low' },
  'settings.workflow.manage': { module: 'Settings', group: 'Governance', label: 'Manage Workflow Settings', description: 'Change workflow rules.', risk: 'high' },
  'settings.file_policy.view': { module: 'Settings', group: 'Governance', label: 'View File Policy', description: 'View file/evidence policy.', risk: 'low' },
  'settings.file_policy.manage': { module: 'Settings', group: 'Governance', label: 'Manage File Policy', description: 'Change file/evidence policy.', risk: 'high' },
  'settings.audit_policy.view': { module: 'Settings', group: 'Governance', label: 'View Audit Policy', description: 'View audit policy.', risk: 'low' },
  'settings.audit_policy.manage': { module: 'Settings', group: 'Governance', label: 'Manage Audit Policy', description: 'Change audit policy (elevated).', risk: 'critical' },
  'settings.safety_rules.view': { module: 'Settings', group: 'Governance', label: 'View Safety Rules', description: 'View HSE safety rules.', risk: 'low' },
  'settings.safety_rules.manage': { module: 'Settings', group: 'Governance', label: 'Manage Safety Rules', description: 'Change HSE safety rules (elevated).', risk: 'critical' },
  'settings.notifications.view': { module: 'Settings', group: 'Module Policy', label: 'View Notification Settings', description: 'View notification module settings.', risk: 'low' },
  'settings.notifications.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Notification Settings', description: 'Change notification module settings.', risk: 'high' },
  'settings.messages.view': { module: 'Settings', group: 'Module Policy', label: 'View Message Settings', description: 'View message module settings.', risk: 'low' },
  'settings.messages.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Message Settings', description: 'Change message module settings.', risk: 'high' },
  'settings.files.view': { module: 'Settings', group: 'Module Policy', label: 'View File Settings', description: 'View file module settings.', risk: 'low' },
  'settings.files.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage File Settings', description: 'Change file module settings.', risk: 'high' },
  'settings.employees.view': { module: 'Settings', group: 'Module Policy', label: 'View Employee Settings', description: 'View HR/employee module settings.', risk: 'low' },
  'settings.employees.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Employee Settings', description: 'Change HR/employee module settings.', risk: 'high' },
  'settings.incidents.view': { module: 'Settings', group: 'Module Policy', label: 'View Incident Settings', description: 'View incident module settings.', risk: 'low' },
  'settings.incidents.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Incident Settings', description: 'Change incident module settings.', risk: 'high' },
  'settings.investigations.view': { module: 'Settings', group: 'Module Policy', label: 'View Investigation Settings', description: 'View investigation module settings.', risk: 'low' },
  'settings.investigations.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Investigation Settings', description: 'Change investigation module settings.', risk: 'high' },
  'settings.capa.view': { module: 'Settings', group: 'Module Policy', label: 'View CAPA Settings', description: 'View CAPA module settings.', risk: 'low' },
  'settings.capa.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage CAPA Settings', description: 'Change CAPA module settings.', risk: 'high' },
  'settings.jsa.view': { module: 'Settings', group: 'Module Policy', label: 'View JSA Settings', description: 'View JSA module settings.', risk: 'low' },
  'settings.jsa.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage JSA Settings', description: 'Change JSA module settings.', risk: 'high' },
  'settings.ptw.view': { module: 'Settings', group: 'Module Policy', label: 'View PTW Settings', description: 'View permit-to-work module settings.', risk: 'low' },
  'settings.ptw.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage PTW Settings', description: 'Change permit-to-work module settings.', risk: 'high' },
  'settings.inspections.view': { module: 'Settings', group: 'Module Policy', label: 'View Inspection Settings', description: 'View inspection module settings.', risk: 'low' },
  'settings.inspections.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Inspection Settings', description: 'Change inspection module settings.', risk: 'high' },
  'settings.training.view': { module: 'Settings', group: 'Module Policy', label: 'View Training Settings', description: 'View training module settings.', risk: 'low' },
  'settings.training.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Training Settings', description: 'Change training module settings.', risk: 'high' },
  'settings.documents.view': { module: 'Settings', group: 'Module Policy', label: 'View Document Settings', description: 'View document module settings.', risk: 'low' },
  'settings.documents.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Document Settings', description: 'Change document module settings.', risk: 'high' },
  'settings.sds.view': { module: 'Settings', group: 'Module Policy', label: 'View SDS Settings', description: 'View SDS module settings.', risk: 'low' },
  'settings.sds.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage SDS Settings', description: 'Change SDS module settings.', risk: 'high' },
  'settings.ppe.view': { module: 'Settings', group: 'Module Policy', label: 'View PPE Settings', description: 'View PPE module settings.', risk: 'low' },
  'settings.ppe.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage PPE Settings', description: 'Change PPE module settings.', risk: 'high' },
  'settings.command_center.view': { module: 'Settings', group: 'Module Policy', label: 'View Command Center Settings', description: 'View command center settings.', risk: 'low' },
  'settings.command_center.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Command Center Settings', description: 'Change command center settings.', risk: 'high' },
  'settings.admin.view': { module: 'Settings', group: 'Module Policy', label: 'View Admin Settings', description: 'View admin module settings.', risk: 'low' },
  'settings.admin.manage': { module: 'Settings', group: 'Module Policy', label: 'Manage Admin Settings', description: 'Change admin module settings.', risk: 'high' },
  'settings.manifests.view': { module: 'Settings', group: 'Manifest Review', label: 'View Manifests', description: 'View module settings manifests.', risk: 'low' },
  'settings.manifests.create': { module: 'Settings', group: 'Manifest Review', label: 'Create Manifest', description: 'Create a module settings manifest.', risk: 'high' },
  'settings.manifests.update': { module: 'Settings', group: 'Manifest Review', label: 'Update Manifest', description: 'Update a module settings manifest.', risk: 'high' },
  'settings.manifests.submit': { module: 'Settings', group: 'Manifest Review', label: 'Submit Manifest', description: 'Submit a manifest for review.', risk: 'high' },
  'settings.manifests.review': { module: 'Settings', group: 'Manifest Review', label: 'Review Manifest', description: 'Review a submitted manifest.', risk: 'critical' },
  'settings.manifests.approve': { module: 'Settings', group: 'Manifest Review', label: 'Approve Manifest', description: 'Approve a manifest.', risk: 'critical' },
  'settings.manifests.return': { module: 'Settings', group: 'Manifest Review', label: 'Return Manifest', description: 'Return a manifest for changes.', risk: 'critical' },
  'settings.manifests.deprecate': { module: 'Settings', group: 'Manifest Review', label: 'Deprecate Manifest', description: 'Deprecate a manifest.', risk: 'critical' },
  'settings.manifests.review.product': { module: 'Settings', group: 'Manifest Review', label: 'Product Owner Review', description: 'Sign off a manifest as Product Owner.', risk: 'critical' },
  'settings.manifests.review.module_owner': { module: 'Settings', group: 'Manifest Review', label: 'Module Owner Review', description: 'Sign off a manifest as Module Owner.', risk: 'critical' },
  'settings.manifests.review.engineering': { module: 'Settings', group: 'Manifest Review', label: 'Engineering Review', description: 'Sign off a manifest as Engineering.', risk: 'critical' },
  'settings.manifests.review.super_admin': { module: 'Settings', group: 'Manifest Review', label: 'Super Admin Review', description: 'Sign off a manifest as Super Admin.', risk: 'critical' },
  'settings.manifests.review.compliance': { module: 'Settings', group: 'Manifest Review', label: 'Compliance Review', description: 'Sign off a manifest as Compliance.', risk: 'critical' },
  'settings.manifests.review.hse': { module: 'Settings', group: 'Manifest Review', label: 'HSE Review', description: 'Sign off a manifest as HSE.', risk: 'critical' },
  'settings.manifests.review.security': { module: 'Settings', group: 'Manifest Review', label: 'Security Review', description: 'Sign off a manifest as Security.', risk: 'critical' },
  'communications.participants.remove_required': { module: 'Settings', group: 'Required Delivery', label: 'Remove Required Participant', description: 'Remove a module-locked required thread participant.', risk: 'critical' },
  'notifications.required_delivery.manage': { module: 'Settings', group: 'Required Delivery', label: 'Manage Required Delivery', description: 'Override required notification delivery.', risk: 'critical' },
  // ── Central Workflow Engine (Spec §22) ───────────────────────────────────────
  'workflow.dashboard.view': { module: 'Workflow', group: 'Views', label: 'View Workflow Dashboard', description: 'View the workflow dashboard.', risk: 'low' },
  'workflow.my_tasks.view': { module: 'Workflow', group: 'Views', label: 'View My Tasks', description: 'View workflow tasks assigned to you.', risk: 'low' },
  'workflow.register.view': { module: 'Workflow', group: 'Views', label: 'View Workflow Register', description: 'View all workflow instances.', risk: 'low' },
  'workflow.tasks.approve': { module: 'Workflow', group: 'Tasks', label: 'Approve Task', description: 'Approve an assigned workflow task.', risk: 'medium' },
  'workflow.tasks.return': { module: 'Workflow', group: 'Tasks', label: 'Return Task', description: 'Return an assigned workflow task for changes.', risk: 'medium' },
  'workflow.tasks.reject': { module: 'Workflow', group: 'Tasks', label: 'Reject Task', description: 'Reject an assigned workflow task.', risk: 'medium' },
  'workflow.tasks.delegate': { module: 'Workflow', group: 'Tasks', label: 'Delegate Task', description: 'Delegate an assigned workflow task.', risk: 'high' },
  'workflow.instances.view': { module: 'Workflow', group: 'Instances', label: 'View Instances', description: 'View workflow instances.', risk: 'low' },
  'workflow.instances.reassign': { module: 'Workflow', group: 'Instances', label: 'Reassign Task', description: 'Reassign a workflow task to another user.', risk: 'high' },
  'workflow.instances.escalate': { module: 'Workflow', group: 'Instances', label: 'Escalate Instance', description: 'Escalate a workflow instance.', risk: 'high' },
  'workflow.instances.cancel': { module: 'Workflow', group: 'Instances', label: 'Cancel Instance', description: 'Cancel a running workflow.', risk: 'high' },
  'workflow.instances.admin_override': { module: 'Workflow', group: 'Instances', label: 'Admin Override', description: 'Override workflow routing / force actions (superadmin).', risk: 'critical' },
  'workflow.instances.migrate': { module: 'Workflow', group: 'Instances', label: 'Migrate Instance', description: 'Migrate an in-progress workflow to a new template version.', risk: 'critical' },
  'workflow.templates.view': { module: 'Workflow', group: 'Templates', label: 'View Templates', description: 'View workflow templates.', risk: 'low' },
  'workflow.templates.create': { module: 'Workflow', group: 'Templates', label: 'Create Template', description: 'Create a workflow template.', risk: 'high' },
  'workflow.templates.update': { module: 'Workflow', group: 'Templates', label: 'Update Template', description: 'Edit a workflow template (creates a draft version).', risk: 'high' },
  'workflow.templates.publish': { module: 'Workflow', group: 'Templates', label: 'Publish Template', description: 'Publish a workflow template version.', risk: 'critical' },
  'workflow.templates.clone': { module: 'Workflow', group: 'Templates', label: 'Clone Template', description: 'Clone a workflow template.', risk: 'high' },
  'workflow.templates.deprecate': { module: 'Workflow', group: 'Templates', label: 'Deprecate Template', description: 'Deprecate a workflow template.', risk: 'critical' },
  'workflow.bindings.view': { module: 'Workflow', group: 'Bindings', label: 'View Bindings', description: 'View module workflow bindings.', risk: 'low' },
  'workflow.bindings.create': { module: 'Workflow', group: 'Bindings', label: 'Create Binding', description: 'Bind a workflow template to a module event.', risk: 'high' },
  'workflow.bindings.update': { module: 'Workflow', group: 'Bindings', label: 'Update Binding', description: 'Edit a module workflow binding.', risk: 'high' },
  'workflow.bindings.activate': { module: 'Workflow', group: 'Bindings', label: 'Activate Binding', description: 'Activate a module workflow binding.', risk: 'high' },
  'workflow.bindings.deactivate': { module: 'Workflow', group: 'Bindings', label: 'Deactivate Binding', description: 'Deactivate a module workflow binding.', risk: 'high' },
  'workflow.handoffs.view': { module: 'Workflow', group: 'Handoffs', label: 'View Handoffs', description: 'View cross-module workflow handoffs.', risk: 'low' },
  'workflow.handoffs.retry': { module: 'Workflow', group: 'Handoffs', label: 'Retry Handoff', description: 'Retry a failed workflow handoff.', risk: 'high' },
  'workflow.handoffs.cancel': { module: 'Workflow', group: 'Handoffs', label: 'Cancel Handoff', description: 'Cancel a workflow handoff.', risk: 'high' },
  'workflow.audit.view': { module: 'Workflow', group: 'Audit', label: 'View Workflow Audit', description: 'View the workflow audit log.', risk: 'low' },
  'workflow.audit.export': { module: 'Workflow', group: 'Audit', label: 'Export Workflow Audit', description: 'Export the workflow audit log.', risk: 'high' },
  // ── UI / dashboard boards + installable widgets ──
  'ui.layout.manage':           { module: 'System', group: 'Dashboards', label: 'Customize Board Layout', description: 'Customize (save) a dashboard board layout for yourself.', risk: 'low' },
  'ui.layout.default.manage':   { module: 'System', group: 'Dashboards', label: 'Set Default Board Layout', description: 'Set the organisation-wide default dashboard layout.', risk: 'medium' },
  'ui.widgets.packages.view':   { module: 'System', group: 'Widgets', label: 'View Widget Packages', description: 'Read installed widget packages (needed to render boards).', risk: 'low' },
  'ui.widgets.packages.manage': { module: 'System', group: 'Widgets', label: 'Manage Widget Packages', description: 'Install or uninstall org-wide widget packages.', risk: 'medium' },

  // ── Finance Overview + Accounts Payable ──────────────────────────────────────
  'finance.overview.view': {
    module: 'Finance', group: 'Overview',
    label: 'View Finance Overview',
    description: 'View the finance command dashboard (spend, approvals, budgets, deadlines).',
    risk: 'low',
  },
  'finance.overview.export': {
    module: 'Finance', group: 'Overview',
    label: 'Export Dashboard Data',
    description: 'Export finance overview data to CSV (audited data egress).',
    risk: 'high',
  },
  'finance.overview.kpi.drill': {
    module: 'Finance', group: 'Overview',
    label: 'Drill Into KPI Cards',
    description: 'Click through KPI cards to see the underlying filtered register.',
    risk: 'low',
  },
  'finance.overview.approvals.inline': {
    module: 'Finance', group: 'Overview',
    label: 'Inline Approve/Reject',
    description: 'Approve or reject items directly in the overview approvals queue (SoD enforced).',
    risk: 'high',
  },
  'finance.ap.view': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'View Accounts Payable',
    description: 'View vendor bills, vendors, payments and the AP aging register.',
    risk: 'low',
  },
  'finance.ap.manage': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Manage Accounts Payable (legacy alias)',
    description: 'Legacy coarse alias kept for role-bundle mapping. Granular keys govern new routes.',
    risk: 'medium',
  },
  'finance.ap.approve': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Approve Bills (legacy alias)',
    description: 'Legacy coarse alias kept for role-bundle mapping. finance.ap.bills.approve governs new routes.',
    risk: 'medium',
  },
  'finance.ap.vendors.create': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Create Vendor',
    description: 'Create a new supplier/vendor in the AP vendor register.',
    risk: 'medium',
  },
  'finance.ap.vendors.update': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Edit Vendor',
    description: 'Edit an existing vendor profile including banking and payment terms.',
    risk: 'medium',
  },
  'finance.ap.bills.create': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Create Bill Draft',
    description: 'Create a new AP bill draft (multi-line, with GL/cost-centre/tax).',
    risk: 'medium',
  },
  'finance.ap.bills.edit': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Edit Draft Bill',
    description: 'Edit an AP bill while it is in draft status.',
    risk: 'medium',
  },
  'finance.ap.bills.submit': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Submit Bill for Approval',
    description: 'Submit a draft bill into the approval workflow.',
    risk: 'medium',
  },
  'finance.ap.bills.approve': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Approve/Reject Bill',
    description: 'Approve or reject submitted bills. Segregation of duties: creator cannot approve their own bill.',
    risk: 'high',
  },
  'finance.ap.bills.void': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Void Bill',
    description: 'Void an AP bill in any non-paid state. Segregation of duties enforced.',
    risk: 'high',
  },
  'finance.ap.payment.record': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Record Payment',
    description: 'Record a payment against an approved bill (full or partial).',
    risk: 'high',
  },
  'finance.ap.payment.run.manage': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Manage Payment Runs',
    description: 'Create and manage batch payment runs against approved bills.',
    risk: 'high',
  },
  'finance.ap.payment.run.process': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Process Payment Run',
    description: 'Execute/process a payment run (marks bills paid). Segregation of duties: creator cannot process.',
    risk: 'high',
  },
  'finance.ap.duplicate.resolve': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Resolve Duplicate Risk',
    description: 'Review and resolve duplicate bill risk flags (mark duplicate or ignore with reason).',
    risk: 'high',
  },
  'finance.ap.reports.export': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Export AP Reports',
    description: 'Export AP registers and reports to CSV (audited data egress).',
    risk: 'high',
  },
  'finance.ap.bills.import': {
    module: 'Finance', group: 'Accounts Payable',
    label: 'Import Bills',
    description: 'Bulk import AP bills from a CSV or XLSX file.',
    risk: 'high',
  },

  // ── Finance statutory configuration ──────────────────────────────────────────
  'finance.statutory.view': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'View Statutory Versions',
    description: 'View statutory rate versions (NIS classes, PAYE bands, Health Surcharge thresholds) and their approval history.',
    risk: 'low',
  },
  'finance.statutory.manage': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'Manage Statutory Config',
    description: 'Create and edit draft statutory versions. Changes require approval before activation (creator ≠ approver enforced).',
    risk: 'high',
  },
  'finance.statutory.approve': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'Approve Statutory Config',
    description: 'Approve submitted statutory versions and activate them. Segregation of duties: creator cannot approve their own submission.',
    risk: 'high',
  },
  'finance.statutory.reports.view': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'View Statutory Reports',
    description: 'View statutory rate history, version audit reports, and approval audit trails.',
    risk: 'low',
  },
  'finance.statutory.reports.export': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'Export Statutory Reports',
    description: 'Export statutory configuration reports and approval audit data (audited data egress).',
    risk: 'medium',
  },
  'finance.statutory.nis_class.delete': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'Delete NIS Class',
    description: 'Delete a single NIS earnings-class band from a draft statutory version. Finance Manager or Admin.',
    risk: 'medium',
  },
  'finance.statutory.nis_class.import': {
    module: 'Finance', group: 'Statutory Configuration',
    label: 'Import NIS Classes',
    description: 'CSV-import a table of NIS earnings-class bands into a draft statutory version. Finance Manager or Admin.',
    risk: 'medium',
  },

  // ── Finance pay-component catalogue ──────────────────────────────────────────
  'finance.payroll.components.view': {
    module: 'Finance', group: 'Pay Components',
    label: 'View Pay Components',
    description: 'View the Finance-owned pay-component catalogue (earnings, deductions, statutory components).',
    risk: 'low',
  },
  'finance.payroll.components.manage': {
    module: 'Finance', group: 'Pay Components',
    label: 'Manage Pay Components',
    description: 'Submit create, update and retire change requests for pay components. Changes are deferred until approved by a different Finance Manager.',
    risk: 'high',
  },
  'finance.payroll.components.approve': {
    module: 'Finance', group: 'Pay Components',
    label: 'Approve Pay Component Changes',
    description: 'Approve or reject pay-component change requests. Creator cannot approve their own request (segregation of duties).',
    risk: 'high',
  },

  // ── HR Compensation (pay items — allowances / deductions) ────────────────────
  'hr.compensation.view': {
    module: 'HR', group: 'Compensation',
    label: 'View Compensation',
    description: 'View employee compensation pay items (allowances and deductions).',
    risk: 'low',
  },
  'hr.compensation.manage': {
    module: 'HR', group: 'Compensation',
    label: 'Manage Compensation',
    description: 'Create, submit and retire compensation pay items. Only active Finance pay components may be used.',
    risk: 'medium',
  },
  'hr.compensation.approve': {
    module: 'HR', group: 'Compensation',
    label: 'Approve Compensation',
    description: 'Approve submitted compensation pay items before they become active. Creator cannot approve their own submission (SoD).',
    risk: 'high',
  },
  'hr.compensation.reports.view': {
    module: 'HR', group: 'Compensation',
    label: 'View Compensation Reports',
    description: 'View compensation history, pay item register, and change audit reports.',
    risk: 'low',
  },
  'hr.compensation.reports.export': {
    module: 'HR', group: 'Compensation',
    label: 'Export Compensation Reports',
    description: 'Export compensation reports (audited data egress).',
    risk: 'medium',
  },

  // ── HR Contract Management ────────────────────────────────────────────────────
  'hr.contracts.view': {
    module: 'HR', group: 'Contracts',
    label: 'View Contracts',
    description: 'View employment contracts, contract templates and the contract dashboard.',
    risk: 'low',
  },
  'hr.contracts.manage': {
    module: 'HR', group: 'Contracts',
    label: 'Manage Contracts',
    description: 'Create, issue, record signatures, activate, renew and cancel employment contracts.',
    risk: 'medium',
  },
  'hr.contracts.terminate': {
    module: 'HR', group: 'Contracts',
    label: 'Terminate Contracts',
    description: 'Terminate an active employment contract (sensitive employment action).',
    risk: 'high',
  },
  'hr.contracts.template.manage': {
    module: 'HR', group: 'Contracts',
    label: 'Manage Contract Templates',
    description: 'Create, update and retire the contract templates used to issue employment contracts.',
    risk: 'medium',
  },

  // ── HR Overtime ───────────────────────────────────────────────────────────────
  'hr.overtime.view': {
    module: 'HR', group: 'Overtime',
    label: 'View Overtime',
    description: 'View overtime entries within the user\'s scope (own or team).',
    risk: 'low',
  },
  'hr.overtime.submit': {
    module: 'HR', group: 'Overtime',
    label: 'Submit Overtime',
    description: 'Submit own overtime entries for manager approval.',
    risk: 'low',
  },
  'hr.overtime.approve': {
    module: 'HR', group: 'Overtime',
    label: 'Approve Overtime',
    description: 'Approve or reject overtime entries submitted by employees.',
    risk: 'medium',
  },
  'hr.overtime.manage': {
    module: 'HR', group: 'Overtime',
    label: 'Manage Overtime',
    description: 'HR admin: view and manage all overtime entries across the organisation.',
    risk: 'medium',
  },
  'hr.overtime.reports.view': {
    module: 'HR', group: 'Overtime',
    label: 'View Overtime Reports',
    description: 'View overtime register and summary reports.',
    risk: 'low',
  },
  'hr.overtime.reports.export': {
    module: 'HR', group: 'Overtime',
    label: 'Export Overtime Reports',
    description: 'Export overtime reports (audited data egress).',
    risk: 'medium',
  },

  // ── HR Employee Statutory Profile (NIS capture) ───────────────────────────────
  'hr.employee.statutory.view': {
    module: 'HR', group: 'Statutory Profile',
    label: 'View Statutory Profile',
    description: 'View the NIS / statutory profile section for an employee (NIS number, previous employer history, opening YTD balances).',
    risk: 'high',
  },
  'hr.employee.statutory.capture': {
    module: 'HR', group: 'Statutory Profile',
    label: 'Capture Statutory Profile',
    description: 'Create or update NIS continuity data for an employee. HR can capture data but cannot mark a profile as verified (Finance only).',
    risk: 'high',
  },

  // ── Finance NIS Profile Verification ─────────────────────────────────────────
  'finance.payroll.nis.view': {
    module: 'Finance', group: 'NIS Verification',
    label: 'View NIS Profiles',
    description: 'View employee NIS statutory profiles submitted by HR for Finance review, including pending and verified profiles.',
    risk: 'low',
  },
  'finance.payroll.nis.verify': {
    module: 'Finance', group: 'NIS Verification',
    label: 'Verify NIS Profile',
    description: 'Set a NIS statutory profile status to verified after Finance review. Only Finance Manager may verify; HR cannot set this status.',
    risk: 'high',
  },
  'finance.payroll.nis.manage': {
    module: 'Finance', group: 'NIS Verification',
    label: 'Manage NIS Profiles',
    description: 'Reject NIS profiles that cannot be verified and manage the Finance side of the NIS continuity workflow.',
    risk: 'high',
  },
  // ── Finance Payroll Runs (Phase 3 Stage 2) ────────────────────────────────────
  'finance.payroll.view_own': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'View Own Payroll Line',
    description: 'View the employee\'s own calculated payroll line (self-scope enforced server-side). Does not grant access to payslips or other employees\' data.',
    risk: 'low',
  },
  'finance.payroll.view_all': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'View All Payroll Data',
    description: 'View all payroll runs, run inputs, run lines, and warnings. Required for Finance staff to prepare and review payroll.',
    risk: 'high',
  },
  'finance.payroll.run.manage': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Payroll Runs',
    description: 'Create payroll runs, lock inputs, and trigger the calculation step. Stage-3 actions (approve, lock, export) require additional keys added in stage 3.',
    risk: 'high',
  },
  'finance.payroll.run_views.manage_team': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Team Saved Views',
    description: 'Create, update, and delete team-scope saved filter views in the payroll runs register. Personal views are managed by their owners without this key.',
    risk: 'low',
  },
  'finance.payroll.reports.view': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'View Payroll Reports',
    description: 'View payroll registers, NIS remittance summaries, PAYE summaries, and other Finance payroll reports.',
    risk: 'medium',
  },
  'finance.payroll.reports.export': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Export Payroll Reports',
    description: 'Export payroll reports in CSV or PDF format. Audited data egress — Finance Manager or Admin only.',
    risk: 'high',
  },
  'finance.payroll.reports.maintain': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Maintain Report Pipeline',
    description: 'Drive report generation/purge workers and retention cleanup. System operators only — never a regular exporter.',
    risk: 'high',
  },
  // ── Finance Payroll Runs (Phase 3 Stage 3 — approve / lock / export) ─────────
  'finance.payroll.approve': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Approve Payroll Run',
    description: 'Approve a submitted payroll run via the approval workflow. Segregation of duties: the Finance staff who created the run cannot be the approver.',
    risk: 'high',
  },
  'finance.payroll.lock': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Lock Payroll Run',
    description: 'Lock an approved payroll run so that lines become immutable and payslips can be generated. Also grants the reopen action (locked → draft with reason, not available for exported runs).',
    risk: 'high',
  },
  'finance.payroll.export': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Export Payroll Run',
    description: 'Export a locked payroll run as a CSV/JSON artifact. Re-export creates a new versioned artifact; prior artifacts are marked not-current. Does not disburse funds. Finance Manager or Admin only.',
    risk: 'high',
  },
  'finance.payroll.certify': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Certify Payroll Evidence',
    description: 'Certify the immutable calculation, population, statutory, variance, payment, and GL evidence before submission.',
    risk: 'high',
  },
  'finance.payroll.funding.approve': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Confirm Payroll Funding',
    description: 'Record immutable funding confirmation for an approved payroll run. The confirmer must also perform release under the configured segregation-of-duty rules.',
    risk: 'high',
  },
  'finance.payroll.release': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Release Payroll',
    description: 'Release a locked and funded payroll, create the immutable release certificate, and create governed downstream disbursement and remittance drafts.',
    risk: 'high',
  },
  'finance.payroll.finding.assign': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Assign Payroll Findings',
    description: 'Assign an open payroll control finding to an active user for investigation and resolution.',
    risk: 'medium',
  },
  'finance.payroll.finding.resolve': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Resolve Payroll Findings',
    description: 'Resolve an eligible payroll control finding with required evidence and an audited reason.',
    risk: 'high',
  },
  'finance.payroll.finding.waive': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Waive Payroll Warnings',
    description: 'Waive an eligible payroll warning with an audited reason and optional expiry. Blockers cannot be waived.',
    risk: 'high',
  },
  'finance.payroll.finding.reopen': {
    module: 'Finance', group: 'Payroll Controls',
    label: 'Reopen Payroll Findings',
    description: 'Reopen a resolved or waived payroll control finding when its evidence is no longer sufficient.',
    risk: 'high',
  },
  'finance.payroll.payslips.generate': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Generate Payslips',
    description: 'Generate and render payslip PDFs for a locked payroll run and upload them to secure storage for employee self-service. Does not alter run figures.',
    risk: 'medium',
  },
  'finance.payroll.payslips.distribute': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Distribute Payslips',
    description: 'Email rendered payslips (password-protected PDF attachments) to employees and track delivery status. Sends personal data externally — Finance Manager or Admin.',
    risk: 'high',
  },
  'finance.payroll.gl.preview': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Preview Payroll GL',
    description: 'Preview the double-entry general-ledger journal that a locked payroll run would post (accounts, debits, credits, balance). Read-only.',
    risk: 'low',
  },
  'finance.payroll.gl.post': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Post Payroll GL',
    description: 'Post a locked payroll run\'s balanced journal to the general ledger, and reverse it (mirror journal) when needed. Writes to the ledger — Finance Manager or Admin.',
    risk: 'high',
  },
  'finance.payroll.paygroups.manage': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Pay Groups',
    description: 'Create pay groups (weekly / fortnightly / semi-monthly / monthly) and assign employees to them. Pay groups drive a run\'s frequency and which employees it pays.',
    risk: 'medium',
  },
  'finance.payroll.policies.view': {
    module: 'Finance', group: 'Payroll Setup', label: 'View Pay Policies',
    description: 'View governed local T&T pay policies, versions, validation evidence and pay-group usage.',
    risk: 'medium',
  },
  'finance.payroll.policies.draft': {
    module: 'Finance', group: 'Payroll Setup', label: 'Draft Pay Policies',
    description: 'Create and edit effective-dated local T&T pay-policy drafts.',
    risk: 'high',
  },
  'finance.payroll.policies.submit': {
    module: 'Finance', group: 'Payroll Setup', label: 'Submit Pay Policies',
    description: 'Certify and submit complete pay-policy versions into the central approval workflow.',
    risk: 'high',
  },
  'finance.payroll.policies.source_approve': {
    module: 'Finance', group: 'Payroll Setup', label: 'Review Pay-Policy Sources',
    description: 'Review HR-owned compensation, time and leave source controls for a pay policy.',
    risk: 'high',
  },
  'finance.payroll.policies.statutory_approve': {
    module: 'Finance', group: 'Payroll Setup', label: 'Review Pay-Policy Statutory Controls',
    description: 'Review local PAYE, NIS and Health Surcharge binding controls for a pay policy.',
    risk: 'high',
  },
  'finance.payroll.policies.activate': {
    module: 'Finance', group: 'Payroll Setup', label: 'Activate Pay Policies',
    description: 'Independently activate or retire an approved effective-dated pay policy.',
    risk: 'critical',
  },
  'finance.payroll.policies.assign': {
    module: 'Finance', group: 'Payroll Setup', label: 'Assign Pay Policies',
    description: 'Assign active pay-policy versions to pay groups with effective-date overlap controls.',
    risk: 'high',
  },
  'finance.payroll.worksheet.override': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Override Payroll Worksheet',
    description: 'Add or remove per-employee earning/deduction adjustments on a locked-input or calculated run (with a mandatory reason). The original snapshot is preserved; the run is recalculated. Subject to approval.',
    risk: 'high',
  },
  'finance.payroll.overtime.rules.manage': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Overtime Rules',
    description: 'Create and activate/deactivate effective-dated overtime rules (multipliers + minimum billable hours) for public holidays, rest days, callouts, etc. Rules price the OT that flows into payroll runs.',
    risk: 'medium',
  },
  'finance.payroll.loans.manage': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Employee Loans',
    description: 'Create, submit for approval, settle and cancel employee loans & salary advances. Approved loans auto-deduct a fixed installment from each pay run until the balance clears. Financial — routed through maker-checker approval.',
    risk: 'high',
  },
  'finance.payroll.statutory_forms.generate': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Generate Statutory Forms',
    description: 'Generate year-end and period statutory forms (BIR TD4 + TD4 Summary, NIBTT NI184/NI187) from locked payroll runs, and set the employer statutory profile (BIR file # / NIS employer #) that appears on them. Statutory output — figures derive from locked runs, never edited by hand.',
    risk: 'high',
  },
  'finance.payroll.statutory_forms.view': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'View Statutory Forms',
    description: 'View and download generated statutory forms (TD4/TD4 Summary/NI184/NI187) and read the employer statutory profile.',
    risk: 'low',
  },
  'finance.payroll.templates.view': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'View Payslip Templates',
    description: 'List and open saved payslip layout templates authored in Payslip Studio (presentation only — no payroll figures).',
    risk: 'low',
  },
  'finance.payroll.templates.manage': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Manage Payslip Templates',
    description: 'Create, edit, set-as-default and archive payslip layout templates in Payslip Studio. Controls payslip presentation (employer block, logo, sections, footer) — never the underlying pay figures.',
    risk: 'medium',
  },
  'finance.payroll.templates.approve': {
    module: 'Finance', group: 'Payroll Runs',
    label: 'Approve Payslip Templates',
    description: 'Approve or request changes on submitted Payslip Studio layout templates. Required to complete the maker-checker workflow before a template can be set as default or assigned to a payroll run. Segregation of duties: approver cannot be the template creator.',
    risk: 'high',
  },

  // ── Finance Expenses (F4) ────────────────────────────────────────────────────
  'finance.expenses.view': {
    module: 'Finance', group: 'Expense Claims',
    label: 'View Expense Claims',
    description: 'View the expense claim register and claim details.',
    risk: 'low',
  },
  'finance.expenses.submit': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Submit Expense Claim',
    description: 'Create and submit own expense claims (employees and finance staff).',
    risk: 'low',
  },
  'finance.expenses.manage': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Manage Expense Claims',
    description: 'Cancel claims, upload receipts, and manage expense records (finance staff+).',
    risk: 'medium',
  },
  'finance.expenses.approve': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Approve Expense Claims',
    description: 'Approve, reject, or mark reimbursed. Segregation of duties: claimant cannot approve their own claim.',
    risk: 'high',
  },
  'finance.expenses.reports.view': {
    module: 'Finance', group: 'Expense Claims',
    label: 'View Expense Reports',
    description: 'View expense claim reports and analytics.',
    risk: 'low',
  },
  'finance.expenses.reports.export': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Export Expense Reports',
    description: 'Export expense claim reports (audited data egress). Finance Manager or Admin only.',
    risk: 'medium',
  },
  'finance.expenses.receipt.upload': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Upload Expense Receipts',
    description: 'Upload and attach receipt files to expense claim lines (Wave 2B).',
    risk: 'low',
  },
  'finance.expenses.handoff.create_reimbursement': {
    module: 'Finance', group: 'Expense Claims',
    label: 'Create Reimbursement Handoff',
    description: 'Trigger the cross-module payroll reimbursement handoff for an approved expense claim. Finance Manager only (SoD-adjacent, medium risk).',
    risk: 'medium',
  },

  // ── Finance Budgets (F5) ─────────────────────────────────────────────────────
  'finance.budgets.view': {
    module: 'Finance', group: 'Budgets',
    label: 'View Budgets',
    description: 'View budget lines, actuals, and variance for accessible cost centres.',
    risk: 'low',
  },
  'finance.budgets.manage': {
    module: 'Finance', group: 'Budgets',
    label: 'Manage Budgets',
    description: 'Create, update, and delete budget lines. Finance staff and manager.',
    risk: 'medium',
  },
  'finance.budgets.reports.view': {
    module: 'Finance', group: 'Budgets',
    label: 'View Budget Reports',
    description: 'View budget variance and summary reports.',
    risk: 'low',
  },
  'finance.budgets.reports.export': {
    module: 'Finance', group: 'Budgets',
    label: 'Export Budget Reports',
    description: 'Export budget reports as CSV/PDF (audited data egress). Finance Manager or Admin only.',
    risk: 'medium',
  },
  'finance.budgets.bulk_upsert': {
    module: 'Finance', group: 'Budgets',
    label: 'Bulk Budget Entry',
    description: 'Create or update many budget lines in one submit (bulk entry). Finance Manager or Admin.',
    risk: 'medium',
  },
  'finance.budgets.copy_last_year': {
    module: 'Finance', group: 'Budgets',
    label: 'Copy Last-Year Budget',
    description: 'Copy prior-year budget lines into a new fiscal year with optional adjustment. Finance Manager or Admin.',
    risk: 'medium',
  },
  'finance.budgets.attachments.upload': {
    module: 'Finance', group: 'Budgets',
    label: 'Upload Budget Documents',
    description: 'Upload supporting documents to a budget line (Wave 2B).',
    risk: 'low',
  },
  'finance.budgets.attachments.delete': {
    module: 'Finance', group: 'Budgets',
    label: 'Delete Budget Documents',
    description: 'Remove supporting documents from a budget line (Wave 2B).',
    risk: 'low',
  },

  // Statutory Remittances & Filing
  'finance.remittances.view': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'View Remittances',
    description: 'View statutory remittances (PAYE/BIR, NIS/NIBTT, Health Surcharge) and derived line details.',
    risk: 'low',
  },
  'finance.remittances.manage': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'Manage Remittances',
    description: 'Compute remittances from payroll runs, create drafts, submit for approval, and cancel.',
    risk: 'medium',
  },
  'finance.remittances.approve': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'Approve Remittances',
    description: 'Approve submitted remittances (SoD: approver must differ from creator), mark as paid, and mark as filed.',
    risk: 'high',
  },
  'finance.remittances.reports.view': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'View Remittance Reports',
    description: 'View historical remittance filing reports across authorities and periods.',
    risk: 'low',
  },
  'finance.remittances.reports.export': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'Export Remittance Reports',
    description: 'Export remittance filing reports as CSV/PDF. Finance Manager or Admin only.',
    risk: 'medium',
  },
  'finance.remittances.receipt.upload': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'Upload Remittance Receipts',
    description: 'Upload filing receipts and supporting documents to a remittance (Wave 2B).',
    risk: 'low',
  },
  'finance.remittances.mark_filed': {
    module: 'Finance', group: 'Statutory Remittances',
    label: 'Mark Remittance Filed',
    description: 'Record a remittance as filed with the authority (filed date + receipt reference). Finance Manager or Admin.',
    risk: 'medium',
  },

  // -- Finance Bank Accounts & Disbursements (F2) --------------------------------
  'finance.bank_accounts.view': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'View Bank Accounts',
    description: 'View employee bank accounts (masked account number only).',
    risk: 'low',
  },
  'finance.bank_accounts.manage': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'Manage Bank Accounts',
    description: 'Add, edit, or deactivate own (employee) or any (finance+) bank account.',
    risk: 'medium',
  },
  'finance.disbursement.view': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'View Disbursements',
    description: 'View the payroll bank disbursement register and line details.',
    risk: 'low',
  },
  'finance.disbursement.manage': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'Manage Disbursements',
    description: 'Create disbursements from approved payroll runs and submit for approval.',
    risk: 'medium',
  },
  'finance.disbursement.approve': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'Approve Disbursements',
    description: 'Approve submitted disbursements, generate EFT bank file, and mark as paid. SoD: creator cannot approve.',
    risk: 'high',
  },
  'finance.disbursement.bank_file.download': {
    module: 'Finance', group: 'Bank Disbursements',
    label: 'Download Bank File',
    description: 'Download the generated EFT/CSV bank disbursement file (sensitive payment artifact). Finance Manager or Admin.',
    risk: 'high',
  },

  // ── Calendar & Tasks (platform) ──────────────────────────────────────────────
  'calendar.view': {
    module: 'Calendar', group: 'Calendar & Tasks',
    label: 'View Calendar',
    description: 'See the calendar and the dated items in scope (own, and — where permitted — team/org). Scope is enforced server-side.',
    risk: 'low',
  },
  'calendar.manage': {
    module: 'Calendar', group: 'Calendar & Tasks',
    label: 'Manage Team/Org Items',
    description: 'Create, edit, and cancel calendar tasks and activities beyond one’s own — for the team or organisation, per server-side scope.',
    risk: 'high',
  },
  'calendar.task.manage_own': {
    module: 'Calendar', group: 'Calendar & Tasks',
    label: 'Manage Own Tasks',
    description: 'Create, update, complete, and cancel one’s own calendar tasks.',
    risk: 'medium',
  },
  'calendar.task.assign': {
    module: 'Calendar', group: 'Calendar & Tasks',
    label: 'Assign Tasks',
    description: 'Assign a task to a permitted team member. The assignee is validated server-side against the reporting hierarchy.',
    risk: 'medium',
  },
  'calendar.activity.manage_own': {
    module: 'Calendar', group: 'Calendar & Tasks',
    label: 'Manage Own Activities',
    description: 'Create and update one’s own calendar activities (meetings, site visits, training) and their attendees.',
    risk: 'medium',
  },
};
