/**
 * src/ui/toast/Toaster.tsx
 *
 * Portal container for the toast system.
 * Mount ONCE in AppShell.tsx via document.body portal.
 *
 * - MAX_VISIBLE = 4: when collapsed shows +N more pill + last N toasts
 * - onMouseEnter → expand (show all)
 * - onMouseLeave → collapse
 * - aria-live="polite" section
 */

import { useEffect, useState, useCallback } from 'preact/hooks';
import { createPortal }                     from 'preact/compat';
import { getToasts, subscribe }             from './toastStore';
import type { ToastRecord }                 from './toastTypes';
import { ToastCard }                        from './ToastCard';
import './toast.css';

const MAX_VISIBLE = 4;

export function Toaster() {
  const [toasts,   setToasts]   = useState<ToastRecord[]>(() => getToasts());
  const [expanded, setExpanded] = useState(false);

  // Subscribe to store changes
  useEffect(() => {
    const unsub = subscribe(() => setToasts([...getToasts()]));
    return unsub;
  }, []);

  const handleMouseEnter = useCallback(() => setExpanded(true),  []);
  const handleMouseLeave = useCallback(() => setExpanded(false), []);

  if (toasts.length === 0) return null;

  // Which toasts to show
  const total   = toasts.length;
  const visible = expanded
    ? toasts
    : toasts.slice(-MAX_VISIBLE);  // show the most recent MAX_VISIBLE
  const hiddenCount = expanded ? 0 : Math.max(0, total - MAX_VISIBLE);

  return createPortal(
    <section
      class="siomac-toaster"
      aria-label="Notifications"
      aria-relevant="additions removals"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hiddenCount > 0 && (
        <div class="toast-overflow-pill" aria-hidden="true">
          +{hiddenCount} more
        </div>
      )}
      {visible.map((record) => (
        <ToastCard key={record.id} record={record} />
      ))}
    </section>,
    document.body,
  );
}
