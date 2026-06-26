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

export function useOverlayA11y<T extends HTMLElement = HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null) : [];

    // Move focus into the panel (first focusable, else the panel itself).
    const first = focusables()[0];
    if (first) first.focus();
    else if (node) { node.tabIndex = -1; node.focus(); }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
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
      // Return focus to whatever opened the overlay.
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [active]);

  return ref;
}
