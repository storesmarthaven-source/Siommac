/**
 * src/components/sections/HSE/ptw/PtwInsightCards.tsx
 *
 * The four standard summary cards under the Permit to Work header — built on the
 * app-wide StatsCard skeleton (fixed size, coloured header, body that always
 * fills, rearrangeable + persisted via the ui_layout backbone, pageKey
 * "hse.permits") per src/ui/PAGE_GUIDE.md.
 *
 * PTW gets its OWN visual language so the row never reads like Incidents or
 * Risk & JSA (which use donut · bars · tiles · sparkline). PTW is time-gated
 * work authorisation, so the charts lean on time + readiness:
 *   Permit Mix          → segmented STACKED BAR (active permits by type)
 *   Expiring Soon       → COUNTDOWN RUNWAY      (permits on a Now→8h time track)
 *   Isolation Readiness → semicircle GAUGE      (LOTO % + compliance bar)
 *   Permit Trend        → vertical COLUMN CHART  (permits raised per month)
 *
 * Metrics come from the live stats endpoint (usePermitStats) plus the permit
 * list (usePermits) for the client-computed runway + monthly trend — no extra
 * backend.
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow } from '@ui';
import { usePermits, usePermitStats } from '@api/hse/ptw';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPE_COLORS = ['#1b2d54', '#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#a855f7'];
const ACTIVE = new Set(['active', 'approved']);

const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function hoursUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

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

// ── PTW-specific chart nodes (distinct from Incidents / Risk & JSA) ─────────────

/** One segmented bar (type mix) + a compact legend — NOT a donut. */
function StatStackBar({ segments }: { segments: { label: string; value: number; color: string }[] }): VNode {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const shown = segments.filter(s => s.value > 0);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', height: '30px', borderRadius: '9px', overflow: 'hidden', background: '#eef0f5' }}>
        {shown.length === 0 && <div style={{ flex: 1 }} />}
        {shown.map(s => (
          <div key={s.label} title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(s.value / total) >= 0.12 && <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#fff' }}>{s.value}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
        {shown.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.72rem', minWidth: 0 }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--siomac-navy)' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A Now→8h runway: each expiring permit is a pin on a time track, closer to the
 *  right = closer to the expiry cliff. PTW-only — time-gated authorisations. */
function ExpiryRunway({ pins }: { pins: number[] }): VNode {
  // pins = hours-until-expiry for each permit (0..8). x% = closer to right as h→0.
  const ticks = [{ h: 8, label: '8h' }, { h: 4, label: '4h' }, { h: 2, label: '2h' }, { h: 0, label: 'Now' }];
  const xFor = (h: number) => (1 - Math.max(0, Math.min(8, h)) / 8) * 100;
  if (pins.length === 0) {
    return (
      <div style={{ width: '100%', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        None expiring within 8 hours
      </div>
    );
  }
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '10px' }}>
      <div style={{ position: 'relative', height: '44px' }}>
        {/* track */}
        <div style={{ position: 'absolute', top: '26px', left: 0, right: 0, height: '6px', borderRadius: '99px',
          background: 'linear-gradient(90deg, #22c55e 0%, #f59e0b 62%, #ef4444 100%)' }} />
        {/* expiry cliff flag */}
        <i class="fas fa-flag-checkered" style={{ position: 'absolute', right: '-2px', top: '20px', fontSize: '0.8rem', color: '#ef4444' }} />
        {/* pins */}
        {pins.map((h, i) => {
          const crit = h <= 2;
          return (
            <div key={i} style={{ position: 'absolute', left: `${xFor(h)}%`, top: '6px', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '0.58rem', fontWeight: 800, color: crit ? '#ef4444' : '#f59e0b' }}>{Math.round(h)}h</span>
              <span style={{ width: '11px', height: '11px', borderRadius: '50%', background: crit ? '#ef4444' : '#f59e0b', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', marginTop: '2px' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 600 }}>
        {ticks.map(t => <span key={t.label}>{t.label}</span>)}
      </div>
    </div>
  );
}

/** Semicircle readiness gauge — NOT a full donut, NOT a flat bar. */
function StatGauge({ percent, color, caption }: { percent: number; color: string; caption: string }): VNode {
  const R = 52, cx = 60, cy = 60;
  const len = Math.PI * R;
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * len;
  const arc = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '140px', height: '78px' }}>
        <svg width="140" height="78" viewBox="0 0 120 68">
          <path d={arc} fill="none" stroke="#eef0f5" stroke-width="12" stroke-linecap="round" />
          <path d={arc} fill="none" stroke={color} stroke-width="12" stroke-linecap="round" stroke-dasharray={`${dash} ${len}`} />
        </svg>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '0', textAlign: 'center' }}>
          <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--siomac-navy)', letterSpacing: '-0.02em' }}>{percent}%</span>
        </div>
      </div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>{caption}</div>
    </div>
  );
}

/** Vertical column chart — NOT a smooth sparkline. */
function StatColumns({ points, labels, color }: { points: number[]; labels: string[]; color: string }): VNode {
  const max = Math.max(1, ...points);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px', height: '78px' }}>
        {points.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', height: '100%' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: v > 0 ? 'var(--siomac-navy)' : 'transparent' }}>{v}</span>
            <div style={{ width: '100%', maxWidth: '22px', height: `${Math.max(3, (v / max) * 58)}px`, borderRadius: '5px 5px 2px 2px', background: v > 0 ? color : '#eef0f5' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '6px' }}>
        {labels.map((m, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: '0.58rem', color: 'var(--text-muted)' }}>{m}</span>
        ))}
      </div>
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
  const isoPct       = stats?.isolationReadiness.percentage ?? 100;
  const isoVerified  = stats?.isolationReadiness.verified   ?? 0;
  const isoRequired  = stats?.isolationReadiness.required   ?? 0;

  const typeSegments = byType.slice(0, 6).map((t, i) => ({
    label: typeLabel(t.type), value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length] ?? '#1b2d54',
  }));

  const pins = all
    .filter(p => ACTIVE.has(p.status))
    .map(p => hoursUntil(p.end_datetime))
    .filter((h): h is number => h !== null && h >= 0 && h <= 8)
    .sort((a, b) => a - b);

  const trend  = monthlyTrend(all.map(p => p.created_at));
  const raised = trend.reduce((a, b) => a + b, 0);

  return (
    <MetricRow pageKey="hse.permits" rowClass="ui-stat-row" cards={[
      { key: 'mix', node: (
        <StatsCard icon="fa-file-shield" title="Permit Mix"
          metric={totalActive} metricUnit="active"
          supporting="By permit type"
          chart={<StatStackBar segments={typeSegments} />}
          footer={highRisk > 0 ? `${highRisk} high-risk active` : 'No high-risk permits active'} />
      ) },
      { key: 'expiring', node: (
        <StatsCard icon="fa-hourglass-half" title="Expiring Soon"
          metric={expiring} metricUnit="permits"
          supporting={withinTwo > 0 ? `${withinTwo} within the next 2 hours` : 'None critical'}
          chart={<ExpiryRunway pins={pins} />}
          footer="Renewal or close-out needed" />
      ) },
      { key: 'isolation', node: (
        <StatsCard icon="fa-lock" title="Isolation Readiness"
          chart={<StatGauge percent={isoPct} caption={`${isoVerified} of ${isoRequired} points verified`}
            color={isoPct >= 90 ? '#22c55e' : isoPct >= 70 ? '#f59e0b' : '#ef4444'} />}
          percent={isoPct} percentColor={isoPct >= 90 ? '#22c55e' : isoPct >= 70 ? '#f59e0b' : '#ef4444'}
          percentTarget="Target 90%"
          footer="LOTO verified before energise" />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-column" title="Permit Trend"
          metric={raised} metricUnit="raised"
          supporting="New permits by month"
          chart={<StatColumns points={trend} labels={lastSixMonthLabels()} color="#2563eb" />}
          footer="Permits — last 6 months" />
      ) },
    ]} />
  );
}
