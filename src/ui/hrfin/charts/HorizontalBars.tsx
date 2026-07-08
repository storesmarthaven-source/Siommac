/**
 * src/ui/hrfin/charts/HorizontalBars.tsx — Aurora bar list (1:1 with the mockup
 * `horizontalBars`): each row is `label · bar · value · note`, the bar tinted
 * per row (aging buckets go accent → warning → danger as they age).
 */

import { type VNode } from 'preact';

export interface HBarItem {
  label: string;
  /** Formatted value shown at the row end, e.g. "$169K". */
  value: string;
  /** 0-100 fill width. */
  percent: number;
  tone?: 'accent' | 'warning' | 'danger' | 'success';
  /** Trailing note; defaults to "<percent>%". */
  note?: string;
  /**
   * Optional click handler for drill-through. When provided the row renders with
   * pointer cursor and role="button" so it's keyboard-reachable.
   */
  onClick?: () => void;
}

export function HorizontalBars({ items }: { items: HBarItem[] }): VNode {
  return (
    <div class="hrfin-bar-list">
      {items.map((row, i) => (
        <div
          class={`hrfin-bar-row${row.onClick ? ' is-clickable' : ''}`}
          key={i}
          role={row.onClick ? 'button' : undefined}
          tabIndex={row.onClick ? 0 : undefined}
          aria-label={row.onClick ? `Drill into ${row.label}` : undefined}
          onClick={row.onClick}
          onKeyDown={row.onClick ? (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onClick?.(); } } : undefined}
          style={row.onClick ? { cursor: 'pointer' } : undefined}
        >
          <span>{row.label}</span>
          <div><i class={`is-${row.tone ?? 'accent'}`} style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div>
          <b>{row.value}</b>
          <em>{row.note ?? `${row.percent}%`}</em>
        </div>
      ))}
    </div>
  );
}
