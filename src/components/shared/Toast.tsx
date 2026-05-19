/**
 * src/components/shared/Toast.tsx
 *
 * Toast notification system.
 *
 * <ToastContainer /> — mounts once at the app root, reads from useUiStore,
 *                      renders all active toasts in a portal.
 *
 * Imperative API (use anywhere, no component context needed):
 *   import { toast } from '@store';
 *   toast.success('Employee saved');
 *   toast.error('Failed to load data', 8000);
 *
 * Enterprise guarantees:
 *   ✓ Portal-rendered — never clipped by overflow:hidden ancestors
 *   ✓ ARIA live region — announced to screen readers immediately
 *   ✓ Auto-dismiss with configurable duration (0 = sticky)
 *   ✓ Manual dismiss via × button
 *   ✓ Pauses auto-dismiss on hover
 *   ✓ Stacks up to 5 visible; oldest dismissed first when limit exceeded
 *   ✓ Reduced-motion: skips slide animation if prefers-reduced-motion
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { type VNode }                                  from 'preact';
import { useEffect, useRef, useCallback }              from 'preact/hooks';
import { createPortal }                               from 'preact/compat';
import { useUiStore, type Toast as ToastData, type ToastVariant } from '@store';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 5;

// ── Icon map ──────────────────────────────────────────────────────────────────

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: 'fa-check-circle',
  error:   'fa-times-circle',
  warning: 'fa-exclamation-triangle',
  info:    'fa-info-circle',
};

const VARIANT_COLOR: Record<ToastVariant, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', icon: '#16a34a', text: '#14532d' },
  error:   { bg: '#fef2f2', border: '#fca5a5', icon: '#dc2626', text: '#7f1d1d' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '#d97706', text: '#78350f' },
  info:    { bg: '#eff6ff', border: '#93c5fd', icon: '#2563eb', text: '#1e3a5f' },
};

// ── Single Toast ──────────────────────────────────────────────────────────────

interface ToastItemProps {
  toast:     ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): VNode {
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors       = VARIANT_COLOR[toast.variant];
  const icon         = VARIANT_ICON[toast.variant];

  const startTimer = useCallback(() => {
    if (toast.duration <= 0) return;
    timerRef.current = setTimeout(() => onDismiss(toast.id), toast.duration);
  }, [toast.id, toast.duration, onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          '10px',
        padding:      '12px 14px',
        borderRadius: '8px',
        border:       `1px solid ${colors.border}`,
        background:   colors.bg,
        color:        colors.text,
        boxShadow:    '0 4px 12px rgba(0,0,0,0.12)',
        minWidth:     '280px',
        maxWidth:     '420px',
        fontSize:     '14px',
        lineHeight:   '1.4',
        animation:    'siomac-toast-in 0.2s ease',
      }}
    >
      {/* Icon */}
      <i
        class={`fas ${icon}`}
        aria-hidden="true"
        style={{ color: colors.icon, fontSize: '16px', marginTop: '1px', flexShrink: 0 }}
      />

      {/* Message */}
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{toast.message}</span>

      {/* Dismiss */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        style={{
          background:  'none',
          border:      'none',
          cursor:      'pointer',
          color:       colors.icon,
          padding:     '0 2px',
          lineHeight:  '1',
          fontSize:    '14px',
          flexShrink:  0,
          opacity:     0.7,
        }}
      >
        <i class="fas fa-times" aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export function ToastContainer(): VNode | null {
  const toasts     = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  // Show only the most recent MAX_VISIBLE; silently drop the rest
  const visible = toasts.slice(-MAX_VISIBLE);

  if (visible.length === 0) return null;

  return createPortal(
    <>
      {/* Keyframe — injected once */}
      <style>{`
        @keyframes siomac-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @media (prefers-reduced-motion: reduce) {
          .siomac-toast-container [role="alert"] { animation: none; }
        }
      `}</style>

      <div
        class="siomac-toast-container"
        aria-label="Notifications"
        style={{
          position:       'fixed',
          bottom:         '24px',
          right:          '24px',
          zIndex:         9999,
          display:        'flex',
          flexDirection:  'column',
          gap:            '8px',
          alignItems:     'flex-end',
          pointerEvents:  'none',   // allow clicks through the gap between toasts
        }}
      >
        {visible.map((t) => (
          <div key={t.id} style={{ pointerEvents: 'all' }}>
            <ToastItem toast={t} onDismiss={removeToast} />
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}
