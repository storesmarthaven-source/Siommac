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
    description: 'Create and update training and competency records.',
    risk: 'medium',
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
    module: 'Workflows', group: 'Workflows',
    label: 'Submit Workflow',
    description: 'Submit items through platform-level approval workflows.',
    risk: 'medium',
  },
  'workflow.approve': {
    module: 'Workflows', group: 'Workflows',
    label: 'Approve Workflow',
    description: 'Approve or reject workflow tasks assigned to you.',
    risk: 'high',
  },
  'workflow.audit': {
    module: 'Workflows', group: 'Workflows',
    label: 'Audit Workflows',
    description: 'View the full workflow history and approval audit trail.',
    risk: 'high',
  },
  'workflow.view': {
    module: 'Workflows', group: 'Workflows',
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
    label: 'Compliance Read',
    description: 'Controlled, fully-audited read access to private message threads for approved investigations.',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'communications.compliance_export': {
    module: 'Communications', group: 'Compliance',
    label: 'Compliance Export',
    description: 'Export message history for approved compliance investigations (requires formal approval).',
    risk: 'critical',
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

  // ── Account Security ──────────────────────────────────────────────────────────
  'auth.security.view': {
    module: 'auth', group: 'Account Security',
    label: 'View User Security Status',
    description: "View another user's MFA enrollment, registered passkeys, and trusted device count.",
    risk: 'high',
  },
  'auth.security.manage_policy': {
    module: 'auth', group: 'Account Security',
    label: 'Manage Security Policy',
    description: 'Update organisation-wide account security policy (MFA requirements, trusted device TTLs, passkey rules).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'auth.passkeys.admin_revoke': {
    module: 'auth', group: 'Account Security',
    label: 'Admin Revoke Passkeys',
    description: 'Revoke all registered passkeys for another user (requires step-up authentication).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
  'auth.trusted_devices.admin_revoke': {
    module: 'auth', group: 'Account Security',
    label: 'Admin Revoke Trusted Devices',
    description: 'Revoke all trusted devices for another user, forcing re-authentication on their next login (requires step-up).',
    risk: 'critical',
    requiresSuperAdmin: true,
  },
};
