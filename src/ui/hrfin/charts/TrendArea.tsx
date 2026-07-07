/**
 * src/ui/hrfin/charts/TrendArea.tsx — Aurora line/area chart (1:1 with the
 * mockup `lineChart`): a gridded 720×260 SVG with an area-filled primary line
 * (seriesA) and an optional dashed comparison line (seriesB), plus x-labels.
 */

import { type VNode } from 'preact';

export interface TrendAreaProps {
  labels: string[];
  seriesA: number[];
  seriesB?: number[];
  title?: string;
}

export function TrendArea({ labels, seriesA, seriesB = [], title }: TrendAreaProps): VNode | null {
  if (!seriesA.length) return null;
  const w = 720, h = 260, pad = 36;
  const all = seriesA.concat(seriesB);
  const max = Math.max(...all), min = Math.min(...all, 0);
  const point = (arr: number[], i: number): string =>
    `${(pad + (i / (arr.length - 1)) * (w - pad * 2)).toFixed(1)},${(h - pad - ((arr[i]! - min) / (max - min || 1)) * (h - pad * 2)).toFixed(1)}`;
  const path = (arr: number[]): string => arr.map((_, i) => (i ? 'L' : 'M') + point(arr, i)).join(' ');
  const area = `M${point(seriesA, 0)} ${seriesA.map((_, i) => `L${point(seriesA, i)}`).join(' ')} L${w - pad},${h - pad} L${pad},${h - pad} Z`;

  return (
    <div class="hrfin-chart-frame">
      <svg class="hrfin-line-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title || 'trend chart'}>
        <path class="hrfin-chart-grid" d={`M${pad} ${h - pad}H${w - pad}M${pad} ${h - pad - 48}H${w - pad}M${pad} ${h - pad - 96}H${w - pad}M${pad} ${h - pad - 144}H${w - pad}`} />
        <path class="hrfin-area" d={area} />
        <path class="hrfin-line-a" d={path(seriesA)} />
        {seriesB.length > 0 && <path class="hrfin-line-b" d={path(seriesB)} />}
        {labels.map((l, i) => <text key={i} x={(pad + (i / (labels.length - 1)) * (w - pad * 2)).toFixed(1)} y={h - 8}>{l}</text>)}
      </svg>
    </div>
  );
}
