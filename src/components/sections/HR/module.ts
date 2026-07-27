/**
 * src/components/sections/HR/module.ts
 *
 * HR feature module (ModuleDefinition). Declares the "HR" sidebar group and its
 * Employee Master sub-module, role visibility, and the single-panel mount, then
 * self-registers at import. Future sub-modules (Onboarding, Import, Contractor
 * Workers) are added as sibling navItems under the same "HR" group.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountHRSection, unmountHRSection } from './mount';

const HR_ROOT_ID = 'preact-hr-root';

const EMPLOYEE_MASTER_ITEM: ModuleNavItem = {
  id: 's-hr-employees',
  label: 'Employee Master',
  icon: 'fa-users',
  permission: 'hr.employees.view',
  sub: 'People register, profiles, statutory readiness & workflows',
};

const ONBOARDING_ITEM: ModuleNavItem = {
  id: 's-hr-onboarding',
  label: 'Onboarding',
  icon: 'fa-rocket',
  permission: 'hr.onboarding.view',
  sub: 'Activation readiness, active cases & onboarding board',
};

const ORGANIZATION_ITEM: ModuleNavItem = {
  id: 's-hr-organization',
  label: 'Organization',
  icon: 'fa-sitemap',
  permission: 'hr.organization.view',
  sub: 'Org units, positions, cost centres & reporting lines',
};

const DOCUMENTS_ITEM: ModuleNavItem = {
  id: 's-hr-documents',
  label: 'Documents',
  icon: 'fa-folder-open',
  permission: 'hr.employee_documents.view',
  sub: 'Employee documents, expiry tracking & requirements',
};

const OFFBOARDING_ITEM: ModuleNavItem = {
  id: 's-hr-offboarding',
  label: 'Offboarding',
  icon: 'fa-door-open',
  permission: 'hr.offboarding.view',
  sub: 'Employee exits — clearance, access removal & final pay',
};

const LEAVE_ITEM: ModuleNavItem = {
  id: 's-hr-leave',
  label: 'Leave & Absence',
  icon: 'fa-calendar-check',
  permission: 'hr.leave.view',
  sub: 'Leave requests, balances, accruals & calendar',
};

const TRANSFERS_ITEM: ModuleNavItem = {
  id: 's-hr-transfers',
  label: 'Transfers & Promotions',
  icon: 'fa-right-left',
  permission: 'hr.transfers.view',
  sub: 'Bundled dept / role / pay changes with approval workflow',
};

const ATTENDANCE_ITEM: ModuleNavItem = {
  id: 's-hr-attendance',
  label: 'Attendance & Timekeeping',
  icon: 'fa-clock',
  permission: 'hr.attendance.view',
  sub: 'Punch records, daily log, exceptions & timesheet approval',
};

const REQUESTS_ITEM: ModuleNavItem = {
  id: 's-hr-requests',
  label: 'HR Requests',
  icon: 'fa-inbox',
  permissionsAny: ['hr.requests.submit_own', 'hr.requests.manage'],
  sub: 'Employee self-service requests & HR triage',
};

const ROSTER_ITEM: ModuleNavItem = {
  id: 's-hr-roster',
  label: 'Shift Roster',
  icon: 'fa-calendar-days',
  permission: 'hr.roster.view',
  sub: 'Shift schedules, rotation patterns & coverage management',
};

const COMPENSATION_ITEM: ModuleNavItem = {
  id: 's-hr-compensation',
  label: 'Compensation',
  icon: 'fa-scale-balanced',
  permission: 'hr.compensation.view',
  sub: 'Recurring pay items & employee statutory (NIS) profiles',
};

const OVERTIME_ITEM: ModuleNavItem = {
  id: 's-hr-overtime',
  label: 'Overtime',
  icon: 'fa-clock',
  permissionsAny: ['hr.overtime.view', 'hr.overtime.submit'],
  sub: 'Overtime submission, approval & payroll feed',
};

// Shared Work Calendar (F-CAL) — an HR-owned, hr.work_calendar.* capability that also feeds payroll.
// Its primary home is here (reachable by HR managers); Payroll Setup carries a shortcut tab for
// finance admins. Per-item permission gate so only holders of the read permission see it.
const WORK_CALENDAR_ITEM: ModuleNavItem = {
  id: 's-hr-work-calendar',
  label: 'Work Calendar',
  icon: 'fa-calendar-days',
  sub: 'Holiday sets, work-calendar patterns & pay-group assignments (working-day evidence for payroll)',
  permission: 'hr.work_calendar.view',
};

export const hrModule: ModuleDefinition = {
  id: 'hr',
  navGroup: { id: 'hr', label: 'Human Resources' },
  navItems: [EMPLOYEE_MASTER_ITEM, ONBOARDING_ITEM, ORGANIZATION_ITEM, DOCUMENTS_ITEM, OFFBOARDING_ITEM, LEAVE_ITEM, TRANSFERS_ITEM, ATTENDANCE_ITEM, REQUESTS_ITEM, ROSTER_ITEM, COMPENSATION_ITEM, OVERTIME_ITEM, WORK_CALENDAR_ITEM],
  // HR department roles operate this module; the backend still enforces each
  // action via can()/requirePermission (see moduleRegistry AppRole note). Order
  // is presentational only (this is a membership set) — kept aligned with the
  // hrFoundation test.
  roles: ['hr_staff', 'hr_manager', 'admin', 'manager', 'superadmin'],
  mount: {
    sectionId: 's-hr',
    rootId: HR_ROOT_ID,
    mount:   (root, ctx) => mountHRSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountHRSection(root),
  },
  visibilityNamespace: 'hr',
};

registerModule(hrModule);
