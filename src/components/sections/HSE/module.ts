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
import { PPE_NAV_ITEMS, PPE_PARENT_ID, HSE_AREAS } from './nav';

const HSE_ROOT_ID = 'preact-hse-root';

// One HSE-wide visibility namespace. Sub-item ids are globally unique
// (s-hse-<area>-<tab> / s-hse-ppe-<tab>), so a single namespace cleanly stores
// each parent's "which children show" choice without collisions, and every
// collapsible parent gets the customize gear via the generic navCore logic.
const HSE_VIS_NAMESPACE = 'hse';

const HSE_DASHBOARD_ID = 's-hse-dashboard';

// HSE Dashboard is the collapsible parent for every functional area. Clicking it
// routes to the dashboard page; its chevron expands the area list.
const DASHBOARD_ITEM: ModuleNavItem = {
  id: HSE_DASHBOARD_ID, label: 'HSE Dashboard', icon: 'fa-gauge-high', sub: 'Incident KPIs, trends and recent events',
};

// Each HSE area is a child of HSE Dashboard (one sidebar level). The area's own
// sub-tabs are rendered IN-PAGE, not in the sidebar — so areas carry no
// defaultVisible flag and therefore get no customize gear.
const AREA_ITEMS: ModuleNavItem[] = HSE_AREAS.map(area => ({
  id: area.parentId, label: area.label, icon: area.icon, parent: HSE_DASHBOARD_ID,
}));

// PPE Manager parent + its 13 sub-items (kept as-is) close out the group.
const PPE_PARENT_ITEM: ModuleNavItem = {
  id: PPE_PARENT_ID, label: 'PPE Manager', icon: 'fa-hard-hat', sub: 'PPE inventory, assignment, compliance and renewals',
};
const PPE_CHILD_ITEMS: ModuleNavItem[] = PPE_NAV_ITEMS.map(i => ({
  id: i.id, label: i.label, icon: i.icon, parent: PPE_PARENT_ID, defaultVisible: i.defaultVisible,
}));

export const hseModule: ModuleDefinition = {
  id: 'hse',
  navGroup: { id: 'hse', label: 'HSE' },
  navItems: [DASHBOARD_ITEM, ...AREA_ITEMS, PPE_PARENT_ITEM, ...PPE_CHILD_ITEMS],
  roles: ['admin', 'manager', 'superadmin'],
  mount: {
    sectionId: 's-hse',
    rootId: HSE_ROOT_ID,
    mount:   (root, ctx) => mountHSESection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountHSESection(root),
  },
  visibilityNamespace: HSE_VIS_NAMESPACE,
};

registerModule(hseModule);
