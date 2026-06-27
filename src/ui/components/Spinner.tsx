/**
 * src/ui/components/Spinner.tsx
 *
 * A small inline loading spinner — for COMPACT / numeric / inline sections where a
 * skeleton is overkill (a stat number, a short activity list, a small table).
 * Skeletons remain the default for full registers, cards, and detail surfaces.
 *
 * Inherits `currentColor` so it adapts to light and navy (drawer) surfaces.
 * Styled by `.ui-spinner*` in assets/styles/uikit-layout.css.
 */

import { type VNode } from 'preact';

export interface SpinnerProps {
  /** Diameter in px (default 18). */
  size?: number;
  /** Optional text beside the spinner. */
  label?: string;
  /** Centre it in a padded block (for card bodies). */
  center?: boolean;
}

export function Spinner({ size = 18, label, center = false }: SpinnerProps): VNode {
  const spinner = (
    <span class="ui-spinner-wrap" role="status" aria-live="polite">
      <span class="ui-spinner" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />
      {label && <span class="ui-spinner-label">{label}</span>}
    </span>
  );
  return center ? <div class="ui-spinner-center">{spinner}</div> : spinner;
}
