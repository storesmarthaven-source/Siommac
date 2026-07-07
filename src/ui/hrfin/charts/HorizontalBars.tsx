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
}

export function HorizontalBars({ items }: { items: HBarItem[] }): VNode {
  return (
    <div class="hrfin-bar-list">
      {items.map((row, i) => (
        <div class="hrfin-bar-row" key={i}>
          <span>{row.label}</span>
          <div><i class={`is-${row.tone ?? 'accent'}`} style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div>
          <b>{row.value}</b>
          <em>{row.note ?? `${row.percent}%`}</em>
        </div>
      ))}
    </div>
  );
}
