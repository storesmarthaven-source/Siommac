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

let currentPanelId = readPersisted();
const listeners = new Set<Listener>();

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
  if (!panelId || panelId === currentPanelId) return;
  currentPanelId = panelId;
  for (const fn of listeners) fn(panelId);
}

/** Current active panel id (non-reactive read). */
export function getActivePanel(): string {
  return currentPanelId;
}

/**
 * Reactive hook: returns `isActive(panelId)` for the section to render its own
 * `active` class. Re-renders the caller whenever the active panel changes.
 */
export function useActiveSection(): (panelId: string) => boolean {
  const [active, setActive] = useState<string>(currentPanelId);

  useEffect(() => {
    const fn: Listener = id => setActive(id);
    listeners.add(fn);
    // Re-sync in case the active panel changed between render and effect.
    if (currentPanelId !== active) setActive(currentPanelId);
    return () => { listeners.delete(fn); };
  }, []);

  return (panelId: string) => panelId === active;
}
