/**
 * src/ui/lib/useOverlayA11y.ts
 *
 * Accessibility for modal-like overlays (Modal, Drawer, WizardShell):
 *   • Escape closes the overlay
 *   • Tab / Shift+Tab is trapped within the panel
 *   • focus moves into the panel on open, and returns to the element that opened
 *     it on close
 *
 * Returns a ref to put on the panel element. No-ops while `active` is false.
 */

import { useEffect, useRef } from 'preact/hooks';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Is this element actually reachable?
 *
 * The previous check was `el.offsetParent !== null`, which has two problems: it
 * reports null for any `position: fixed` element even when it is plainly
 * visible, and it reports null for EVERYTHING under jsdom — so the focus trap
 * silently degraded to "no focusables" and could not be tested at all.
 *
 * `checkVisibility()` is the purpose-built API; the computed-style fallback
 * covers older browsers and the test environment.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  const withCheck = el as HTMLElement & { checkVisibility?: (opts?: object) => boolean };
  if (typeof withCheck.checkVisibility === 'function') {
    return withCheck.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function useOverlayA11y<T extends HTMLElement = HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  // The effect intentionally depends only on `active` — re-running it on every
  // render would re-steal focus mid-typing. That makes `onClose` a stale
  // closure, so it is read through a ref that each render refreshes.
  //
  // The refresh happens in an effect, not during render. Writing a ref while
  // rendering is a side effect in the render phase: it is not rolled back if the
  // render is discarded, and it makes the component's output depend on when the
  // write happened rather than on its props. An unconditional effect runs after
  // every committed render, which is exactly when the handler should be swapped
  // — always before any event can read it.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible) : [];

    // Move focus into the panel (first focusable, else the panel itself).
    const first = focusables()[0];
    // A contained drawer often opens over a scrollable planning surface. Moving
    // focus must not scroll that surface and make the underlying page jump.
    if (first) first.focus({ preventScroll: true });
    else if (node) { node.tabIndex = -1; node.focus({ preventScroll: true }); }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const firstEl = f[0]!;
      const lastEl = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Return focus to whatever opened the overlay — but only if that element
      // is still in the document. On a route change the opener is gone, and
      // calling focus() on a detached node silently moves focus to <body>,
      // which drops the user at the top of the new page.
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
