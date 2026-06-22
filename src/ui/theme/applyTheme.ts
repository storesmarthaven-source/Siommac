/**
 * src/ui/theme/applyTheme.ts
 *
 * Runtime theming: apply token overrides to the document root so the WHOLE app
 * re-themes instantly (every component + hover/focus state reads these vars).
 *
 * Persistence is app-wide via the existing `settings` KV (key `themeTokens`):
 *   • boot:  apply the localStorage cache synchronously (no flash), then fetch
 *            the authoritative value from settings and re-apply + re-cache.
 *   • save:  superadmin writes the override map back to settings (see @api/theme).
 *
 * Only CHANGED tokens are stored — an empty map means "use the base.css defaults".
 */

/** Settings key (also the cache namespace). Alphanumeric per UpdateSettingSchema. */
export const THEME_SETTING_KEY = 'themeTokens';
const LS_KEY = 'siomac.theme';

export type ThemeOverrides = Record<string, string>;

/** Set each override as an inline custom property on :root (wins over base.css). */
export function applyThemeOverrides(map: ThemeOverrides): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(map)) {
    if (value) root.style.setProperty(name, value);
  }
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
