// Cross-module deep-link into the HR Employee Master (mirrors the payroll
// `siomac_open_payroll_*` contract). A caller in another module — e.g. the payroll
// Approvals & Exceptions queue jumping to a finding's affected employee — stashes the
// employee id and navigates; EmployeeMaster consumes the one-shot hint on mount and
// opens that employee's profile drawer.

import { showSection } from '@components/nav/navCore';

export const HR_EMPLOYEE_DEEPLINK_KEY = 'siomac_open_hr_employee';

/** Open the HR Employee Master and pop the given employee's profile drawer. */
export function openHrEmployee(employeeId: string): void {
  try { sessionStorage.setItem(HR_EMPLOYEE_DEEPLINK_KEY, employeeId); } catch { /* ignore */ }
  showSection('s-hr-employees');
}
