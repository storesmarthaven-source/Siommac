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
  BUTTON_PATTERNS, findButtonPattern,
} from '../registry';
import { Studio } from './Studio';

const MEMBERS = ['button', 'dropdown-button', 'split-button'] as const;

/** The subtype selector option for `name`. Fails loudly rather than silently. */
function subtype(container: Element, name: string): HTMLElement {
  const shortName = name.replace(' Button', '');
  const found = [...container.querySelectorAll<HTMLElement>('.sds-family__type')]
    .find(el => el.querySelector('strong')?.textContent === shortName);
  if (!found) throw new Error(`No "${name}" subtype option is rendered`);
  return found;
}

/** Open the Buttons family browser from the catalogue card. */
function openButtonBrowser(container: Element): void {
  const card = container.querySelector<HTMLElement>('.sds-card--family');
  if (!card) throw new Error('No Buttons family card is rendered');
  fireEvent.click(card);
}

/** Open the canonical Action Button editor through the family browser. */
function openButtons(container: Element): void {
  openButtonBrowser(container);
  const action = [...container.querySelectorAll<HTMLButtonElement>('.sds-button-browser__card')]
    .find(card => card.querySelector('strong')?.textContent === 'Action Button');
  if (!action) throw new Error('No Action Button browser card is rendered');
  fireEvent.click(action);
}

const activeSubtype = (c: Element): string | undefined =>
  c.querySelector('.sds-family .is-on .sds-family__copy strong')?.textContent ?? undefined;

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

  it('registers governed patterns without adding variants or components', () => {
    expect(BUTTON_PATTERNS.map(pattern => pattern.id)).toEqual(['ai-action', 'icon-button', 'special-treatments']);
    expect(findButtonPattern('ai-action')?.foundationComponentId).toBe('button');
    for (const pattern of BUTTON_PATTERNS) expect(findComponent(pattern.id)).toBeUndefined();
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

  it('opens a visual browser before any Button editor', () => {
    const { container, getByRole } = render(<Studio />);

    openButtonBrowser(container);

    expect(getByRole('heading', { name: 'Buttons' })).toBeTruthy();
    expect(container.querySelectorAll('.sds-button-browser__card')).toHaveLength(6);
    expect(getByRole('heading', { name: 'Button components' })).toBeTruthy();
    expect(getByRole('heading', { name: 'Governed patterns' })).toBeTruthy();
    expect(container.querySelector('.sds-button-editor')).toBeNull();
  });

  it('opens Action Button from its browser card', () => {
    const { container } = render(<Studio />);

    openButtons(container);

    expect(container.querySelector('.sds-wb__head h2')?.textContent).toBe('Buttons');
    expect(activeSubtype(container)).toBe('Action');
    expect(subtype(container, 'Action Button').textContent).toContain('Button');
    expect(subtype(container, 'Action Button').textContent).not.toContain('Save changes');
    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Primary button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Primary');
    expect(container.querySelector('.sds-button-editor__intro h3')?.textContent).toBe('Variants');
    expect(container.querySelectorAll('.sds-button-picker [role="radio"]')).toHaveLength(6);
    expect(container.querySelector('.sds-button-use h3')?.textContent).toBe('Common application use');
    expect(container.querySelectorAll('.sds-button-use article')).toHaveLength(3);
  });

  it('opens a governed AI pattern without creating another Button variant', () => {
    const { container, getByRole, queryByRole } = render(<Studio />);
    openButtonBrowser(container);

    fireEvent.click(getByRole('button', { name: /AI Action/ }));

    expect(getByRole('heading', { name: 'AI Action' })).toBeTruthy();
    expect(getByRole('button', { name: /Edit Action Button foundation/ })).toBeTruthy();
    expect(queryByRole('radio', { name: /AI/ })).toBeNull();
    expect(container.querySelectorAll('.sds-button-pattern__examples article')).toHaveLength(2);
  });

  it('puts the live preview before the Button chooser', () => {
    const { container } = render(<Studio />);
    openButtons(container);

    const main = container.querySelector('.sds-button-editor__main');
    const preview = main?.querySelector('.sds-button-preview');
    const picker = main?.querySelector('.sds-button-picker');
    expect(main?.firstElementChild).toBe(preview);
    expect(preview).not.toBeNull();
    expect(picker).not.toBeNull();
    if (!preview || !picker) throw new Error('Button preview or chooser is missing');
    expect(preview.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    expect(container.querySelectorAll('.sds-button-picker [role="radio"]')).toHaveLength(6);
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
    expect(labels).toEqual(['Next', 'Cancel', 'Preview', 'Back', 'Delete', 'View record']);
  });

  it('selects the exact Button variant to edit', () => {
    const { container, getByRole } = render(<Studio />);
    openButtons(container);

    fireEvent.click(getByRole('radio', { name: /Danger/ }));

    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Danger button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Danger');
  });

  it('opens the Studio color picker for a component override', () => {
    const { container, getAllByLabelText, getByRole } = render(<Studio />);
    openButtons(container);

    const firstThemeToggle = getAllByLabelText('Use theme')[0];
    if (!firstThemeToggle) throw new Error('Expected a theme toggle');
    fireEvent.click(firstThemeToggle);
    fireEvent.click(getByRole('button', { name: 'Choose Background color' }));

    expect(getByRole('group', { name: 'Background color picker' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Set color to #dc2626' }));
    expect(getByRole('button', { name: 'Choose Background color' }).textContent).toContain('#dc2626');
  });

  it('keeps each variant preview example independent and unpublished', () => {
    const { container, getByLabelText, getByRole, queryByLabelText } = render(<Studio />);
    openButtons(container);

    expect(getByRole('button', { name: 'Next' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Choose Trailing icon' }));
    expect(getByRole('group', { name: 'Trailing icon Lucide icon browser' }).textContent).toContain('Lucide icons');
    fireEvent.input(getByLabelText('Search Lucide icons'), { target: { value: 'ChevronRight' } });
    fireEvent.click(getByRole('button', { name: 'Choose ChevronRight' }));
    expect(getByRole('button', { name: 'Clear Trailing icon' })).toBeTruthy();
    expect(queryByLabelText('Button text')).toBeNull();

    fireEvent.click(getByRole('radio', { name: /Secondary/ }));
    fireEvent.click(getByRole('button', { name: 'Choose Leading icon' }));
    fireEvent.click(getByRole('button', { name: 'Use recommended ArrowLeft' }));
    fireEvent.click(getByRole('radio', { name: 'Filled circle' }));
    fireEvent.click(getByRole('button', { name: 'Choose Icon color' }));
    fireEvent.click(getByRole('button', { name: 'Set color to #dc2626' }));
    expect(container.querySelector('.sds-button-preview__single .ui-btn-label')?.textContent).toBe('Cancel');
    expect(container.querySelector('.sds-button-preview__single .sds-preview-icon--filled-circle')).not.toBeNull();
    const previewIcon = container.querySelector<HTMLElement>('.sds-button-preview__single .sds-preview-icon');
    expect(previewIcon?.style.color).toBe('rgb(220, 38, 38)');

    fireEvent.click(getByRole('radio', { name: /Primary/ }));
    expect(getByRole('button', { name: 'Clear Trailing icon' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Clear Trailing icon' }));
    expect(getByRole('button', { name: 'Choose Trailing icon' }).textContent).toContain('No icon');
    expect(container.querySelector('.sds-button-settings__actions > span')?.textContent).toBe('Up to date');
  });
});
