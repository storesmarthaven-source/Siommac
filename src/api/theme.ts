/**
 * src/api/theme.ts
 *
 * App-wide design-system theme persistence via the dedicated `app_theme` table.
 *   • read  — public endpoint (the login screen themes itself too)
 *   • write — superadmin/admin only, audited + app_event server-side
 */

import { authPost, apiPost } from '@lib/api';
import type { ThemeOverrides } from '@ui/theme/applyTheme';

/** Read the saved global token overrides (empty/absent → base.css defaults). */
export async function loadThemeTokens(): Promise<ThemeOverrides | null> {
  const res = await authPost<{ success: boolean; data?: { tokens: ThemeOverrides } }>('theme/get', {});
  return res.success && res.data ? (res.data.tokens ?? {}) : null;
}

/** Persist the global token overrides (enforced admin-only server-side). */
export async function saveThemeTokens(map: ThemeOverrides): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('theme/save', { tokens: map });
  if (!res.success) throw new Error(res.message ?? 'Failed to save theme.');
}
