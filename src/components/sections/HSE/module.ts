/**
 * src/components/sections/HSE/module.ts
 *
 * HSE feature module — the reference implementation of the ModuleDefinition
 * contract (src/lib/moduleRegistry.ts). Declares the module's entire nav
 * contribution, role visibility, mount, and the PPE sub-item visibility
 * namespace, then self-registers at import.
 *
 * Adding a future module = copy this shape; no edits to shared config/navCore.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountHSESection, unmountHSESection } from './mount';
import { PPE_NAV_ITEMS, PPE_PARENT_ID, PPE_VIS_NAMESPACE } from './nav';

const HSE_ROOT_ID = 'preact-hse-root';

// Top-level HSE items: Dashboard + the collapsible PPE Manager parent.
const HSE_TOP_ITEMS: ModuleNavItem[] = [
  { id: 's-hse-dashboard', label: 'HSE Dashboard', icon: 'fa-gauge-high', sub: 'Incident KPIs, trends and recent events' },
  { id: PPE_PARENT_ID,     label: 'PPE Manager',   icon: 'fa-hard-hat',   sub: 'PPE inventory, assignment, compliance and renewals' },
];

// PPE sub-items nest under the PPE Manager parent and are visibility-toggleable.
const PPE_CHILD_ITEMS: ModuleNavItem[] = PPE_NAV_ITEMS.map(i => ({
  id: i.id, label: i.label, icon: i.icon, parent: PPE_PARENT_ID, defaultVisible: i.defaultVisible,
}));

export const hseModule: ModuleDefinition = {
  id: 'hse',
  navGroup: { id: 'hse', label: 'HSE' },
  navItems: [...HSE_TOP_ITEMS, ...PPE_CHILD_ITEMS],
  roles: ['admin', 'manager', 'superadmin'],
  mount: {
    sectionId: 's-hse',
    rootId: HSE_ROOT_ID,
    mount:   (root, ctx) => mountHSESection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountHSESection(root),
  },
  visibilityNamespace: PPE_VIS_NAMESPACE,
};

registerModule(hseModule);
