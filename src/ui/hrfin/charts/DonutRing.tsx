/**
 * src/ui/hrfin/charts/DonutRing.tsx — Aurora donut (1:1 with the mockup
 * `donut`): a conic-gradient ring with a centred value + label. The legend
 * (a metric-list) is composed by the caller alongside it.
 */

import { type VNode } from 'preact';

export interface DonutRingProps {
  /** 0-100. */
  value: number;
  label: string;
}

export function DonutRing({ value, label }: DonutRingProps): VNode {
  return (
    <div class="hrfin-donut" style={{ ['--value' as string]: String(Math.max(0, Math.min(100, value))) }}>
      <span>{value}%</span>
      <small>{label}</small>
    </div>
  );
}
