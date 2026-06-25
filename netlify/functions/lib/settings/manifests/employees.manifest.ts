// Employee Master — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, workflowRule, systemSecurity, auditPolicy } from '../catalogHelpers';

const M = 'employees';

export const employeesManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Employee Master',
  hasSettings: true,
  moduleCategory: 'hr',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'numbering', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'automation', applies: true },
    { sectionKey: 'permissions', applies: true },
    { sectionKey: 'personal_preferences', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'employees.number_auto_generate', {
      label: 'Auto-Generate Employee Number', description: 'Automatically generate employee numbers on creation.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.number_prefix', {
      label: 'Employee Number Prefix', description: 'Prefix used for generated employee numbers.',
      dataType: 'string', defaultValue: 'EMP', scope: ['global'],
    }),
    modulePolicy(M, 'employees.require_supervisor', {
      label: 'Require Supervisor', description: 'Require a supervisor before an employee can be active.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'employees.require_department', {
      label: 'Require Department', description: 'Require a department before an employee can be active.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'employees.status_change_workflow', {
      label: 'Status Change Workflow', description: 'Require approval for sensitive status changes (maker-checker).',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    systemSecurity(M, 'employees.termination_blocks_login', {
      label: 'Termination Blocks Login', description: 'Disable login when an employee is terminated.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.require_nis_number', {
      label: 'Require NIS Number', description: 'Require a T&T NIS number before payroll-ready.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.require_bir_file_number', {
      label: 'Require BIR File Number', description: 'Require a BIR file number before payroll handoff.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.require_statutory_profile_before_payroll', {
      label: 'Statutory Profile Before Payroll', description: 'Block payroll handoff until the statutory profile is complete.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    auditPolicy(M, 'employees.audit_statutory_changes', {
      label: 'Audit Statutory Changes', description: 'Audit all NIS, BIR, TD1, and health-surcharge changes.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),

    // ── v36 §11: Statutory (extends the above) ───────────────────────────────
    modulePolicy(M, 'employees.require_td1', {
      label: 'Require TD1', description: 'Require a received TD1 before payroll-ready when PAYE applies.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),

    // ── v36 §11: Workflow & Change Control ───────────────────────────────────
    workflowRule(M, 'employees.contact_change_requires_approval', {
      label: 'Contact Change Requires Approval', description: 'Route personal/emergency contact changes through maker-checker instead of direct edit.',
      dataType: 'boolean', defaultValue: false, scope: ['global'],
    }),
    workflowRule(M, 'employees.transfer_requires_approval', {
      label: 'Transfer Requires Approval', description: 'Require approval for department/site transfers (maker-checker).',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),

    // ── v36 §11: Import Rules (consumed by the import upload defaults) ────────
    modulePolicy(M, 'employees.import_default_mode', {
      label: 'Import Default Mode', description: 'Default mode for a new import batch when not specified.',
      dataType: 'select', defaultValue: 'create', allowedValues: ['create', 'update', 'create_update'], scope: ['global'],
    }),
    modulePolicy(M, 'employees.import_default_create_logins', {
      label: 'Import Creates Logins by Default', description: 'Whether imported employees get a Supabase Auth login by default.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.import_duplicate_employee_number', {
      label: 'Import Duplicate Employee-Number Handling', description: 'Default handling when an imported row matches an existing employee number.',
      dataType: 'select', defaultValue: 'skip', allowedValues: ['skip', 'update', 'error'], scope: ['global'],
    }),

    // ── v36 §11: Onboarding ──────────────────────────────────────────────────
    modulePolicy(M, 'employees.onboarding_default_package', {
      label: 'Default Onboarding Package', description: 'Package pre-selected when starting onboarding.',
      dataType: 'select', defaultValue: 'standard_employee',
      allowedValues: ['standard_employee', 'safety_critical_employee', 'contractor_worker', 'supervisor_manager', 'office_admin'], scope: ['global'],
    }),

    // ── v36 §11: Register Layout + Profile Drawer (admin defaults, user-overridable) ──
    modulePolicy(M, 'employees.register_default_page_size', {
      label: 'Register Page Size', description: 'Default rows per page in the employee register.',
      dataType: 'number', defaultValue: 25, minValue: 10, maxValue: 200, scope: ['global'],
    }),
    modulePolicy(M, 'employees.register_show_worker_type', {
      label: 'Show Worker Type Column', description: 'Show the employee/contractor worker-type column in the register.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'employees.profile_default_tab', {
      label: 'Profile Default Tab', description: 'Tab shown first when opening an employee profile drawer.',
      dataType: 'select', defaultValue: 'overview',
      allowedValues: ['overview', 'employment', 'assignments', 'documents', 'training', 'statutory', 'leave', 'attendance', 'workflows', 'audit'],
      scope: ['global'],
    }),

    // ── v36 §11: Audit & Privacy (extends audit_statutory_changes) ───────────
    auditPolicy(M, 'employees.audit_profile_views', {
      label: 'Audit Profile Views', description: 'Record an audit entry when a sensitive employee profile is viewed.',
      dataType: 'boolean', defaultValue: false, scope: ['global'],
    }),
    modulePolicy(M, 'employees.mask_sensitive_fields_in_register', {
      label: 'Mask Sensitive Fields in Register', description: 'Mask statutory/restricted fields in the register list view.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
