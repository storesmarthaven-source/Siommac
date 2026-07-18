/**
 * Per-user theme: store + persistence via the canonical settings system.
 * Covers the acceptance list: initial load, persistence, logout/login, user
 * switching (cache isolation), save-failure rollback, rapid-toggle stale guard,
 * and legacy-key removal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@lib/api', () => ({ apiPost }));
vi.mock('@ui/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: () => null }));

import { toast } from '@ui/toast';
import { readCachedTheme, writeCachedTheme, resolveTheme, currentUserId, purgeLegacyThemeCache } from '@lib/themePreference';
import { useUiStore, initUserTheme, resetThemeToDefault } from '@store/ui';

const bodyTheme = () => document.body.getAttribute('data-theme');
const flush = () => new Promise((r) => setTimeout(r, 0));
const setSession = (userId: string | null) =>
  userId ? localStorage.setItem('siomac_session_v1', JSON.stringify({ userId })) : localStorage.removeItem('siomac_session_v1');
const mySetTheme = (t: 'light' | 'dark') => useUiStore.getState().setTheme(t);
const okThreads = { success: true } as const;
const prefsWith = (v: string) => ({ success: true, data: [{ settingKey: 'system.user_theme', effectiveValue: v }] });

beforeEach(() => {
  localStorage.clear();
  apiPost.mockReset();
  (toast.error as ReturnType<typeof vi.fn>).mockReset();
  document.body.removeAttribute('data-theme');
  useUiStore.setState({ theme: 'light' });
});

describe('anti-flash cache is per-user (switching isolation)', () => {
  it('reads/writes keyed by userId; other users see nothing', () => {
    writeCachedTheme('USR-A', 'dark');
    writeCachedTheme('USR-B', 'light');
    expect(readCachedTheme('USR-A')).toBe('dark');
    expect(readCachedTheme('USR-B')).toBe('light');
    expect(readCachedTheme('USR-C')).toBeNull();
  });
  it('currentUserId comes from the persisted session', () => {
    setSession('USR-9');
    expect(currentUserId()).toBe('USR-9');
    setSession(null);
    expect(currentUserId()).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('passes explicit values through', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });
  it("'system' follows prefers-color-scheme", () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(resolveTheme('system')).toBe('dark');
    (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('initUserTheme — initial load (cache then authoritative DB)', () => {
  it('applies the DB value after sign-in', async () => {
    setSession('USR-A');
    apiPost.mockResolvedValueOnce(prefsWith('dark'));   // my-preferences
    await initUserTheme('USR-A');
    expect(useUiStore.getState().theme).toBe('dark');
    expect(bodyTheme()).toBe('dark');
    expect(readCachedTheme('USR-A')).toBe('dark');   // cache reconciled
  });
  it('applies the anti-flash cache immediately, before the DB resolves', async () => {
    setSession('USR-A');
    writeCachedTheme('USR-A', 'dark');
    let resolveDb!: (v: unknown) => void;
    apiPost.mockReturnValueOnce(new Promise((res) => { resolveDb = res; }));
    const p = initUserTheme('USR-A');
    expect(useUiStore.getState().theme).toBe('dark');   // cache applied synchronously
    resolveDb(prefsWith('light'));
    await p;
    expect(useUiStore.getState().theme).toBe('light');  // DB reconciles
  });
});

describe('setTheme — optimistic persistence through the canonical write path', () => {
  it('applies immediately and calls settings/values/set for the actor', async () => {
    setSession('USR-A');
    apiPost.mockResolvedValue(okThreads);
    mySetTheme('dark');
    expect(useUiStore.getState().theme).toBe('dark');   // optimistic
    expect(bodyTheme()).toBe('dark');
    await flush();
    expect(apiPost).toHaveBeenCalledWith('settings/values/set',
      { settingKey: 'system.user_theme', scopeType: 'user', scopeId: 'USR-A', value: 'dark' },
      { retryable: false });
  });

  it('rolls back and toasts when persistence fails', async () => {
    setSession('USR-A');
    apiPost.mockRejectedValueOnce(new Error('network'));
    mySetTheme('dark');
    expect(useUiStore.getState().theme).toBe('dark');   // optimistic
    await flush();
    expect(useUiStore.getState().theme).toBe('light');  // rolled back
    expect(bodyTheme()).toBe('light');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('rapid toggling — a stale response cannot overwrite a newer toggle', () => {
  it('suppresses a late failure rollback that is no longer the latest intent', async () => {
    setSession('USR-A');
    let rejectFirst!: (e: Error) => void;
    apiPost
      .mockReturnValueOnce(new Promise((_, rej) => { rejectFirst = rej; }))   // #1 dark — slow reject
      .mockResolvedValueOnce(okThreads)                                        // #2 light
      .mockResolvedValueOnce(okThreads);                                       // #3 dark
    mySetTheme('dark');   // seq1
    mySetTheme('light');  // seq2
    mySetTheme('dark');   // seq3
    expect(useUiStore.getState().theme).toBe('dark');
    rejectFirst(new Error('stale'));
    await flush();
    expect(useUiStore.getState().theme).toBe('dark');   // NOT rolled back to the stale 'light'
  });
});

describe('logout / login and user switching', () => {
  it('resets to light on sign-out and loads the next user on sign-in', async () => {
    setSession('USR-A');
    apiPost.mockResolvedValue(okThreads);
    mySetTheme('dark');
    await flush();
    setSession(null);                            // session cleared first on logout
    resetThemeToDefault();                        // ThemeBridge resets when userId → null
    expect(useUiStore.getState().theme).toBe('light');
    setSession('USR-B');                          // different user
    apiPost.mockResolvedValueOnce(prefsWith('dark'));
    await initUserTheme('USR-B');
    expect(useUiStore.getState().theme).toBe('dark');
    // USR-A's cache is untouched and never applied for USR-B implicitly.
    expect(readCachedTheme('USR-A')).toBe('dark');
    expect(readCachedTheme('USR-B')).toBe('dark');
  });
});

describe('legacy toggle removed', () => {
  it('setTheme never writes the legacy unkeyed key; purge removes it', async () => {
    localStorage.setItem('siomac-theme', 'dark');   // legacy residue
    setSession('USR-A');
    apiPost.mockResolvedValue(okThreads);
    mySetTheme('dark');
    await flush();
    expect(localStorage.getItem('siomac-theme')).toBe('dark');  // untouched by the new path
    purgeLegacyThemeCache();
    expect(localStorage.getItem('siomac-theme')).toBeNull();     // and cleaned up
    expect(readCachedTheme('USR-A')).toBe('dark');               // new keyed value written
  });
});
