/**
 * src/ui/widgets/inlinePrimitives.tsx
 *
 * Small INLINE-STYLED building blocks shared by widget registries. Inline styles
 * (not scoped CSS) so the exact same markup renders correctly BOTH on the board and
 * in the library catalogue/detail previews (which load different stylesheets and are
 * not under any feature scope like `.hr-emp-master`). Keep these dependency-free.
 */
import type { JSX, VNode } from 'preact';

export const ellip: JSX.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** snake/kebab → Title Case (—  for empty). */
export const humanize = (s: string | null | undefined): string =>
  s ? s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';

export function Empty({ label, h = 80 }: { label: string; h?: number }): VNode {
  return <div style={{ height: h, display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 12 }}>{label}</div>;
}

// ── list rows ────────────────────────────────────────────────────────────────
export type RowTone = 'danger' | 'warn' | 'ok' | 'muted';
export const TONE: Record<RowTone, string> = { danger: '#dc2626', warn: '#d97706', ok: '#16a34a', muted: '#667085' };

export function ListRow({ primary, secondary, right, tone = 'muted' }: { primary: string; secondary?: string; right?: string; tone?: RowTone }): VNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 9px', border: '1px solid var(--cds-border, #e4e7ec)', borderRadius: 8, background: 'var(--cds-surface, #fff)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...ellip, fontSize: 13, fontWeight: 600, color: 'var(--cds-text, #1f2a44)' }}>{primary}</div>
        {secondary ? <div style={{ ...ellip, fontSize: 11.5, color: '#667085' }}>{secondary}</div> : null}
      </div>
      {right ? <span style={{ flex: 'none', fontSize: 11, fontWeight: 500, color: TONE[tone] }}>{right}</span> : null}
    </div>
  );
}

export function WidgetList({ loading, rows, empty }: { loading: boolean; rows: VNode[]; empty: string }): VNode {
  const muted: JSX.CSSProperties = { fontSize: 12.5, color: '#667085', padding: '10px 4px' };
  if (loading) return <div style={muted}>Loading…</div>;
  if (rows.length === 0) return <div style={muted}>{empty}</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{rows}</div>;
}

// ── tiny charts ──────────────────────────────────────────────────────────────
/** Dependency-free line sparkline scaled to its box. */
export function MiniSparkline({ points, height = 56, stroke = 'var(--cds-accent, #f97316)' }: { points: number[]; height?: number; stroke?: string }): VNode {
  const w = 240, h = height, pad = 4;
  if (points.length === 0) return <Empty label="No data" h={h} />;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => `${pad + i * step},${h - pad - (p / max) * (h - pad * 2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Trend">
      <polyline points={coords} fill="none" stroke={stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Area+line trend (taller, for KPI cards). */
export function TrendArea({ points, height = 90, color = '#0b5bd3' }: { points: number[]; height?: number; color?: string }): VNode {
  const w = 320, h = height, pad = 6;
  if (points.length === 0) return <Empty label="No trend data" h={h} />;
  const max = Math.max(...points), min = Math.min(...points), span = (max - min) || 1;
  const n = points.length;
  const X = (i: number): number => (n === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1));
  const Y = (c: number): number => h - pad - ((c - min) / span) * (h - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');
  const area = `${line} L ${X(n - 1).toFixed(1)} ${h} L ${X(0).toFixed(1)} ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Trend">
      <path d={area} fill="rgba(11,91,211,.10)" />
      <path d={line} fill="none" stroke={color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Horizontal mini bars (label · bar · value). */
export function MiniBars({ rows, palette = ['#0b5bd3'] }: { rows: { label: string; count: number }[]; palette?: string[] }): VNode {
  const items = rows.slice(0, 4);
  if (!items.length) return <Empty label="Nothing here" />;
  const max = Math.max(...items.map(r => r.count), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {items.map((r, i) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ ...ellip, color: '#475569' }}>{humanize(r.label)}</span>
          <span style={{ height: 8, borderRadius: 6, background: '#eef2f7', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.round((r.count / max) * 100)}%`, background: palette[i % palette.length], borderRadius: 6 }} />
          </span>
          <strong style={{ color: '#1f2a44' }}>{r.count}</strong>
        </div>
      ))}
    </div>
  );
}

/** Donut ring with a centred percentage. */
export function DonutPct({ percent, color = '#16a34a' }: { percent: number; color?: string }): VNode {
  const C = 2 * Math.PI * 50;
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * C;
  return (
    <svg viewBox="0 0 150 150" width="100%" height={120} role="img" aria-label={`${percent} percent`}>
      <circle cx="75" cy="75" r="50" fill="none" stroke="#e7edf6" stroke-width="14" />
      <circle cx="75" cy="75" r="50" fill="none" stroke={color} stroke-width="14" stroke-linecap="round"
        stroke-dasharray={`${dash.toFixed(1)} ${(C - dash).toFixed(1)}`} transform="rotate(-90 75 75)" />
      <text x="75" y="72" text-anchor="middle" font-size="26" font-weight="700" fill="#1f2a44">{percent}%</text>
      <text x="75" y="92" text-anchor="middle" font-size="11" fill="#94a3b8">ready</text>
    </svg>
  );
}
