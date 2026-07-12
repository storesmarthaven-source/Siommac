/**
 * src/ui/toast/Toaster.tsx
 *
 * Portal container for the toast system.
 * Mount ONCE in AppShell.tsx via document.body portal.
 *
 * Stacking effect: verbatim port of archieamas/stacked-toast.
 *   - Container: position:fixed bottom:20px right:20px, transition:height 0.3s
 *   - Cards: position:absolute bottom:0 right:0, transition:all 0.4s
 *   - Collapsed: newest at front (bottom), scale/opacity/zIndex by index
 *   - Expanded (.expanded-stack on hover): cards stack vertically, full height
 *   - Hover debounce: 200ms (HOVER_DEBOUNCE_DELAY)
 *   - Cards beyond MAX_VISIBLE_TOASTS (5) get display:none in collapsed mode
 *   - Enter: .entering class → @keyframes siomac-toast-enter (translateY(100%) scale(0.9) → identity)
 *   - Exit: store exiting flag → .exiting class → @keyframes siomac-toast-exit (reverse), removed after TOAST_EXIT_MS
 */

import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { createPortal }                             from "preact/compat";
import { getToasts, subscribe, setGlobalPaused }    from "./toastStore";
import type { ToastRecord }                         from "./toastTypes";
import { ToastCard }                                from "./ToastCard";
import "./toast.css";

// ── Archieamas constants (verbatim) ───────────────────────────────────────────

const MAX_VISIBLE_TOASTS         = 5;
const TOAST_GAP                  = 10;
const STACK_ITEM_OFFSET_Y        = 10;
const STACK_ITEM_SCALE_DECREMENT  = 0.05;
const STACK_ITEM_OPACITY_DECREMENT = 0.15;
const HOVER_DEBOUNCE_DELAY       = 200;

// ── Inner component that owns the DOM ref and positioning logic ───────────────

interface ToasterInnerProps {
  toasts: ToastRecord[];
}

function ToasterInner({ toasts }: ToasterInnerProps) {
  const containerRef  = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedRef   = useRef(false);

  // ── updateToastPositions — verbatim port of archieamas ──────────────────────
  const updateToastPositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const allCards = Array.from(
      container.querySelectorAll<HTMLElement>(".siomac-toast"),
    );

    const activeCards = allCards.filter((el) => !el.classList.contains("exiting"));

    if (expandedRef.current) {
      // ── Expanded view ──────────────────────────────────────────────────────
      let cumulativeHeight = 0;
      const reversed = [...activeCards].reverse(); // newest first

      reversed.forEach((el, index) => {
        el.style.display   = "";
        el.style.opacity   = "1";
        el.style.transform = "scale(1)";
        el.style.top       = `${cumulativeHeight}px`;   // top-anchored: fan down
        el.style.zIndex    = String(activeCards.length - index);
        cumulativeHeight  += el.offsetHeight + TOAST_GAP;
      });

    } else {
      // ── Collapsed / stacked view ───────────────────────────────────────────
      const visibleInStack = [...activeCards]
        .slice(-MAX_VISIBLE_TOASTS)
        .reverse(); // newest first → i=0 is front

      activeCards.forEach((el) => {
        if (!visibleInStack.includes(el)) {
          el.style.display = "none";
        } else {
          el.style.display = "";
        }
      });

      visibleInStack.forEach((el, i) => {
        el.style.top       = `${i * STACK_ITEM_OFFSET_Y}px`;   // older peek down
        el.style.transform = `scale(${1 - i * STACK_ITEM_SCALE_DECREMENT})`;
        const opacity      = i === 0
          ? 1
          : Math.max(0.1, 1 - i * STACK_ITEM_OPACITY_DECREMENT);
        el.style.opacity   = String(opacity);
        el.style.zIndex    = String(MAX_VISIBLE_TOASTS - i);
      });
    }

    container.style.pointerEvents = activeCards.length > 0 ? "auto" : "none";
  }, []);

  // ── Re-run positions after every render (toasts list changed) ───────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => updateToastPositions());
    return () => cancelAnimationFrame(raf);
  }, [toasts, updateToastPositions]);

  // ── Hover: expand / collapse with 200ms debounce ─────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const activeCards = Array.from(
        container.querySelectorAll<HTMLElement>(".siomac-toast"),
      ).filter((el) => !el.classList.contains("exiting"));
      if (activeCards.length > 0 && !expandedRef.current) {
        expandedRef.current = true;
        container.classList.add("expanded-stack");
        updateToastPositions();
      }
      setGlobalPaused(true);
    }, HOVER_DEBOUNCE_DELAY);
  }, [updateToastPositions]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      if (expandedRef.current) {
        expandedRef.current = false;
        container.classList.remove("expanded-stack");
        updateToastPositions();
      }
      setGlobalPaused(false);
    }, HOVER_DEBOUNCE_DELAY);
  }, [updateToastPositions]);

  // ── Tab-hidden: pause all timers while document is not visible ───────────────

  useEffect(() => {
    const handleVisibility = () => { setGlobalPaused(document.hidden); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ── Render oldest-first in DOM (newest = last DOM child = visual front) ───────
  const orderedToasts = [...toasts].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <section
      ref={containerRef}
      className="siomac-toaster"
      aria-label="Notifications"
      aria-relevant="additions removals"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {orderedToasts.map((record) => (
        <ToastCard
          key={record.id}
          toast={record}
          onPositionUpdate={updateToastPositions}
        />
      ))}
    </section>
  );
}

// ── Toaster (public) ──────────────────────────────────────────────────────────

export function Toaster() {
  const [toasts, setToasts] = useState<ToastRecord[]>(() => getToasts());

  useEffect(() => {
    const unsub = subscribe(() => setToasts([...getToasts()]));
    return unsub;
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <ToasterInner toasts={toasts} />,
    document.body,
  );
}
