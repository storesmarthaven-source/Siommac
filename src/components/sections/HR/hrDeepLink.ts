// Cross-module deep-link into the HR Employee Master (mirrors the payroll
// `siomac_open_payroll_*` contract). A caller in another module — e.g. the payroll
// Approvals & Exceptions queue jumping to a finding's affected employee — stashes the
// employee id and navigates; EmployeeMaster consumes the one-shot hint on mount and
// opens that employee's profile drawer.

import { showSection } from '@components/nav/navCore';
import type { ProfileTabKey } from '@api/hr/employeeProfile';

export const HR_EMPLOYEE_DEEPLINK_KEY = 'siomac_open_hr_employee';
export const HR_EMPLOYEE_RECORD_DEEPLINK_KEY = 'siomac_open_hr_employee_record';
export const HR_EMPLOYEE_RECORD_TAB_DEEPLINK_KEY = 'siomac_open_hr_employee_record_tab';
export const HR_ONBOARDING_SURFACE_DEEPLINK_KEY = 'siomac_open_hr_onboarding_surface';

/** Open the HR Employee Master and pop the given employee's profile drawer. */
export function openHrEmployee(employeeId: string): void {
  try { sessionStorage.setItem(HR_EMPLOYEE_DEEPLINK_KEY, employeeId); } catch { /* ignore */ }
  showSection('s-hr-employees');
}

/** Open the full employee record at a specific canonical profile tab. */
export function openHrEmployeeRecord(employeeId: string, tab: ProfileTabKey = 'overview'): void {
  try {
    sessionStorage.setItem(HR_EMPLOYEE_RECORD_DEEPLINK_KEY, employeeId);
    sessionStorage.setItem(HR_EMPLOYEE_RECORD_TAB_DEEPLINK_KEY, tab);
  } catch { /* navigation still succeeds when session storage is unavailable */ }
  showSection('s-hr-employees');
}

/** Open the package-management surface inside the HR Onboarding section. */
export function openOnboardingPackages(): void {
  try { sessionStorage.setItem(HR_ONBOARDING_SURFACE_DEEPLINK_KEY, 'packages'); } catch { /* ignore */ }
  showSection('s-hr-onboarding');
}
