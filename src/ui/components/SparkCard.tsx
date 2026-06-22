/**
 * src/ui/components/SparkCard.tsx
 *
 * A 4-up metric card: a label + big value, plus ONE optional visual —
 * a miniature sparkline, a horizontal progress bar, or a set of labelled bar
 * rows. Used in the metric row directly under the page hero.
 *
 * Promoted verbatim from HSE `_shared.tsx` (zero visual change — `.hse-spark-*`).
 * For standalone chart pieces see `@ui/charts` (`Sparkline`, `BarRow`, `ProgressBar`).
 */

import { type VNode } from 'preact';

export interface SparkDef {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaUp?: boolean;     // true = bad (going up), false = good (going down)
  color?: string;
  bars?: { label: string; value: number; max: number; color: string }[];
  progress?: { pct: number; color: string; target?: string };
  sparkPoints?: number[]; // 6 values for the miniature SVG line
  sparkColor?: string;
  months?: string[];
}

export function SparkCard({ spark }: { spark: SparkDef }): VNode {
  const pts = spark.sparkPoints;
  const W = 200, H = 44;
  let svgLine = '', svgArea = '';
  let lastX = W, lastY = H / 2;
  if (pts && pts.length >= 2) {
    const max = Math.max(...pts, 1);
    const coords = pts.map((v, i) => [
      Math.round((i / (pts.length - 1)) * W),
      Math.round(H - (v / max) * (H - 6) - 3),
    ]);
    svgLine = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0]},${c[1]}`).join(' ');
    svgArea = `M0,${H} ${svgLine.slice(1)} L${W},${H} Z`;
    const last = coords[coords.length - 1];
    lastX = last?.[0] ?? W;
    lastY = last?.[1] ?? H / 2;
  }
  const col = spark.sparkColor ?? '#ef4444';
  const gradId = `sg-${spark.label.replace(/\W/g, '')}`;
  const months = spark.months ?? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

  return (
    <div class="hse-spark-card">
      <div class="hse-spark-header">
        <span class="hse-spark-label">{spark.label}</span>
        {spark.delta && (
          <span class={`hse-spark-delta ${spark.deltaUp ? 'up' : 'down'}`}>
            <i class={`fas fa-arrow-${spark.deltaUp ? 'up' : 'down'}`} />{spark.delta}
          </span>
        )}
      </div>

      <div class="hse-spark-val" style={spark.color ? `color:${spark.color}` : undefined}>
        {spark.value}
      </div>
      {spark.sub && <div class="hse-spark-sub">{spark.sub}</div>}

      {/* Rich sparkline — taller, gradient area, endpoint dot with halo */}
      {pts && pts.length >= 2 && (
        <>
          <svg height={H} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible', display: 'block' }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={col} stop-opacity="0.18" />
                <stop offset="100%" stop-color={col} stop-opacity="0" />
              </linearGradient>
            </defs>
            <path d={svgArea} fill={`url(#${gradId})`} />
            <path d={svgLine} fill="none" stroke={col} stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" />
            <circle cx={lastX} cy={lastY} r="8" fill={col} fill-opacity="0.12" />
            <circle cx={lastX} cy={lastY} r="4" fill={col} stroke="#fff" stroke-width="2" />
          </svg>
          <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
        </>
      )}

      {/* Progress bar */}
      {spark.progress && (
        <>
          <div class="hse-spark-bar-track" style={{ marginTop: '4px' }}>
            <div class="hse-spark-bar-fill" style={{ width: `${spark.progress.pct}%`, background: spark.progress.color }} />
          </div>
          {spark.progress.target && (
            <div class="sc-progress-labels">
              <span>0%</span>
              <span style={{ color: spark.progress.color, fontWeight: 600 }}>{spark.progress.target}</span>
              <span>100%</span>
            </div>
          )}
        </>
      )}

      {/* Type breakdown — labelled bar rows */}
      {spark.bars && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '2px' }}>
          {spark.bars.map(b => (
            <div key={b.label} class="sc-bar-row">
              <span class="sc-bar-label">{b.label}</span>
              <span class="sc-bar-val" style={{ color: b.color }}>{b.value}</span>
              <div class="sc-bar-track">
                <div class="sc-bar-fill" style={{
                  width: `${Math.round((b.value / Math.max(b.max, 1)) * 100)}%`,
                  background: b.color,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
