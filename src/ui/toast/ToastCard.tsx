/**
 * src/ui/toast/ToastCard.tsx
 *
 * Single toast card component.
 * - Pauses dismiss timer and progress bar on hover/focus
 * - Esc key dismisses
 * - action buttons stop propagation
 * - avatar OR variant icon chip
 * - role="alert" for error/critical, role="status" for others
 * - Respects prefers-reduced-motion
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { ToastRecord, ToastAction } from './toastTypes';
import { dismissToast, updateToast } from './toastStore';
import { ToastProgress } from './ToastProgress';

/** Horizontal distance (px) a swipe must travel before it dismisses on release. */
const SWIPE_CLOSE_PX = 80;
/** Opacity reaches ~0 as the swipe approaches this distance. */
const SWIPE_FADE_PX  = 160;
/** Entry height-expand window; must cover the height transition in toast.css. */
const ENTER_MS       = 300;

// ── Icon SVGs per variant ─────────────────────────────────────────────────────

function VariantIcon({ variant }: { variant: ToastRecord['variant'] }) {
  switch (variant) {
    case 'success':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path class="check" d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case 'error':
    case 'critical':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line class="x1" x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" />
          <line class="x2" x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" />
        </svg>
      );
    case 'warning':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 9v4M12 17h.01" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case 'info':
    case 'neutral':
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" stroke-linecap="round" />
          <line x1="12" y1="16" x2="12.01" y2="16" stroke-linecap="round" />
        </svg>
      );
  }
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="toast-icon-spinner">
      <circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" />
    </svg>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

interface ActionButtonProps {
  action:    ToastAction;
  toastId:   string;
  isFirst?:  boolean;
}

function ActionButton({ action, toastId, isFirst }: ActionButtonProps) {
  const tone = action.tone ?? (isFirst ? 'primary' : 'secondary');
  const toneClass = tone === 'danger' ? 'toast-action--danger'
    : tone === 'primary' ? 'toast-action--primary'
    : 'toast-action--secondary';

  const handleClick = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (!action.onClick) {
      dismissToast(toastId);
      return;
    }
    const result = await action.onClick();
    // onClick returning false keeps the toast open; anything else dismisses
    if (result !== false) {
      dismissToast(toastId);
    }
  }, [action, toastId]);

  return (
    <button
      type="button"
      class={`toast-action ${toneClass}`}
      onClick={handleClick}
    >
      {action.label}
    </button>
  );
}

// ── ToastCard ─────────────────────────────────────────────────────────────────

interface ToastCardProps {
  record: ToastRecord;
}

