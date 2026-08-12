/**
 * src/ui/gallery/BrandThemePanel.test.tsx
 *
 * The workspace's contract with the rest of the system:
 *   • generating writes into the EXISTING draft (no second store)
 *   • it writes only brand-driven roles
 *   • it blocks publishing when a critical pairing fails, and allows it when
 *     they all pass
 *   • Reset removes what it added and leaves hand edits alone
 *
 * Extraction is not exercised here — it needs a canvas, which jsdom does not
 * implement. Its ranking is covered against real pixel buffers in
 * theme/brand/brandTheme.test.ts, which is the honest place for it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/preact';
import { type VNode } from 'preact';
import { BrandThemePanel } from './BrandThemePanel';
import { useGalleryDraft, type GalleryDraft } from './galleryStore';
import { BRAND_LOCKED_ROLES, SEMANTIC_TOKEN_NAMES } from '../theme/semanticTokens';
import { SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN } from '../theme/brand/brandTheme';

vi.mock('@api/theme', () => ({
  saveThemeTokens: (_m: Record<string, string>) => Promise.resolve(),
  loadThemeTokens: () => Promise.resolve({}),
}));

/**
 * The locked roles the engine never writes. jsdom does not resolve custom
 * properties from stylesheets, so without these every pairing measured against
 * a surface would score 0 and the panel would look permanently blocked for the
 * wrong reason.
 */
const NEUTRALS: Record<string, string> = {
  '--ui-color-surface-default': '#FFFFFF',
  '--ui-color-surface-page': '#F0F4F8',
  '--ui-color-text-primary': '#1F2A44',
  // Roles the enterprise policy keeps neutral — the engine never writes them, so
  // in the browser they come from the stylesheet. jsdom needs them supplied or
  // the pairings measured against the rail have nothing to measure against.
  '--ui-color-action-secondary': '#1b2d54',
  '--ui-color-action-secondary-text': '#ffffff',
  '--ui-color-nav-background': '#1b2d54',
  '--ui-color-nav-text': '#8d9cb7',
};

function mountPanel(seedNeutrals = true, opts: { onUploadLogo?: (d: string) => Promise<string> } = {}) {
  let draft!: GalleryDraft;
  function Harness(): VNode {
    draft = useGalleryDraft();
    return (
      <div ref={draft.attachScope}>
        <BrandThemePanel draft={draft} logoUrl={null} onUploadLogo={opts.onUploadLogo} />
      </div>
    );
  }
  const utils = render(<Harness />);
  if (seedNeutrals) {
    void act(() => { Object.entries(NEUTRALS).forEach(([k, v]) => draft.set(k, v)); });
  }
  return { ...utils, draft: () => draft };
}

/** Type a hex into a seed field. */
function setSeed(container: HTMLElement, label: string, hex: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`no field labelled ${label}`);
  fireEvent.input(input, { target: { value: hex } });
}

