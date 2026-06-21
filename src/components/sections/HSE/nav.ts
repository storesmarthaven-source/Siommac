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

// ═══════════════════════════════════════════════════════════════════════════════
// HSE area registry — the single source of truth for every HSE functional area.
// Each area is a top-level sidebar item; areas with sub-tabs collapse like PPE.
// Adding an area or a sub-tab is a one-line edit here; module.ts + HSESection.tsx
// read this registry, so neither needs touching per area.
// ═══════════════════════════════════════════════════════════════════════════════

export interface HseSubItem {
  /** Section id — also the route target. Convention: 's-hse-<area>-<tab>'. */
  id:    string;
  tab:   string;
  label: string;
  icon:  string;
  defaultVisible?: boolean;
}

export interface HseArea {
  /** Logical area key (matches the shell's area switch). */
  key:      string;
  /** Parent nav id. For single-page areas this IS the route target. */
  parentId: string;
  label:    string;
  icon:     string;
  sub:      string;             // sidebar parent subtitle
  /** localStorage visibility namespace for the area's sub-items. */
  visNamespace: string;
  /** Sub-tabs. Empty ⇒ a single-page area (the parent itself routes). */
  items:    HseSubItem[];
  /** Default sub-tab when the parent (collapsed) is opened. */
  defaultTab: string;
}

/** Helper to build a sub-item with the id convention. */
const sub = (area: string, tab: string, label: string, icon: string, defaultVisible = true): HseSubItem =>
  ({ id: `s-hse-${area}-${tab}`, tab, label, icon, defaultVisible });

