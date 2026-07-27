/**
 * src/components/sections/HR/employeeRowActions.ts
 *
 * The Employee Register row ⋮ menu, as data.
 *
 * Two gates, both required:
 *   • CAPABILITY — mirrors the permission the backend operation enforces (EmployeeMasterAccess).
 *   • EMPLOYEE STATE — an action that cannot apply to this employee is not offered. Offering
 *     "Start Offboarding" on someone already terminated (or already mid-offboarding) is a
 *     control that lies: the server would reject it, so the menu must not present it.
 *
 * Edit vs request is a fork, never both: a user who can edit the record directly gets the
 * editor; everyone else gets the change-request path.
 */

import type { LucideName } from '@ui';
import type { EmployeeMasterAccess } from './employeeMasterAccess';

/** `label` doubles as the key passed to EmployeeMaster's action → dialog map. */
export interface EmployeeRowAction {
  label: string;
  icon: LucideName;
  /** Rendered as a lifecycle action: red, and preceded by a separator. */
  danger?: boolean;
  separatorBefore?: boolean;
}

/** Employment states an employee must be IN for offboarding to make sense: they are on staff
 *  today. `draft`/`pending_onboarding` have not started; the rest have already left. */
const OFFBOARDABLE_STATUSES = new Set(['active', 'probation', 'on_leave', 'suspended']);

export interface EmployeeRowActionSubject {
  status: string;
  offboardingActive: boolean;
}

export function canStartOffboarding(employee: EmployeeRowActionSubject): boolean {
  return !employee.offboardingActive && OFFBOARDABLE_STATUSES.has(employee.status.toLowerCase());
}

export function employeeRowActions(
  employee: EmployeeRowActionSubject,
  access: EmployeeMasterAccess,
): EmployeeRowAction[] {
  const actions: EmployeeRowAction[] = [
    { label: 'View Profile', icon: 'Eye' },
  ];

  // Direct edit wins over the request path — a user who has both would otherwise be offered
  // two routes to the same change, one of which needlessly creates approval work.
  if (access.editEmployee) actions.push({ label: 'Edit Contact Details', icon: 'FilePenLine' });
  else if (access.requestChange) actions.push({ label: 'Request Change', icon: 'FilePenLine' });

  if (access.uploadDocument) actions.push({ label: 'Upload HR Document', icon: 'Upload' });
  if (access.changeStatus) actions.push({ label: 'Update Employment Status', icon: 'ShieldCheck' });

  if (access.startOffboarding && canStartOffboarding(employee)) {
    actions.push({ label: 'Start Offboarding', icon: 'UserRoundX', danger: true, separatorBefore: true });
  }

  return actions;
}
