/**
 * src/ui/components/ChartCard.tsx
 *
 * A titled card container for a chart or any visual block: a header (label +
 * optional right-aligned slot) over a body. Wraps the existing `.hse-spark-card`
 * surface so it matches the metric cards on every page.
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface ChartCardProps {
  label: string;
  /** Optional right-aligned header content (e.g. a legend, a delta, a select). */
  headerRight?: ComponentChildren;
  children: ComponentChildren;
}

export function ChartCard({ label, headerRight, children }: ChartCardProps): VNode {
  return (
    <div class="hse-spark-card">
      <div class="hse-spark-header">
        <span class="hse-spark-label">{label}</span>
        {headerRight}
      </div>
      {children}
    </div>
  );
}
