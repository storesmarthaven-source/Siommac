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

import { useEffect, useRef, useCallback } from 'preact/hooks';
import type { ToastRecord, ToastAction } from './toastTypes';
import { removeToast, updateToast } from './toastStore';
import { ToastProgress } from './ToastProgress';

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
      removeToast(toastId);
      return;
    }
    const result = await action.onClick();
    // onClick returning false keeps the toast open; anything else dismisses
    if (result !== false) {
      removeToast(toastId);
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
    meta, actions, duration, dismissible, paused, remainingMs,
    onClick, onDismiss,
  } = record;

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef    = useRef<number>(0);
  const remaining   = useRef<number>(remainingMs);

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
      removeToast(id);
    }, remaining.current);
  }, [id, duration, onDismiss]);

  useEffect(() => {
    remaining.current = remainingMs;
    startTimer();
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (e.key === 'Escape') {
      onDismiss?.();
      removeToast(id);
    }
  }, [id, onDismiss]);

  const handleCardClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleDismiss = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onDismiss?.();
    removeToast(id);
  }, [id, onDismiss]);

  // ── Variant class ─────────────────────────────────────────────────────────

  const variantClass = `toast-card--${variant}`;
  const tierClass    = tier === 'rich' ? 'toast-card--rich'
    : tier === 'loading' ? 'toast-card--loading'
    : tier === 'action' ? 'toast-card--action'
    : '';

  const isClickable = !!onClick;

  return (
    <div
      role={role}
      tabIndex={0}
      class={`toast-card ${variantClass} ${tierClass}${isClickable ? ' toast-card--clickable' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={isClickable ? handleCardClick : undefined}
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
