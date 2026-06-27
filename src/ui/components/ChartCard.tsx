/**
 * src/ui/components/ChartCard.tsx
 *
 * A titled card container for a chart or any visual block: a header (label +
 * optional right-aligned slot) over a body. Wraps the existing `.hse-spark-card`
 * surface so it matches the metric cards on every page.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { Skeleton } from './Skeleton';

export interface ChartCardProps {
  label: string;
  /** Optional right-aligned header content (e.g. a legend, a delta, a select). */
  headerRight?: ComponentChildren;
  children: ComponentChildren;
  /** Cold-load — render a sized shimmer block instead of the chart (no layout shift). */
  loading?: boolean;
  /** Chart body height used for the skeleton block (px). */
  chartHeight?: number;
}

export function ChartCard({ label, headerRight, children, loading = false, chartHeight = 180 }: ChartCardProps): VNode {
  return (
    <div class="hse-spark-card" aria-busy={loading ? 'true' : 'false'}>
      <div class="hse-spark-header">
        <span class="hse-spark-label">{label}</span>
        {!loading && headerRight}
      </div>
      {loading ? <Skeleton width="100%" height={chartHeight} radius={12} /> : children}
    </div>
  );
}
