/**
 * src/ui/toast/ToastCard.tsx
 *
 * Single toast card — SIOMAC card design preserved verbatim.
 *
 * Stacking effect integration (archieamas):
 *   - On mount: card gets class `entering` → @keyframes toast-enter fires,
 *     then class is removed so the stacking inline-style can take over.
 *   - Exit: store `exiting` flag → class `exiting` → @keyframes toast-exit,
 *     pointer-events:none. Store removes the record after TOAST_EXIT_MS (450ms).
 *   - Inline bottom/transform/opacity/zIndex are set by Toaster's
 *     updateToastPositions(); cards must NOT set those themselves.
 *
 * Card layout (unchanged):
 *   tier-normal:  grid-template-rows: auto 2px          (main · bar)
 *   action/rich:  grid-template-rows: auto auto 2px     (main · actions · bar)
 *
 * Timer pause: hover/focus on the individual card still pauses auto-dismiss
 * (archieamas has no timer pause, but we keep ours; the container hover
 * also pauses via setGlobalPaused in Toaster).
 */

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { ToastRecord, ToastAction }             from './toastTypes';
import { dismissToast, updateToast, getGlobalPaused } from './toastStore';

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

// ── Action button ─────────────────────────────────────────────────────────────

interface ActionButtonProps {
  action:  ToastAction;
  toastId: string;
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
    <button type="button" class="cpop-toast-action" onClick={handleClick}>
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

  const [secs, setSecs]    = useState(() => Math.ceil(remainingMs / 1000));
  const rafRef             = useRef<number | null>(null);
  const startWallRef       = useRef<number>(Date.now());
  const startRemRef        = useRef<number>(remainingMs);

  useEffect(() => {
    if (paused) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setSecs(Math.ceil(remainingMs / 1000));
      return;
    }
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
  record:           ToastRecord;
  onPositionUpdate: () => void;
}

export function ToastCard({ record, onPositionUpdate }: ToastCardProps) {
  const {
    id, tier, variant, title, message, body, icon, avatarUrl,
    meta, actions, summary, note, duration, dismissible,
    paused, remainingMs, exiting, onClick, onDismiss,
  } = record;

  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef       = useRef<number>(0);
  const remaining      = useRef<number>(remainingMs);
  const localPausedRef = useRef<boolean>(false);
  const cardRef        = useRef<HTMLElement | null>(null);

  // ── Enter animation: add class on mount, remove after animation ──────────────
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.classList.add('entering');
    // The toast-enter animation is 0.4s; remove the class after it so the
    // stacking inline-styles (transform/opacity) from updateToastPositions
    // can take effect without fighting the animation forwards fill.
    const t = setTimeout(() => {
      el.classList.remove('entering');
      onPositionUpdate();
    }, 420); // slightly past the 0.4s animation
    return () => clearTimeout(t);
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const role = (variant === 'error' || variant === 'critical') ? 'alert' : 'status';

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
    onClick?.();
  }, [onClick]);

  const handleDismiss = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onDismiss?.();
    dismissToast(id);
  }, [id, onDismiss]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const isNormal = tier === 'normal' || tier === 'loading';
  const variantClass = `cpop-toast-${variant === 'critical' ? 'error' : variant === 'neutral' ? 'info' : variant}`;
  const isClickable  = !!onClick;

  // Title: prefer title; fall back to message
  const displayTitle = title ?? message ?? '';
  // Body text: body (rich) or message when title is also set
  const displayText  = body ?? (title && message ? message : undefined);
  const hasActions   = actions && actions.length > 0;

  // Progress bar animation duration matches the toast duration
  const barDuration = duration > 0 ? duration : 4000;

  return (
    <article
      ref={cardRef as any}
      role={role}
      tabIndex={0}
      class={[
        'cpop-toast',
        variantClass,
        isNormal    ? 'tier-normal'           : '',
        !!exiting   ? 'exiting'               : '',
        isClickable ? 'toast-card--clickable' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={isClickable ? handleCardClick : undefined}
      aria-label={displayTitle || undefined}
    >
      {/* ── Row 1: main (icon · body · tools) ── */}
      <div class="cpop-toast-main">

        {/* Icon */}
        <div class="cpop-toast-icon" aria-hidden="true">
          {tier === 'loading' ? <LoadingSpinner />
            : icon      ? <i class={icon} aria-hidden="true" />
            : avatarUrl ? <img src={avatarUrl} alt="" class="toast-avatar" />
            : <VariantIcon variant={variant} />
          }
        </div>

        {/* Body */}
        <div class="cpop-toast-body">
          <div class="cpop-toast-title-row">
            <span class="cpop-toast-dot" aria-hidden="true" />
            <div class="cpop-toast-title">{displayTitle}</div>
          </div>

          {displayText && (
            <div class="cpop-toast-text">{displayText}</div>
          )}

          {meta && meta.length > 0 && (
            <div class="cpop-toast-kicker">
              {meta.map((m) => (
                <span key={m} class="cpop-toast-chip">{m}</span>
              ))}
            </div>
          )}

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
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
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

      {/* ── Row 3: progress bar (2px, CSS animation) ── */}
      {duration > 0 && (
        <div
          class="cpop-toast-bar"
          style={{ animationDuration: `${barDuration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </article>
  );
}
