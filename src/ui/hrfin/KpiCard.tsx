/**
 * src/ui/hrfin/KpiCard.tsx — Aurora KPI card (1:1 with the mockup): head
 * (label + optional badge), big value, support line, an absolutely-positioned
 * visual (sparkline / mini-bars / progress meter), and an optional footer.
 * `loading` renders a cold-load skeleton — never a fake 0.
 */

import { type VNode } from 'preact';

export type KpiVisual = 'line' | 'bars' | 'progress' | 'none';
export type KpiTone = 'accent' | 'success' | 'danger';

export interface KpiCardProps {
  label: string;
  value?: string;
  badge?: string;
  badgeTone?: 'success' | 'danger' | 'warning' | 'muted';
  support?: string;
  visual?: KpiVisual;
  values?: number[];
  tone?: KpiTone;
  percent?: number;
  footer?: string;
  loading?: boolean;
}

function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: KpiTone }): VNode {
  const w = 150, h = 46;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * 34 - 6).toFixed(1)}`).join(' ');
  return <svg class={`hrfin-sparkline is-${tone}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} /></svg>;
}

function MiniBars({ values, tone = 'accent' }: { values: number[]; tone?: KpiTone }): VNode {
  return <div class={`hrfin-mini-bars is-${tone}`}>{values.map((v, i) => <i key={i} style={{ height: `${v * 5 + 8}px` }} />)}</div>;
}

export function KpiCard({ label, value, badge, badgeTone = 'success', support, visual = 'none', values = [], tone = 'accent', percent = 0, footer, loading }: KpiCardProps): VNode {
  return (
    <article class="hrfin-kpi-card">
      <div class="hrfin-kpi-head">
        <span>{label}</span>
        {!loading && badge && <b class={`hrfin-mini-badge is-${badgeTone}`}>{badge}</b>}
      </div>
      {loading ? (
        <>
          <span class="hrfin-skel" style={{ width: '58%', height: 28, marginBottom: 10 }} />
          <span class="hrfin-skel" style={{ width: '44%', height: 12 }} />
        </>
      ) : (
        <>
          <strong>{value ?? '—'}</strong>
          {support && <p>{support}</p>}
          {visual === 'line' && values.length > 1 && <Sparkline values={values} tone={tone} />}
          {visual === 'bars' && values.length > 0 && <MiniBars values={values} tone={tone} />}
          {visual === 'progress' && <div class="hrfin-meter"><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}
          {footer && <small>{footer}</small>}
        </>
      )}
    </article>
  );
}