export function ToastCard({ record }: ToastCardProps) {
  const {
    id, tier, variant, title, message, body, icon, avatarUrl,
    meta, actions, duration, dismissible, paused, remainingMs, exiting,
    onClick, onDismiss,
  } = record;

  const cardRef      = useRef<HTMLDivElement>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef     = useRef<number>(0);
  const remaining    = useRef<number>(remainingMs);

  // Swipe-to-dismiss state: dragX drives the live transform; the ref mirrors it
  // so the release handler reads the latest value without a stale closure.
  const [dragX, setDragX] = useState(0);
  const dragXRef    = useRef(0);
  const dragging    = useRef(false);
  const dragStartX  = useRef(0);
  const movedRef    = useRef(false);

  const role = (variant === 'error' || variant === 'critical') ? 'alert' : 'status';

  // ── Timer management ──────────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    if (duration <= 0 || remaining.current <= 0) return;
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss?.();
      dismissToast(id);
    }, remaining.current);
  }, [id, duration, onDismiss]);

  useEffect(() => {
    remaining.current = remainingMs;
    startTimer();
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Entry: expand height 0 → natural so the stack pushes down smoothly ──────
  // Mirror of the exit collapse; runs once on mount. The CSS keyframe carries
  // the slide + scale while height/margin animate the reflow. useLayoutEffect
  // runs before paint so there's no full-height flash before the collapse.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || exiting) return;
    const h = el.offsetHeight;                        // natural height
    el.style.height    = '0px';
    el.style.marginTop = 'calc(var(--toast-gap) * -1)';
    void el.offsetHeight;                             // reflow: pin collapsed start
    el.style.height    = `${h}px`;                    // → transitions open
    el.style.marginTop = '';
    enterTimerRef.current = setTimeout(() => {
      // Release the fixed height so later content changes reflow naturally.
      if (cardRef.current) cardRef.current.style.height = '';
    }, ENTER_MS);
    return () => { if (enterTimerRef.current) clearTimeout(enterTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Exit: measure current height, then collapse to 0 so the stack glides up ──
  // Driven off the record's `exiting` flag (set by dismissToast). We pin the
  // live height, force a reflow, then animate height/margin/padding to 0 — the
  // CSS transition on `.toast-card` carries the slide + fade at the same time.
  useEffect(() => {
    if (!exiting) return;
    clearTimer();
    // Cancel any pending entry height-release so it can't clobber the collapse.
    if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    el.style.height = `${h}px`;
    void el.offsetHeight; // force reflow so 0 animates from a concrete start
    el.style.height        = '0px';
    el.style.marginTop     = 'calc(var(--toast-gap) * -1)'; // eat one flex gap
    el.style.paddingTop    = '0px';
    el.style.paddingBottom = '0px';
  }, [exiting, clearTimer]);

  const handleMouseEnter = useCallback(() => {
    if (duration <= 0) return;
    clearTimer();
    const elapsed = Date.now() - startRef.current;
    remaining.current = Math.max(0, remaining.current - elapsed);
    updateToast(id, { paused: true, remainingMs: remaining.current });
  }, [id, duration, clearTimer]);

  const handleMouseLeave = useCallback(() => {
    if (duration <= 0) return;
    updateToast(id, { paused: false, remainingMs: remaining.current });
    startTimer();
  }, [id, duration, startTimer]);

  const handleFocus = handleMouseEnter;
  const handleBlur  = handleMouseLeave;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      onDismiss?.();
      dismissToast(id);
    }
  }, [id, dismissible, onDismiss]);

  const handleCardClick = useCallback(() => {
    // Suppress the click that ends a swipe/drag.
    if (movedRef.current) { movedRef.current = false; return; }
    onClick?.();
  }, [onClick]);

  const handleDismiss = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onDismiss?.();
    dismissToast(id);
  }, [id, onDismiss]);

  // ── Swipe-to-dismiss (pointer drag toward the right edge) ─────────────────
  const setDrag = useCallback((px: number) => {
    dragXRef.current = px;
    setDragX(px);
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (!dismissible || exiting || e.button !== 0) return;
    // Don't start a swipe from the action or close buttons.
    if ((e.target as HTMLElement).closest?.('.toast-action, .toast-close')) return;
    dragging.current   = true;
    movedRef.current   = false;
    dragStartX.current = e.clientX;
    clearTimer(); // hold the auto-dismiss while the user is interacting
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [dismissible, exiting, clearTimer]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const dx = Math.max(0, e.clientX - dragStartX.current); // rightward only
    if (dx > 4) movedRef.current = true;
    setDrag(dx);
  }, [setDrag]);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragXRef.current > SWIPE_CLOSE_PX) {
      onDismiss?.();
      dismissToast(id);           // exit animation takes over from here
    } else {
      setDrag(0);                 // spring back
      startTimer();               // resume the auto-dismiss
    }
  }, [id, onDismiss, setDrag, startTimer]);

  // ── Variant class ─────────────────────────────────────────────────────────

  const variantClass = `toast-card--${variant}`;
  const tierClass    = tier === 'rich' ? 'toast-card--rich'
    : tier === 'loading' ? 'toast-card--loading'
    : tier === 'action' ? 'toast-card--action'
    : '';

  const isClickable = !!onClick;

  const isDragging = dragX > 0;

  return (
    <div
      ref={cardRef}
      role={role}
      tabIndex={0}
      class={`toast-card ${variantClass} ${tierClass}`
        + `${isClickable ? ' toast-card--clickable' : ''}`
        + `${isDragging ? ' toast-card--dragging' : ''}`
        + `${exiting ? ' toast-card--exiting' : ''}`}
      style={isDragging && !exiting ? {
        transform: `translateX(${dragX}px)`,
        opacity:   Math.max(0, 1 - dragX / SWIPE_FADE_PX),
      } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={isClickable ? handleCardClick : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label={title ?? message}
    >
      {/* Icon chip */}
      <div class={`toast-icon-chip toast-icon-chip--${variant}`} aria-hidden="true">
        {tier === 'loading' ? <LoadingSpinner />
          : icon ? <i class={icon} aria-hidden="true" />
          : avatarUrl ? <img src={avatarUrl} alt="" class="toast-avatar" />
          : <VariantIcon variant={variant} />
        }
      </div>

      {/* Body */}
      <div class="toast-body">
        {title   && <div class="toast-title">{title}</div>}
        {message && <div class="toast-message">{message}</div>}
        {body    && <div class="toast-body-text">{body}</div>}

        {/* Meta chips */}
        {meta && meta.length > 0 && (
          <div class="toast-meta">
            {meta.map((m) => (
              <span key={m} class="toast-meta-chip">{m}</span>
            ))}
          </div>
        )}

        {/* Action buttons (up to 2) */}
        {actions && actions.length > 0 && (
          <div class="toast-actions">
            {actions.slice(0, 2).map((action, i) => (
              <ActionButton key={action.label} action={action} toastId={id} isFirst={i === 0} />
            ))}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      {dismissible && (
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss notification"
          onClick={handleDismiss}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" stroke-width="2.5" />
            <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" stroke-width="2.5" />
          </svg>
        </button>
      )}

      {/* Progress bar */}
      {duration > 0 && (
        <ToastProgress
          duration={duration}
          remainingMs={paused ? remaining.current : remainingMs}
          paused={paused}
          variant={variant}
        />
      )}
    </div>
  );
}
