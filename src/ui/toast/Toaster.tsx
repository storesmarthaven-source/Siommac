/**
 * src/ui/toast/Toaster.tsx
 *
 * Portal container for the toast system.
 * Mount ONCE in AppShell.tsx via document.body portal.
 *
 * Stacking effect: verbatim port of archieamas/stacked-toast.
 *   - Container: fixed at the persisted top-right, bottom-right, or bottom-center preference
 *   - Cards: position:absolute on the selected vertical edge, transition:all 0.4s
 *   - Collapsed: newest at front, scale/opacity/zIndex by index
 *   - Expanded (.expanded-stack on hover): cards stack vertically, full height
 *   - Hover debounce: 200ms (HOVER_DEBOUNCE_DELAY)
 *   - Cards beyond MAX_VISIBLE_TOASTS (5) get display:none in collapsed mode
 *   - Enter: .entering class → @keyframes siomac-toast-enter (slides from the right)
 *   - Exit: store exiting flag → .exiting class → @keyframes siomac-toast-exit (slides right), removed after TOAST_EXIT_MS
 */

import type { VNode }                                from "preact";
import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { createPortal }                             from "preact/compat";
import { getToasts, subscribe, setGlobalPaused } from "./toastStore";
import type { ToastRecord }                         from "./toastTypes";
import { ToastCard }                                from "./ToastCard";
import {
  getToastRuntimePreferences,
  subscribeToastRuntimePreferences,
} from "./toastPreferences";
import type { ToastPreference } from "../../../types/uiPreferences";
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
  preferences: ToastPreference;
}

function ToasterInner({ toasts, preferences }: ToasterInnerProps) {
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

    const bottomAnchored = preferences.position.startsWith("bottom-");

    if (expandedRef.current) {
      // ── Expanded view ──────────────────────────────────────────────────────
      let cumulativeHeight = 0;
      const reversed = [...activeCards].reverse(); // newest first

      reversed.forEach((el, index) => {
        el.style.display   = "";
        el.style.opacity   = "1";
        el.style.transform = "scale(1)";
        el.style.top       = bottomAnchored ? "auto" : `${cumulativeHeight}px`;
        el.style.bottom    = bottomAnchored ? `${cumulativeHeight}px` : "auto";
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
        el.style.top       = bottomAnchored ? "auto" : `${i * STACK_ITEM_OFFSET_Y}px`;
        el.style.bottom    = bottomAnchored ? `${i * STACK_ITEM_OFFSET_Y}px` : "auto";
        el.style.transform = `scale(${1 - i * STACK_ITEM_SCALE_DECREMENT})`;
        const opacity      = i === 0
          ? 1
          : Math.max(0.1, 1 - i * STACK_ITEM_OPACITY_DECREMENT);
        el.style.opacity   = String(opacity);
        el.style.zIndex    = String(MAX_VISIBLE_TOASTS - i);
      });
    }

    container.style.pointerEvents = activeCards.length > 0 ? "auto" : "none";
  }, [preferences.position]);

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
      className={`siomac-toaster siomac-toaster--${preferences.position}`}
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
          showPreviews={preferences.showPreviews}
        />
      ))}
    </section>
  );
}

// ── Toaster (public) ──────────────────────────────────────────────────────────

export function Toaster(): VNode | null {
  const [toasts, setToasts] = useState<ToastRecord[]>(() => getToasts());
  const [preferences, setPreferences] = useState<ToastPreference>(() => getToastRuntimePreferences());
  const knownToastIdsRef = useRef(new Set(getToasts().map(record => record.id)));

  useEffect(() => {
    const unsub = subscribe(() => setToasts([...getToasts()]));
    return unsub;
  }, []);

  useEffect(() => subscribeToastRuntimePreferences(setPreferences), []);

  useEffect(() => {
    const nextIds = new Set(toasts.map(record => record.id));
    const newToast = toasts.find(record => !knownToastIdsRef.current.has(record.id) && record.variant !== "loading");
    knownToastIdsRef.current = nextIds;
    if (!preferences.playSound || !newToast || typeof window.AudioContext !== "function") return;

    const context = new window.AudioContext();
    const play = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.addEventListener("ended", () => { void context.close(); }, { once: true });
      oscillator.start();
      oscillator.stop(context.currentTime + 0.13);
    };

    if (context.state === "suspended") {
      void context.resume().then(play).catch((error: unknown) => {
        console.warn("Notification sound could not be played.", error);
        void context.close();
      });
    } else {
      play();
    }
  }, [preferences.playSound, toasts]);

  if (toasts.length === 0) return null;

  return createPortal(
    <ToasterInner toasts={toasts} preferences={preferences} />,
    document.body,
  );
}
