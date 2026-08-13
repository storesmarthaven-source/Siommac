/**
 * src/ui/registry/families.ts — catalogue grouping for the Studio.
 *
 * A family is NAVIGATION, not architecture. It collapses several components
 * into one catalogue card and one nav row so the Studio reads "Buttons" rather
 * than three sibling entries — and opening it still gives each member its own
 * workbench and its own complete `def.props` schema.
 *
 * ⛔ A family is not a merged component. Action / Dropdown / Split Button look
 * related but their interaction models differ: one performs an action, one only
 * reveals actions, one does both. Folding them into a single component would
 * produce the `isDropdown` / `isSplit` / `menuItems` / `splitAction` prop soup
 * this kit exists to remove. Group in the catalogue, separate in the API.
 *
 * ⭐ The membership lives HERE, not as a `family` field on every `ComponentDef`.
 * Grouping is a property of the catalogue, and 50-odd primitives that will never
 * belong to one should not carry a field describing their absence from it. The
 * reverse lookup is derived, so there is still exactly one place to edit.
 */

import { type ComponentCategory, type ComponentDef } from './types';

export interface ComponentFamily {
  /** Nav/route key. Must not collide with a component id — asserted in tests. */
  id: string;
  /** Catalogue name, e.g. "Buttons". */
  name: string;
  /** The section the family card appears in. Members must share it. */
  category: ComponentCategory;
  /** One sentence for the card and the workbench header. */
  description: string;
  /** Which member opens when the family itself is selected. */
  defaultComponentId: string;
  /** Members, in the order the subtype selector shows them. */
  componentIds: readonly string[];
  /**
   * Each member's role WITHIN the family, in a few words, keyed by component id.
   *
   * This is what makes the selector legible at a glance — "Performs one action"
   * next to "Reveals related actions" is the whole distinction, and a user
   * should not have to open all three to find it. Family metadata rather than a
   * `ComponentDef` field: a component's role relative to its siblings only
   * exists because the family does.
   */
  roles: Readonly<Record<string, string>>;
}

export const BUTTON_FAMILY: ComponentFamily = {
  id: 'buttons',
  name: 'Buttons',
  category: 'actions',
  description:
    'Action, dropdown and split controls for executing or selecting actions. Three separate ' +
    'components — they share an appearance, not an interaction model.',
  defaultComponentId: 'button',
  componentIds: ['button', 'dropdown-button', 'split-button'],
  roles: {
    'button':          'Performs one action',
    'dropdown-button': 'Reveals related actions',
    'split-button':    'Default action + alternatives',
  },
};

export const COMPONENT_FAMILIES: readonly ComponentFamily[] = [BUTTON_FAMILY];

export function findFamily(id: string): ComponentFamily | undefined {
  return COMPONENT_FAMILIES.find(f => f.id === id);
}

/** The family a component belongs to, or `undefined` for the standalone majority. */
export function familyOfComponent(componentId: string): ComponentFamily | undefined {
  return COMPONENT_FAMILIES.find(f => f.componentIds.includes(componentId));
}

/**
 * Resolve a family's members against the catalogue.
 *
 * `pool` lets a caller resolve within one already-filtered category, so a family
 * can never reintroduce a member the caller had excluded.
 */
export function familyMembers(
  family: ComponentFamily,
  pool: readonly ComponentDef[],
): ComponentDef[] {
  return family.componentIds
    .map(id => pool.find(d => d.id === id))
    .filter((d): d is ComponentDef => d !== undefined);
}
