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

/** Open the Buttons family browser from the catalogue card. */
function openButtonBrowser(container: Element): void {
  const card = container.querySelector<HTMLElement>('.sds-card--family');
  if (!card) throw new Error('No Buttons family card is rendered');
  fireEvent.click(card);
}

/** Open the canonical Action Button editor through the family browser. */
function openButtons(container: Element): void {
  openButtonBrowser(container);
  openButtonMember(container, 'Action Button');
}

function openButtonMember(container: Element, name: string): void {
  const member = [...container.querySelectorAll<HTMLButtonElement>('.sds-button-browser__card')]
    .find(card => card.querySelector('strong')?.textContent === name);
  if (!member) throw new Error(`No ${name} browser card is rendered`);
  fireEvent.click(member);
}

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
  it('uses a concise breadcrumb hierarchy without a redundant Components crumb', () => {
    const { container } = render(<Studio />);
    const labels = (): string[] => [...container.querySelectorAll<HTMLElement>('.sds-crumbs > ol > li')]
      .map(item => item.textContent.trim());
    const navTo = (label: string): void => {
      const target = [...container.querySelectorAll<HTMLButtonElement>('.sds-nav button')]
        .find(button => button.textContent.trim() === label);
      if (!target) throw new Error(`No ${label} navigation item is rendered`);
      fireEvent.click(target);
    };

    expect(labels()).toEqual(['Studio home', 'Overview']);

    openButtons(container);
    expect(labels()).toEqual(['Studio home', 'Buttons', 'Action Button']);

    navTo('Breadcrumbs');
    expect(labels()).toEqual(['Studio home', 'Breadcrumbs']);

    navTo('Theme Generator');
    expect(labels()).toEqual(['Studio home', 'Brand', 'Theme Generator']);
  });

  it('shows Buttons once, and its members are not sibling cards', () => {
    const { container } = render(<Studio />);

    // One family card and one nav row — not one per member in either place.
    expect(container.querySelectorAll('.sds-card--family')).toHaveLength(2);
    expect(container.querySelectorAll('.sds-card--family .sds-card__art')).toHaveLength(2);
    expect(container.querySelector('.sds-card--family .sds-card__specimen')).toBeNull();
    expect(container.querySelectorAll('.sds-card__preview .sds-card__art').length).toBe(container.querySelectorAll('.sds-card').length);
    const previewImages = [...container.querySelectorAll<HTMLImageElement>('.sds-card__preview img')];
    expect(previewImages).toHaveLength(1);
    expect(previewImages.map(image => image.closest('.sds-card')?.querySelector('.sds-card__foot strong')?.textContent))
      .toEqual(['FileInput']);
    expect(container.querySelector('.sds-card__preview .ui-btn')).toBeNull();
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

  it('uses complete fitted compositions for complex catalogue previews', () => {
    const { container } = render(<Studio />);
    const cards = [...container.querySelectorAll<HTMLElement>('.sds-card')];
    const cardNamed = (name: string) => cards.find(card =>
      card.querySelector('.sds-card__foot strong')?.textContent === name);

    expect(cardNamed('FileInput')?.querySelector('.sds-thumb-upload-image')).toBeTruthy();
    expect(cardNamed('ColorPicker')?.querySelector('.sds-thumb-color-picker__spectrum')).toBeTruthy();
    expect(cardNamed('Breadcrumbs')?.querySelector('.ui-breadcrumbs')).toBeTruthy();
    expect(cardNamed('Select')?.textContent).toContain('Does not contain');
    expect(cardNamed('Select')?.textContent).toContain('Search');
    expect(cardNamed('Select')?.textContent).toContain('Product');
    expect(cardNamed('FileInput')?.querySelectorAll('.is-preview-blurred')).toHaveLength(0);
    expect(cardNamed('Select')?.querySelectorAll('.is-preview-blurred')).toHaveLength(1);
    expect(cardNamed('Switches')?.querySelector('.sds-thumb-switch-family__general .ui-switch-check')).toBeTruthy();
    expect(cardNamed('Switches')?.querySelectorAll('.ui-switch-track')).toHaveLength(1);
    expect(cardNamed('Switches')?.querySelector('.ui-theme-mode-switch')).toBeNull();
    expect(cardNamed('Checkbox')?.querySelectorAll('.ui-choice--checkbox')).toHaveLength(2);
    expect(cardNamed('Checkbox')?.querySelector('.sds-thumb-choice--check .is-on')).toBeNull();
    expect(cardNamed('Toast')?.querySelector('.sds-thumb-toast')).toBeTruthy();
    expect(cardNamed('SweetAlert2 Popup')?.querySelector('.sds-thumb-sweet-alert')).toBeTruthy();
  });

  it('exposes the real Toast variants, icons, timer and tier-specific content controls', () => {
    const { getByLabelText, getByRole, getByText, queryByLabelText } = render(<Studio />);
    fireEvent.click(getByRole('button', { name: 'Toast', exact: true }));

    expect(getByRole('button', { name: 'Trigger toast' })).toBeTruthy();
    expect(getByRole('button', { name: 'Choose Icon' })).toBeTruthy();
    expect(getByLabelText('Auto dismiss')).toBeTruthy();
    expect(getByLabelText('Duration (ms)')).toBeTruthy();
    expect(getByLabelText('Timer progress')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Action', exact: true }));
    expect(getByText('Module and status')).toBeTruthy();
    expect(getByText('Summary details')).toBeTruthy();
    expect(getByText('Supporting note')).toBeTruthy();
    expect(queryByLabelText('File preview')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Rich', exact: true }));
    expect(getByText('File preview')).toBeTruthy();
    expect(queryByLabelText('Supporting note')).toBeNull();

    fireEvent.click(getByLabelText('Auto dismiss'));
    expect(queryByLabelText('Duration (ms)')).toBeNull();
    expect(queryByLabelText('Timer progress')).toBeNull();
  });

  it('exposes SweetAlert alert, confirm, prompt, loading and timed behaviors', () => {
    const { getByLabelText, getByRole, queryByLabelText } = render(<Studio />);
    fireEvent.click(getByRole('button', { name: 'SweetAlert2 Popup', exact: true }));

    expect(getByRole('button', { name: 'Preview alert' })).toBeTruthy();
    expect(getByLabelText('Show icon')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Prompt', exact: true }));
    expect(getByLabelText('Input type')).toBeTruthy();
    expect(getByLabelText('Cancel action')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Loading', exact: true }));
    expect(queryByLabelText('Backdrop dismiss')).toBeNull();
    expect(queryByLabelText('Cancel action')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Timed', exact: true }));
    expect(getByLabelText('Duration (ms)')).toBeTruthy();
    expect(getByLabelText('Timer progress')).toBeTruthy();
  });

  it('offers governed Modal Frame layouts without separate sidebar components', () => {
    const { container, getByRole } = render(<Studio />);
    fireEvent.click(getByRole('button', { name: 'Modal Frame', exact: true }));

    const layouts = getByRole('radiogroup', { name: 'Modal Frame Layout' });
    expect(layouts.querySelectorAll('[role="radio"]')).toHaveLength(6);
    expect(layouts.querySelectorAll('.sds-modal-layout-thumb')).toHaveLength(6);
    expect(getByRole('radio', { name: /Frame/ }).getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('.sds-button-preview__single .sds-modal-frame-canvas')).toBeTruthy();
    fireEvent.click(getByRole('radio', { name: /Sidebar right/ }));

    const frame = container.querySelector('.ui-dialog--layout-sidebar-right');
    expect(frame).toBeTruthy();
    expect(frame?.querySelector('.ui-dialog-head')).toBeTruthy();
    expect(frame?.querySelector('.ui-dialog-content')).toBeTruthy();
    expect(frame?.querySelector('.ui-dialog-sidebar')).toBeTruthy();
    expect(frame?.querySelector('.ui-dialog-foot')).toBeTruthy();
    expect(container.querySelector('.sds-nav button')?.textContent).not.toBe('Dialog Sidebar');
  });

  it('keeps the Checkbox application example in a canonical vertical group', () => {
    const { container, getByRole } = render(<Studio />);
    fireEvent.click(getByRole('button', { name: 'Checkbox', exact: true }));

    const specimen = container.querySelector('.sds-use-context__spec');
    expect(specimen?.closest('.sds-use-context--single')).toBeTruthy();
    expect(specimen?.querySelector('[role="group"][aria-label="Modules"]')).toBeTruthy();
    expect(specimen?.querySelectorAll('.ui-choice--checkbox')).toHaveLength(4);
    expect(specimen?.querySelector('.ui-choice-group--inline')).toBeNull();
  });

  it('opens a visual browser before any Button editor', () => {
    const { container, getByRole } = render(<Studio />);

    openButtonBrowser(container);

    expect(getByRole('heading', { name: 'Buttons' })).toBeTruthy();
    expect(container.querySelectorAll('.sds-button-browser__card')).toHaveLength(6);
    expect(getByRole('heading', { name: 'Button components' })).toBeTruthy();
    expect(getByRole('heading', { name: 'Governed patterns' })).toBeTruthy();
    const actionCard = [...container.querySelectorAll<HTMLElement>('.sds-button-browser__card')]
      .find(card => card.querySelector('.sds-button-browser__copy strong')?.textContent === 'Action Button');
    if (!actionCard) throw new Error('Expected the Action Button browser card');
    expect(actionCard.textContent).not.toContain('Save changes');
    expect(actionCard.textContent).not.toContain('Open editor');
    expect(actionCard.querySelector('.sds-button-browser__specimen')?.textContent).toContain('Button');
    expect(actionCard.querySelector('.sds-button-browser__specimen .ui-btn svg')).toBeNull();

    const splitCard = [...container.querySelectorAll<HTMLElement>('.sds-button-browser__card')]
      .find(card => card.querySelector('.sds-button-browser__copy strong')?.textContent === 'Split Button');
    if (!splitCard) throw new Error('Expected the Split Button browser card');
    expect(splitCard.querySelector('.ui-split > .ui-btn:first-child')?.textContent).toContain('Split button');
    expect(splitCard.querySelector('.ui-split > .ui-btn:first-child svg')).toBeNull();
    expect(splitCard.querySelector('.sds-button-browser__canvas-label')?.textContent).toBe('Component preview');
    expect(container.querySelector('.sds-button-editor')).toBeNull();
  });

  it('opens Action Button from its browser card', () => {
    const { container } = render(<Studio />);

    openButtons(container);

    expect(container.querySelector('.sds-wb__head h2')?.textContent).toBe('Action Button');
    expect(container.querySelector('.sds-family')).toBeNull();
    expect(container.querySelector('.sds-component-nav__all')?.textContent).toContain('Components');
    expect(container.querySelectorAll('.sds-component-nav button')).toHaveLength(3);
    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Try the Primary button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Primary');
    expect(container.querySelector('.sds-button-editor__intro h3')?.textContent).toBe('Variants');
    expect(container.querySelector('.sds-button-preview .sds-button-picker')).not.toBeNull();
    expect(container.querySelectorAll('.sds-button-picker [role="radio"]')).toHaveLength(6);
    expect(container.querySelector('.sds-button-use h3')?.textContent).toBe('Common application use');
    expect(container.querySelectorAll('.sds-button-use article')).toHaveLength(3);
  });

  it('opens a governed AI pattern without creating another Button variant', () => {
    const { container, getByRole, queryByRole } = render(<Studio />);
    openButtonBrowser(container);

    fireEvent.click(getByRole('button', { name: /AI Action/ }));

    expect(getByRole('heading', { name: 'AI Action' })).toBeTruthy();
    expect(container.querySelector('.ui-ai-action-button__brand-glyph')).not.toBeNull();
    expect(container.querySelector('.sds-owned-button__canvas')).not.toBeNull();
    expect(container.querySelector('.sds-owned-button__settings')?.textContent).toContain('Preview settings');
    expect(queryByRole('radio', { name: /AI/ })).toBeNull();
    expect(container.querySelectorAll('.sds-button-use article')).toHaveLength(3);
    expect(getByRole('complementary', { name: 'AI Action settings' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Choose AI icon' })).toBeNull();
    fireEvent.input(getByRole('combobox', { name: 'Icon style' }), { target: { value: 'lucide' } });
    fireEvent.click(getByRole('button', { name: 'Choose AI icon' }));
    fireEvent.click(getByRole('button', { name: 'Use recommended BrainCircuit' }));
    expect(container.querySelector('.sds-owned-button__stage .ui-ai-action-button svg')).not.toBeNull();
    expect(container.querySelector('.sds-button-use')?.textContent).toContain('Ask SIOMAC');
  });

  it('keeps Icon Button labels locked while exposing its icon editor', () => {
    const { container, getByRole, queryByRole } = render(<Studio />);
    openButtonBrowser(container);
    fireEvent.click(getByRole('button', { name: /Icon Button/ }));

    expect(getByRole('complementary', { name: 'Icon Button settings' })).toBeTruthy();
    expect(queryByRole('textbox', { name: 'Accessible name' })).toBeNull();
    expect(getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(container.querySelector('.sds-owned-button__settings footer')?.textContent).toContain('Shape and colors');
    expect(getByRole('button', { name: 'Change shape and colors' })).toBeTruthy();
  });

  it('isolates Credits controls without adding a Credits ButtonVariant', () => {
    const { container, getByRole } = render(<Studio />);
    openButtonBrowser(container);
    fireEvent.click(getByRole('button', { name: /Special Treatments/ }));

    expect(getByRole('complementary', { name: 'Special Treatments settings' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Choose Base color' }));
    fireEvent.input(getByRole('textbox', { name: 'Hex color' }), { target: { value: '#7c3aed' } });
    expect(container.querySelector<HTMLElement>('.sds-credits-preview')?.style.cssText).toContain('#7c3aed');
    expect(JSON.stringify(findComponent('button')?.props?.variant)).not.toContain('credits');
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

  it('opens Split Button in its own focused editor and schema', () => {
    const { container, queryByText } = render(<Studio />);
    openButtonBrowser(container);
    openButtonMember(container, 'Split Button');

    // Split Button's own schema replaced it — not merged with it.
    expect(container.querySelector('.sds-owned-button__settings strong')?.textContent).toBe('Try the Split Button');
    expect(container.querySelector('.sds-owned-button__stage')?.textContent).toContain('Live preview');
    expect(container.querySelector('.sds-owned-button__specimen .ui-split > .ui-btn:first-child')?.textContent).toContain('Split button');
    expect(container.querySelector('.sds-owned-button__specimen .ui-split > .ui-btn:first-child svg')).toBeNull();
    expect(container.querySelector('.sds-pg')).toBeNull();
    expect(queryByText('Menu accessible name')).toBeNull();
    expect(queryByText('Background')).toBeNull();
    expect(container.querySelector('.sds-family')).toBeNull();
  });

  it('renders governed non-text controls without exposing button labels for editing', () => {
    const { container, queryByLabelText } = render(<Studio />);
    openButtonBrowser(container);
    openButtonMember(container, 'Dropdown Button');

    // Behavioural controls stay schema-driven, while product copy is fixed in
    // the preview and cannot become a published styling choice.
    const def = findComponent('dropdown-button');
    const labels = [...container.querySelectorAll('.sds-owned-button__settings label, .sds-owned-button__settings h4, .sds-owned-button__settings [role="radiogroup"]')]
      .map(el => el.textContent).join(' | ');
    for (const control of Object.values(def?.props ?? {}).filter(control =>
      control.type !== 'text' && control.label !== 'Variant' && control.label !== 'Leading icon' && control.label !== 'Size')) {
      expect(labels).toContain(control.label);
    }
    expect(container.querySelector('[role="radiogroup"][aria-label="Dropdown Button variant"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Choose Leading icon"]')).not.toBeNull();
    expect(queryByLabelText('Trigger label')).toBeNull();
    expect(queryByLabelText('Primary action')).toBeNull();
    expect(queryByLabelText('Menu accessible name')).toBeNull();
  });

  it('uses the same modern live-preview shell for both compound Button editors', () => {
    for (const name of ['Dropdown Button', 'Split Button']) {
      const { container, unmount } = render(<Studio />);
      openButtonBrowser(container);
      openButtonMember(container, name);

      expect(container.querySelector('.sds-owned-button__editor')).not.toBeNull();
      expect(container.querySelector('.sds-owned-button__canvas')).not.toBeNull();
      expect(container.querySelector('.sds-owned-button__settings')?.textContent).toContain('Shape and colors');
      expect(container.querySelector('.sds-button-use')).not.toBeNull();
      expect(container.querySelector('.sds-owned-button__variants')).not.toBeNull();
      expect(container.querySelector('.sds-owned-button__settings')?.textContent).toContain('Icon treatment');
      expect(container.querySelector('button[aria-label="Choose Icon color"]')).not.toBeNull();
      unmount();
    }
  });

  it('keeps component sizing functional but removes size controls from properties panels', () => {
    const { container, queryByRole } = render(<Studio />);
    openButtonBrowser(container);
    openButtonMember(container, 'Split Button');

    expect(queryByRole('button', { name: 'Small' })).toBeNull();
    expect(queryByRole('button', { name: 'Medium' })).toBeNull();
    expect(queryByRole('button', { name: 'Large' })).toBeNull();

    const textInputNav = [...container.querySelectorAll<HTMLButtonElement>('.sds-nav button')]
      .find(button => button.textContent.trim() === 'TextInput');
    if (!textInputNav) throw new Error('No TextInput navigation item is rendered');
    fireEvent.click(textInputNav);
    expect(container.querySelector('[role="group"][aria-label="Size"]')).toBeNull();
  });

  it('exposes date and file treatments as focused variants and hides suffix editing', () => {
    const { container, queryByLabelText } = render(<Studio />);
    const navigate = (name: string): void => {
      const target = [...container.querySelectorAll<HTMLButtonElement>('.sds-nav button')]
        .find(button => button.textContent.trim() === name);
      if (!target) throw new Error(`No ${name} navigation item is rendered`);
      fireEvent.click(target);
    };

    navigate('DateInput');
    expect(container.querySelectorAll('.sds-axis [role="radio"]')).toHaveLength(4);
    expect(container.querySelector('.sds-axis')?.textContent).toContain('Date & time');
    const dateTime = [...container.querySelectorAll<HTMLButtonElement>('.sds-axis [role="radio"]')]
      .find(button => button.querySelector('strong')?.textContent === 'Date & time');
    if (!dateTime) throw new Error('No Date & time variant is rendered');
    fireEvent.click(dateTime);
    expect(container.querySelector('.sds-button-preview__single')?.textContent).toContain('Date & time');

    navigate('FileInput');
    expect(container.querySelectorAll('.sds-axis [role="radio"]')).toHaveLength(3);
    expect(container.querySelector('.sds-button-preview__single .ui-file-field')?.textContent).toContain('Choose a file');
    expect(container.querySelector('.sds-button-preview__single .ui-file-field')?.textContent).toContain('Upload');

    navigate('TextInput');
    expect(queryByLabelText('Suffix affix')).toBeNull();
    expect(container.querySelector('.sds-button-settings')?.textContent).not.toContain('Suffix affix');
  });

  it('keeps compound Button icon colors isolated by variant', () => {
    const { container, getByRole } = render(<Studio />);
    openButtonBrowser(container);
    openButtonMember(container, 'Dropdown Button');

    fireEvent.click(getByRole('button', { name: 'Choose Icon color' }));
    fireEvent.input(getByRole('textbox', { name: 'Hex color' }), { target: { value: '#dc2626' } });
    expect(getByRole('button', { name: 'Choose Icon color' }).textContent).toContain('#dc2626');

    fireEvent.click(getByRole('radio', { name: 'Select Primary variant' }));
    expect(getByRole('button', { name: 'Choose Icon color' }).textContent).toContain('#ffffff');

    fireEvent.click(getByRole('radio', { name: 'Select Secondary variant' }));
    expect(getByRole('button', { name: 'Choose Icon color' }).textContent).toContain('#dc2626');
  });

  it('separates the Credits treatment from Action Button variants', () => {
    const { container, queryByText } = render(<Studio />);
    openButtons(container);

    expect(container.querySelectorAll('.sds-button-picker [role="radio"]')).toHaveLength(6);
    expect(queryByText('Credits')).toBeNull();

    const backToButtons = [...container.querySelectorAll<HTMLElement>('.sds-crumbs button')]
      .find(button => button.textContent.trim() === 'Buttons');
    if (!backToButtons) throw new Error('No back to Buttons control is rendered');
    fireEvent.click(backToButtons);
    openButtonMember(container, 'Dropdown Button');
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

    expect(container.querySelector('.sds-button-settings__head strong')?.textContent).toBe('Try the Danger button');
    expect(container.querySelector('.sds-button-picker .is-on strong')?.textContent).toBe('Danger');
  });

  it('opens the Studio color picker for a component override', () => {
    const { container, getByRole } = render(<Studio />);
    openButtons(container);

    const backgroundLabel = [...container.querySelectorAll('label')]
      .find(label => label.textContent === 'Background');
    const backgroundField = backgroundLabel?.closest('.sds-edit-field');
    const backgroundThemeToggle = backgroundField?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!backgroundThemeToggle) throw new Error('Expected the Background theme toggle');
    fireEvent.click(backgroundThemeToggle);
    fireEvent.click(getByRole('button', { name: 'Choose Background color' }));

    expect(getByRole('group', { name: 'Background color picker' })).toBeTruthy();
    fireEvent.input(getByRole('textbox', { name: 'Hex color' }), { target: { value: '#dc2626' } });
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
    fireEvent.input(getByRole('textbox', { name: 'Hex color' }), { target: { value: '#dc2626' } });
    expect(container.querySelector('.sds-button-preview__single .ui-btn-label')?.textContent).toBe('Cancel');
    expect(container.querySelector('.sds-button-preview__single .sds-preview-icon--filled-circle')).not.toBeNull();
    const previewIcon = container.querySelector<HTMLElement>('.sds-button-preview__single .sds-preview-icon');
    expect(previewIcon?.style.color).toBe('rgb(220, 38, 38)');

    fireEvent.click(getByRole('radio', { name: /Primary/ }));
    expect(getByRole('button', { name: 'Choose Icon color' }).textContent).toContain('#ffffff');
    expect(getByRole('button', { name: 'Clear Trailing icon' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Clear Trailing icon' }));
    expect(getByRole('button', { name: 'Choose Trailing icon' }).textContent).toContain('No icon');
    expect(container.querySelector('.sds-publish__status')?.textContent).not.toContain('draft change');
  });

  it('uses one Button-family publishing surface and links compound editors to it', () => {
    const { container, getByRole, queryByText } = render(<Studio />);
    openButtonBrowser(container);
    openButtonMember(container, 'Dropdown Button');

    expect(container.querySelectorAll('.sds-publish')).toHaveLength(1);
    expect(container.querySelector('.sds-owned-button__settings .sds-button-settings__actions')).toBeNull();
    expect(getByRole('button', { name: 'Review & publish' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Change shape and colors' }));

    expect(container.querySelector('.sds-button-settings__head')?.textContent).toContain('Preview settings');
    expect(getByRole('button', { name: 'Review & publish' })).toBeTruthy();
    expect(queryByText('Preview example')).toBeNull();
    expect(getByRole('heading', { name: 'Preview options' })).toBeTruthy();
  });

  it('keeps generic preview options and state isolated by variant', () => {
    const { container, getByLabelText, getByRole } = render(<Studio />);
    const textInputNav = [...container.querySelectorAll<HTMLButtonElement>('.sds-nav button')]
      .find(button => button.textContent.trim() === 'TextInput');
    if (!textInputNav) throw new Error('No TextInput navigation item is rendered');
    fireEvent.click(textInputNav);

    const placeholder = getByLabelText('Placeholder') as HTMLInputElement;
    fireEvent.input(placeholder, { target: { value: 'Text-only placeholder' } });

    fireEvent.click(getByRole('radio', { name: 'Search' }));
    expect((getByLabelText('Placeholder') as HTMLInputElement).value).toBe('e.g. Sarah James');
    expect(getByRole('button', { name: 'Choose Leading icon' }).textContent).toContain('Search');
    fireEvent.input(getByLabelText('Placeholder'), { target: { value: 'Search-only placeholder' } });

    fireEvent.click(getByRole('radio', { name: 'Text' }));
    expect((getByLabelText('Placeholder') as HTMLInputElement).value).toBe('Text-only placeholder');

    fireEvent.click(getByRole('button', { name: 'Reset' }));
    expect((getByLabelText('Placeholder') as HTMLInputElement).value).toBe('e.g. Sarah James');
    fireEvent.click(getByRole('radio', { name: 'Search' }));
    expect((getByLabelText('Placeholder') as HTMLInputElement).value).toBe('Search-only placeholder');

    const expectedIcons: Record<string, string> = {
      Password: 'LockKeyhole', Email: 'Mail', URL: 'Link',
    };
    for (const [variant, icon] of Object.entries(expectedIcons)) {
      fireEvent.click(getByRole('radio', { name: variant }));
      expect(getByRole('button', { name: 'Choose Leading icon' }).textContent).toContain(icon);
    }
  });

  it('shows preview controls directly and collapses only Component style', () => {
    const { container, queryByText } = render(<Studio />);
    const textInputNav = [...container.querySelectorAll<HTMLButtonElement>('.sds-nav button')]
      .find(button => button.textContent.trim() === 'TextInput');
    if (!textInputNav) throw new Error('No TextInput navigation item is rendered');
    fireEvent.click(textInputNav);

    expect(queryByText('More preview options')).toBeNull();
    expect(container.querySelector('.sds-button-settings__body [aria-label="Choose Leading icon"]')).not.toBeNull();
    const componentStyle = container.querySelector<HTMLDetailsElement>('.sds-button-settings__style');
    expect(componentStyle).not.toBeNull();
    expect(componentStyle?.open).toBe(false);
    expect(componentStyle?.querySelector('summary')?.textContent).toContain('Component style');
  });

  it('keeps recipe edits on the selected Button variant', () => {
    const { container, getAllByLabelText, getByRole } = render(<Studio />);
    openButtons(container);

    const primaryHeightTheme = getAllByLabelText('Use brand theme')[0];
    if (!primaryHeightTheme) throw new Error('Expected Primary height theme control');
    expect(primaryHeightTheme.closest('.sds-edit-field')?.querySelector('.sds-edit-field__theme strong')?.textContent).toBe('40 px');
    fireEvent.click(primaryHeightTheme);
    const primaryHeight = container.querySelector<HTMLInputElement>('#style---ui-button-primary-height-md');
    if (!primaryHeight) throw new Error('Expected Primary height override input');
    expect(primaryHeight.type).toBe('number');
    expect(primaryHeight.value).toBe('40');
    expect((getByRole('combobox', { name: 'Button height unit' }) as HTMLSelectElement).value).toBe('px');
    fireEvent.input(primaryHeight, { target: { value: '44' } });

    const scope = container.querySelector<HTMLElement>('.sds-button-editor__main[data-ui-preview-scope]');
    expect(scope?.style.getPropertyValue('--ui-button-primary-height-md')).toBe('44px');
    expect(scope?.style.getPropertyValue('--ui-button-secondary-height-md')).toBe('');

    fireEvent.click(getByRole('radio', { name: /Secondary/ }));
    expect(container.querySelector('#style---ui-button-primary-height-md')).toBeNull();
    expect(container.querySelector('#style---ui-button-secondary-height-md')).toBeNull();
    expect(container.querySelector('.sds-publish__status')?.textContent).toContain('1 draft change');
    fireEvent.click(getByRole('button', { name: 'Review & publish' }));
    expect(getByRole('dialog', { name: 'Publish Studio changes?' })).toBeTruthy();
  });
});
