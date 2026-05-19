/**
 * src/components/shared/Spinner.tsx
 *
 * Accessible loading spinner.
 *
 * Usage:
 *   <Spinner />                         // 24px, centered
 *   <Spinner size={16} />               // inline small
 *   <Spinner label="Loading employees" /> // custom SR label
 *   <Spinner fullPage />                 // covers the containing block
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import type { VNode } from 'preact';

export interface SpinnerProps {
  /** Diameter in px. Default: 32 */
  size?:     number;
  /** Stroke colour. Default: inherits currentColor (works on any background) */
  color?:    string;
  /** Screen-reader label. Default: 'Loading…' */
  label?:    string;
  /** Stretch to fill the parent container and centre vertically */
  fullPage?: boolean;
  className?: string;
}

export function Spinner({
  size      = 32,
  color     = 'currentColor',
  label     = 'Loading…',
  fullPage  = false,
  className = '',
}: SpinnerProps): VNode {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ animation: 'siomac-spin 0.75s linear infinite', display: 'block', flexShrink: 0 }}
    >
      {/* Three-quarter arc — classic spinner shape */}
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
      <path d="M12 2 a10 10 0 0 1 10 10" />
    </svg>
  );

  if (fullPage) {
    return (
      <div
        class={`siomac-spinner-fullpage ${className}`}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          minHeight:      '200px',
          width:          '100%',
        }}
        role="status"
        aria-label={label}
      >
        {svg}
        <span class="visually-hidden">{label}</span>
      </div>
    );
  }

  return (
    <span
      class={`siomac-spinner ${className}`}
      role="status"
      aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {svg}
      <span class="visually-hidden">{label}</span>
    </span>
  );
}

// Inject the keyframe animation once (idempotent)
if (typeof document !== 'undefined') {
  const STYLE_ID = 'siomac-spinner-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id        = STYLE_ID;
    style.textContent = `
      @keyframes siomac-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}
