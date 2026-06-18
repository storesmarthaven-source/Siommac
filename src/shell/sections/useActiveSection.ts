/**
 * src/shell/sections/useActiveSection.ts
 *
 * Single source of truth for which `.app-section` panel is visible, owned by
 * Preact.
 *
 * Why this exists: section panels are rendered by Preact, but visibility used to
 * be toggled imperatively by `showSection` (navCore) adding/removing the
 * `active` class on the DOM nodes. Because the panels' JSX is
 * `class="app-section"` (no `active`), any Preact re-render of the shell — e.g.
 * a `useQuery` in a slot component settling — reconciles `class` back to
 * `"app-section"`, dropping the imperatively-added `active`. Every panel then
 * falls to `display:none` and the main content goes blank until a reload.
 *
 * Fix: the active section id lives in a tiny external store. `showSection`
 * publishes to it (see navCore), each panel renders its own `active` class from
 * it via `useActiveSection`, and the store notifies subscribers so panels
 * re-render on navigation. Preact now owns the class, so shell re-renders
 * preserve it instead of clobbering it.
 *
 * Module panels: a registered module (e.g. HSE) serves many logical nav ids from
 * one panel (`mount.sectionId`). `showSection` publishes the *resolved panel id*
 * here, so a panel only needs to compare against its own element id.
 */

import { useEffect, useState } from 'preact/hooks';

type Listener = (panelId: string) => void;

/**
 * Store state lives on `window` (not plain module-level vars) so it survives
 * Vite HMR. When a file is edited in dev, Vite hot-swaps modules and re-runs the
 * Preact render; module-scoped state would reset to the persisted seed, but the
 * live navigation since boot would normally be fine since showSection persists.
 * Pinning to window also keeps the *same* listener set + value across a hot-swap
 * of this very module, so an edit cannot blank the active panel.
 */
interface ActiveSectionStore { panelId: string; listeners: Set<Listener>; }
const store: ActiveSectionStore =
  ((window as unknown as { __siomacActiveSection?: ActiveSectionStore }).__siomacActiveSection ??=
    { panelId: readPersisted(), listeners: new Set<Listener>() });

/** Seed from the persisted last section so a reload lands on the right panel. */
function readPersisted(): string {
  try {
    const role = (window as unknown as { AppState?: { get(k: string): string } }).AppState?.get('currentRole') ?? '';
    return localStorage.getItem('siomac_last_section_' + role) ?? '';
  } catch {
    return '';
  }
}

/** Publish the active *panel* id (called by showSection). Idempotent. */
export function setActivePanel(panelId: string): void {
  if (!panelId || panelId === store.panelId) return;
  store.panelId = panelId;
  for (const fn of store.listeners) fn(panelId);
}

/** Current active panel id (non-reactive read). */
export function getActivePanel(): string {
  return store.panelId;
}

/**
 * Reactive hook: returns `isActive(panelId)` for the section to render its own
 * `active` class. Re-renders the caller whenever the active panel changes.
 */
export function useActiveSection(): (panelId: string) => boolean {
  const [active, setActive] = useState<string>(store.panelId);

  useEffect(() => {
    const fn: Listener = id => setActive(id);
    store.listeners.add(fn);
    // Re-sync in case the active panel changed between render and effect (e.g.
    // a Vite HMR re-render after the store already advanced).
    if (store.panelId !== active) setActive(store.panelId);
    return () => { store.listeners.delete(fn); };
  }, []);

  return (panelId: string) => panelId === active;
}

// Keep the window-backed store across hot updates of this module: accept the
// HMR update without resetting state, so editing files never blanks the page.
if (import.meta.hot) {
  import.meta.hot.accept();
}
