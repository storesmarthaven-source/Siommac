// Finance Payroll — settings manifest (Phase 3 Stage 2)
// Policy settings per Spec §13.

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy } from '../catalogHelpers';

const M = 'finance_payroll';
const MANAGE = 'settings.global.manage'; // Finance payroll settings are org-level (admin/finance_manager)

export const financePayrollManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Finance Payroll',
  hasSettings: true,
  moduleCategory: 'finance',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general',    applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'automation', applies: false, reasonNotApplicable: 'Payroll calculation is triggered manually by Finance staff; no automated scheduling applies.' },
    { sectionKey: 'audit_retention', applies: true },
  ],
  settings: [
    modulePolicy(M, 'finance_payroll.require_verified_nis_for_payroll', {
      label: 'Require Verified NIS for Payroll',
      description:
        'If enabled, employees with an unverified NIS profile will be blocked from payroll calculation (severity = blocker). ' +
        'If disabled (default), a warning is raised but calculation proceeds.',
      dataType: 'boolean',
      defaultValue: false,
      scope: ['global'],
      requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'finance_payroll.warn_missing_nis_number', {
      label: 'Warn on Missing NIS Number',
      description:
        'If enabled (default), a warning is added to the payroll run when an employee has no NIS number on record. ' +
        'Disable to suppress the warning (not recommended for compliance).',
      dataType: 'boolean',
      defaultValue: true,
      scope: ['global'],
      requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'finance_payroll.block_missing_nis_for_new_employee', {
      label: 'Block Missing NIS for New Employees',
      description:
        'If enabled, new employees (joined within 90 days) without a NIS number are blocked from payroll (severity = blocker). ' +
        'If disabled (default), the warning is raised but calculation proceeds.',
      dataType: 'boolean',
      defaultValue: false,
      scope: ['global'],
      requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'finance_payroll.require_approved_timesheet_for_hourly', {
      label: 'Require Approved Timesheet for Hourly Employees',
      description:
        'If enabled (default), hourly employees without an approved timesheet for the period are excluded from payroll. ' +
        'Disable to include hourly employees with zero hours (useful for audit/reconciliation runs).',
      dataType: 'boolean',
      defaultValue: true,
      scope: ['global'],
      requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'finance_payroll.warn_missing_timesheet_for_salary', {
      label: 'Warn on Missing Timesheet for Salaried Employees',
      description:
        'If enabled (default), a warning is added when a salaried employee has no approved timesheet for the period. ' +
        'The run proceeds — salary employees are included regardless.',
      dataType: 'boolean',
      defaultValue: true,
      scope: ['global'],
      requiresPermission: MANAGE,
    }),
  ],
};
