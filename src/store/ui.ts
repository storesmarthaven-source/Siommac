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
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { create } from 'zustand';
import type { Theme } from '@cfg';

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

  // ── Toast / banner notifications ───────────────────────────────────────────
  toasts:          Toast[];

  // ── Actions ────────────────────────────────────────────────────────────────
  navigateTo:      (id: SectionId) => void;
  setSidebarOpen:  (open: boolean) => void;
  toggleSidebar:   () => void;
  setTheme:        (t: Theme) => void;
  toggleTheme:     () => void;
  setSectionLoading: (v: boolean) => void;
  setGlobalLoading: (v: boolean) => void;
  addToast:        (t: Omit<Toast, 'id'>) => void;
  removeToast:     (id: string) => void;
}

// ── Toast type ────────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id:       string;
  variant:  ToastVariant;
  message:  string;
  /** Auto-dismiss after this many ms (default 4000, 0 = never) */
  duration: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTheme(): Theme {
  try {
    return localStorage.getItem('siomac-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let _toastCounter = 0;
function makeToastId(): string {
  return `toast-${Date.now()}-${++_toastCounter}`;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>()((set, get) => ({
  activeSection:   null,
  prevSection:     null,
  sidebarOpen:     true,
  theme:           readTheme(),
  sectionLoading:  false,
  globalLoading:   false,
  toasts:          [],

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

  addToast(t) {
    const toast: Toast = {
      id:       makeToastId(),
      duration: t.duration ?? 4000,
      variant:  t.variant,
      message:  t.message,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));

    if (toast.duration > 0) {
      setTimeout(() => get().removeToast(toast.id), toast.duration);
    }
  },

  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// ── Convenience toast helpers ─────────────────────────────────────────────────
// Always reads from the live store instance — never captures getState() at
// module-load time, which would produce a stale closure if the store is reset
// (e.g. between test cases).

export const toast = {
  success: (message: string, duration?: number) =>
    useUiStore.getState().addToast({ variant: 'success', message, duration: duration ?? 4000 }),
  error: (message: string, duration?: number) =>
    useUiStore.getState().addToast({ variant: 'error', message, duration: duration ?? 6000 }),
  warning: (message: string, duration?: number) =>
    useUiStore.getState().addToast({ variant: 'warning', message, duration: duration ?? 5000 }),
  info: (message: string, duration?: number) =>
    useUiStore.getState().addToast({ variant: 'info', message, duration: duration ?? 4000 }),
};

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectActiveSection  = (s: UiState) => s.activeSection;
export const selectSectionLoading = (s: UiState) => s.sectionLoading;
export const selectTheme          = (s: UiState) => s.theme;
export const selectSidebarOpen    = (s: UiState) => s.sidebarOpen;
