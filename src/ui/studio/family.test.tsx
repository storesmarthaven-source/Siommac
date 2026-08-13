/**
 * src/ui/studio/family.test.tsx — the Buttons family contract.
 *
 * A family groups components in the CATALOGUE without merging them into one
 * component. Both halves have a failure mode, and each assertion below guards
 * one of them:
 *
 *   grouping lost   → three sibling cards, the fragmentation the kit removes
 *   merging happens → one Button with isDropdown/isSplit/menuItems, the prop
 *                     soup the kit ALSO removes
 *
 * The sharpest assertion is the last one: the Properties panel must render the
 * SELECTED definition's own `def.props`. A second, hand-built properties system
 * for families is the thing this file exists to make impossible to add quietly.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import {
  BUTTON_FAMILY, COMPONENT_FAMILIES, componentsByCategory,
  findComponent, findFamily, familyOfComponent, COMPOUND_OF,
} from '../registry';
import { Studio } from './Studio';

const MEMBERS = ['button', 'dropdown-button', 'split-button'] as const;

/** The subtype selector option for `name`. Fails loudly rather than silently. */
function subtype(container: Element, name: string): HTMLElement {
  const shortName = name.replace(' Button', '');
  const found = [...container.querySelectorAll<HTMLElement>('.sds-family-switch button')]
    .find(el => el.querySelector('strong')?.textContent === shortName);
  if (!found) throw new Error(`No "${name}" subtype option is rendered`);
  return found;
}

/** Open the Buttons family from the catalogue card. */
function openButtons(container: Element): void {
  const card = container.querySelector<HTMLElement>('.sds-card--family');
  if (!card) throw new Error('No Buttons family card is rendered');
  fireEvent.click(card);
}

const activeSubtype = (c: Element): string | undefined =>
  c.querySelector('.sds-family-switch .is-on strong')?.textContent ?? undefined;

describe('Buttons family — registry', () => {
  it('collapses the three button components into one catalogue node', () => {
    const actions = componentsByCategory().find(g => g.category === 'actions');
    const families = (actions?.nodes ?? []).flatMap(n => n.kind === 'family' ? [n] : []);

    expect(families).toHaveLength(1);
    expect(families[0]?.family.id).toBe('buttons');
    expect(families[0]?.members.map(m => m.id)).toEqual([...MEMBERS]);
  });

  it('counts components, not nodes — grouping must not shrink coverage', () => {
    const actions = componentsByCategory().find(g => g.category === 'actions');
    expect(actions?.items.map(d => d.id)).toEqual(expect.arrayContaining([...MEMBERS]));
    expect(actions?.nodes.length).toBeLessThan(actions?.items.length ?? 0);
  });

  it('never lets a family id collide with a component id', () => {
    for (const family of COMPONENT_FAMILIES) {
      expect(findComponent(family.id)).toBeUndefined();
      for (const id of family.componentIds) expect(findComponent(id)).toBeDefined();
      expect(family.componentIds).toContain(family.defaultComponentId);
    }
  });

  it('keeps each member a separate component with its own props schema', () => {
    // The distinguishing prop of each. If these converge, they have been merged.
    expect(findComponent('button')?.props).toHaveProperty('tone');
    expect(findComponent('dropdown-button')?.props).toHaveProperty('matchWidth');
    expect(findComponent('split-button')?.props).toHaveProperty('menuLabel');

    for (const id of MEMBERS) {
      for (const banned of ['isDropdown', 'isSplit', 'splitAction', 'trigger']) {
        expect(findComponent(id)?.props ?? {}).not.toHaveProperty(banned);
      }
    }
  });

  it('retains the Button + Menu relationship for the compound members', () => {
    expect(COMPOUND_OF['dropdown-button']).toBe('Button + Menu');
    expect(COMPOUND_OF['split-button']).toBe('Button + Menu');
    // Action Button is not compound — it must not gain an ownership line.
    expect(COMPOUND_OF.button).toBeUndefined();
  });

  it('resolves a member back to its family', () => {
    for (const id of MEMBERS) expect(familyOfComponent(id)?.id).toBe('buttons');
    expect(familyOfComponent('segmented-control')).toBeUndefined();
    expect(findFamily('buttons')).toBe(BUTTON_FAMILY);
  });
});

