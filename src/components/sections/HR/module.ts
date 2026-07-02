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
  sub: 'People register, profiles, statutory readiness & workflows',
};

const ONBOARDING_ITEM: ModuleNavItem = {
  id: 's-hr-onboarding',
  label: 'Onboarding',
  icon: 'fa-rocket',
  sub: 'Activation readiness, active cases & onboarding board',
};

const ORGANIZATION_ITEM: ModuleNavItem = {
  id: 's-hr-organization',
  label: 'Organization',
  icon: 'fa-sitemap',
  sub: 'Org units, positions, cost centres & reporting lines',
};

const DOCUMENTS_ITEM: ModuleNavItem = {
  id: 's-hr-documents',
  label: 'Documents',
  icon: 'fa-folder-open',
  sub: 'Employee documents, expiry tracking & requirements',
};

const OFFBOARDING_ITEM: ModuleNavItem = {
  id: 's-hr-offboarding',
  label: 'Offboarding',
  icon: 'fa-door-open',
  sub: 'Employee exits — clearance, access removal & final pay',
};

const LEAVE_ITEM: ModuleNavItem = {
  id: 's-hr-leave',
  label: 'Leave & Absence',
  icon: 'fa-calendar-check',
  sub: 'Leave requests, balances, accruals & calendar',
};

export const hrModule: ModuleDefinition = {
  id: 'hr',
  navGroup: { id: 'hr', label: 'HR' },
  navItems: [EMPLOYEE_MASTER_ITEM, ONBOARDING_ITEM, ORGANIZATION_ITEM, DOCUMENTS_ITEM, OFFBOARDING_ITEM, LEAVE_ITEM],
  roles: ['admin', 'manager', 'superadmin'],
  mount: {
    sectionId: 's-hr',
    rootId: HR_ROOT_ID,
    mount:   (root, ctx) => mountHRSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountHRSection(root),
  },
  visibilityNamespace: 'hr',
};

registerModule(hrModule);
