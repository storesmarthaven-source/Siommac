/**
 * src/ui/registry — the component registry.
 *
 * The Gallery's single source of truth for what the design system contains,
 * what it does not contain yet, and what each component replaces. Assembled
 * from three files so no single one becomes unreadable:
 *
 *   definitions.tsx    the original five-component proof (forms, selection, overlays)
 *   actions.defs.tsx   the Actions family
 *   forms.defs.tsx     the Forms wave (inputs, choice controls, date/time, files)
 *   data.defs.tsx      DataTable and the Badge system
 *   containers.defs.tsx the Card surface
 *   navigation.defs.tsx the Tabs component
 *   planned.ts         everything still MISSING — gaps as data, not as a memory
 *
 * Nothing outside the workbench and the coverage script reads this. It is
 * design-system metadata, not runtime configuration.
 */

export {
  type ComponentDef, type ComponentCategory, type ComponentStatus,
  type PropControl, type PropValues, type StyleControl, type StyleGroup,
  type A11yInfo, type KeyBinding, type ComponentExample, type MigrationInfo,
  type ComparisonSet, type ComparisonAspect, type ImplSpecimen, type ImplGeneration, type RetiredImpl,
  defaultProps, styleVarNames, isBuilt,
} from './types';

export { DEMO_PEOPLE, DEMO_DEPARTMENTS } from './definitions';

import { COMPONENT_DEFS as CORE_DEFS } from './definitions';
import { ACTION_DEFS } from './actions.defs';
import { FORM_DEFS } from './forms.defs';
import { DATA_DEFS } from './data.defs';
import { CONTAINER_DEFS } from './containers.defs';
import { NAVIGATION_DEFS } from './navigation.defs';
import { PLANNED_DEFS } from './planned';
import { type ComponentCategory, type ComponentDef, isBuilt } from './types';

/**
 * The whole catalogue, built and planned.
 *
 * A `missing` entry appearing here is deliberate: the Gallery shows it, the
 * coverage script counts it, and nobody has to remember it.
 */
export const COMPONENT_DEFS: readonly ComponentDef[] = [
  ...CORE_DEFS,
  ...ACTION_DEFS,
  ...FORM_DEFS,
  ...DATA_DEFS,
  ...CONTAINER_DEFS,
  ...NAVIGATION_DEFS,
  ...PLANNED_DEFS,
];

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  foundations: 'Foundations',
  actions:     'Actions',
  forms:       'Forms',
  selection:   'Selection',
  people:      'People',
  overlays:    'Overlays',
  data:        'Data',
  navigation:  'Navigation',
  feedback:    'Feedback',
  containers:  'Containers',
  status:      'Status',
  patterns:    'Enterprise patterns',
};

/** Left-nav order. A design decision, not alphabetical. */
export const CATEGORY_ORDER: ComponentCategory[] = [
  'actions', 'forms', 'selection', 'people', 'overlays',
  'data', 'navigation', 'feedback', 'containers', 'status', 'patterns',
];

export interface CategoryGroup {
  category: ComponentCategory;
  label: string;
  items: ComponentDef[];
  built: number;
  total: number;
}

/**
 * Components grouped for the nav and the coverage dashboard.
 *
 * Built components sort first within a category — the workbench is for working
 * on what exists, with the gaps listed after rather than interleaved.
 */
export function componentsByCategory(): CategoryGroup[] {
  return CATEGORY_ORDER
    .map(category => {
      const items = COMPONENT_DEFS
        .filter(d => d.category === category)
        .sort((a, b) => Number(isBuilt(b)) - Number(isBuilt(a)));
      return {
        category,
        label: CATEGORY_LABELS[category],
        items,
        built: items.filter(isBuilt).length,
        total: items.length,
      };
    })
    .filter(g => g.total > 0);
}

export function findComponent(id: string): ComponentDef | undefined {
  return COMPONENT_DEFS.find(d => d.id === id);
}

export interface RegistryTotals {
  canonical: number;
  beta: number;
  deprecated: number;
  missing: number;
  total: number;
  /** Share of the intended catalogue that exists, 0–1. */
  completeness: number;
}

export function registryTotals(): RegistryTotals {
  const canonical  = COMPONENT_DEFS.filter(d => d.status === 'stable').length;
  const beta       = COMPONENT_DEFS.filter(d => d.status === 'beta').length;
  const deprecated = COMPONENT_DEFS.filter(d => d.status === 'deprecated').length;
  const missing    = COMPONENT_DEFS.filter(d => d.status === 'missing').length;
  const total      = COMPONENT_DEFS.length;
  return {
    canonical, beta, deprecated, missing, total,
    completeness: total === 0 ? 0 : (canonical + beta) / total,
  };
}
