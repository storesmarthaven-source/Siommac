/**
 * src/store/ui.ts  —  UI layout & navigation state
 *
 * Owns:
 *   - Which section is currently active
 *   - Sidebar open/collapsed state
 *   - Light/dark theme
 *   - Global loading / error banners
 *   - Modal open state (one modal at a time — stack if needed in Phase 3+)
 *
 * Deliberately free of any data or session logic — this store only controls
 * what the user sees on-screen, not what data is loaded.
 *
 * Toast API: re-exported from @ui/toast (single engine — no dual system).
 * All 192 call sites that do `import { toast } from '@store'` keep working
 * unchanged; the implementation has moved to the canonical toastStore.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { create } from 'zustand';
import type { Theme } from '@cfg';
import { toast } from '@ui/toast';
import {
  currentUserId, readCachedTheme, writeCachedTheme, purgeLegacyThemeCache,
  persistThemeToDb, loadThemeFromDb,
} from '@lib/themePreference';

// ── Re-export the canonical toast API ────────────────────────────────────────
// Import sites: `import { toast } from '@store'` or `import { toast } from '@store/ui'`
export { toast };

// ── State shape ───────────────────────────────────────────────────────────────

export type SectionId = string;   // e.g. 's-adm-dashboard', 's-emp-attendance'

export interface UiState {
  // ── Navigation ─────────────────────────────────────────────────────────────
  /** Currently visible section.  null = no section loaded (login screen) */
  activeSection:   SectionId | null;
  /** Previous section — used for the back-navigation gesture */
  prevSection:     SectionId | null;

  // ── Sidebar ────────────────────────────────────────────────────────────────
  sidebarOpen:     boolean;

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme:           Theme;

  // ── Loading states ─────────────────────────────────────────────────────────
  /** Section-level loading (shown while a section's initial data loads) */
  sectionLoading:  boolean;
  /** Global overlay spinner (used for full-page operations like logout) */
  globalLoading:   boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  navigateTo:      (id: SectionId) => void;
  setSidebarOpen:  (open: boolean) => void;
  toggleSidebar:   () => void;
  /** User-initiated theme change: applies + caches + PERSISTS to the DB
   *  (optimistic; rolls back + toasts on failure). The single authoritative
   *  entry point for changing the theme. */
  setTheme:        (t: Theme) => void;
  toggleTheme:     () => void;
  /** Apply a theme WITHOUT persisting (bootstrap / DB reconciliation only). */
  hydrateTheme:    (t: Theme) => void;
  setSectionLoading: (v: boolean) => void;
  setGlobalLoading: (v: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Apply the theme to the DOM — CSS reacts to body[data-theme]. */
function applyThemeToDom(t: Theme): void {
  try { document.body.setAttribute('data-theme', t); } catch { /* no DOM */ }
}

/** Initial store theme: the CURRENT user's anti-flash cache (keyed by the
 *  persisted session's userId, so user A's theme never paints for B), else light. */
function readInitialTheme(): Theme {
  return readCachedTheme(currentUserId()) ?? 'light';
}

// Monotonic intent guard: every user-initiated setTheme bumps this. A late
// persist-failure rollback or a slow DB-bootstrap value is only honoured if it
// is STILL the latest intent — so a stale response can't clobber a newer toggle.
let themeIntentSeq = 0;

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>()((set, get) => ({
  activeSection:   null,
  prevSection:     null,
  sidebarOpen:     true,
  theme:           readInitialTheme(),
  sectionLoading:  false,
  globalLoading:   false,

  navigateTo(id) {
    const prev = get().activeSection;
    set({ activeSection: id, prevSection: prev, sectionLoading: true });
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },

  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },

  setTheme(t) {
    const prev = get().theme;
    if (t === prev) return;
    const userId = currentUserId();
    const seq = ++themeIntentSeq;
    // Optimistic: apply + cache immediately so the UI is instant.
    set({ theme: t });
    applyThemeToDom(t);
    writeCachedTheme(userId, t);
    if (!userId) return;                       // not signed in — nothing to persist
    void persistThemeToDb(userId, t).catch((err: unknown) => {
      if (seq !== themeIntentSeq) return;      // a newer toggle superseded this — keep it
      set({ theme: prev });                    // roll back
      applyThemeToDom(prev);
      writeCachedTheme(userId, prev);
      toast.error(err instanceof Error ? err.message : 'Could not save your appearance preference.');
    });
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  hydrateTheme(t) {
    // Bootstrap / DB reconciliation — apply + cache, but do NOT persist.
    set({ theme: t });
    applyThemeToDom(t);
    writeCachedTheme(currentUserId(), t);
  },

  setSectionLoading(v) {
    set({ sectionLoading: v });
  },

  setGlobalLoading(v) {
    set({ globalLoading: v });
  },
}));

// ── Theme bootstrap (per-user, DB-authoritative) ────────────────────────────────

/**
 * Authenticated bootstrap: apply the user's anti-flash cache immediately, then
 * reconcile with the authoritative DB value. Called when the signed-in user
 * becomes available AND whenever it changes (so switching users never inherits
 * the previous user's theme). The DB value is applied only if the user has not
 * toggled since the load began (stale-guard).
 */
export async function initUserTheme(userId: string): Promise<void> {
  purgeLegacyThemeCache();
  const cached = readCachedTheme(userId);
  if (cached) useUiStore.getState().hydrateTheme(cached);
  const seqAtStart = themeIntentSeq;
  try {
    const dbTheme = await loadThemeFromDb();
    if (themeIntentSeq === seqAtStart) useUiStore.getState().hydrateTheme(dbTheme);
  } catch { /* cache / default stands until the next successful load */ }
}

/** Reset to the default light theme on sign-out (returns to the login screen). */
export function resetThemeToDefault(): void {
  useUiStore.getState().hydrateTheme('light');
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectActiveSection  = (s: UiState) => s.activeSection;
export const selectSectionLoading = (s: UiState) => s.sectionLoading;
export const selectTheme          = (s: UiState) => s.theme;
export const selectSidebarOpen    = (s: UiState) => s.sidebarOpen;
