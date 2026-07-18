/**
 * src/lib/themePreference.ts — per-user light/dark theme persistence.
 *
 * Reuses the CANONICAL per-user settings system (no parallel store):
 *   • setting:  system.user_theme  (app_setting_catalog, ui_preference, scope user)
 *   • write:    POST settings/values/set  { settingKey, scopeType:'user', scopeId:self, value }
 *   • read:     POST settings/my-preferences  → effectiveValue
 * The DB is authoritative; localStorage is only an anti-flash cache and is
 * KEYED BY USER ID so one user's theme can never paint for another.
 */
import { apiPost } from '@lib/api';
import type { Theme } from '@cfg';

export const THEME_SETTING_KEY = 'system.user_theme';
const CACHE_PREFIX = 'siomac-theme:'; // + userId  (legacy unkeyed 'siomac-theme' is retired)

function cacheKey(userId: string | null): string {
  return CACHE_PREFIX + (userId ?? 'anon');
}

/** The signed-in user's id from the persisted session (the session store is
 *  backed by this same key). Read here rather than importing the session store
 *  to keep this leaf module free of a store import cycle. */
export function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem('siomac_session_v1');
    return raw ? ((JSON.parse(raw) as { userId?: string }).userId ?? null) : null;
  } catch { return null; }
}

/** Anti-flash cache read for a specific user (null → no cached value). */
export function readCachedTheme(userId: string | null): Theme | null {
  try {
    const v = localStorage.getItem(cacheKey(userId));
    return v === 'dark' || v === 'light' ? v : null;
  } catch { return null; }
}

export function writeCachedTheme(userId: string | null, t: Theme): void {
  try { localStorage.setItem(cacheKey(userId), t); } catch { /* private mode */ }
}

/** Retire the legacy unkeyed cache key (one user's theme leaking to another). */
export function purgeLegacyThemeCache(): void {
  try { localStorage.removeItem('siomac-theme'); } catch { /* ignore */ }
}

/** Resolve a stored value (incl. 'system') to a concrete theme via the OS setting. */
export function resolveTheme(value: string | null | undefined): Theme {
  if (value === 'dark') return 'dark';
  if (value === 'light') return 'light';
  // 'system' / unknown → follow the OS preference.
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}

/** Persist the actor's OWN theme through the canonical settings write path. */
export async function persistThemeToDb(userId: string, t: Theme): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'settings/values/set',
    { settingKey: THEME_SETTING_KEY, scopeType: 'user', scopeId: userId, value: t },
    { retryable: false },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to save appearance preference.');
}

/** Load the actor's effective theme from the DB (authoritative). */
export async function loadThemeFromDb(): Promise<Theme> {
  const res = await apiPost<{ success: boolean; data?: { settingKey: string; effectiveValue: string }[] }>(
    'settings/my-preferences', {}, { retryable: false },
  );
  const row = res.data?.find((r) => r.settingKey === THEME_SETTING_KEY);
  return resolveTheme(row?.effectiveValue);
}
