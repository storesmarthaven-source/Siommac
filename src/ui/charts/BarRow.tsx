/**
 * src/ui/charts/BarRow.tsx
 *
 * A single labelled horizontal bar: label · value · proportional fill.
 * The same row used inside `SparkCard`'s breakdown, exposed standalone for
 * building small "by category / by type" breakdowns on any page.
 */

import { type VNode } from 'preact';

export interface BarRowProps {
  label: string;
  value: number;
  max: number;
  color?: string;
}

export function BarRow({ label, value, max, color = 'var(--siomac-navy)' }: BarRowProps): VNode {
  return (
    <div class="sc-bar-row">
      <span class="sc-bar-label">{label}</span>
      <span class="sc-bar-val" style={{ color }}>{value}</span>
      <div class="sc-bar-track">
        <div class="sc-bar-fill" style={{ width: `${Math.round((value / Math.max(max, 1)) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}
