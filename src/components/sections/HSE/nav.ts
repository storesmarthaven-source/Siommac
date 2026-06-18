/**
 * src/components/sections/HSE/nav.ts
 *
 * PPE Manager sub-item registry — the single source of truth for the PPE areas.
 * Drives BOTH the sidebar (which children PPE Manager shows) and the in-page
 * shell (which tab renders for the active section). Adding/removing a PPE area
 * is a one-line change here.
 *
 * Section id convention: 's-hse-ppe-<tab>'. The sidebar visibility namespace is
 * 'ppe' (see src/lib/navVisibility.ts).
 */

import type { VisibilityItem } from '@lib/navVisibility';

export const PPE_VIS_NAMESPACE = 'ppe';

/** Parent nav item that the PPE sub-items collapse under. */
export const PPE_PARENT_ID = 's-hse-ppe';

export interface PpeNavItem extends VisibilityItem {
  /** Section id — also the route target. */
  id:    string;
  /** Short tab key (suffix after s-hse-ppe-). */
  tab:   string;
  label: string;
  icon:  string;           // Font Awesome class (sidebar maps via navIcons)
}

/**
 * The 14 PPE areas. `defaultVisible` controls the minimal default set shown in
 * the sidebar (the superadmin can reveal the rest via the inline customizer).
 */
export const PPE_NAV_ITEMS: PpeNavItem[] = [
  { id: 's-hse-ppe-inventory',   tab: 'inventory',   label: 'Inventory',     icon: 'fa-boxes-stacked',           defaultVisible: true  },
  { id: 's-hse-ppe-assign',      tab: 'assign',      label: 'Assign PPE',    icon: 'fa-user-plus',               defaultVisible: true  },
  { id: 's-hse-ppe-matrix',      tab: 'matrix',      label: 'Role Matrix',   icon: 'fa-table-cells',             defaultVisible: true  },
  { id: 's-hse-ppe-employees',   tab: 'employees',   label: 'Employees',     icon: 'fa-users',                   defaultVisible: false },
  { id: 's-hse-ppe-renewals',    tab: 'renewals',    label: 'Renewals',      icon: 'fa-clock-rotate-left',       defaultVisible: false },
  { id: 's-hse-ppe-returns',     tab: 'returns',     label: 'Returns',       icon: 'fa-rotate-left',             defaultVisible: false },
  { id: 's-hse-ppe-requests',    tab: 'requests',    label: 'Requests',      icon: 'fa-clipboard-list',          defaultVisible: false },
  { id: 's-hse-ppe-inspections', tab: 'inspections', label: 'Inspections',   icon: 'fa-magnifying-glass-chart',  defaultVisible: false },
  { id: 's-hse-ppe-fitTesting',  tab: 'fitTesting',  label: 'Fit Testing',   icon: 'fa-lungs',                   defaultVisible: false },
  { id: 's-hse-ppe-procurement', tab: 'procurement', label: 'Procurement',   icon: 'fa-cart-shopping',           defaultVisible: false },
  { id: 's-hse-ppe-kits',        tab: 'kits',        label: 'Site Kits',     icon: 'fa-briefcase-medical',       defaultVisible: false },
  { id: 's-hse-ppe-reports',     tab: 'reports',     label: 'Reports',       icon: 'fa-chart-simple',            defaultVisible: false },
  { id: 's-hse-ppe-settings',    tab: 'settings',    label: 'Settings',      icon: 'fa-sliders',                 defaultVisible: false },
];

/** Lookup the PPE tab key for a section id (null if not a PPE section). */
export function ppeTabForSection(sectionId: string): string | null {
  return PPE_NAV_ITEMS.find(i => i.id === sectionId)?.tab ?? null;
}
