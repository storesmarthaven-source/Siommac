/**
 * src/ui/studio/brandDirections.ts — the three theme directions, as policy.
 *
 * Separated from `BrandOverview` because this is domain logic, not presentation:
 * it decides how far a customer's brand is allowed to reach into the product.
 * Keeping it here means the guarantees below can be ASSERTED in a test instead
 * of demonstrated by clicking through fifteen seed × direction combinations.
 *
 * A direction is a SUBSET of the roles the engine already emitted — never a
 * second palette and never a second engine. The colours are identical across all
 * three; only their reach changes:
 *
 *   Enterprise     primary action · focus · selection edge
 *   Balanced       + selection fill · nav active (wash, indicator, text)
 *   Brand Forward  + link
 *
 * Two invariants hold by construction, and `brandDirections.test.ts` proves them
 * for every seed:
 *
 *   • No direction can emit an operational colour (success/warning/danger/info).
 *     The engine never generates one, so there is none to filter.
 *   • No direction can emit a surface or secondary-action role. The engine's own
 *     `NEUTRAL_BY_POLICY` assertion throws if generation ever writes one.
 */

import { SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN } from '../theme/brand/brandTheme';

export type ThemeDirection = 'enterprise' | 'balanced' | 'forward';

const ROLE_ACTION = ['--ui-color-action-primary', '--ui-color-action-primary-hover', '--ui-color-action-primary-text'];
const ROLE_FOCUS = ['--ui-color-focus-outline', '--ui-color-focus-ring'];
const ROLE_SELECTION_EDGE = ['--ui-color-selection-border'];
const ROLE_SELECTION_FILL = ['--ui-color-selection-background'];
const ROLE_NAV_ACTIVE = [
  '--ui-color-navigation-active',
  '--ui-color-nav-active-background',
  '--ui-color-nav-active-indicator',
  '--ui-color-nav-active-text',
];
const ROLE_LINK = ['--ui-color-text-link'];
const SEEDS = [SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN];

/** Roles no direction may ever carry, whatever the seed. */
export const LOCKED_OPERATIONAL = [
  '--ui-color-success', '--ui-color-warning', '--ui-color-danger', '--ui-color-info',
] as const;

/** Surfaces and secondary actions: the frame, not the brand. */
export const LOCKED_NEUTRAL = [
  '--ui-color-action-secondary', '--ui-color-action-secondary-text',
  '--ui-color-nav-background', '--ui-color-nav-text',
  '--ui-color-surface', '--ui-color-surface-raised', '--ui-color-border',
] as const;

export interface DirectionDef {
  id: ThemeDirection;
  label: string;
  blurb: string;
  roles: readonly string[];
}

export const DIRECTIONS: readonly DirectionDef[] = [
  {
    id: 'enterprise', label: 'Enterprise',
    blurb: 'Most restrained. A neutral application shell, with the brand carried by key actions, focus and selection.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE],
  },
  {
    id: 'balanced', label: 'Balanced',
    blurb: 'Stronger branded indicators and more visible active states. Data and form surfaces stay neutral.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE, ...ROLE_SELECTION_FILL, ...ROLE_NAV_ACTIVE],
  },
  {
    id: 'forward', label: 'Brand Forward',
    blurb: 'The strongest professional brand presence. Still no branded dialog, card, table or input surfaces, and operational colours are untouched.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE, ...ROLE_SELECTION_FILL, ...ROLE_NAV_ACTIVE, ...ROLE_LINK],
  },
];

export function directionById(id: ThemeDirection): DirectionDef {
  const found = DIRECTIONS.find(d => d.id === id);
  if (!found) throw new Error(`Unknown theme direction: ${id}`);
  return found;
}

/**
 * The generated palette, narrowed to one direction's roles.
 *
 * Filtering the engine's OUTPUT (rather than parameterising the engine) is what
 * keeps the three directions provably the same palette: a role either reaches
 * the product or it does not, and its value is the same either way.
 */
export function tokensForDirection(
  generated: Record<string, string>,
  id: ThemeDirection,
): Record<string, string> {
  const allowed = new Set(directionById(id).roles);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(generated)) {
    if (allowed.has(name)) out[name] = value;
  }
  return out;
}
