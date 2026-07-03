/**
 * src/ui/toast/Toaster.tsx
 *
 * Portal container for the toast system.
 * Mount ONCE in AppShell.tsx via document.body portal.
 *
 * Architecture: simple CSS grid (.cpop-toasts), one card per row.
 * Toasts are rendered newest-first so the newest appears at the TOP (deviation 1).
 * Hover over the container pauses all auto-dismiss timers AND the progress bars.
 * No deck stacking, no height-normalisation, no swipe-to-dismiss.
 */

import { useEffect, useState } from 'preact/hooks';
import { createPortal }        from 'preact/compat';
import { getToasts, subscribe, setGlobalPaused } from './toastStore';
import type { ToastRecord }    from './toastTypes';
import { ToastCard }           from './ToastCard';
import './toast.css';

export function Toaster() {
  const [toasts, setToasts] = useState<ToastRecord[]>(() => getToasts());

  useEffect(() => {
    const unsub = subscribe(() => setToasts([...getToasts()]));
    return unsub;
  }, []);

  // Tab-hidden: pause all timers while document is not visible
  useEffect(() => {
    const handleVisibility = () => {
      setGlobalPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  if (toasts.length === 0) return null;

  // Render newest first so it appears at the top of the grid
  const reversed = [...toasts].reverse();

  return createPortal(
    <section
      class="cpop-toasts"
      aria-label="Notifications"
      aria-relevant="additions removals"
      aria-live="polite"
      onMouseEnter={() => setGlobalPaused(true)}
      onMouseLeave={() => setGlobalPaused(false)}
    >
      {reversed.map((record) => (
        <ToastCard key={record.id} record={record} />
      ))}
    </section>,
    document.body,
  );
}
