/**
 * src/ui/toast/ToastCard.tsx
 *
 * Single toast card — three-tier SIOMAC design (normal / action / rich)
 * running on the archieamas stacking model.
 *
 * Archieamas integration:
 *   - On mount: card gets class `entering` → @keyframes siomac-toast-enter fires,
 *     then class is removed so inline stacking styles can take over.
 *   - Exit: store `exiting` flag → class `exiting` → @keyframes siomac-toast-exit,
 *     pointer-events:none. Store removes the record after TOAST_EXIT_MS (450ms).
 *   - Inline bottom/transform/opacity/zIndex are set by Toaster's
 *     updateToastPositions(); cards must NOT set those themselves.
 *
 * Three-tier layout:
 *   normal:  icon + title-row + description + close X + timer footer + progress bar
 *   action:  + chips + summary rows + note + tinted action strip
 *   rich:    + chips + summary rows + file preview + tinted action strip
 */

import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { ToastActionButton, ToastRecord }       from "./toastTypes";
import { ToastIcon }                                from "./ToastIcon";
import { ToastProgress }                            from "./ToastProgress";
import { dismissToast, getGlobalPaused, updateToast } from "./toastStore";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  toast: ToastRecord;
  onDismiss?: () => void;
  onPositionUpdate: () => void;
}

// ── ToastCard ─────────────────────────────────────────────────────────────────