export const HSE_AREAS: HseArea[] = [
  {
    key: 'incidents', parentId: 's-hse-incidents', label: 'Incidents', icon: 'fa-triangle-exclamation',
    sub: 'Report, investigate and close incidents', visNamespace: 'hse-incidents', defaultTab: 'register',
    // Report Incident is a modal action (the "+ Report" button), not a tab.
    // Analytics live in the future HSE Reports page, not in this workspace.
    items: [
      sub('incidents', 'register',       'Incident Register', 'fa-clipboard-list'),
      sub('incidents', 'investigations', 'Investigations',    'fa-magnifying-glass-chart'),
      sub('incidents', 'capa',           'CAPA / Actions',    'fa-list-check'),
    ],
  },
  {
    key: 'risk', parentId: 's-hse-risk', label: 'Risk & JSA', icon: 'fa-triangle-exclamation',
    sub: 'Hazards, risk assessments and JSAs', visNamespace: 'hse-risk', defaultTab: 'hazards',
    items: [
      sub('risk', 'hazards',     'Hazard Register',   'fa-radiation'),
      sub('risk', 'assessments', 'Risk Assessments',  'fa-table-cells-large'),
      sub('risk', 'jsa',         'JSA Library',       'fa-list-ol'),
    ],
  },
  {
    key: 'permits', parentId: 's-hse-permits', label: 'Permits (PTW)', icon: 'fa-id-badge',
    sub: 'Permit to work control gates', visNamespace: 'hse-permits', defaultTab: 'register', items: [],
  },
  {
    key: 'inspections', parentId: 's-hse-inspections', label: 'Inspections', icon: 'fa-clipboard-check',
    sub: 'Scheduled inspections and findings', visNamespace: 'hse-inspections', defaultTab: 'schedule',
    items: [
      sub('inspections', 'schedule', 'Schedule', 'fa-calendar-check'),
      sub('inspections', 'findings', 'Findings', 'fa-flag'),
    ],
  },
  {
    key: 'training', parentId: 's-hse-training', label: 'Training', icon: 'fa-graduation-cap',
    sub: 'Competency matrix and certifications', visNamespace: 'hse-training', defaultTab: 'matrix',
    items: [
      sub('training', 'matrix', 'Competency Matrix', 'fa-table-cells'),
      sub('training', 'certs',  'Certifications',    'fa-certificate'),
    ],
  },
  {
    key: 'toolbox', parentId: 's-hse-toolbox', label: 'Toolbox Talks', icon: 'fa-people-group',
    sub: 'Daily safety talks and attendance', visNamespace: 'hse-toolbox', defaultTab: 'log', items: [],
  },
  {
    key: 'documents', parentId: 's-hse-documents', label: 'Documents & SDS', icon: 'fa-folder-open',
    sub: 'HSE documents and safety data sheets', visNamespace: 'hse-documents', defaultTab: 'docs',
    items: [
      sub('documents', 'docs', 'Documents',   'fa-file-lines'),
      sub('documents', 'sds',  'SDS Library', 'fa-flask'),
    ],
  },
  {
    key: 'workflows', parentId: 's-hse-workflows', label: 'Workflows', icon: 'fa-diagram-project',
    sub: 'Approvals, register, audit trail and wizard', visNamespace: 'hse-workflows', defaultTab: 'approvals',
    items: [
      sub('workflows', 'approvals', 'Approvals',         'fa-inbox',               true),
      sub('workflows', 'register',  'Workflow Register',  'fa-list-check',          true),
      sub('workflows', 'audit',     'Audit Log',          'fa-shield-halved',       true),
      sub('workflows', 'handoffs',  'Handoffs',           'fa-handshake',           false),
      sub('workflows', 'wizard',    'New Workflow',        'fa-wand-magic-sparkles', true),
    ],
  },
  {
    key: 'contractors', parentId: 's-hse-contractors', label: 'Contractor Mgmt', icon: 'fa-id-card-clip',
    sub: 'STOW induction, HSE file, site access and expired-file gates', visNamespace: 'hse-contractors', defaultTab: 'register',
    items: [
      sub('contractors', 'register',  'Contractor Register', 'fa-clipboard-list',    true),
      sub('contractors', 'induction', 'Induction Log',       'fa-person-chalkboard', true),
      sub('contractors', 'files',     'HSE Files',           'fa-folder-open',       true),
      sub('contractors', 'access',    'Site Access',         'fa-door-open',         false),
    ],
  },
  {
    key: 'compliance', parentId: 's-hse-compliance', label: 'Legal & Compliance', icon: 'fa-scale-balanced',
    sub: 'OSH Act obligations, EMA permits, breach log, regulatory calendar', visNamespace: 'hse-compliance', defaultTab: 'obligations',
    items: [
      sub('compliance', 'obligations', 'OSH Obligations',    'fa-list-check',           true),
      sub('compliance', 'permits',     'EMA Permits',         'fa-file-contract',        true),
      sub('compliance', 'breaches',    'Breach Log',          'fa-triangle-exclamation', true),
      sub('compliance', 'calendar',    'Regulatory Calendar', 'fa-calendar-days',        false),
    ],
  },
  {
    key: 'emergency', parentId: 's-hse-emergency', label: 'Emergency Response', icon: 'fa-truck-medical',
    sub: 'Emergency plans, muster points, drill log, ERT member register', visNamespace: 'hse-emergency', defaultTab: 'plans',
    items: [
      sub('emergency', 'plans',  'Emergency Plans', 'fa-map-location-dot', true),
      sub('emergency', 'muster', 'Muster Points',   'fa-people-group',     true),
      sub('emergency', 'drills', 'Drill Log',        'fa-stopwatch',        true),
      sub('emergency', 'ert',    'ERT Register',     'fa-shield-halved',    false),
    ],
  },
  {
    key: 'environmental', parentId: 's-hse-environmental', label: 'Environmental Mgmt', icon: 'fa-leaf',
    sub: 'Spill register, waste manifests, EMA notifications, monitoring log', visNamespace: 'hse-environmental', defaultTab: 'spills',
    items: [
      sub('environmental', 'spills',     'Spill Register',    'fa-droplet',    true),
      sub('environmental', 'waste',      'Waste Manifests',   'fa-trash-can',  true),
      sub('environmental', 'ema',        'EMA Notifications', 'fa-file-lines', true),
      sub('environmental', 'monitoring', 'Env Monitoring',    'fa-chart-line', false),
    ],
  },
];

/** Resolve which area + tab a section id belongs to (null if not an HSE area). */
export function sectionToArea(sectionId: string): { area: HseArea; tab: string } | null {
  for (const area of HSE_AREAS) {
    if (sectionId === area.parentId) return { area, tab: area.defaultTab };
    const item = area.items.find(i => i.id === sectionId);
    if (item) return { area, tab: item.tab };
  }
  return null;
}
