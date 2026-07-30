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
import { loadSession } from '@lib/session';
import { sectionPanelId } from '@lib/sectionRestore';

type Listener = (panelId: string) => void;

/**
 * Store state lives on `window` (not plain module-level vars) so it survives
 * Vite HMR. When a file is edited in dev, Vite hot-swaps modules and re-runs the
 * Preact render; module-scoped state would reset to the persisted seed, but the
 * live navigation since boot would normally be fine since showSection persists.
 * Pinning to window also keeps the *same* listener set + value across a hot-swap
 * of this very module, so an edit cannot blank the active panel.
 */
interface ActiveSectionStore { panelId: string; seeded: boolean; listeners: Set<Listener>; }
const store: ActiveSectionStore =
  ((window as unknown as { __siomacActiveSection?: ActiveSectionStore }).__siomacActiveSection ??=
    { panelId: '', seeded: false, listeners: new Set<Listener>() });

/**
 * Seed from the persisted last section so a reload lands on the right panel.
 *
 * Three corrections over the original: the role comes from the PERSISTED session
 * (AppState is in-memory and still empty when this module first evaluates, which
 * made the seed always read `siomac_last_section_` and resolve to nothing); the
 * stored LOGICAL id is mapped to its panel — a module-backed subsection like
 * `s-hr-employees` is served by `#s-hr`, so seeding the raw id matched no panel and
 * the shell painted blank until navigation caught up; and the seed is resolved on
 * FIRST READ rather than at module evaluation, because `sectionPanelId` needs the
 * feature modules to have self-registered and this module's position in the import
 * graph does not guarantee that yet.
 */
function readPersisted(): string {
  try {
    const role = loadSession()?.role
      ?? (window as unknown as { AppState?: { get(k: string): string } }).AppState?.get('currentRole')
      ?? '';
    const stored = localStorage.getItem('siomac_last_section_' + role);
    return stored ? sectionPanelId(stored) : '';
  } catch {
    return '';
  }
}

/** The active panel, seeding lazily from storage the first time it is asked for. */
function currentPanel(): string {
  if (!store.seeded) { store.seeded = true; store.panelId = readPersisted(); }
  return store.panelId;
}

/** Publish the active *panel* id (called by showSection). Idempotent. */
export function setActivePanel(panelId: string): void {
  store.seeded = true;
  if (!panelId || panelId === store.panelId) return;
  store.panelId = panelId;
  for (const fn of store.listeners) fn(panelId);
}

/** Current active panel id (non-reactive read). */
export function getActivePanel(): string {
  return currentPanel();
}

/**
 * Reactive hook: returns `isActive(panelId)` for the section to render its own
 * `active` class. Re-renders the caller whenever the active panel changes.
 */
export function useActiveSection(): (panelId: string) => boolean {
  const [active, setActive] = useState<string>(currentPanel);

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
