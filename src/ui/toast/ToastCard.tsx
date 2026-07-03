/**
 * src/ui/toast/ToastCard.tsx
 *
 * Single toast card component — Sonner deck-stacking architecture.
 *
 * Layout: position:absolute within the Toaster's fixed region.
 * - Collapsed: translateY(lift * toastsBefore) + scale(1 - toastsBefore * 0.05)
 *              height normalised to frontHeight for stacked cards
 * - Expanded:  translateY(expandedOffset) + scale(1) + natural height
 *
 * Entry: mounts with slide-from-right start state, transitions to identity
 *        after first paint (via `mounted` flag in useEffect). CSS transitions
 *        handle all motion — no keyframes — so retargeting is smooth.
 *
 * Exit: `exiting` flag triggers slide-right + fade via CSS transition.
 *       Remaining cards retarget their transforms (no height-collapse needed
 *       because layout is absolute, not flex flow).
 *
 * Swipe: pointer-capture + rightward drag sets --swipe-amount CSS var.
 *        Dismisses on release if dx >= 45px OR velocity > 0.11 px/ms.
 *        Springs back otherwise.
 *
 * Timers: per-card hover pause; also respects globalPaused (expand/tab-hidden).
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { ToastRecord, ToastAction } from './toastTypes';
import { dismissToast, updateToast, getGlobalPaused } from './toastStore';
import { ToastProgress } from './ToastProgress';

/** Horizontal swipe threshold (px) — release past here = dismiss. */
const SWIPE_CLOSE_PX   = 45;
/** Swipe velocity threshold (px/ms) — fast flick also dismisses. */
const SWIPE_VELOCITY   = 0.11;
/** Opacity fully reaches 0 at this swipe distance. */
const SWIPE_FADE_PX    = 160;

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
  action:   ToastAction;
  toastId:  string;
  isFirst?: boolean;
}

function ActionButton({ action, toastId, isFirst }: ActionButtonProps) {
  const tone = action.tone ?? (isFirst ? 'primary' : 'secondary');
  const toneClass = tone === 'danger'   ? 'toast-action--danger'
    : tone === 'primary'   ? 'toast-action--primary'
    : 'toast-action--secondary';

  const handleClick = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (!action.onClick) {
      dismissToast(toastId);
      return;
    }
    const result = await action.onClick();
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
  record:         ToastRecord;
  /** Cards newer than this one (front = 0). */
  toastsBefore:   number;
  /** px each stacked card translates DOWN behind the front. */
  liftAmount:     number;
  /** Height of the front (newest) toast in px — used for height-normalisation. */
  frontHeight:    number;
  /** Whether the deck is expanded (hovered). */
  expanded:       boolean;
  /** translateY offset in expanded state (px from top of container). */
  expandedOffset: number;
  /** Whether this card is within the peek window (toastsBefore < MAX_PEEK). */
  visible:        boolean;
  /** Report measured height back to Toaster for offset calculation. */
  onMeasure:      (id: string, height: number) => void;
}

