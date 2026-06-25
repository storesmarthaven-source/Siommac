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
  'hr.employees.import':                 { module: 'HR', group: 'Employee Master', label: 'Import Employees',        description: 'Access the bulk employee import wizard.', risk: 'medium' },
  'hr.employees.import.upload':          { module: 'HR', group: 'Employee Master', label: 'Import: Upload',          description: 'Upload an import file and stage rows.', risk: 'medium' },
  'hr.employees.import.map':             { module: 'HR', group: 'Employee Master', label: 'Import: Map & Policy',     description: 'Map columns and set import policy.', risk: 'medium' },
  'hr.employees.import.validate':        { module: 'HR', group: 'Employee Master', label: 'Import: Validate',        description: 'Validate staged rows and resolve exceptions.', risk: 'medium' },
  'hr.employees.import.commit':          { module: 'HR', group: 'Employee Master', label: 'Import: Commit',          description: 'Commit an import batch (create/update employees).', risk: 'high' },
  'hr.employees.import.report.download': { module: 'HR', group: 'Employee Master', label: 'Import: Download Report',  description: 'Download the import result/error report.', risk: 'low' },
  'hr.organization.view':           { module: 'HR', group: 'Organization',   label: 'View Organization',        description: 'View the organization structure and departments tree.', risk: 'low' },
  'hr.organization.manage':         { module: 'HR', group: 'Organization',   label: 'Manage Organization',      description: 'Create or edit org units and reporting lines.', risk: 'high' },
  'hr.positions.view':              { module: 'HR', group: 'Organization',   label: 'View Positions',           description: 'View job positions.', risk: 'low' },
  'hr.positions.manage':            { module: 'HR', group: 'Organization',   label: 'Manage Positions',         description: 'Create or edit job positions.', risk: 'high' },
  'hr.employee_documents.view':           { module: 'HR', group: 'Documents', label: 'View HR Documents',        description: 'View HR employee documents.', risk: 'medium' },
  'hr.employee_documents.upload':         { module: 'HR', group: 'Documents', label: 'Upload HR Document',       description: 'Upload an HR employee document.', risk: 'medium' },
  'hr.employee_documents.verify':         { module: 'HR', group: 'Documents', label: 'Verify/Reject HR Document', description: 'Verify or reject an HR employee document.', risk: 'high' },
  'hr.employee_documents.archive':        { module: 'HR', group: 'Documents', label: 'Archive HR Document',      description: 'Archive an HR employee document.', risk: 'medium' },
  'hr.employee_documents.download':       { module: 'HR', group: 'Documents', label: 'Download HR Document',     description: 'Download an HR employee document (audited).', risk: 'high' },
  'hr.employee_documents.sensitive_view': { module: 'HR', group: 'Documents', label: 'View Restricted HR Docs',  description: 'View restricted / medical / legal HR documents.', risk: 'high' },

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
};
