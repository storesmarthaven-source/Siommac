/**
 * src/ui/hrfin/charts/TrendArea.tsx — Aurora line/area chart (Chunk 13-chart upgrade).
 *
 * Upgrades from the original read-only chart to an interactive one:
 *   - Period toggle (MTD / Monthly / Quarterly) with `onPeriodChange` callback.
 *   - Hover tooltip: shows exact values for the hovered data point.
 *   - Forecast segment: data points at index >= `forecastFromIndex` are rendered
 *     as a dashed line (not area-filled) to distinguish actuals from projections.
 *
 * Backward-compatible: all new props are optional; existing call sites continue
 * to work unchanged (no period toggle, no forecast, no tooltip).
 */

import { type VNode } from 'preact';
import { useState, useCallback } from 'preact/hooks';

export type TrendPeriod = 'MTD' | 'Monthly' | 'Quarterly';

export interface TrendAreaProps {
  labels: string[];
  seriesA: number[];
  seriesB?: number[];
  title?: string;
  /** Optional: index from which data is forecast (dashed line). -1 or >= length = all actual. */
  forecastFromIndex?: number;
  /** Current period for the period toggle. When provided, the toggle renders. */
  period?: TrendPeriod;
  /** Called when the user selects a different period. */
  onPeriodChange?: (p: TrendPeriod) => void;
  /** Label for seriesA (shown in tooltip). Defaults to 'Spend'. */
  seriesALabel?: string;
  /** Label for seriesB (shown in tooltip). Defaults to 'Budget'. */
  seriesBLabel?: string;
}

const PERIODS: TrendPeriod[] = ['MTD', 'Monthly', 'Quarterly'];