export function ToastCard({
  record,
  toastsBefore,
  liftAmount,
  frontHeight,
  expanded,
  expandedOffset,
  visible,
  onMeasure,
}: ToastCardProps) {
  const {
    id, tier, variant, title, message, body, icon, avatarUrl,
    meta, actions, duration, dismissible, paused, remainingMs, exiting,
    onClick, onDismiss,
  } = record;

  const cardRef         = useRef<HTMLDivElement>(null);
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef        = useRef<number>(0);
  const remaining       = useRef<number>(remainingMs);
  const localPausedRef  = useRef<boolean>(false);

  // Entry animation: start collapsed/offscreen, transition to identity after mount
  const [mounted, setMounted] = useState(false);

  // Swipe state
  const [swipeX, setSwipeX]  = useState(0);
  const swipeXRef            = useRef(0);
  const dragging             = useRef(false);
  const dragStartX           = useRef(0);
  const dragStartTime        = useRef(0);
  const movedRef             = useRef(false);

  const role = (variant === 'error' || variant === 'critical') ? 'alert' : 'status';

  // ── Measure height for Toaster layout ────────────────────────────────────

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0) onMeasure(id, h);
  });

  // ── Entry: set mounted=true after first paint ─────────────────────────────

  useEffect(() => {
    // requestAnimationFrame ensures the browser has painted the initial (unmounted)
    // transform before we apply the mounted state, triggering the CSS transition.
    const raf = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer management ──────────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    if (duration <= 0 || remaining.current <= 0) return;
    if (localPausedRef.current || getGlobalPaused()) return;
    startRef.current  = Date.now();
    timerRef.current  = setTimeout(() => {
      onDismiss?.();
      dismissToast(id);
    }, remaining.current);
  }, [id, duration, onDismiss]);

  // Start timer on mount
  useEffect(() => {
    remaining.current = remainingMs;
    startTimer();
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to globalPaused changes ─────────────────────────────────────────

  useEffect(() => {
    if (paused || localPausedRef.current) return; // card-level pause takes precedence
    if (getGlobalPaused()) {
      clearTimer();
      const elapsed = Date.now() - startRef.current;
      remaining.current = Math.max(0, remaining.current - elapsed);
    } else {
      startTimer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]); // fires when store updates propagate via record.paused

  // ── Hover: pause/resume this card's timer ─────────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (duration <= 0) return;
    localPausedRef.current = true;
    clearTimer();
    const elapsed = Date.now() - startRef.current;
    remaining.current = Math.max(0, remaining.current - elapsed);
    updateToast(id, { paused: true, remainingMs: remaining.current });
  }, [id, duration, clearTimer]);

  const handleMouseLeave = useCallback(() => {
    if (duration <= 0) return;
    localPausedRef.current = false;
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
    if (movedRef.current) { movedRef.current = false; return; }
    onClick?.();
  }, [onClick]);

  const handleDismiss = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onDismiss?.();
    dismissToast(id);
  }, [id, onDismiss]);

  // ── Swipe-to-dismiss (pointer drag toward the right edge) ─────────────────

  const applySwipe = useCallback((px: number) => {
    swipeXRef.current = px;
    setSwipeX(px);
    if (cardRef.current) {
      cardRef.current.style.setProperty('--swipe-amount', `${px}px`);
    }
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (!dismissible || exiting || e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.('.toast-action, .toast-close')) return;
    dragging.current   = true;
    movedRef.current   = false;
    dragStartX.current = e.clientX;
    dragStartTime.current = Date.now();
    clearTimer();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [dismissible, exiting, clearTimer]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const dx = Math.max(0, e.clientX - dragStartX.current);
    if (dx > 4) movedRef.current = true;
    applySwipe(dx);
  }, [applySwipe]);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx       = swipeXRef.current;
    const elapsed  = Math.max(1, Date.now() - dragStartTime.current);
    const velocity = dx / elapsed;
    if (dx >= SWIPE_CLOSE_PX || velocity > SWIPE_VELOCITY) {
      onDismiss?.();
      dismissToast(id);
    } else {
      applySwipe(0);
      startTimer();
    }
  }, [id, onDismiss, applySwipe, startTimer]);

  // ── Derive CSS variables and inline styles ────────────────────────────────

  const isFront     = toastsBefore === 0;
  const isExiting   = !!exiting;
  const isDragging  = swipeX > 0;
  const isClickable = !!onClick;

  const variantClass = `toast-card--${variant}`;
  const tierClass    = tier === 'rich'    ? 'toast-card--rich'
    : tier === 'loading' ? 'toast-card--loading'
    : tier === 'action'  ? 'toast-card--action'
    : '';

  // Build style object — CSS vars drive the animation via CSS rules
  const style: Record<string, string | number> = {
    '--toasts-before':     toastsBefore,
    '--lift-amount':       `${liftAmount}px`,
    '--front-toast-height': `${frontHeight}px`,
    '--offset':            `${expandedOffset}px`,
  };

  // Swipe opacity (fade while dragging)
  if (isDragging && !isExiting) {
    style['opacity'] = Math.max(0, 1 - swipeX / SWIPE_FADE_PX);
  }

  return (
    <div
      ref={cardRef}
      role={role}
      tabIndex={0}
      class={[
        'toast-card',
        variantClass,
        tierClass,
        mounted   ? 'toast-card--mounted'   : '',
        expanded  ? 'toast-card--expanded'  : '',
        isFront   ? 'toast-card--front'     : '',
        !visible  ? 'toast-card--hidden'    : '',
        isDragging ? 'toast-card--dragging' : '',
        isExiting  ? 'toast-card--exiting'  : '',
        isClickable ? 'toast-card--clickable' : '',
      ].filter(Boolean).join(' ')}
      style={style as Record<string, string>}
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
          : icon       ? <i class={icon} aria-hidden="true" />
          : avatarUrl  ? <img src={avatarUrl} alt="" class="toast-avatar" />
          : <VariantIcon variant={variant} />
        }
      </div>

      {/* Body */}
      <div class="toast-body">
        {title   && <div class="toast-title">{title}</div>}
        {message && <div class="toast-message">{message}</div>}
        {body    && <div class="toast-body-text">{body}</div>}

        {meta && meta.length > 0 && (
          <div class="toast-meta">
            {meta.map((m) => (
              <span key={m} class="toast-meta-chip">{m}</span>
            ))}
          </div>
        )}

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
            <line x1="18" y1="6" x2="6"  y2="18" stroke-linecap="round" stroke-width="2.5" />
            <line x1="6"  y1="6" x2="18" y2="18" stroke-linecap="round" stroke-width="2.5" />
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
