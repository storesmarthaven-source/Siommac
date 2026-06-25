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
  ],
};
