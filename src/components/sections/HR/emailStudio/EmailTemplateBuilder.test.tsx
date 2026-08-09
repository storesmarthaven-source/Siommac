import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlankEmailDocument, createEmailBlock, createEmailSection, createStarterEmailDocument } from '@lib/emailTemplateDocument';
import type { EmailTemplateDraft } from '../../../../../types/emailTemplates';

const { saveDraft, uploadAsset, applyChrome } = vi.hoisted(() => ({
  saveDraft: vi.fn((value: unknown) => Promise.resolve(value)),
  uploadAsset: vi.fn(),
  applyChrome: vi.fn(() =>
    Promise.resolve({
      chrome: { header: [], footer: [], updatedAt: '', updatedBy: '' },
      syncedTemplateIds: [],
      skippedTemplateIds: [],
    }),
  ),
}));

vi.mock('@api/hr/emailTemplates', () => ({
  useUpdateEmailTemplateDraft: () => ({ mutateAsync: saveDraft }),
  useUpdateEmailChrome: () => ({ mutateAsync: applyChrome, isPending: false }),
  useSavedSections: () => ({ data: [], isLoading: false }),
  useCreateSavedSection: () => ({ mutateAsync: vi.fn() }),
  useDeleteSavedSection: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@api/hr/emailTemplateAssets', () => ({
  uploadEmailTemplateAsset: uploadAsset,
}));

import { EmailTemplateBuilder } from './EmailTemplateBuilder';

function template(status: EmailTemplateDraft['status'] = 'draft'): EmailTemplateDraft {
  const first = createEmailBlock('paragraph');
  first.name = 'First paragraph';
  first.properties.html = 'First message';
  const second = createEmailBlock('paragraph');
  second.name = 'Second paragraph';
  second.properties.html = 'Second message';
  const document = createBlankEmailDocument();
  document.blocks = [createEmailSection([first]), createEmailSection([second])];
  return {
    id: 'template-1',
    key: 'test-template',
    name: 'Test Template',
    description: null,
    family: 'onboarding',
    triggerKey: 'onboarding.case_created',
    triggerLabel: 'Case created',
    audience: 'Employee',
    language: 'English',
    businessUnitLabel: 'Company default',
    ownerLabel: 'HR Operations',
    status,
    approvalState: status === 'published' ? 'approved' : 'not_submitted',
    currentVersion: 1,
    activeUsageCount: status === 'published' ? 1 : 0,
    protected: false,
    updatedAt: '2026-08-02T12:00:00.000Z',
    subject: 'Welcome',
    preheader: 'Your onboarding starts here',
    editorSchema: document,
    compiledHtml: '',
    compiledText: '',
  };
}

afterEach(() => {
  cleanup();
  saveDraft.mockClear();
  uploadAsset.mockReset();
});

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: (format?: string) => format ? values.delete(format) : values.clear(),
    getData: format => values.get(format) ?? '',
    setData: (format, value) => { values.set(format, value); },
    setDragImage: () => undefined,
  };
}