export function TrendArea({
  labels,
  seriesA,
  seriesB = [],
  title,
  forecastFromIndex,
  period,
  onPeriodChange,
  seriesALabel = 'Spend',
  seriesBLabel = 'Budget',
}: TrendAreaProps): VNode | null {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const [tooltipY, setTooltipY] = useState(0);

  // Callbacks must be declared before any early return to satisfy rules-of-hooks.
  const seriesALen = seriesA.length;
  const handleMouseMove = useCallback((e: MouseEvent): void => {
    const svg = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const chartW = 720, chartPad = 36;
    const rawX = ((e.clientX - svg.left) / svg.width) * chartW;
    const step = (chartW - chartPad * 2) / Math.max(seriesALen - 1, 1);
    const idx = Math.min(seriesALen - 1, Math.max(0, Math.round((rawX - chartPad) / step)));
    setHoverIdx(idx);
    setTooltipX(e.clientX - svg.left);
    setTooltipY(e.clientY - svg.top);
  }, [seriesALen]);

  const handleMouseLeave = useCallback((): void => { setHoverIdx(null); }, []);

  if (!seriesA.length) return null;

  const w = 720, h = 260, pad = 36;

  // Filter out NaN (forecast placeholders) for scale calculation
  const actualA = seriesA.filter(v => !Number.isNaN(v));
  const actualB = seriesB.filter(v => !Number.isNaN(v));
  const all     = actualA.concat(actualB);
  const max     = all.length ? Math.max(...all) : 1;
  const min     = all.length ? Math.min(...all, 0) : 0;
  const range   = max - min || 1;

  const px = (i: number, arr: number[]): number =>
    pad + (i / (Math.max(arr.length - 1, 1))) * (w - pad * 2);
  const py = (v: number): number =>
    h - pad - ((v - min) / range) * (h - pad * 2);

  const fIdx = forecastFromIndex ?? seriesA.length; // all actual if not set

  // Build the actual segment path (up to fIdx)
  const _actualSegA = seriesA.slice(0, fIdx).filter((_, i) => !Number.isNaN(seriesA[i]!));
  const actualIndices = seriesA.slice(0, fIdx).map((_, i) => i).filter(i => !Number.isNaN(seriesA[i]!));

  const pathA = actualIndices.length
    ? actualIndices.map((i, k) => `${k ? 'L' : 'M'}${px(i, seriesA).toFixed(1)},${py(seriesA[i]!).toFixed(1)}`).join(' ')
    : '';

  const areaA = actualIndices.length
    ? `M${px(actualIndices[0]!, seriesA).toFixed(1)},${py(seriesA[actualIndices[0]!]!).toFixed(1)} ` +
      actualIndices.slice(1).map(i => `L${px(i, seriesA).toFixed(1)},${py(seriesA[i]!).toFixed(1)}`).join(' ') +
      ` L${px(actualIndices[actualIndices.length - 1]!, seriesA).toFixed(1)},${(h - pad).toFixed(1)} L${px(actualIndices[0]!, seriesA).toFixed(1)},${(h - pad).toFixed(1)} Z`
    : '';

  // Forecast segment (dashed): from fIdx onwards
  const forecastIndices = seriesA.map((_, i) => i).filter(i => i >= fIdx && !Number.isNaN(seriesA[i]!));
  // Connect the last actual to first forecast with dashed line
  const forecastConnector = fIdx > 0 && fIdx < seriesA.length && !Number.isNaN(seriesA[fIdx - 1]!) && !Number.isNaN(seriesA[fIdx]!)
    ? `M${px(fIdx - 1, seriesA).toFixed(1)},${py(seriesA[fIdx - 1]!).toFixed(1)} L${px(fIdx, seriesA).toFixed(1)},${py(seriesA[fIdx]!).toFixed(1)}`
    : '';
  const forecastPath = forecastIndices.length
    ? forecastIndices.map((i, k) => `${k ? 'L' : 'M'}${px(i, seriesA).toFixed(1)},${py(seriesA[i]!).toFixed(1)}`).join(' ')
    : '';

  const pathB = seriesB.length
    ? seriesB.map((v, i) => Number.isNaN(v) ? null : `${i ? 'L' : 'M'}${px(i, seriesB).toFixed(1)},${py(v).toFixed(1)}`).filter(Boolean).join(' ')
    : '';

  // Hover hit areas: vertical slabs for each data point — handlers declared before early return above

  const fmt = (v: number | undefined): string => {
    if (v === undefined || Number.isNaN(v ?? NaN)) return '—';
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000)     return `$${Math.round(v / 1_000)}k`;
    return `$${Math.round(v)}`;
  };

  return (
    <div class="hrfin-chart-frame" style={{ position: 'relative' }}>
      {/* Period toggle */}
      {period && onPeriodChange && (
        <div class="hrfin-chart-period-toggle" style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              class={`hrfin-chip${p === period ? ' is-active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Hover tooltip */}
      {hoverIdx !== null && (
        <div
          class="hrfin-chart-tooltip"
          style={{
            position:  'absolute',
            left:      Math.min(tooltipX + 12, w - 120),
            top:       Math.max(tooltipY - 40, 0),
            background: 'var(--hrfin-surface-2, #1e2535)',
            border:    '1px solid var(--hrfin-border, #2a3347)',
            borderRadius: 6,
            padding:   '6px 10px',
            fontSize:  12,
            pointerEvents: 'none',
            zIndex:    10,
            minWidth:  90,
            color:     'var(--hrfin-text-primary, #e8eaf2)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{labels[hoverIdx] ?? ''}</div>
          <div>{seriesALabel}: {fmt(seriesA[hoverIdx])}</div>
          {seriesB.length > 0 && <div>{seriesBLabel}: {fmt(seriesB[hoverIdx])}</div>}
          {hoverIdx >= fIdx && <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Forecast</div>}
        </div>
      )}

      <svg
        class="hrfin-line-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={title ?? 'trend chart'}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'crosshair' }}
      >
        {/* Grid lines */}
        <path
          class="hrfin-chart-grid"
          d={`M${pad} ${h - pad}H${w - pad}M${pad} ${h - pad - 48}H${w - pad}M${pad} ${h - pad - 96}H${w - pad}M${pad} ${h - pad - 144}H${w - pad}`}
        />

        {/* Actual area fill */}
        {areaA && <path class="hrfin-area" d={areaA} />}

        {/* Actual line */}
        {pathA && <path class="hrfin-line-a" d={pathA} />}

        {/* Forecast connector + dashed line */}
        {forecastConnector && <path class="hrfin-line-a-forecast" d={forecastConnector} strokeDasharray="4 4" />}
        {forecastPath && <path class="hrfin-line-a-forecast" d={forecastPath} strokeDasharray="4 4" />}

        {/* Series B (budget reference) */}
        {pathB && <path class="hrfin-line-b" d={pathB} />}

        {/* X labels */}
        {labels.map((l, i) => (
          <text
            key={i}
            x={px(i, seriesA).toFixed(1)}
            y={h - 8}
            textAnchor="middle"
          >
            {l}
          </text>
        ))}

        {/* Hover indicator dot */}
        {hoverIdx !== null && !Number.isNaN(seriesA[hoverIdx] ?? NaN) && (
          <circle
            cx={px(hoverIdx, seriesA).toFixed(1)}
            cy={py(seriesA[hoverIdx]!).toFixed(1)}
            r={4}
            class="hrfin-chart-dot"
          />
        )}
      </svg>
    </div>
  );
}