export function ToastCard({ toast, onPositionUpdate }: Props) {
  const [paused, setPaused]           = useState(false);
  const [remainingMs, setRemainingMs] = useState(toast.duration);
  const [stopped, setStopped]         = useState(false);

  const cardRef        = useRef<HTMLElement | null>(null);
  const startedAt      = useRef(Date.now());
  const pausedAt       = useRef<number | null>(null);
  const totalPaused    = useRef(0);
  const stoppedRef     = useRef(false);
  const rafRef         = useRef<number>(0);

  const hasTimer = toast.duration > 0;

  // ── Enter animation: add class on mount, remove after animation ──────────────
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.classList.add("entering");
    const t = setTimeout(() => {
      el.classList.remove("entering");
      onPositionUpdate();
    }, 420); // slightly past the 0.4s animation
    return () => clearTimeout(t);
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer: rAF-based countdown (mirrors spec's ToastCard) ────────────────────
  useEffect(() => {
    if (!hasTimer) return;

    const tick = () => {
      const now = Date.now();
      const pausedDuration = pausedAt.current ? now - pausedAt.current : 0;
      const elapsed = now - startedAt.current - totalPaused.current - pausedDuration;
      const nextRemaining = Math.max(0, toast.duration - elapsed);

      setRemainingMs(nextRemaining);

      if (nextRemaining <= 0) {
        handleDismiss();
        return;
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTimer, toast.duration]);

  // ── React to globalPaused changes ─────────────────────────────────────────────
  useEffect(() => {
    if (!hasTimer || stoppedRef.current) return;
    const globalPaused = getGlobalPaused();
    if (globalPaused) {
      setTimerPaused(true);
    } else if (!stoppedRef.current) {
      setTimerPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer pause/resume ────────────────────────────────────────────────────────
  function setTimerPaused(nextPaused: boolean) {
    if (!hasTimer) return;
    setPaused(nextPaused);

    if (nextPaused && !pausedAt.current) {
      pausedAt.current = Date.now();
    } else if (!nextPaused && pausedAt.current) {
      totalPaused.current += Date.now() - pausedAt.current;
      pausedAt.current = null;
    }
  }

  // ── Dismiss (animated exit via store) ────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    dismissToast(toast.id);
  }, [toast.id]);

  // ── Action button click ───────────────────────────────────────────────────────
  function handleActionClick(action: ToastActionButton) {
    try {
      if (action.onClick) void action.onClick();
      if (action.href) window.location.assign(action.href);
    } finally {
      if (action.dismissOnClick !== false) handleDismiss();
    }
  }

  // ── Hover / focus pause ───────────────────────────────────────────────────────
  const handleMouseEnter = useCallback(() => {
    if (stoppedRef.current) return;
    setTimerPaused(true);
    updateToast(toast.id, { exiting: toast.exiting });
  }, [toast.id, toast.exiting]);

  const handleMouseLeave = useCallback(() => {
    if (stoppedRef.current) return;
    setTimerPaused(false);
  }, []);

  // ── "Click to stop" — persistent pause ───────────────────────────────────────
  function handleToggleStop() {
    const next = !stoppedRef.current;
    stoppedRef.current = next;
    setStopped(next);
    setTimerPaused(next);
  }

  // ── Keyboard dismiss ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape" && toast.dismissible) handleDismiss();
  }, [toast.dismissible, handleDismiss]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <article
      ref={cardRef as any}
      className={[
        "siomac-toast",
        `siomac-toast--${toast.variant}`,
        `siomac-toast--${toast.tier}`,
        toast.exiting ? "exiting" : "",
        paused ? "is-paused" : ""
      ].filter(Boolean).join(" ")}
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.ariaLive}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusIn={() => { if (!stoppedRef.current) setTimerPaused(true); }}
      onFocusOut={() => { if (!stoppedRef.current) setTimerPaused(false); }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="siomac-toast__main">
        <ToastIcon variant={toast.variant} />

        <div className="siomac-toast__body">
          <div className="siomac-toast__title-row">
            <span className="siomac-toast__dot" />
            <div className="siomac-toast__title">{toast.title}</div>
          </div>

          {toast.description ? (
            <div className="siomac-toast__description">{toast.description}</div>
          ) : null}

          {toast.tier !== "normal" ? (
            <>
              <ToastChips toast={toast} />
              <ToastSummary toast={toast} />
              <ToastFile toast={toast} />
              <ToastNote toast={toast} />
            </>
          ) : null}
        </div>

        {toast.dismissible ? (
          <button
            className="siomac-toast__close"
            type="button"
            aria-label="Dismiss notification"
            onClick={handleDismiss}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {toast.tier === "normal" && hasTimer ? (
        <footer className="siomac-toast__timer">
          This message will close in <span>{seconds}</span> seconds.{" "}
          <button type="button" onClick={handleToggleStop}>
            {stopped ? "Resume." : "Click to stop."}
          </button>
          <ToastProgress duration={toast.duration} paused={paused} />
        </footer>
      ) : null}

      {toast.tier !== "normal" && toast.actions?.length ? (
        <div className="siomac-toast__actions">
          {toast.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={[
                "siomac-toast__action",
                action.tone ? `siomac-toast__action--${action.tone}` : ""
              ].filter(Boolean).join(" ")}
              onClick={() => handleActionClick(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {toast.tier !== "normal" && hasTimer ? (
        <ToastProgress duration={toast.duration} paused={paused} />
      ) : null}
    </article>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastChips({ toast }: { toast: ToastRecord }) {
  if (!toast.moduleLabel && !toast.statusLabel) return null;
  return (
    <div className="siomac-toast__chips">
      {toast.moduleLabel ? <span className="siomac-toast__chip">{toast.moduleLabel}</span> : null}
      {toast.statusLabel ? <span className="siomac-toast__chip">{toast.statusLabel}</span> : null}
    </div>
  );
}

function ToastSummary({ toast }: { toast: ToastRecord }) {
  if (!toast.details?.length) return null;
  return (
    <div className="siomac-toast__summary">
      {toast.details.map((item) => (
        <div className="siomac-toast__summary-row" key={item.label}>
          <span className="siomac-toast__summary-label">{item.label}</span>
          <span className="siomac-toast__summary-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function ToastNote({ toast }: { toast: ToastRecord }) {
  if (!toast.note) return null;
  return <div className="siomac-toast__note">{toast.note}</div>;
}

function ToastFile({ toast }: { toast: ToastRecord }) {
  if (!toast.file) return null;
  return (
    <div className="siomac-toast__file">
      <div className="siomac-toast__file-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v6h5" />
          <path d="M9.5 13h5M9.5 16h7" />
        </svg>
      </div>
      <div>
        <h3 className="siomac-toast__file-name">{toast.file.name}</h3>
        {toast.file.subtitle || toast.file.sizeLabel ? (
          <p className="siomac-toast__file-subtitle">
            {[toast.file.subtitle, toast.file.sizeLabel].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {toast.file.meta?.length ? (
          <div className="siomac-toast__file-meta">
            {toast.file.meta.slice(0, 3).map((item) => (
              <div className="siomac-toast__file-stat" key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
