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
  type ComponentDef, type ComponentCategory, type ComponentStatus, type ThumbnailKind,
  type PropControl, type PropCondition, type PropValues, type StyleControl, type StyleGroup,
  type A11yInfo, type KeyBinding, type ComponentExample, type VariantSample, type MigrationInfo,
  defaultProps, propsForAxis, propsForVariant, styleVarNames, isBuilt,
} from './types';

export { DEMO_PEOPLE, DEMO_DEPARTMENTS } from './definitions';
export { COMPOUND_OF } from './compound.defs';
export {
  BUTTON_PATTERNS, findButtonPattern,
  type ButtonPattern, type ButtonPatternExample, type ButtonPatternPreset, type ButtonPatternControl,
  type ButtonPatternValue, type ButtonPatternValues,
} from './button-patterns';

export {
  type ComponentFamily, COMPONENT_FAMILIES, BUTTON_FAMILY, SWITCH_FAMILY,
  findFamily, familyOfComponent, familyMembers,
} from './families';

import { COMPONENT_DEFS as CORE_DEFS } from './definitions';
import { ACTION_DEFS } from './actions.defs';
import { FORM_DEFS } from './forms.defs';
import { DATA_DEFS } from './data.defs';
import { CONTAINER_DEFS } from './containers.defs';
import { NAVIGATION_DEFS } from './navigation.defs';
import { FEEDBACK_DEFS } from './feedback.defs';
import { OVERLAY_DEFS } from './overlays.defs';
import { REMAINING_PRIMITIVE_DEFS } from './remaining-primitives.defs';
import { PEOPLE_DRAWER_DEFS } from './people-drawer.defs';
import { COMPOUND_DEFS } from './compound.defs';
import { PLANNED_DEFS } from './planned';
import { type ComponentCategory, type ComponentDef, isBuilt } from './types';
import { type ComponentFamily, familyOfComponent, familyMembers } from './families';
import { assertComponentRegistry } from './validate';

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
  ...FEEDBACK_DEFS,
  ...OVERLAY_DEFS,
  ...REMAINING_PRIMITIVE_DEFS,
  ...PEOPLE_DRAWER_DEFS,
  ...COMPOUND_DEFS,
  ...PLANNED_DEFS,
];

assertComponentRegistry(COMPONENT_DEFS);

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
  'actions', 'patterns', 'forms', 'selection', 'people', 'overlays',
  'data', 'navigation', 'feedback', 'containers', 'status',
];

/**
 * One row of the catalogue: a standalone component, or a family standing in for
 * several. The Studio's nav and its card grid both render from this, so a family
 * can never be grouped in one place and split in the other.
 */
export type CatalogueNode =
  | { kind: 'component'; def: ComponentDef }
  | { kind: 'family'; family: ComponentFamily; members: ComponentDef[] };

export interface CategoryGroup {
  category: ComponentCategory;
  label: string;
  /** Flat component list. Coverage counts read this — grouping must not shrink it. */
  items: ComponentDef[];
  /** The same components with families collapsed. What the Studio renders. */
  nodes: CatalogueNode[];
  built: number;
  total: number;
}

/**
 * Components grouped for the nav and the coverage dashboard.
 *
 * Built components sort first within a category — the workbench is for working
 * on what exists, with the gaps listed after rather than interleaved.
 *
 * A family takes the position of its first member, so collapsing never
 * reshuffles the rest of a category, and `built`/`total` keep counting
 * COMPONENTS: three cards becoming one must not make coverage look smaller.
 */
export function componentsByCategory(): CategoryGroup[] {
  return CATEGORY_ORDER
    .map(category => {
      const items = COMPONENT_DEFS
        .filter(d => d.category === category)
        .sort((a, b) => Number(isBuilt(b)) - Number(isBuilt(a)));

      const nodes: CatalogueNode[] = [];
      const seen = new Set<string>();
      for (const def of items) {
        const family = familyOfComponent(def.id);
        if (family?.category !== category) {
          nodes.push({ kind: 'component', def });
          continue;
        }
        if (seen.has(family.id)) continue;
        seen.add(family.id);
        // Resolved against `items`, so a member filtered out of this category
        // cannot reappear through the family.
        nodes.push({ kind: 'family', family, members: familyMembers(family, items) });
      }

      return {
        category,
        label: CATEGORY_LABELS[category],
        items,
        nodes,
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
  /** Missing PRIMITIVES — the kit's real catalogue debt. */
  missingPrimitives: number;
  /** Missing `patterns` — module-owned compositions. NOT kit debt. */
  modulePatterns: number;
  total: number;
  /** Share of the PRIMITIVE catalogue that exists, 0–1. */
  completeness: number;
}

/**
 * Totals for the Studio header and the coverage dashboard.
 *
 * ⭐ `patterns` are module-owned compositions (PayrollApprovalTable is payroll,
 * DayOneGateCard is onboarding). They are built FROM primitives by the domain
 * that owns them, so they are neither part of the kit's catalogue nor a gap in
 * it — a design system that owns payroll approval is the application.
 *
 * Counting them dropped completeness from 74% to 45% and made the number argue
 * for building business features inside the kit. This mirrors
 * `scripts/check-ui-kit-coverage.mjs` exactly; the two must not disagree, or the
 * Studio and the build gate report different truths about the same registry.
 */
export function registryTotals(): RegistryTotals {
  const isPattern = (d: ComponentDef): boolean => d.category === 'patterns';
  const canonical  = COMPONENT_DEFS.filter(d => d.status === 'stable').length;
  const beta       = COMPONENT_DEFS.filter(d => d.status === 'beta').length;
  const deprecated = COMPONENT_DEFS.filter(d => d.status === 'deprecated').length;
  const missingPrimitives = COMPONENT_DEFS.filter(d => d.status === 'missing' && !isPattern(d)).length;
  const modulePatterns    = COMPONENT_DEFS.filter(d => d.status === 'missing' && isPattern(d)).length;
  const primitiveCatalogue = canonical + beta + missingPrimitives;
  return {
    canonical, beta, deprecated, missingPrimitives, modulePatterns,
    total: COMPONENT_DEFS.length,
    completeness: primitiveCatalogue === 0 ? 0 : (canonical + beta) / primitiveCatalogue,
  };
}