describe('Brand Theme workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('renders both generated scales and the semantic mapping', () => {
    const { container } = mountPanel();
    expect(container.querySelectorAll('.ui-brand-scale')).toHaveLength(2);
    expect(container.querySelectorAll('.ui-brand-scale-cell').length).toBe(22);   // 11 steps × 2
    expect(container.textContent).toContain('action-primary');
    expect(container.textContent).toContain('nav-background');
  });

  it('writes the generated theme into the shared draft, not a store of its own', () => {
    const { container, draft } = mountPanel();
    void act(() => { setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E'); });

    const values = draft().values;
    expect(values['--ui-color-action-primary']).toBeTruthy();
    expect(values['--ui-brand-primary-500']).toBeTruthy();
    expect(values[SEED_PRIMARY_TOKEN]).toBe('#0F766E');
  });

  it('writes only declared, brand-driven roles', () => {
    const { container, draft } = mountPanel(false);
    void act(() => { setSeed(container as HTMLElement, 'Accent seed hex', '#3B0764'); });

    const written = Object.keys(draft().values).filter(k => k.startsWith('--ui-color-'));
    expect(written.length).toBeGreaterThan(0);
    for (const role of written) expect(SEMANTIC_TOKEN_NAMES).toContain(role);
    for (const locked of BRAND_LOCKED_ROLES) expect(written).not.toContain(locked.name);
  });

  it('the draft edit lands on the preview scope and never on :root', () => {
    const { container, draft } = mountPanel();
    void act(() => { setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E'); });

    const scope = container.querySelector<HTMLElement>('[style]')!;
    expect(scope.style.getPropertyValue('--ui-color-action-primary'))
      .toBe(draft().values['--ui-color-action-primary']);
    expect(document.documentElement.style.getPropertyValue('--ui-color-action-primary')).toBe('');
  });

  it('allows publishing when every critical pairing passes', () => {
    const { container } = mountPanel();
    void act(() => { setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E'); });

    expect(container.textContent).not.toContain('critical contrast');
    expect(publishButton(container as HTMLElement).disabled).toBe(false);
  });

  it('blocks publishing when a critical pairing cannot be measured', () => {
    // No neutrals seeded → link and selection are judged against an unresolvable
    // surface. An unmeasurable pairing must never read as a pass.
    const { container } = mountPanel(false);
    void act(() => { setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E'); });

    expect(container.textContent).toContain('critical contrast');
    expect(publishButton(container as HTMLElement).disabled).toBe(true);
  });

  it('blocks publishing when the navigation pair fails outright', () => {
    const { container, draft } = mountPanel();
    void act(() => { setSeed(container as HTMLElement, 'Accent seed hex', '#3B0764'); });
    // Break the rail deliberately: white background under the generated dim text.
    void act(() => { draft().set('--ui-color-nav-background', '#FFFFFF'); });

    expect(container.textContent).toContain('critical contrast');
    expect(publishButton(container as HTMLElement).disabled).toBe(true);
  });

  it('Reset removes the brand it wrote and leaves unrelated draft edits alone', () => {
    const { container, draft } = mountPanel();
    void act(() => { draft().set('--siomac-gold', '#123456'); });
    void act(() => { setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E'); });
    expect(draft().values['--ui-color-action-primary']).toBeTruthy();

    void act(() => { fireEvent.click(byText(container as HTMLElement, 'button', 'Reset')); });

    expect(draft().values['--ui-color-action-primary']).toBeUndefined();
    expect(draft().values['--ui-brand-primary-500']).toBeUndefined();
    expect(draft().values[SEED_PRIMARY_TOKEN]).toBeUndefined();
    expect(draft().values['--siomac-gold']).toBe('#123456');
  });

  it('keeps both seeds when they are edited in the same tick', () => {
    // Regression: `apply` read the seeds from its closure, so setting the accent
    // straight after the primary merged into the PRE-primary value and reverted
    // it. Two edits, one survivor — invisible until you changed both in a row.
    const { container, draft } = mountPanel();
    void act(() => {
      setSeed(container as HTMLElement, 'Primary seed hex', '#0F766E');
      setSeed(container as HTMLElement, 'Accent seed hex', '#3B0764');
    });

    expect(draft().values[SEED_PRIMARY_TOKEN]).toBe('#0F766E');
    expect(draft().values[SEED_ACCENT_TOKEN]).toBe('#3B0764');
  });

  it('routes “Save as company logo” through the injected branding endpoint', async () => {
    // The workspace must not grow its own upload path — it hands the data URI to
    // the host, which owns the existing branding endpoint. The endpoint's own
    // wire contract is pinned in Settings/uploadLogoContract.test.ts.
    const onUploadLogo = vi.fn((_dataUrl: string) => Promise.resolve('https://cdn.example/branding/company_logo_9.png'));
    const { container } = mountPanel(true, { onUploadLogo });

    await selectLogoFile(container as HTMLElement);
    expect(onUploadLogo).not.toHaveBeenCalled();   // choosing a file must not publish it

    await act(async () => {
      fireEvent.click(byText(container as HTMLElement, 'button', 'Save as company logo'));
      await Promise.resolve();
    });

    expect(onUploadLogo).toHaveBeenCalledTimes(1);
    expect(onUploadLogo.mock.calls[0]?.[0]).toMatch(/^data:image\/gif;base64,/);

    // The persisted URL replaces the local preview, so a reload shows the same
    // image the rest of the app now serves.
    const img = container.querySelector<HTMLImageElement>('.ui-brand-logo-frame img');
    expect(img?.src).toBe('https://cdn.example/branding/company_logo_9.png');
    // Saved — so the panel stops offering to save it again.
    expect(() => byText(container as HTMLElement, 'button', 'Save as company logo')).toThrow();
  });

  it('reports a failed logo save instead of pretending it persisted', async () => {
    const onUploadLogo = vi.fn((_dataUrl: string) => Promise.reject(new Error('Validation error: imageBase64: Required')));
    const { container } = mountPanel(true, { onUploadLogo });

    await selectLogoFile(container as HTMLElement);
    await act(async () => {
      fireEvent.click(byText(container as HTMLElement, 'button', 'Save as company logo'));
      await Promise.resolve();
    });

    expect(container.querySelector('.ui-brand-error')?.textContent).toContain('imageBase64');
  });

  it('reports every pairing with a measured ratio, not a bare verdict', () => {
    const { container } = mountPanel();
    const ratios = [...container.querySelectorAll('.ui-brand-table')]
      .flatMap(t => [...t.querySelectorAll('td code')])
      .map(c => c.textContent)
      .filter(t => t.endsWith(':1'));
    expect(ratios.length).toBeGreaterThan(0);
    for (const r of ratios) expect(r).toMatch(/^\d+(\.\d+)?:1$/);
  });
});

/**
 * Choose a logo file. jsdom has no canvas, so extraction cannot run here — the
 * file is still captured as `pendingFile`, which is the part this exercises.
 * Ranking is covered against real pixel buffers in theme/brand/brandTheme.test.ts.
 */
async function selectLogoFile(container: HTMLElement): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('.ui-brand-file input');
  if (input === null) throw new Error('no logo file input');
  const file = new File([Uint8Array.from([0x47, 0x49, 0x46, 0x38])], 'logo.gif', { type: 'image/gif' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    // A NATIVE dispatch, not `fireEvent.change`: testing-library's helper sets
    // `target.value` on the way through, which a file input rejects, so the
    // event never reaches Preact's handler and the whole flow silently no-ops.
    // A real file picker dispatches exactly this.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // FileReader.onload is a macrotask and the state it sets lands in a second
    // render — flush a real timer, not just a microtask.
    await new Promise(r => setTimeout(r, 20));
  });
}

function publishButton(container: HTMLElement): HTMLButtonElement {
  return byText(container, 'button', 'Apply & publish') as HTMLButtonElement;
}

function byText(container: HTMLElement, selector: string, text: string): HTMLElement {
  const el = [...container.querySelectorAll<HTMLElement>(selector)]
    .find(n => n.textContent.trim().includes(text));
  if (!el) throw new Error(`no ${selector} containing "${text}"`);
  return el;
}
