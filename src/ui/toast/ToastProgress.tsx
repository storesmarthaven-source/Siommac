/**
 * src/ui/toast/ToastProgress.tsx
 *
 * Animated progress bar for toast auto-dismiss timer.
 * Respects prefers-reduced-motion.
 */

import type { ToastVariant } from './toastTypes';

interface ToastProgressProps {
  duration:    number;
  remainingMs: number;
  paused:      boolean;
  variant:     ToastVariant;
}

// Map variant to progress bar color class
const VARIANT_BAR_CLASS: Record<ToastVariant, string> = {
  success:  'toast-progress--success',
  error:    'toast-progress--error',
  warning:  'toast-progress--warning',
  info:     'toast-progress--info',
  neutral:  'toast-progress--neutral',
  critical: 'toast-progress--critical',
};

export function ToastProgress({ duration, remainingMs, paused, variant }: ToastProgressProps) {
  if (duration <= 0) return null;

  const pct = Math.max(0, Math.min(100, (remainingMs / duration) * 100));

  return (
    <div class="toast-progress-track" role="none">
      <div
        class={`toast-progress-bar ${VARIANT_BAR_CLASS[variant]}`}
        style={{ width: `${pct}%`, animationPlayState: paused ? 'paused' : 'running' }}
      />
    </div>
  );
}
