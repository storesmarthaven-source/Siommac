/**
 * src/api/theme.ts
 *
 * App-wide theme persistence, layered on the existing global `settings` KV
 * (one row, key `themeTokens`, value = JSON map of token → override). Reading is
 * a direct settings read (same as branding); writing goes through the
 * superadmin-gated `updateSetting` route.
 */

import { getSettingsMap } from '@api/settings';
import { THEME_SETTING_KEY, type ThemeOverrides } from '@ui/theme/applyTheme';

/** Read the saved token overrides (empty/absent → use base.css defaults). */
export async function loadThemeTokens(signal?: AbortSignal): Promise<ThemeOverrides | null> {
  const map = await getSettingsMap(signal);
  const raw = map[THEME_SETTING_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ThemeOverrides;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist the token overrides app-wide (superadmin only — enforced server-side). */
export async function saveThemeTokens(map: ThemeOverrides): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const value = JSON.stringify(map);
  if (value.length > 4096) {
    throw new Error('Theme is too large to save — reduce the number of overrides.');
  }
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateSetting',
    { key: THEME_SETTING_KEY, value },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to save theme.');
}
