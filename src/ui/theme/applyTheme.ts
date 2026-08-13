/**
 * src/ui/theme/applyTheme.ts
 *
 * Runtime theming: apply token overrides to the document root so the WHOLE app
 * re-themes instantly (every component + hover/focus state reads these vars).
 *
 * Persistence is app-wide via the dedicated `app_theme` table (see @api/theme):
 *   • boot:  apply the localStorage cache synchronously (no flash), then fetch
 *            the authoritative value from app_theme and re-apply + re-cache.
 *   • save:  admin/superadmin writes the override map back (audited server-side).
 *
 * Only CHANGED tokens are stored — an empty map means "use the base.css defaults".
 */

const LS_KEY = 'siomac.theme';
let appliedThemeNames = new Set<string>();

export type ThemeOverrides = Record<string, string>;

/** Set each override as an inline custom property on :root (wins over base.css). */
export function applyThemeOverrides(map: ThemeOverrides): void {
  const root = document.documentElement;
  for (const name of appliedThemeNames) if (!(name in map)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(map)) {
    if (value) root.style.setProperty(name, value);
  }
  appliedThemeNames = new Set(Object.keys(map));
}

/* ── Preview-scoped drafts (UI Kit v2) ───────────────────────────────────────
 *
 * Everything above writes to `:root`, which is correct for a PUBLISHED theme and
 * wrong for an interactive workbench: every slider drag would re-theme the live
 * app, and saving pushed it to every user. The Gallery needs a place to
 * experiment that is visible only inside its own canvas.
 *
 * The mechanism is the same one the cascade already gives us — custom properties
 * inherit, and a value set on an element beats the one it inherits from `:root`.
 * So a draft is just the same override map applied to a scope element instead of
 * the document root. Nothing about the components changes; they keep reading the
 * same variable names.
 *
 * This covers RECIPE variables (`--ui-button-primary-bg`) as well as foundation
 * tokens, because both are ordinary custom properties. One mechanism, both jobs.
 *
 *   Published ──▶ :root (all users, via app_theme)
 *   Draft     ──▶ [data-ui-preview-scope] (this tab only)
 *   Apply     ──▶ promotes draft to published
 */

/** The attribute the Gallery canvas carries; also the CSS hook for scoped rules. */
export const PREVIEW_SCOPE_ATTR = 'data-ui-preview-scope';

/**
 * Apply a draft override map to a scope element rather than `:root`.
 *
 * Values are set inline, so they beat any stylesheet rule targeting the same
 * element and are inherited by everything inside it. Passing an empty string
 * REMOVES the property — that is how the inspector reverts one control without
 * having to know the token's default.
 */
export function applyScopedOverrides(el: HTMLElement | null, map: ThemeOverrides): void {
  if (!el) return;
  for (const [name, value] of Object.entries(map)) {
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  }
}

/** Remove specific draft overrides from a scope element. */
export function clearScopedOverrides(el: HTMLElement | null, names: string[]): void {
  if (!el) return;
  names.forEach(n => el.style.removeProperty(n));
}

/** Remove every draft override from a scope element (Reset all). */
export function clearAllScopedOverrides(el: HTMLElement | null): void {
  if (!el) return;
  // Iterate a snapshot: removeProperty mutates the live CSSStyleDeclaration.
  const names = Array.from({ length: el.style.length }, (_, i) => el.style.item(i));
  names.filter(n => n.startsWith('--')).forEach(n => el.style.removeProperty(n));
}

/**
 * Read a token's effective value AS SEEN INSIDE a scope — draft value if the
 * scope overrides it, otherwise whatever it inherits.
 *
 * The inspector must use this rather than `readTokenValue`, or every control
 * would display the published value while the canvas showed the draft.
 */
export function readScopedTokenValue(el: HTMLElement | null, name: string): string {
  if (!el) return readTokenValue(name);
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Remove a single inline override (reverts the token to its base.css default). */
export function clearThemeOverride(name: string): void {
  document.documentElement.style.removeProperty(name);
}

/** Remove every inline override for the given token names. */
export function clearThemeOverrides(names: string[]): void {
  const root = document.documentElement;
  names.forEach(n => root.style.removeProperty(n));
}

/** Read the effective value of a token (override or base.css default). */
export function readTokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function cacheTheme(map: ThemeOverrides): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* private mode */ }
}

export function readCachedTheme(): ThemeOverrides {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as ThemeOverrides; }
  catch { return {}; }
}

/**
 * Boot hook — call once, early (main.tsx). Applies the cached theme immediately
 * to avoid a flash, then refreshes from the authoritative settings store.
 */
export function initTheme(): void {
  applyThemeOverrides(readCachedTheme());

  void (async () => {
    try {
      const { loadThemeTokens } = await import('@api/theme');
      const map = await loadThemeTokens();
      if (map) {
        applyThemeOverrides(map);
        cacheTheme(map);
      }
    } catch {
      /* not signed in yet / offline — cached + base.css defaults stand */
    }
  })();
}