describe('Buttons family — Studio', () => {
  it('shows Buttons once, and its members are not sibling cards', () => {
    const { container } = render(<Studio />);

    // One family card and one nav row — not one per member in either place.
    expect(container.querySelectorAll('.sds-card--family')).toHaveLength(1);
    expect(container.querySelectorAll('.sds-card--family .sds-card__specimen')).toHaveLength(1);
    const navRows = [...container.querySelectorAll('.sds-nav__item--sub')]
      .map(el => el.textContent);
    expect(navRows.filter(t => t.startsWith('Buttons'))).toHaveLength(1);
    for (const name of ['Action Button', 'Dropdown Button', 'Split Button']) {
      expect(navRows).not.toContain(name);
    }
    const standaloneCaptions = [...container.querySelectorAll('.sds-card--open .sds-card__foot strong')]
      .map(el => el.textContent);
    for (const name of ['Action Button', 'Dropdown Button', 'Split Button']) {
      expect(standaloneCaptions).not.toContain(name);
    }
  });

  it('opens on Action Button by default', () => {
    const { container } = render(<Studio />);

    openButtons(container);

    expect(container.querySelector('.sds-wb__head h2')?.textContent).toBe('Buttons');
    expect(activeSubtype(container)).toBe('Action');
    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Primary button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Primary');
  });

  it('swaps the active def AND the Properties schema on subtype change', () => {
    const { container, queryByText } = render(<Studio />);
    openButtons(container);

    expect(queryByText('Style settings')).toBeNull();
    expect(queryByText('Background')).not.toBeNull();
    expect(queryByText('Menu accessible name')).toBeNull();

    fireEvent.click(subtype(container, 'Split Button'));

    // Split Button's own schema replaced it — not merged with it.
    expect(activeSubtype(container)).toBe('Split');
    expect(container.querySelector('.sds-pg__who strong')?.textContent).toBe('Try the Split Button');
    expect(queryByText('Menu accessible name')).not.toBeNull();
    expect(queryByText('Background')).toBeNull();

    expect(subtype(container, 'Split Button').textContent).toContain('Default action + alternatives');
  });

  it('renders every Properties control from the selected definition', () => {
    const { container } = render(<Studio />);
    openButtons(container);

    fireEvent.click(subtype(container, 'Dropdown Button'));

    // Every declared prop reaches the panel. A hand-built family properties
    // system would drift from the definition the moment a prop was added.
    const def = findComponent('dropdown-button');
    const labels = [...container.querySelectorAll('.sds-pg__panel label, .sds-pg__panel h4')]
      .map(el => el.textContent).join(' | ');
    for (const control of Object.values(def?.props ?? {})) {
      expect(labels).toContain(control.label);
    }
  });

  it('separates the Credits treatment from Action Button variants', () => {
    const { container, queryByText } = render(<Studio />);
    openButtons(container);

    expect(container.querySelectorAll('.sds-button-picker [role="radio"]')).toHaveLength(7);
    expect(queryByText('Credits')).toBeNull();

    fireEvent.click(subtype(container, 'Dropdown Button'));
    expect(queryByText('Special treatments')).toBeNull();
    expect(container.querySelector('.sds-special .ui-credits')).toBeNull();
  });

  it('uses purposeful content for every Button variant', () => {
    const { container } = render(<Studio />);
    openButtons(container);

    const labels = [...container.querySelectorAll('.sds-button-picker .ui-btn')]
      .map(button => button.textContent.trim());
    expect(labels).toEqual(['Save', 'Cancel', 'Preview', 'Back', 'Delete', 'View record']);
  });

  it('selects the exact Button variant to edit', () => {
    const { container, getByRole } = render(<Studio />);
    openButtons(container);

    fireEvent.click(getByRole('radio', { name: /Danger/ }));

    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Danger button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Danger');
  });
});
