/**
 * src/ui/toast/Toaster.tsx
 *
 * Portal container for the Sonner-style deck-stacking toast system.
 * Mount ONCE in AppShell.tsx via document.body portal.
 *
 * Architecture (Emil Kowalski / Sonner parity):
 * - position:absolute cards anchored inside a fixed region; NO flex column
 * - Collapsed: cards stack with translateY(lift * toasts-before) + scale(1 - toasts-before * 0.05)
 * - Expanded (hover): cards lay out at their true offsets using tracked heights + 8px gaps
 * - Only the front 3 cards peek (older ones opacity:0 / pointer-events:none)
 * - No "+N more" pill — older toasts are simply hidden
 * - globalPaused while hovered or tab hidden
 * - aria-live="polite" section
 */

import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { createPortal }                              from 'preact/compat';
import { getToasts, subscribe, setGlobalPaused, getGlobalPaused } from './toastStore';
import type { ToastRecord }                          from './toastTypes';
import { ToastCard }                                 from './ToastCard';
import './toast.css';

/** How many toasts can peek behind the front card in collapsed state. */
const MAX_PEEK = 3;
/** Vertical distance each successive card translates DOWN behind the front, in px. */
const LIFT_AMOUNT = 14;
/** Gap between cards in expanded state (px). */
const EXPANDED_GAP = 8;

export function Toaster() {
  const [toasts,   setToasts]   = useState<ToastRecord[]>(() => getToasts());
  const [expanded, setExpanded] = useState(false);

  // Per-card height map: id → measured height in px
  const heightMap = useRef<Map<string, number>>(new Map());

  // Subscribe to store changes
  useEffect(() => {
    const unsub = subscribe(() => setToasts([...getToasts()]));
    return unsub;
  }, []);

  // Pause/resume all timers on expand/collapse
  const handleMouseEnter = useCallback(() => {
    setExpanded(true);
    setGlobalPaused(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setExpanded(false);
    setGlobalPaused(false);
  }, []);

  // Tab-hidden: pause all timers while document is not visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setGlobalPaused(true);
      } else {
        // Only resume if we're not currently hovering
        if (!expanded) setGlobalPaused(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [expanded]);

  const setHeight = useCallback((id: string, h: number) => {
    heightMap.current.set(id, h);
  }, []);

  if (toasts.length === 0) return null;

  // Toasts array: oldest first (index 0), newest last
  // "Front" = newest = last in array = toastsBeforeIt = 0
  const total = toasts.length;

  // Build per-card props:
  // toastsBefore = number of toasts NEWER than this one = (total - 1 - i)
  // visible (peek) = only if toastsBefore < MAX_PEEK
  // frontHeight = height of the front toast (newest = last)
  const frontId     = toasts[total - 1]?.id;
  const frontHeight = frontId ? (heightMap.current.get(frontId) ?? 64) : 64;

  // Compute expanded offsets (sum of heights of all toasts AFTER this one + gaps)
  // Toasts after index i are i+1 .. total-1 (they are newer, rendered above in the stack)
  // In expanded mode we lay out newest-on-top; the front toast is at offset 0,
  // and older toasts sit BELOW it.
  // offset for toast[i] = sum of heights of toasts[i+1..total-1] + gaps
  const expandedOffsets: number[] = [];
  {
    let runningOffset = 0;
    // Walk from newest (total-1) down to 0
    for (let i = total - 1; i >= 0; i--) {
      expandedOffsets[i] = runningOffset;
      const h = heightMap.current.get(toasts[i]!.id) ?? 64;
      runningOffset += h + EXPANDED_GAP;
    }
  }

  // Toaster container height in expanded state = sum of all heights + gaps
  const expandedHeight = expandedOffsets[0] !== undefined
    ? (expandedOffsets[0] + (heightMap.current.get(toasts[0]!.id) ?? 64))
    : 0;

  return createPortal(
    <section
      class="siomac-toaster"
      aria-label="Notifications"
      aria-relevant="additions removals"
      aria-live="polite"
      style={expanded
        ? { height: `${Math.max(expandedHeight, frontHeight)}px` }
        : { height: `${frontHeight + LIFT_AMOUNT * Math.min(total - 1, MAX_PEEK - 1)}px` }
      }
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {toasts.map((record, i) => {
        const toastsBefore = total - 1 - i; // 0 = front (newest)
        const isPeeking    = toastsBefore < MAX_PEEK;
        return (
          <ToastCard
            key={record.id}
            record={record}
            toastsBefore={toastsBefore}
            liftAmount={LIFT_AMOUNT}
            frontHeight={frontHeight}
            expanded={expanded}
            expandedOffset={expandedOffsets[i] ?? 0}
            visible={isPeeking}
            onMeasure={setHeight}
          />
        );
      })}
    </section>,
    document.body,
  );
}
