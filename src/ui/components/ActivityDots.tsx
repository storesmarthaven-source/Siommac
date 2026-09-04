import { type VNode } from 'preact';
import './activity-dots.css';

export type ActivityDotsSize = 'sm' | 'md' | 'lg';

export interface ActivityDotsProps {
  /** Polite status text announced to assistive technology. */
  label?: string;
  /** Visual scale of the four-dot activity mark. */
  size?: ActivityDotsSize;
  /** Additional class for placement without changing the component recipe. */
  class?: string;
}

/**
 * Lightweight indeterminate activity feedback for compact asynchronous regions.
 * Uses compositor-only transforms and no runtime animation dependency.
 */
export function ActivityDots({ label = 'Loading…', size = 'md', class: extra }: ActivityDotsProps): VNode {
  return (
    <span
      class={`ui-activity-dots ui-activity-dots--${size}${extra ? ` ${extra}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <span class="ui-activity-dots__track" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span class="ui-activity-dots__label">{label}</span>
    </span>
  );
}
