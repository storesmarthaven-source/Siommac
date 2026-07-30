/**
 * src/lib/sectionRestore.ts
 *
 * Refresh restoration: turning the persisted `siomac_last_section_<role>` value
 * back into a live panel after a hard reload.
 *
 * Two things made that fail, and both are fixed here rather than papered over:
 *
 *  1. **Logical vs. panel ids.** A registered feature module serves EVERY one of
 *     its nav items from a single DOM panel (`mount.sectionId`) — `s-hr-employees`,
 *     `s-hr-onboarding`, … all live inside `#s-hr`. `showSection` already knows
 *     this (it resolves through `getModuleForSection`), but the callers that
 *     *validated* a stored id did it with `document.getElementById(storedId)`,
 *     which is null for every module-backed subsection. Employee Master therefore
 *     never restored: the stored id looked "not in the DOM" and the boot fell
 *     back to the role's first section (or, when the seed reached the active-panel
 *     store unmapped, to no active panel at all — a blank page). Validation now
 *     goes through the same canonical mapping the router uses.
 *
 *  2. **Ordering.** `AttendanceSystem.init()` runs before NavController mounts, so
 *     `window.Nav` does not exist yet and `nav?.showSection?.(…)` was a silent
 *     no-op — nothing was ever restored. `whenNavReady` registers the restore
 *     against the one-shot `siomac:nav-ready` event NavController fires when it
 *     installs the shim. That is a barrier, not a delay: no timers, no polling,
 *     no retry loop, and it runs synchronously when Nav is already present.
 */

import { getModuleForSection } from './moduleRegistry';

/** Fired once by NavController immediately after it installs the `window.Nav` shim. */
export const NAV_READY_EVENT = 'siomac:nav-ready';

export type NavShim = NonNullable<Window['Nav']>;

/**
 * The DOM panel that serves a logical section id. Module-backed nav items share
 * their module's single mount panel; everything else is its own panel.
 * This is the SAME resolution `navCore.showSectionNow` performs — one mapping,
 * not a second copy of the rule.
 */
export function sectionPanelId(sectionId: string): string {
  return getModuleForSection(sectionId)?.mount.sectionId ?? sectionId;
}

/**
 * The section to navigate to on a refresh: the stored id when its resolved panel
 * exists in the shell, else `fallbackId`. Returns the LOGICAL id (not the panel)
 * so the module shell still receives the `siomac:section` broadcast that selects
 * the right page inside the panel.
 */
export function resolveRestorableSection(storedId: string | null | undefined, fallbackId: string): string {
  if (!storedId) return fallbackId;
  return document.getElementById(sectionPanelId(storedId)) ? storedId : fallbackId;
}

/** The persisted last section for a role, or null. Storage access can throw (private mode). */
export function readLastSection(role: string): string | null {
  try { return localStorage.getItem('siomac_last_section_' + role); } catch { return null; }
}

/** True once NavController has installed the `window.Nav` shim. */
export function isNavReady(): boolean {
  return typeof window.Nav?.showSection === 'function';
}

/** Announce that `window.Nav` is installed and usable. Called by NavController. */
export function markNavReady(): void {
  window.dispatchEvent(new CustomEvent(NAV_READY_EVENT));
}

/**
 * Run `fn` with the Nav shim — now if it is already installed, otherwise exactly
 * once when `markNavReady()` fires. No timeout, no retry: the event IS the signal.
 */
export function whenNavReady(fn: (nav: NavShim) => void): void {
  const ready = window.Nav;
  if (isNavReady() && ready) { fn(ready); return; }
  window.addEventListener(NAV_READY_EVENT, () => {
    const shim = window.Nav;
    if (shim) fn(shim);
  }, { once: true });
}
