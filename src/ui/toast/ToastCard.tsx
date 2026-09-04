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
 * Shared interaction model:
 *   stable header: status icon + title + disclosure + explicit close
 *   expandable body: description, metadata, file preview and actions
 *   timer footer: elapsed progress + one-way stop control
 */

import type { VNode }                                from "preact";
import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { LucideIcon }                               from "../LucideIcon";
import type { ToastActionButton, ToastRecord }      from "./toastTypes";
import { ToastIcon }                                from "./ToastIcon";
import { ToastProgress }                            from "./ToastProgress";
import { dismissToast, getGlobalPaused }            from "./toastStore";
import "./toast.css";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ToastCardProps {
  toast: ToastRecord;
  onDismiss?: () => void;
  onPositionUpdate?: () => void;
  /** Render as an in-flow specimen instead of an absolutely positioned stack card. */
  standalone?: boolean;
  /** Hide descriptive and record-preview content while retaining available actions. */
  showPreviews?: boolean;
}

// ── ToastCard ─────────────────────────────────────────────────────────────────

export function ToastCard({ toast, onDismiss, onPositionUpdate, standalone = false, showPreviews = true }: ToastCardProps): VNode {
  const [remainingMs, setRemainingMs] = useState(toast.duration);
  const [stopped, setStopped]         = useState(false);
  const [expanded, setExpanded]       = useState(toast.defaultExpanded ?? false);

  const cardRef        = useRef<HTMLElement | null>(null);
  const startedAtRef   = useRef<number | null>(null);
  const pausedAtRef    = useRef<number | null>(null);
  const totalPausedRef = useRef(0);
  const rafRef         = useRef<number>(0);

  const hasTimer = toast.duration > 0;
  const hasPreviewContent = showPreviews && Boolean(
    toast.description
      ?? toast.moduleLabel
      ?? toast.statusLabel
      ?? toast.details?.length
      ?? toast.note
      ?? toast.file,
  );
  const hasExpandableContent = hasPreviewContent || Boolean(toast.actions?.length);
  const canExpand = hasExpandableContent && toast.expandable !== false;
  const shouldPause = stopped || getGlobalPaused();
  const detailsId = `siomac-toast-details-${toast.id}`;

  // ── Dismiss (animated exit via store) ──────────────────────────────────────
  const handleDismiss = useCallback(() => {
    if (onDismiss) onDismiss();
    else dismissToast(toast.id);
  }, [toast.id, onDismiss]);

  // ── Enter animation: add class on mount, remove after animation ──────────────
  useEffect(() => {
    if (standalone) return;
    const el = cardRef.current;
    if (!el) return;
    el.classList.add("entering");
    const t = setTimeout(() => {
      el.classList.remove("entering");
      onPositionUpdate?.();
    }, 420); // slightly past the 0.4s animation
    return () => clearTimeout(t);
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone]);

  // ── Timer: rAF-based countdown (mirrors spec's ToastCard) ────────────────────
  useEffect(() => {
    if (!hasTimer) return;

    startedAtRef.current = Date.now();
    pausedAtRef.current = null;
    totalPausedRef.current = 0;

    const tick = () => {
      const now = Date.now();
      const startedAt = startedAtRef.current ?? now;
      const pausedDuration = pausedAtRef.current === null ? 0 : now - pausedAtRef.current;
      const elapsed = now - startedAt - totalPausedRef.current - pausedDuration;
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
  }, [hasTimer, toast.duration, toast.createdAt, handleDismiss]);

  // ── Keep the rAF timer's pause accounting in sync with all pause sources ─────
  useEffect(() => {
    if (!hasTimer) return;

    if (shouldPause && pausedAtRef.current === null) {
      pausedAtRef.current = Date.now();
    } else if (!shouldPause && pausedAtRef.current !== null) {
      totalPausedRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
  }, [hasTimer, shouldPause]);

  // Expansion and timer-stop change card height; recalculate the deck twice so
  // both the first layout and the end of the CSS transition are captured.
  useEffect(() => {
    onPositionUpdate?.();
    const timeout = window.setTimeout(() => onPositionUpdate?.(), 260);
    return () => window.clearTimeout(timeout);
  }, [expanded, stopped, onPositionUpdate]);

  // ── Action button click ───────────────────────────────────────────────────────
  function handleActionClick(action: ToastActionButton) {
    try {
      if (action.onClick) void action.onClick();
      if (action.href) window.location.assign(action.href);
    } finally {
      if (action.dismissOnClick !== false) handleDismiss();
    }
  }

  // ── "Click to stop" — one-way persistent stop, matching the reference ───────
  function handleStopAutoDismiss() {
    setStopped(true);
  }

  // ── Keyboard dismiss ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape" && toast.dismissible) handleDismiss();
  }, [toast.dismissible, handleDismiss]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <article
      ref={cardRef}
      className={[
        "siomac-toast",
        `siomac-toast--${toast.variant}`,
        `siomac-toast--${toast.tier}`,
        standalone ? "siomac-toast--standalone" : "",
        toast.exiting ? "exiting" : "",
        shouldPause ? "is-paused" : "",
        expanded ? "is-expanded" : ""
      ].filter(Boolean).join(" ")}
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.ariaLive}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="siomac-toast__main">
        <ToastIcon variant={toast.variant} icon={toast.icon} />

        <div className="siomac-toast__body">
          <div className="siomac-toast__title">{toast.title}</div>
        </div>

        <div className="siomac-toast__header-actions">
          {canExpand ? (
            <button
              className="siomac-toast__expand"
              type="button"
              aria-label={expanded ? "Collapse notification details" : "Expand notification details"}
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              <LucideIcon name="ChevronDown" />
            </button>
          ) : null}
          {toast.dismissible ? (
            <button
              className="siomac-toast__close"
              type="button"
              aria-label="Dismiss notification"
              onClick={handleDismiss}
            >
              <LucideIcon name="X" />
            </button>
          ) : null}
        </div>
      </div>

      {canExpand ? (
        <div
          id={detailsId}
          className="siomac-toast__details-shell"
          aria-hidden={!expanded}
        >
          <div className="siomac-toast__details-clip">
            <div className="siomac-toast__details">
              {showPreviews && toast.description ? (
                <div className="siomac-toast__description">{toast.description}</div>
              ) : null}
              {showPreviews && toast.tier !== "normal" ? (
                <>
                  <ToastChips toast={toast} />
                  <ToastSummary toast={toast} />
                  <ToastFile toast={toast} />
                  <ToastNote toast={toast} />
                </>
              ) : null}
              {toast.actions?.length ? (
                <div className="siomac-toast__actions">
                  {toast.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className={[
                        "siomac-toast__action",
                        action.tone ? `siomac-toast__action--${action.tone}` : ""
                      ].filter(Boolean).join(" ")}
                      tabIndex={expanded ? 0 : -1}
                      onClick={() => handleActionClick(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {hasTimer && !stopped ? (
        <footer className="siomac-toast__timer">
          <span className="siomac-toast__timer-text">
            This message will close in <span>{seconds}</span> seconds.
          </span>
          <button type="button" onClick={handleStopAutoDismiss}>
            Click to stop.
          </button>
          {toast.progress !== false ? (
            <ToastProgress duration={toast.duration} remainingMs={remainingMs} />
          ) : null}
        </footer>
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
