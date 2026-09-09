import { useEffect, useState } from 'preact/hooks';

export type DemoPageId = 'messages' | 'notifications' | 'tickets' | 'calendar' | 'meetings';

export interface DemoPageOptions {
  showLandingPage: boolean;
  useStagedData: boolean;
}

export interface DemoModeState {
  enabled: boolean;
  pages: Record<DemoPageId, DemoPageOptions>;
}

const DEFAULT_STATE: DemoModeState = {
  enabled: false,
  pages: {
    messages: { showLandingPage: true, useStagedData: true },
    notifications: { showLandingPage: true, useStagedData: true },
    tickets: { showLandingPage: true, useStagedData: true },
    calendar: { showLandingPage: true, useStagedData: true },
    meetings: { showLandingPage: true, useStagedData: true },
  },
};

const PAGE_OPTIONS_KEY = 'siomac.demo-mode.page-options.v1';

function defaultPages(): DemoModeState['pages'] {
  return {
    messages: { ...DEFAULT_STATE.pages.messages },
    notifications: { ...DEFAULT_STATE.pages.notifications },
    tickets: { ...DEFAULT_STATE.pages.tickets },
    calendar: { ...DEFAULT_STATE.pages.calendar },
    meetings: { ...DEFAULT_STATE.pages.meetings },
  };
}

function readStoredPages(): DemoModeState['pages'] {
  if (typeof window === 'undefined') return defaultPages();
  try {
    const stored = JSON.parse(window.localStorage.getItem(PAGE_OPTIONS_KEY) ?? 'null') as Partial<Record<DemoPageId, Partial<DemoPageOptions>>> | null;
    const defaults = defaultPages();
    if (!stored || typeof stored !== 'object') return defaults;
    for (const page of ['messages', 'notifications', 'tickets', 'calendar', 'meetings'] as const) {
      const candidate = stored[page];
      if (!candidate || typeof candidate !== 'object') continue;
      if (typeof candidate.showLandingPage === 'boolean') defaults[page].showLandingPage = candidate.showLandingPage;
      if (typeof candidate.useStagedData === 'boolean') defaults[page].useStagedData = candidate.useStagedData;
    }
    return defaults;
  } catch {
    return defaultPages();
  }
}

function storePages(pages: DemoModeState['pages']): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PAGE_OPTIONS_KEY, JSON.stringify(pages));
}

let state: DemoModeState = { enabled: false, pages: readStoredPages() };
const listeners = new Set<(next: DemoModeState) => void>();

function cloneState(value: DemoModeState): DemoModeState {
  return {
    enabled: value.enabled,
    pages: {
      messages: { ...value.pages.messages },
      notifications: { ...value.pages.notifications },
      tickets: { ...value.pages.tickets },
      calendar: { ...value.pages.calendar },
      meetings: { ...value.pages.meetings },
    },
  };
}

function publish(next: DemoModeState): void {
  state = cloneState(next);
  listeners.forEach(listener => listener(cloneState(state)));
}

/**
 * Demo authorization is deliberately memory-only. Page configuration is a
 * non-sensitive presentation preference and persists locally, but a refresh or
 * sign-out still ends the verified read-only session.
 */
export function readDemoMode(): DemoModeState {
  return cloneState(state);
}

export function setDemoModeEnabled(enabled: boolean): void {
  publish({ ...state, enabled });
}

export function setDemoPageOptions(page: DemoPageId, options: DemoPageOptions): void {
  const pages = { ...state.pages, [page]: { ...options } };
  storePages(pages);
  publish({ ...state, pages });
}

export function resetDemoMode(): void {
  publish({ enabled: false, pages: readStoredPages() });
}

export function subscribeDemoMode(listener: (next: DemoModeState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDemoMode(): DemoModeState {
  const [value, setValue] = useState(readDemoMode);
  useEffect(() => subscribeDemoMode(setValue), []);
  return value;
}