describe('EmailTemplateBuilder editing controls', () => {
  it('uses page properties as the no-selection inspector and edits message metadata there', () => {
    const { container } = render(<EmailTemplateBuilder template={template()} onBack={vi.fn()} onToast={vi.fn()} />);

    const inspector = container.querySelector<HTMLElement>('.etb-inspector')!;
    expect(inspector.textContent).toContain('Page properties');
    expect(inspector.textContent).toContain('Email details');
    expect(inspector.textContent).toContain('Canvas');
    expect(inspector.textContent).toContain('Typography');

    const subjectInput = Array.from(inspector.querySelectorAll<HTMLInputElement>('input')).find(input => input.value === 'Welcome')!;
    fireEvent.input(subjectInput, { target: { value: 'Welcome to SIOMAC' } });
    expect(subjectInput.value).toBe('Welcome to SIOMAC');

    const firstBlock = container.querySelector<HTMLElement>('[data-block-id]')!;
    fireEvent.click(firstBlock);
    expect(inspector.textContent).not.toContain('Page properties');
    fireEvent.click(screen.getByRole('button', { name: 'Close properties' }));
    expect(inspector.textContent).toContain('Page properties');
  });

  it('explains published immutability and offers a real editable-copy action', () => {
    const onCreateEditableCopy = vi.fn();
    render(<EmailTemplateBuilder template={template('published')} onBack={vi.fn()} onToast={vi.fn()} onCreateEditableCopy={onCreateEditableCopy} />);

    expect(screen.getByText('This published version is read-only.')).toBeTruthy();
    const copy = screen.getByRole('button', { name: /Create Editable Copy/i });
    fireEvent.click(copy);
    expect(onCreateEditableCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add Heading' }).disabled).toBe(true);
  });

  it('keeps selection actions contextual and makes lock a genuine edit guard', () => {
    const row = template();
    const paragraph = row.editorSchema.blocks[0]!.children[0]!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    const block = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"]`)!;

    fireEvent.click(block);
    // Canvas chrome carries drag/duplicate/delete; hide and lock live in the inspector header.
    const chrome = block.querySelector<HTMLElement>(':scope > .etb-block-chrome')!;
    expect(chrome.querySelector(`[aria-label="Drag ${paragraph.name}"]`)).toBeTruthy();
    expect(chrome.querySelector(`[aria-label="Duplicate ${paragraph.name}"]`)).toBeTruthy();

    const inspector = container.querySelector<HTMLElement>('.etb-inspector')!;
    const hide = inspector.querySelector<HTMLButtonElement>('[aria-label="Hide selection"]')!;
    fireEvent.click(hide);
    expect(block.classList.contains('hidden-block')).toBe(true);

    fireEvent.click(inspector.querySelector<HTMLButtonElement>('[aria-label="Lock selection"]')!);
    expect(screen.queryByRole('button', { name: 'Resize selection' })).toBeNull();
    expect(
      block.querySelector<HTMLButtonElement>(`[aria-label="Duplicate ${paragraph.name}"]`)!.disabled,
    ).toBe(true);

    fireEvent.click(inspector.querySelector<HTMLButtonElement>('[aria-label="Unlock selection"]')!);
    expect(screen.getByRole('button', { name: 'Resize selection' })).toBeTruthy();
  });

  it('edits square corners, transparent backgrounds, inner padding, and outer spacing independently', () => {
    const row = template();
    const paragraph = row.editorSchema.blocks[0]!.children[0]!;
    paragraph.styles.backgroundColor = '#ffffff';
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"]`)!);

    // Every numeric control in the inspector is a slider.
    const radiusLabel = screen.getByRole<HTMLInputElement>('slider', { name: 'Rounded corners' }).closest('label')!;
    fireEvent.input(radiusLabel.querySelector<HTMLInputElement>('input[type="range"]')!, { target: { value: '14' } });
    expect(radiusLabel.textContent).toContain('14px');

    const backgroundLabel = screen.getByText('Background').closest('label')!;
    fireEvent.click(backgroundLabel.querySelector<HTMLButtonElement>('.etb-color-trigger')!);
    fireEvent.click(screen.getByRole('button', { name: 'Use transparent background' }));
    fireEvent.click(backgroundLabel.querySelector<HTMLButtonElement>('.etb-color-trigger')!);
    expect(backgroundLabel.querySelector('.etb-color-chip.is-transparent')).toBeTruthy();

    fireEvent.input(screen.getByRole('slider', { name: 'Inner spacing' }), { target: { value: '0' } });
    const content = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.parentElement!;
    expect(content.style.padding).toBe('0px');

    fireEvent.input(screen.getByRole('slider', { name: 'Outer spacing' }), { target: { value: '18' } });
    const slot = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"]`)!.parentElement!;
    expect(slot.style.getPropertyValue('--etb-space-top')).toBe('18px');
  });

  it('moves, duplicates, deletes, undoes, and redoes without deleting the parent section', () => {
    const row = template();
    const firstSection = row.editorSchema.blocks[0]!;
    const firstParagraph = firstSection.children[0]!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${firstSection.id}"]`)!);
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    const rootBlocks = container.querySelectorAll<HTMLElement>('.etb-canvas-slot > .etb-canvas-block');
    expect(rootBlocks[1]?.dataset.blockId).toBe(firstSection.id);

    const paragraphBlock = container.querySelector<HTMLElement>(`[data-block-id="${firstParagraph.id}"]`)!;
    fireEvent.click(paragraphBlock);
    fireEvent.click(paragraphBlock.querySelector<HTMLButtonElement>(`[aria-label="Duplicate ${firstParagraph.name}"]`)!);
    expect(container.querySelectorAll('.etb-editable-copy')).toHaveLength(3);

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(container.querySelectorAll('.etb-editable-copy')).toHaveLength(2);
    expect(container.querySelector(`[data-block-id="${firstSection.id}"]`)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(container.querySelectorAll('.etb-editable-copy')).toHaveLength(3);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(container.querySelectorAll('.etb-editable-copy')).toHaveLength(2);
  });

  it('updates canvas text immediately and opens formatting beside the canvas editor', async () => {
    const row = template();
    const paragraph = row.editorSchema.blocks[0]!.children[0]!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    const canvasEditor = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!;
    canvasEditor.focus();
    canvasEditor.innerHTML = '<em>Canvas change</em>';
    fireEvent.input(canvasEditor);

    expect(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.innerHTML).toContain('Canvas change');
    expect(container.querySelector('.etb-inspector .etb-rich-surface')).toBeNull();
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy());
  });

  it('applies horizontal and vertical alignment with visible icon controls', () => {
    const row = template();
    const section = row.editorSchema.blocks[0]!;
    const paragraph = section.children[0]!;
    paragraph.properties.minHeight = 180;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${section.id}"]`)!);

    fireEvent.click(screen.getByRole('button', { name: 'Middle align' }));
    const sectionLayout = container.querySelector<HTMLElement>(`[data-block-id="${section.id}"] .etb-layout-block.single`)!;
    expect(sectionLayout.style.justifyContent).toBe('center');
    expect(screen.getByRole('button', { name: 'Middle align' }).querySelector('svg')).toBeTruthy();

    const alignment = screen.getByText('Alignment').closest('label')!;
    expect(alignment.querySelectorAll('button')).toHaveLength(3);

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'Bottom align' }));
    const paragraphBody = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] > .etb-canvas-body`)!;
    expect(paragraphBody.style.minHeight).toBe('180px');
    expect(paragraphBody.style.justifyContent).toBe('flex-end');
    expect(screen.queryByText('Alignment')).toBeNull();
  });

  it('shows active formatting state and keeps typography controls inside the text toolbar', async () => {
    const row = template();
    const paragraph = row.editorSchema.blocks[0]!.children[0]!;
    paragraph.properties.html = '<strong>Bold copy</strong>';
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"]`)!);
    container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.focus();
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy());
    const editor = container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!;
    const text = editor.querySelector('strong')?.firstChild;
    expect(text).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(text!);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('combobox', { name: 'Font family' })).toBeNull();
    // One size field: type any value directly, or pick a preset from the chevron menu.
    const size = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Text size' });
    fireEvent.input(size, { target: { value: '19' } });
    expect(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.parentElement!.style.fontSize).toBe('19px');
    fireEvent.click(screen.getByRole('button', { name: 'Text size presets' }));
    fireEvent.click(screen.getByRole('option', { name: '24px' }));
    expect(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.parentElement!.style.fontSize).toBe('24px');
    expect(screen.queryByLabelText('Link colour')).toBeNull();
    const colourGroup = container.querySelector<HTMLElement>('.etb-floating-colour-group')!;
    fireEvent.click(colourGroup.querySelector<HTMLButtonElement>('.etb-color-trigger')!);
    const colour = colourGroup.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colour.value.toUpperCase()).toBe('#24314D');
    fireEvent.input(colour, { target: { value: '#123456' } });
    expect(container.querySelector<HTMLElement>(`[data-block-id="${paragraph.id}"] .etb-editable-copy`)!.parentElement!.style.color).toBe('rgb(18, 52, 86)');
  });

  it('drags a palette block into the document and reorders existing sections', () => {
    const row = template();
    const firstSection = row.editorSchema.blocks[0]!;
    const transfer = dataTransfer();
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    fireEvent.dragStart(screen.getByRole('button', { name: 'Add Heading' }), { dataTransfer: transfer });
    const rootGuides = container.querySelectorAll<HTMLElement>('.etb-email-canvas > .etb-drop-guide, .etb-email-canvas > .etb-canvas-slot > .etb-drop-guide');
    const finalGuide = rootGuides[rootGuides.length - 1]!;
    fireEvent.dragEnter(finalGuide, { dataTransfer: transfer });
    fireEvent.drop(finalGuide, { dataTransfer: transfer });
    expect(container.querySelectorAll('.etb-canvas-slot > .etb-canvas-block')).toHaveLength(3);
    expect(screen.getAllByText('Heading').length).toBeGreaterThan(0);

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${firstSection.id}"]`)!);
    const moveTransfer = dataTransfer();
    const sectionBlock = container.querySelector<HTMLElement>(`[data-block-id="${firstSection.id}"]`)!;
    fireEvent.dragStart(sectionBlock.querySelector<HTMLButtonElement>(`:scope > .etb-block-chrome [aria-label="Drag ${firstSection.name}"]`)!, { dataTransfer: moveTransfer });
    const guidesAfterDrag = container.querySelectorAll<HTMLElement>('.etb-email-canvas > .etb-drop-guide, .etb-email-canvas > .etb-canvas-slot > .etb-drop-guide');
    const lastGuide = guidesAfterDrag[guidesAfterDrag.length - 1]!;
    fireEvent.dragEnter(lastGuide, { dataTransfer: moveTransfer });
    fireEvent.drop(lastGuide, { dataTransfer: moveTransfer });
    const rootBlocks = container.querySelectorAll<HTMLElement>('.etb-canvas-slot > .etb-canvas-block');
    expect(rootBlocks[rootBlocks.length - 1]?.dataset.blockId).toBe(firstSection.id);
  });

  it('adds palette content to the selected shared section instead of creating another container', () => {
    const row = template();
    const section = row.editorSchema.blocks[0]!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${section.id}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'Add Heading' }));

    expect(container.querySelectorAll('.etb-canvas-slot > .etb-canvas-block')).toHaveLength(2);
    expect(container.querySelectorAll(`[data-block-id="${section.id}"] .etb-nested-slot`)).toHaveLength(2);
  });

  it('merges columns without losing their content and keeps an empty section quiet', () => {
    const row = template();
    const columns = createEmailBlock('columns');
    columns.name = 'Two columns';
    columns.properties.columns = 2;
    columns.properties.columnWidths = [50, 50];
    const leftCopy = createEmailBlock('paragraph');
    leftCopy.properties.html = 'Left content';
    const rightCopy = createEmailBlock('paragraph');
    rightCopy.properties.html = 'Right content';
    columns.children = [createEmailSection([leftCopy]), createEmailSection([rightCopy])];
    row.editorSchema.blocks = [columns, createEmailSection()];

    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${columns.id}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: /Merge to one column/i }));

    expect(container.querySelector('.etb-layout-block.columns')).toBeNull();
    expect(container.querySelector('.etb-layout-block.single')).toBeTruthy();
    expect(screen.getByText('Left content')).toBeTruthy();
    expect(screen.getByText('Right content')).toBeTruthy();
    expect(screen.queryByText('Build this section')).toBeNull();
    expect(screen.getByText('Drop content here')).toBeTruthy();
  });

  it('makes divider padding visible and supports a true edge-to-edge line', () => {
    const row = template();
    const divider = createEmailBlock('divider');
    const section = createEmailSection([divider]);
    row.editorSchema.blocks = [section];
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${divider.id}"]`)!);
    const frame = container.querySelector<HTMLElement>('.etb-divider-frame')!;
    expect(frame.style.padding).toBe('12px 28px');
    fireEvent.input(screen.getByRole('slider', { name: 'Inner spacing' }), { target: { value: '0' } });
    expect(frame.style.padding).toBe('0px');
  });

  it('ships the first-day overview as one Smart Block with editable tiles', () => {
    const row = template();
    row.editorSchema = createStarterEmailDocument('onboarding', 'onboarding.case_created');
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    // The CTA card stays a normal composed section beside the Smart Block.
    fireEvent.click(screen.getByTitle('Layers'));
    for (const name of ['First-day overview', 'Overview tiles', 'Call to action card', 'CTA heading', 'CTA supporting text', 'CTA button']) {
      expect(screen.getByRole('treeitem', { name: new RegExp(name) })).toBeTruthy();
    }

    const grid = container.querySelector<HTMLElement>('.etb-fact-grid')!;
    expect(grid.querySelectorAll('.etb-fact-tile')).toHaveLength(4);

    // Selecting it exposes the tile editor, not a wall of nested primitives.
    const gridBlock = grid.closest<HTMLElement>('[data-block-id]')!;
    fireEvent.click(gridBlock);
    expect(screen.getByRole('button', { name: 'Tile 1 icon' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Tile 1 label' })).toBeTruthy();

    fireEvent.input(screen.getByRole('textbox', { name: 'Tile 1 value' }), { target: { value: 'Monday 4 August' } });
    expect(grid.textContent).toContain('Monday 4 August');

    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }));
    expect(grid.querySelectorAll('.etb-fact-tile')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tile 5' }));
    expect(grid.querySelectorAll('.etb-fact-tile')).toHaveLength(4);
  });

  it('keeps the welcome button, photo and copy as independently selectable blocks', () => {
    const row = template();
    row.editorSchema = createStarterEmailDocument('onboarding', 'onboarding.case_created');
    const allBlocks = row.editorSchema.blocks.flatMap(function visit(block): typeof row.editorSchema.blocks {
      return [block, ...block.children.flatMap(visit)];
    });
    const button = allBlocks.find(block => block.name === 'Onboarding hub button')!;
    const photo = allBlocks.find(block => block.name === 'Employee profile photo')!;
    const title = allBlocks.find(block => block.name === 'Welcome title')!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    const buttonBlock = container.querySelector<HTMLElement>(`[data-block-id="${button.id}"]`)!;
    fireEvent.click(buttonBlock);
    expect(screen.getByText('Button label')).toBeTruthy();
    const label = buttonBlock.querySelector<HTMLElement>('.etb-editable-button-label')!;
    label.textContent = 'Begin onboarding';
    fireEvent.input(label);
    expect(screen.getByText('Button label').closest('label')!.querySelector<HTMLInputElement>('input')!.value).toBe('Begin onboarding');

    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${photo.id}"]`)!);
    expect(screen.getByText('Alternative text')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLElement>(`[data-block-id="${title.id}"]`)!);
    expect(container.querySelector<HTMLElement>(`[data-block-id="${title.id}"]`)!.classList.contains('selected')).toBe(true);
  });

  it('shows the complete section and content hierarchy in the Layers panel', () => {
    const row = template();
    const section = row.editorSchema.blocks[0]!;
    const child = section.children[0]!;
    const { container } = render(<EmailTemplateBuilder template={row} onBack={vi.fn()} onToast={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Layers'));
    expect(screen.getByRole('heading', { name: 'Layers' })).toBeTruthy();
    const treeItems = container.querySelectorAll('[role="treeitem"]');
    expect(treeItems.length).toBeGreaterThanOrEqual(4);
    const childLayer = Array.from(treeItems).find(item => item.textContent?.includes(child.name));
    expect(childLayer).toBeTruthy();
    fireEvent.click(childLayer!);
    expect(container.querySelector<HTMLElement>(`[data-block-id="${child.id}"]`)?.classList.contains('selected')).toBe(true);
    expect(screen.getByText(`Content in ${section.name}`)).toBeTruthy();
  });

});
