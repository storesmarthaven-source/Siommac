import { registerModule, type ModuleDefinition } from '@lib/moduleRegistry';
import { mountWorkerOnboarding, unmountWorkerOnboarding } from './mount';

const SECTION_ID = 's-my-onboarding';
export const workerOnboardingModule: ModuleDefinition = {
  id: 'my-onboarding',
  navGroup: { id: 'overview', label: '' },
  navItems: [{ id: SECTION_ID, label: 'My Onboarding', icon: 'fa-user-check', permission: 'hr.onboarding.self.view', sub: 'Your onboarding actions, documents and Day-One plan' }],
  roles: ['superadmin','admin','manager','employee','hr_staff','hr_manager','hse_staff','finance_staff','finance_manager'],
  mount: { sectionId: SECTION_ID, rootId: 'preact-my-onboarding-root', mount: (root, ctx) => mountWorkerOnboarding(root, ctx.queryClient as never), unmount: unmountWorkerOnboarding },
  visibilityNamespace: 'my-onboarding',
};
registerModule(workerOnboardingModule);
