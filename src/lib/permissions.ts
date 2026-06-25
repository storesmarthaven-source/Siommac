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
  'hr.employees.status_change',
  'hr.employees.transfer',
  'hr.employees.role_change',
  'hr.employees.supervisor_change',
  'hr.employees.sensitive_view',
  'hr.employees.statutory.view',
  'hr.employees.statutory.update',
  'hr.employees.payroll_readiness.view',
  'hr.employees.restricted_contact.update',
  'hr.organization.view',
  'hr.organization.manage',
  'hr.positions.view',
  'hr.positions.manage',
  'hr.employee_documents.view',
  'hr.employee_documents.upload',
  'hr.employee_documents.verify',
  'hr.employee_documents.archive',
  'hr.employee_documents.download',
  'hr.employee_documents.sensitive_view',
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
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {

  employee: new Set<PermissionKey>([
    // Workflow — my tasks + decide when assigned (Spec §22)
    'workflow.my_tasks.view', 'workflow.tasks.approve', 'workflow.tasks.return', 'workflow.tasks.reject',
    // Settings — own personal preferences only (Spec §4)
    'settings.own_preferences.view', 'settings.own_preferences.manage',
    'attendance.view_own',
    'leaves.view_own',
    'leaves.submit',
    'payroll.view_own',
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
  ]),

  manager: new Set<PermissionKey>([
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
  ]),

  admin: new Set<PermissionKey>([
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
    'hr.employees.view', 'hr.employees.create', 'hr.employees.statutory.view', 'hr.employees.statutory.update',
    'hr.employees.payroll_readiness.view', 'hr.employees.restricted_contact.update',
    'hr.employees.status_change', 'hr.employees.transfer', 'hr.employees.role_change',
    'hr.employees.supervisor_change', 'hr.employees.sensitive_view',
    'hr.organization.view', 'hr.organization.manage', 'hr.positions.view', 'hr.positions.manage',
    'hr.employee_documents.view', 'hr.employee_documents.upload', 'hr.employee_documents.verify',
    'hr.employee_documents.archive', 'hr.employee_documents.download', 'hr.employee_documents.sensitive_view',
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
    'hr.employees.view', 'hr.employees.create', 'hr.employees.statutory.view', 'hr.employees.statutory.update',
    'hr.employees.payroll_readiness.view', 'hr.employees.restricted_contact.update',
    'hr.employees.status_change', 'hr.employees.transfer', 'hr.employees.role_change',
    'hr.employees.supervisor_change', 'hr.employees.sensitive_view',
    'hr.organization.view', 'hr.organization.manage', 'hr.positions.view', 'hr.positions.manage',
    'hr.employee_documents.view', 'hr.employee_documents.upload', 'hr.employee_documents.verify',
    'hr.employee_documents.archive', 'hr.employee_documents.download', 'hr.employee_documents.sensitive_view',
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
