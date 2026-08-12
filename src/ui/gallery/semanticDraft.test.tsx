/**
 * src/ui/gallery/semanticDraft.test.tsx
 *
 * Proves the semantic tokens ride the EXISTING draft → preview → Apply
 * mechanism rather than a second one built beside it.
 *
 * The three properties that matter, and why:
 *   1. a draft edit lands on the preview scope        — so you can experiment
 *   2. `:root` is untouched while drafting            — so experimenting does
 *                                                       not re-theme the app
 *                                                       for the user (the exact
 *                                                       defect the draft layer
 *                                                       was built to fix)
 *   3. Apply promotes to `:root` + `app_theme`        — so publishing is the
 *                                                       only thing that ships
 *
 * The `@api/theme` module is mocked because this asserts the STORE's contract
 * with persistence (what it sends, and that it merges rather than replaces),
 * not the HTTP route — which the theme endpoint's own tests own.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/preact';
import { type VNode } from 'preact';
import { useGalleryDraft, type GalleryDraft } from './galleryStore';
import { SEMANTIC_TOKEN_NAMES } from '../theme/semanticTokens';

const saveThemeTokens = vi.fn((_map: Record<string, string>) => Promise.resolve());
const loadThemeTokens = vi.fn(() => Promise.resolve({ '--siomac-gold': '#FFB712' }));
vi.mock('@api/theme', () => ({
  saveThemeTokens: (m: Record<string, string>) => saveThemeTokens(m),
  loadThemeTokens: () => loadThemeTokens(),
}));

/** Mount the hook and hand back its live value plus the scope element. */
function mountDraft(): { draft: () => GalleryDraft; scope: HTMLElement } {
  let latest!: GalleryDraft;
  function Harness(): VNode {
    const draft = useGalleryDraft();
    latest = draft;
    return <div data-testid="scope" ref={draft.attachScope} />;
  }
  // Query the element out of THIS render's own container, not the document:
  // the reload test mounts a second harness while the first is still attached,
  // and a document-wide query would find both and throw.
  const { container } = render(<Harness />);
  const scope = container.querySelector<HTMLElement>('[data-testid="scope"]');
  if (scope === null) throw new Error('preview scope did not mount');
  return { draft: () => latest, scope };
}

const ACTION_PRIMARY = '--ui-color-action-primary';
const NAV_BG         = '--ui-color-nav-background';
const BORDER         = '--ui-color-border-default';

describe('semantic tokens in the draft layer', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    saveThemeTokens.mockClear();
    loadThemeTokens.mockClear();
  });

  it('every semantic role is draft-editable', () => {
    const { draft, scope } = mountDraft();
    void act(() => { SEMANTIC_TOKEN_NAMES.forEach((n, i) => draft().set(n, `rgb(${i}, 0, 0)`)); });

    for (const [i, name] of SEMANTIC_TOKEN_NAMES.entries()) {
      expect(scope.style.getPropertyValue(name), name).toBe(`rgb(${i}, 0, 0)`);
    }
    expect(draft().dirtyCount).toBe(SEMANTIC_TOKEN_NAMES.length);
  });

  it('an action-primary edit lands on the preview scope, not on :root', () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(ACTION_PRIMARY, '#0F766E'); });

    expect(scope.style.getPropertyValue(ACTION_PRIMARY)).toBe('#0F766E');
    expect(document.documentElement.style.getPropertyValue(ACTION_PRIMARY)).toBe('');
  });

  it('a navigation edit lands on the preview scope, not on :root', () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(NAV_BG, '#101828'); });

    expect(scope.style.getPropertyValue(NAV_BG)).toBe('#101828');
    expect(document.documentElement.style.getPropertyValue(NAV_BG)).toBe('');
  });

  it('a border edit lands on the preview scope, not on :root', () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(BORDER, '#123456'); });

    expect(scope.style.getPropertyValue(BORDER)).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue(BORDER)).toBe('');
  });

  it('reverting one role leaves the others drafted', () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(ACTION_PRIMARY, '#0F766E'); draft().set(NAV_BG, '#101828'); });
    void act(() => { draft().revert(ACTION_PRIMARY); });

    expect(scope.style.getPropertyValue(ACTION_PRIMARY)).toBe('');
    expect(scope.style.getPropertyValue(NAV_BG)).toBe('#101828');
  });

  it('resetAll clears every drafted role from the scope', () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(ACTION_PRIMARY, '#0F766E'); draft().set(BORDER, '#123456'); });
    void act(() => { draft().resetAll(); });

    expect(scope.style.getPropertyValue(ACTION_PRIMARY)).toBe('');
    expect(scope.style.getPropertyValue(BORDER)).toBe('');
    expect(draft().dirtyCount).toBe(0);
  });

  it('a draft survives a reload without ever being published', () => {
    const first = mountDraft();
    void act(() => { first.draft().set(ACTION_PRIMARY, '#0F766E'); });

    const second = mountDraft();   // fresh mount = the reload
    expect(second.scope.style.getPropertyValue(ACTION_PRIMARY)).toBe('#0F766E');
    expect(document.documentElement.style.getPropertyValue(ACTION_PRIMARY)).toBe('');
    expect(saveThemeTokens).not.toHaveBeenCalled();
  });

  it('Apply promotes the draft to :root and persists it, merged with what is published', async () => {
    const { draft, scope } = mountDraft();
    void act(() => { draft().set(ACTION_PRIMARY, '#0F766E'); draft().set(NAV_BG, '#101828'); });

    await act(async () => { await draft().publish(); });

    // Persisted — and the untouched published token survived the merge rather
    // than being wiped by a whole-map overwrite.
    expect(saveThemeTokens).toHaveBeenCalledWith({
      '--siomac-gold': '#FFB712',
      [ACTION_PRIMARY]: '#0F766E',
      [NAV_BG]: '#101828',
    });
    // Promoted to the document, so the whole app now sees it…
    expect(document.documentElement.style.getPropertyValue(ACTION_PRIMARY)).toBe('#0F766E');
    // …and the draft is empty, so "dirty" stays honest.
    expect(scope.style.getPropertyValue(ACTION_PRIMARY)).toBe('');
    expect(draft().dirtyCount).toBe(0);
  });
});
