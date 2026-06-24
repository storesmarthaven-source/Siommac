/**
 * src/components/sections/HSE/ptw/PtwInsightCards.tsx
 *
 * The four standard summary cards under the Permit to Work header — built on the
 * app-wide StatsCard skeleton (the same standard as Incidents / Risk & JSA):
 * fixed size, coloured header, body that always fills, rearrangeable + persisted
 * via the ui_layout backbone (pageKey="hse.permits").
 *
 * Chart mix mirrors the standard donut · bars · % · trend so the row never feels
 * uniform:
 *   Permit Mix          → donut  (active permits by type)
 *   Expiring Soon       → bars   (<2h / 2-4h / 4-8h time-bands)
 *   Isolation Readiness → navy % (LOTO compliance bar)
 *   Permit Trend        → trend  (permits raised per month, last 6 mo)
 *
 * Metrics come from the live stats endpoint (usePermitStats) plus the permit
 * list (usePermits) for the client-computed monthly trend — no extra backend.
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow, Sparkline } from '@ui';
import { usePermits, usePermitStats } from '@api/hse/ptw';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPE_COLORS = ['#1b2d54', '#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#a855f7'];

const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Real series: records created in each of the last `months` months. */
function monthlyTrend(dates: Array<string | null | undefined>, months = 6): number[] {
  const now = new Date();
  const buckets = new Array<number>(months).fill(0);
  for (const iso of dates) {
    if (!iso) continue;
    const d = new Date(iso);
    const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (diff >= 0 && diff < months) buckets[months - 1 - diff]! += 1;
  }
  return buckets;
}
function lastSixMonthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, idx) => MONTH_ABBR[(now.getMonth() - (5 - idx) + 12) % 12]!);
}

// ── Shared chart nodes (all live inside the StatsCard `chart` slot) ─────────────

/** Donut + centre value + legend — same geometry as the Incidents "Severity Mix". */
function StatDonut({ total, centerLabel, segments }: {
  total: number;
  centerLabel: string;
  segments: { label: string; value: number; color: string }[];
}): VNode {
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '26px' }}>
      <div style={{ position: 'relative', flexShrink: 0, width: 142, height: 142 }}>
        <svg width="142" height="142" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="62" fill="none" stroke="#eef0f5" stroke-width="15" />
          {segments.map(s => {
            if (s.value <= 0) return null;
            const len = (s.value / sum) * C;
            const node = (
              <circle key={s.label} cx="75" cy="75" r={R} fill="none" stroke={s.color} stroke-width="15"
                stroke-dasharray={`${Math.max(0, len - 3)} ${C}`} stroke-dashoffset={-offset}
                transform="rotate(-90 75 75)" stroke-linecap="butt" />
            );
            offset += len;
            return node;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--siomac-navy)', lineHeight: 1, letterSpacing: '-0.03em' }}>{total}</span>
          <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: '3px' }}>{centerLabel}</span>
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gap: '9px', minWidth: 0 }}>
        {segments.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.74rem' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--siomac-navy)' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal labelled bars — proportional fill, value on the right. */
function StatBars({ bars }: { bars: { label: string; value: number; color: string }[] }): VNode {
  const max = Math.max(1, ...bars.map(b => b.value));
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '11px' }}>
      {bars.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No data yet</div>}
      {bars.map(b => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ width: '84px', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
          <div style={{ flex: 1, height: '9px', borderRadius: '999px', background: '#eef0f5', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ width: `${Math.round((b.value / max) * 100)}%`, height: '100%', background: b.color, borderRadius: '999px' }} />
          </div>
          <span style={{ width: '22px', textAlign: 'right', fontWeight: 700, fontSize: '0.8rem', color: 'var(--siomac-navy)', flexShrink: 0 }}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Sparkline + month axis — same as the Incidents "Incident Trend". */
function StatTrend({ points, color, labels }: { points: number[]; color: string; labels: string[] }): VNode {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Sparkline points={points} color={color} height={72} />
      <div class="hse-spark-months">{labels.map(m => <span key={m}>{m}</span>)}</div>
    </div>
  );
}

// ── Root ────────────────────────────────────────────────────────────────────────

export function PtwInsightCards(): VNode {
  const stats = usePermitStats().data?.data;
  const all   = usePermits({}).data?.data ?? [];

  const totalActive  = stats?.activePermits.total          ?? 0;
  const highRisk     = stats?.activePermits.highRisk       ?? 0;
  const byType       = stats?.activePermits.byType         ?? [];
  const expiring     = stats?.expiringSoon.total           ?? 0;
  const withinTwo    = stats?.expiringSoon.withinTwoHours  ?? 0;
  const buckets      = stats?.expiringSoon.buckets         ?? [];
  const isoPct       = stats?.isolationReadiness.percentage ?? 100;
  const isoVerified  = stats?.isolationReadiness.verified   ?? 0;
  const isoRequired  = stats?.isolationReadiness.required   ?? 0;

  const typeSegments = byType.slice(0, 5).map((t, i) => ({
    label: typeLabel(t.type), value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length] ?? '#1b2d54',
  }));

  const bandBars = buckets.map(b => ({
    label: b.label, value: b.count, color: b.label === '<2h' ? '#ef4444' : '#f59e0b',
  }));

  const trend  = monthlyTrend(all.map(p => p.created_at));
  const raised = trend.reduce((a, b) => a + b, 0);

  return (
    <MetricRow pageKey="hse.permits" rowClass="ui-stat-row" cards={[
      { key: 'mix', node: (
        <StatsCard icon="fa-file-shield" title="Permit Mix"
          chart={<StatDonut total={totalActive} centerLabel="Active" segments={typeSegments} />}
          footer={highRisk > 0 ? `${highRisk} high-risk active` : 'No high-risk permits active'} />
      ) },
      { key: 'expiring', node: (
        <StatsCard icon="fa-clock" title="Expiring Soon"
          metric={expiring} metricUnit="permits"
          supporting={withinTwo > 0 ? `${withinTwo} within the next 2 hours` : 'None critical'}
          chart={<StatBars bars={bandBars} />}
          footer="Renewal or close-out needed" />
      ) },
      { key: 'isolation', node: (
        <StatsCard icon="fa-lock" title="Isolation Readiness" variant="navy"
          metric={`${isoPct}%`} supporting={`${isoVerified} of ${isoRequired} points verified`}
          percent={isoPct} percentColor={isoPct >= 90 ? '#4ade80' : isoPct >= 70 ? '#fbbf24' : '#ef4444'}
          percentTarget="Target 90%"
          footer="LOTO verified before energise" />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-line" title="Permit Trend"
          metric={raised} metricUnit="raised"
          supporting="New permits by month"
          chart={<StatTrend points={trend} color="#2563eb" labels={lastSixMonthLabels()} />}
          footer="Permits — last 6 months" />
      ) },
    ]} />
  );
}
