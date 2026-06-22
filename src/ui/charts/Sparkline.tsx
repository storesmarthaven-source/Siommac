/**
 * src/ui/charts/Sparkline.tsx
 *
 * A standalone miniature SVG line chart with a gradient fill and an endpoint dot.
 * This is the same drawing logic used inside `SparkCard`, exposed on its own so
 * new pages can drop a sparkline anywhere (e.g. inside a ChartCard).
 */

import { type VNode } from 'preact';

export interface SparklineProps {
  points: number[];
  color?: string;
  /** Pixel height of the chart (width is fluid, 100%). */
  height?: number;
}

export function Sparkline({ points, color = '#ef4444', height = 44 }: SparklineProps): VNode | null {
  if (!points || points.length < 2) return null;
  const W = 200, H = height;
  const max = Math.max(...points, 1);
  const coords = points.map((v, i) => [
    Math.round((i / (points.length - 1)) * W),
    Math.round(H - (v / max) * (H - 6) - 3),
  ]);
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0]},${c[1]}`).join(' ');
  const area = `M0,${H} ${line.slice(1)} L${W},${H} Z`;
  const last = coords[coords.length - 1];
  const lastX = last?.[0] ?? W;
  const lastY = last?.[1] ?? H / 2;
  const gradId = `spk-${Math.round(points.reduce((a, b) => a + b, 0))}-${points.length}`;

  return (
    <svg height={H} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.18" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx={lastX} cy={lastY} r="8" fill={color} fill-opacity="0.12" />
      <circle cx={lastX} cy={lastY} r="4" fill={color} stroke="#fff" stroke-width="2" />
    </svg>
  );
}
