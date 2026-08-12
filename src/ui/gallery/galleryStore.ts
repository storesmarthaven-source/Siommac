/**
 * src/ui/gallery/galleryStore.ts — draft state for the workbench.
 *
 * Holds the DRAFT recipe/token overrides, separate from the published theme.
 *
 *   Published tokens  ── app_theme ──▶ :root                (every user)
 *   Gallery draft     ── inline    ──▶ [data-ui-preview-scope]  (this tab only)
 *   Apply             ── promotes ───▶ :root + app_theme
 *
 * The previous ThemeEditor wrote every change straight to `:root` and persisted
 * app-wide on save, so dragging a slider re-themed production for everyone. A
 * workbench cannot be a playground under those rules, which is why the draft
 * layer exists before any component was built on it.
 *
 * Drafts survive a reload via localStorage — half an hour of tuning must not be
 * lost to a refresh — but they are never sent anywhere until Apply.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  applyScopedOverrides, clearAllScopedOverrides, readScopedTokenValue,
  applyThemeOverrides, cacheTheme, type ThemeOverrides,
} from '../theme/applyTheme';

const DRAFT_KEY = 'siomac.uikit.draft';

export interface GalleryDraft {
  /** Current draft values, keyed by CSS custom property name. */
  values: ThemeOverrides;
  /** Number of variables changed from published. */
  dirtyCount: number;
  /** Read a variable as seen INSIDE the preview scope (draft value or inherited). */
  read: (name: string) => string;
  set: (name: string, value: string) => void;
  /**
   * Replace a whole GROUP of variables in one update: drop every name in
   * `owned`, then apply `values`.
   *
   * `set()` alone could not express "this generator no longer emits that token".
   * Regenerating a brand merged the new map over the old one, so a cleared
   * accent, or any role a newer mapping policy stopped writing, stayed in the
   * draft forever and kept painting the preview. The generator owns a namespace;
   * this is how it hands the whole namespace over at once.
   */
  replaceGroup: (owned: readonly string[], values: ThemeOverrides) => void;
  revert: (name: string) => void;
  resetAll: () => void;
  /** Publish the draft to `:root` + persist app-wide. */
  publish: () => Promise<void>;
  /** Ref CALLBACK for the preview scope element. */
  attachScope: (el: HTMLElement | null) => void;
  exportJson: () => string;
  exportCss: () => string;
  importJson: (json: string) => { ok: true; count: number } | { ok: false; error: string };
}

function readStoredDraft(): ThemeOverrides {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ThemeOverrides) : {};
  } catch { return {}; }
}

function storeDraft(values: ThemeOverrides): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(values)); } catch { /* private mode */ }
}

export function useGalleryDraft(): GalleryDraft {
  const [values, setValues] = useState<ThemeOverrides>(readStoredDraft);
  // The scope lives in STATE, not a ref: `read()` needs it during render to
  // report the value the user is actually looking at, and a ref's `.current` is
  // not a render-time value. Holding it in state also re-runs the apply effect
  // the moment the element mounts.
  const [scopeEl, setScopeEl] = useState<HTMLElement | null>(null);

  const attachScope = useCallback((el: HTMLElement | null) => { setScopeEl(el); }, []);

  // Re-apply the whole draft whenever it changes or the scope element appears.
  useEffect(() => {
    if (!scopeEl) return;
    clearAllScopedOverrides(scopeEl);
    applyScopedOverrides(scopeEl, values);
  }, [values, scopeEl]);

  useEffect(() => { storeDraft(values); }, [values]);

  const read = useCallback(
    (name: string) => values[name] ?? readScopedTokenValue(scopeEl, name),
    [values, scopeEl],
  );

  const set = useCallback((name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const replaceGroup = useCallback((owned: readonly string[], next: ThemeOverrides) => {
    setValues(prev => {
      const out = { ...prev };
      // One state update, so the preview never renders a half-swapped brand.
      for (const name of owned) Reflect.deleteProperty(out, name);
      return { ...out, ...next };
    });
  }, []);

  const revert = useCallback((name: string) => {
    setValues(prev => {
      const next = { ...prev };
      Reflect.deleteProperty(next, name);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    clearAllScopedOverrides(scopeEl);
    setValues({});
  }, [scopeEl]);

  const publish = useCallback(async () => {
    // Promote draft → published. The import is dynamic so the workbench does not
    // pull the theme API into every bundle that touches @ui.
    const { saveThemeTokens } = await import('@api/theme');
    const { loadThemeTokens } = await import('@api/theme');
    const existing = (await loadThemeTokens()) ?? {};
    const merged = { ...existing, ...values };
    await saveThemeTokens(merged);
    applyThemeOverrides(merged);
    cacheTheme(merged);
    // The draft is now the published value; clearing it keeps "dirty" honest.
    clearAllScopedOverrides(scopeEl);
    setValues({});
  }, [values, scopeEl]);

  const exportJson = useCallback(() => JSON.stringify(values, null, 2), [values]);

  const exportCss = useCallback(() => {
    const body = Object.entries(values).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    return `:root {\n${body}\n}`;
  }, [values]);

  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return { ok: false as const, error: 'Expected a JSON object.' };
      const clean: ThemeOverrides = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        // Only custom properties. Anything else would be silently ignored later,
        // which reads to the user as a successful import that did nothing.
        if (k.startsWith('--') && typeof v === 'string') clean[k] = v;
      }
      if (Object.keys(clean).length === 0) return { ok: false as const, error: 'No CSS custom properties found.' };
      setValues(clean);
      return { ok: true as const, count: Object.keys(clean).length };
    } catch {
      return { ok: false as const, error: 'Invalid JSON.' };
    }
  }, []);

  return {
    values,
    dirtyCount: Object.keys(values).length,
    read, set, replaceGroup, revert, resetAll, publish,
    attachScope,
    exportJson, exportCss, importJson,
  };
}
