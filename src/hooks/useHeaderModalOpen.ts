/**
 * src/hooks/useHeaderModalOpen.ts
 *
 * Observes the `.open` CSS class on a named header modal overlay element and
 * returns a boolean indicating whether it is currently visible. Components use
 * this to gate expensive list queries behind modal visibility: hidden dropdowns
 * skip the fetch entirely and only load on first open.
 *
 * NavController is the sole writer of `classList.add/remove('open')` on these
 * modals — the MutationObserver picks up those class-attribute mutations and
 * flips the returned boolean synchronously.
 */

import { useEffect, useState } from 'preact/hooks';

/**
 * Returns `true` while the header modal identified by `modalId` carries the
 * `open` CSS class.  Starts as `false` (conservative: never pre-fetch) and
 * flips synchronously whenever the class attribute changes.
 */
export function useHeaderModalOpen(modalId: string): boolean {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Seed initial state in case the element is already open on mount.
    setIsOpen(modal.classList.contains('open'));

    const obs = new MutationObserver(() => {
      setIsOpen(modal.classList.contains('open'));
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [modalId]);

  return isOpen;
}
