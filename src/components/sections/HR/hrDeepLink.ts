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

/**
 * Open an employee's FULL Employee Master record on a given tab — the Start Onboarding
 * wizard's "Review in Employee Master" action.
 *
 * Additive alongside `openHrEmployee` (which pops the drawer and is what Finance uses);
 * changing that one would have altered payroll's behaviour for free.
 *
 * It stashes a hint AND fires an event because the two callers are in different positions:
 * the onboarding board host is OUTSIDE Employee Master, so EmployeeMaster mounts and consumes
 * the one-shot hint; the Employee Master host renders the wizard as its OWN child, so it is
 * already mounted and its mount effect would never re-run — it hears the event instead.
 * Both paths therefore land on the same record and tab.
 */
export const HR_EMPLOYEE_RECORD_KEY = 'siomac_open_hr_employee_record';
export const HR_EMPLOYEE_RECORD_EVENT = 'siomac:hr-open-employee-record';
export interface HrEmployeeRecordTarget { employeeId: string; tab: string }

export function openHrEmployeeRecord(employeeId: string, tab = 'overview'): void {
  const target: HrEmployeeRecordTarget = { employeeId, tab };
  try { sessionStorage.setItem(HR_EMPLOYEE_RECORD_KEY, JSON.stringify(target)); } catch { /* ignore */ }
  showSection('s-hr-employees');
  try { window.dispatchEvent(new CustomEvent<HrEmployeeRecordTarget>(HR_EMPLOYEE_RECORD_EVENT, { detail: target })); } catch { /* ignore */ }
}

/**
 * Open HR ▸ Onboarding ▸ Packages — the wizard's "Manage Packages" link.
 *
 * Same hint-plus-event shape as the employee record link, and for the same reason: from the
 * Employee Master host the onboarding board has to mount and consume the hint, while from the
 * board itself the surface coordinator is already mounted and only hears the event.
 */
export const HR_ONBOARDING_SURFACE_KEY = 'siomac_open_hr_onboarding_surface';
export const HR_ONBOARDING_SURFACE_EVENT = 'siomac:hr-onboarding-open-surface';

export function openOnboardingPackages(): void {
  try { sessionStorage.setItem(HR_ONBOARDING_SURFACE_KEY, 'packages'); } catch { /* ignore */ }
  showSection('s-hr-onboarding');
  try { window.dispatchEvent(new CustomEvent<string>(HR_ONBOARDING_SURFACE_EVENT, { detail: 'packages' })); } catch { /* ignore */ }
}

/** Read + clear the one-shot onboarding-surface hint. */
export function consumeOnboardingSurface(): string | null {
  try {
    const v = sessionStorage.getItem(HR_ONBOARDING_SURFACE_KEY);
    sessionStorage.removeItem(HR_ONBOARDING_SURFACE_KEY);
    return v;
  } catch { return null; }
}

/** Read + clear the one-shot full-record hint. Returns null when there is none. */
export function consumeHrEmployeeRecordTarget(): HrEmployeeRecordTarget | null {
  try {
    const raw = sessionStorage.getItem(HR_EMPLOYEE_RECORD_KEY);
    sessionStorage.removeItem(HR_EMPLOYEE_RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HrEmployeeRecordTarget>;
    return parsed.employeeId ? { employeeId: parsed.employeeId, tab: parsed.tab ?? 'overview' } : null;
  } catch { return null; }
}
