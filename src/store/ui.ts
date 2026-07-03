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

// ── Re-export the canonical toast API ────────────────────────────────────────
// Import sites: `import { toast } from '@store'` or `import { toast } from '@store/ui'`
export { toast } from '@ui/toast';

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
  setTheme:        (t: Theme) => void;
  toggleTheme:     () => void;
  setSectionLoading: (v: boolean) => void;
  setGlobalLoading: (v: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTheme(): Theme {
  try {
    return localStorage.getItem('siomac-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>()((set, get) => ({
  activeSection:   null,
  prevSection:     null,
  sidebarOpen:     true,
  theme:           readTheme(),
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
    set({ theme: t });
    try {
      localStorage.setItem('siomac-theme', t);
      document.body.setAttribute('data-theme', t);
    } catch {
      // ignore storage error
    }
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setSectionLoading(v) {
    set({ sectionLoading: v });
  },

  setGlobalLoading(v) {
    set({ globalLoading: v });
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectActiveSection  = (s: UiState) => s.activeSection;
export const selectSectionLoading = (s: UiState) => s.sectionLoading;
export const selectTheme          = (s: UiState) => s.theme;
export const selectSidebarOpen    = (s: UiState) => s.sidebarOpen;
