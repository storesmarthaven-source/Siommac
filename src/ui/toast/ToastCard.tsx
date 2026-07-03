/**
 * src/ui/toast/ToastCard.tsx
 *
 * Single toast card — SIOMAC new design (chosen normal + action spec).
 *
 * Grid layout (matches the spec):
 *   tier-normal:  grid-template-rows: auto 2px
 *   tier-action/rich: grid-template-rows: auto auto 2px
 *     row 1 = .cpop-toast-main  (icon · body · tools)
 *     row 2 = .cpop-toast-actions (action strip, hidden for normal)
 *     row 3 = .cpop-toast-bar  (progress, 2px)
 *
 * Body interior:
 *   - title-row: dot + title
 *   - text (message / body)
 *   - kicker chips (meta[])
 *   - action-summary (summary[] key/value rows)
 *   - action-note (note)
 *
 * Tools (top-right column):
 *   - countdown badge (live seconds remaining, hidden when duration <= 0, pauses on hover)
 *   - close button
 *
 * Deck stacking (PRESERVED — Sonner architecture unchanged):
 *   position:absolute, CSS vars --toasts-before / --lift-amount / --front-toast-height /
 *   --offset / --swipe-amount, globalPaused, tab-hidden pause, swipe-to-dismiss.
 *
 * Enter: translateX(22px) translateY(6px) opacity:0 → identity (CSS transition, not keyframe).
 * Exit:  translateY(-100%) scale(0.95) opacity:0  (slides UP).
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

// ── Icon SVGs (spec viewBox 0 0 52 52, stroke-width 3.6) ─────────────────────

function VariantIcon({ variant }: { variant: ToastRecord['variant'] }) {
  switch (variant) {
    case 'success':
      return (
        <svg viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.6">
          <circle cx="26" cy="26" r="22" />
          <path d="M16 27.5l6.5 6.5L37 18" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case 'error':
    case 'critical':
      return (
        <svg viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.6">
          <circle cx="26" cy="26" r="22" />
          <path d="M18 18l16 16M34 18L18 34" stroke-linecap="round" />
        </svg>
      );
    case 'warning':
      return (
        <svg viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.6">
          <path d="M26 7L48 45H4L26 7Z" stroke-linejoin="round" />
          <line x1="26" y1="20" x2="26" y2="31" stroke-linecap="round" />
          <circle cx="26" cy="38" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'info':
    case 'neutral':
    default:
      return (
        <svg viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.6">
          <circle cx="26" cy="26" r="22" />
          <circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none" />
          <line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round" />
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

// ── Action button (action-strip style) ────────────────────────────────────────

interface ActionButtonProps {
  action:   ToastAction;
  toastId:  string;
}

function ActionButton({ action, toastId }: ActionButtonProps) {
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
      class="cpop-toast-action"
      onClick={handleClick}
    >
      {action.label}
    </button>
  );
}

// ── Countdown badge ───────────────────────────────────────────────────────────

interface CountdownProps {
  duration:    number;
  remainingMs: number;
  paused:      boolean;
}

function CountdownBadge({ duration, remainingMs, paused }: CountdownProps) {
  if (duration <= 0) return null;

  // Live countdown: tick every second using rAF while not paused
  const [secs, setSecs] = useState(() => Math.ceil(remainingMs / 1000));
  const rafRef          = useRef<number | null>(null);
  const startWallRef    = useRef<number>(Date.now());
  const startRemRef     = useRef<number>(remainingMs);

  useEffect(() => {
    if (paused) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setSecs(Math.ceil(remainingMs / 1000));
      return;
    }
    // (Re)start the ticker
    startWallRef.current = Date.now();
    startRemRef.current  = remainingMs;

    function tick() {
      const elapsed   = Date.now() - startWallRef.current;
      const remaining = Math.max(0, startRemRef.current - elapsed);
      setSecs(Math.ceil(remaining / 1000));
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, remainingMs]);

  return (
    <span class="cpop-toast-countdown" aria-hidden="true">
      {secs}s
    </span>
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
    meta, actions, summary, note, duration, dismissible,
    paused, remainingMs, exiting, onClick, onDismiss,
  } = record;

  const cardRef         = useRef<HTMLElement>(null);
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef        = useRef<number>(0);
  const remaining       = useRef<number>(remainingMs);
  const localPausedRef  = useRef<boolean>(false);

  // Entry animation: mount in off-screen state, transition to identity after first RAF
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

  // ── React to globalPaused changes ─────────────────────────────────────────

  useEffect(() => {
    if (paused || localPausedRef.current) return;
    if (getGlobalPaused()) {
      clearTimer();
      const elapsed = Date.now() - startRef.current;
      remaining.current = Math.max(0, remaining.current - elapsed);
    } else {
      startTimer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // ── Hover: pause/resume timer ─────────────────────────────────────────────

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

  // ── Swipe-to-dismiss ──────────────────────────────────────────────────────

  const applySwipe = useCallback((px: number) => {
    swipeXRef.current = px;
    setSwipeX(px);
    if (cardRef.current) {
      cardRef.current.style.setProperty('--swipe-amount', `${px}px`);
    }
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (!dismissible || exiting || e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.('.cpop-toast-action, .cpop-toast-close')) return;
    dragging.current      = true;
    movedRef.current      = false;
    dragStartX.current    = e.clientX;
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

  // ── Derived classes and styles ────────────────────────────────────────────

  const isFront     = toastsBefore === 0;
  const isExiting   = !!exiting;
  const isDragging  = swipeX > 0;
  const isClickable = !!onClick;

  // Determine tier class: normal = no action strip; action/rich = with action strip
  const isNormal = tier === 'normal' || tier === 'loading';
  const variantClass = `cpop-toast-${variant === 'critical' ? 'error' : variant === 'neutral' ? 'info' : variant}`;

  const style: Record<string, string | number> = {
    '--toasts-before':      toastsBefore,
    '--lift-amount':        `${liftAmount}px`,
    '--front-toast-height': `${frontHeight}px`,
    '--offset':             `${expandedOffset}px`,
  };

  if (isDragging && !isExiting) {
    style['opacity'] = Math.max(0, 1 - swipeX / SWIPE_FADE_PX);
  }

  // Text to show in the title row. Prefer title; fall back to message for simple toasts.
  const displayTitle = title ?? message ?? '';
  // Body text = body (rich) or message when title is also present, else nothing extra
  const displayText = body ?? (title && message ? message : undefined);

  const hasActions = actions && actions.length > 0;

  return (
    <article
      ref={cardRef}
      role={role}
      tabIndex={0}
      class={[
        'toast-card',
        'cpop-toast',
        variantClass,
        isNormal   ? 'tier-normal'          : '',
        mounted    ? 'toast-card--mounted'   : '',
        expanded   ? 'toast-card--expanded'  : '',
        isFront    ? 'toast-card--front'     : '',
        !visible   ? 'toast-card--hidden'    : '',
        isDragging ? 'toast-card--dragging'  : '',
        isExiting  ? 'toast-card--exiting'   : '',
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
      aria-label={displayTitle || undefined}
    >
      {/* ── Row 1: main (icon · body · tools) ── */}
      <div class="cpop-toast-main">

        {/* Icon */}
        <div class="cpop-toast-icon" aria-hidden="true">
          {tier === 'loading' ? <LoadingSpinner />
            : icon       ? <i class={icon} aria-hidden="true" />
            : avatarUrl  ? <img src={avatarUrl} alt="" class="toast-avatar" />
            : <VariantIcon variant={variant} />
          }
        </div>

        {/* Body */}
        <div class="cpop-toast-body">
          {/* Title row: colored dot + title text */}
          <div class="cpop-toast-title-row">
            <span class="cpop-toast-dot" aria-hidden="true" />
            <div class="cpop-toast-title">{displayTitle}</div>
          </div>

          {/* Message / body text */}
          {displayText && (
            <div class="cpop-toast-text">{displayText}</div>
          )}

          {/* Kicker chips (meta[]) */}
          {meta && meta.length > 0 && (
            <div class="cpop-toast-kicker">
              {meta.map((m) => (
                <span key={m} class="cpop-toast-chip">{m}</span>
              ))}
            </div>
          )}

          {/* Action-summary block */}
          {summary && summary.length > 0 && (
            <div class="cpop-action-summary">
              {summary.map((row) => (
                <div key={row.label} class="cpop-action-line">
                  <span class="cpop-action-label">{row.label}</span>
                  <span class="cpop-action-value">{row.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action-note */}
          {note && (
            <div class="cpop-action-note">{note}</div>
          )}
        </div>

        {/* Tools: countdown + close */}
        <div class="cpop-toast-tools">
          <CountdownBadge
            duration={duration}
            remainingMs={remainingMs}
            paused={paused}
          />

          {dismissible && (
            <button
              type="button"
              class="cpop-toast-close"
              aria-label="Dismiss notification"
              onClick={handleDismiss}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Row 2: action strip (hidden for tier-normal via CSS) ── */}
      <div class="cpop-toast-actions">
        {hasActions && actions!.slice(0, 2).map((action) => (
          <ActionButton key={action.label} action={action} toastId={id} />
        ))}
      </div>

      {/* ── Row 3: progress bar (2px) ── */}
      <ToastProgress
        duration={duration}
        remainingMs={paused ? remaining.current : remainingMs}
        paused={paused}
        variant={variant}
      />
    </article>
  );
}
