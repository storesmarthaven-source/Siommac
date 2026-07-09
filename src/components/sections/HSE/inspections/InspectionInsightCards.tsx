/**
 * src/components/sections/HSE/inspections/InspectionInsightCards.tsx
 *
 * The 4 top StatsCards for Inspections — each uses a DIFFERENT visualisation so
 * the row reads richly (page-guide: page-specific chart content):
 *   Schedule tab:  Scheduled→column trend · Overdue→bars by type ·
 *                  Completion→semicircle gauge · Open Findings→severity donut
 *   Findings tab:  Open→severity donut · Critical→bars by stage ·
 *                  Closed YTD→tiles · Closure→gauge
 * All computed from live data (no synthetic series).
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow } from '@ui';
import { useInspections, useFindings, useInspectionStats, type InspectionRow } from '@api/hse/inspections';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PALETTE = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#fb923c', '#f472b6'];
const SEV_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#eab308', low: '#22c55e', observation: '#3b82f6' };
const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const isOverdue = (i: InspectionRow) => !!i.due_at && new Date(i.due_at).getTime() < Date.now() && !['completed', 'cancelled'].includes(i.status);

function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; }
  return m;
}
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

// ── Chart primitives ────────────────────────────────────────────────────────────

function StatDonut({ total, centerLabel, segments }: { total: number; centerLabel: string; segments: { label: string; value: number; color: string }[] }): VNode {
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
      <div style={{ position: 'relative', flexShrink: 0, width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="62" fill="none" stroke="#eef0f5" stroke-width="15" />
          {segments.map(s => {
            if (s.value <= 0) return null;
            const len = (s.value / sum) * C;
            const node = <circle key={s.label} cx="75" cy="75" r={R} fill="none" stroke={s.color} stroke-width="15"
              stroke-dasharray={`${Math.max(0, len - 3)} ${C}`} stroke-dashoffset={-offset} transform="rotate(-90 75 75)" stroke-linecap="butt" />;
            offset += len;
            return node;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '2.1rem', fontWeight: 600, color: 'var(--siomac-navy)', lineHeight: 1, letterSpacing: '-0.03em' }}>{total}</span>
          <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: '3px' }}>{centerLabel}</span>
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gap: '8px', minWidth: 0 }}>
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.73rem' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', flex: 1 }}>{s.label}</span>
            <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{s.value}</span>
          </div>
        ))}
        {segments.every(s => s.value === 0) && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>None</div>}
      </div>
    </div>
  );
}

function StatBars({ bars }: { bars: { label: string; value: number; color: string }[] }): VNode {
  const max = Math.max(1, ...bars.map(b => b.value));
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '9px' }}>
      {bars.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No data yet</div>}
      {bars.map(b => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ width: '88px', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
          <div style={{ flex: 1, height: '9px', borderRadius: '999px', background: '#eef0f5', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ width: `${Math.round((b.value / max) * 100)}%`, height: '100%', background: b.color, borderRadius: '999px' }} />
          </div>
          <span style={{ width: '22px', textAlign: 'right', fontWeight: 'var(--font-weight-bold)', fontSize: '0.8rem', color: 'var(--siomac-navy)', flexShrink: 0 }}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}

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
          <span style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--siomac-navy)', letterSpacing: '-0.02em' }}>{percent}%</span>
        </div>
      </div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'center' }}>{caption}</div>
    </div>
  );
}

function StatColumns({ points, labels, color }: { points: number[]; labels: string[]; color: string }): VNode {
  const max = Math.max(1, ...points);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px', height: '78px' }}>
        {points.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', height: '100%' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 'var(--font-weight-bold)', color: v > 0 ? 'var(--siomac-navy)' : 'transparent' }}>{v}</span>
            <div style={{ width: '100%', maxWidth: '22px', height: `${Math.max(3, (v / max) * 58)}px`, borderRadius: '5px 5px 2px 2px', background: v > 0 ? color : '#eef0f5' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '6px' }}>
        {labels.map((m, i) => <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: '0.58rem', color: 'var(--text-muted)' }}>{m}</span>)}
      </div>
    </div>
  );
}

function StatTiles({ tiles }: { tiles: { value: number | string; label: string; color?: string }[] }): VNode {
  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: '10px' }}>
      {tiles.map(t => (
        <div key={t.label} style={{ background: 'var(--bg-subtle, #f8fafe)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.7rem', fontWeight: 600, color: t.color ?? 'var(--siomac-navy)', lineHeight: 1 }}>{t.value}</div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: '6px' }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function InspectionInsightCards({ active }: { active: string }): VNode {
  const s = useInspectionStats().data?.data;
  const inspections = useInspections({ limit: 200 }).data?.data ?? [];
  const findings = useFindings({ limit: 200 }).data?.data ?? [];

  const overdue = inspections.filter(isOverdue);
  const openFindings = findings.filter(f => !['closed', 'cancelled'].includes(f.status));
  const completionRate = s?.completionRate ?? 0;
  const closureRate = s?.closureRate ?? 0;

  const typeTally = tally(inspections, i => i.inspection_type ?? i.type);
  const typeKeys = Object.keys(typeTally);
  const overdueBars = Object.entries(tally(overdue, i => i.inspection_type ?? i.type)).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => ({ label: titleCase(k), value: v, color: '#ef4444' }));
  const sevSegments = ['critical', 'high', 'medium', 'low', 'observation']
    .map(sev => ({ label: titleCase(sev), value: openFindings.filter(f => f.severity === sev).length, color: SEV_COLOR[sev] ?? '#3b82f6' }));
  const criticalByStage = Object.entries(tally(findings.filter(f => f.severity === 'critical' && !['closed', 'cancelled'].includes(f.status)), f => f.status))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v], i) => ({ label: titleCase(k), value: v, color: PALETTE[i % PALETTE.length] ?? '#ef4444' }));
  const inspTrend = monthlyTrend(inspections.map(i => i.created_at));
  const monthLabels = lastSixMonthLabels();
  void typeKeys;

  if (active === 'findings') {
    return (
      <MetricRow pageKey="hse.inspections.findings" rowClass="ui-stat-row" cards={[
        { key: 'open', node: (
          <StatsCard icon="fa-magnifying-glass" title="Open Findings" supporting="By severity"
            chart={<StatDonut total={openFindings.length} centerLabel="Open" segments={sevSegments} />}
            footer="Require corrective action" />
        ) },
        { key: 'critical', node: (
          <StatsCard icon="fa-triangle-exclamation" title="Critical Findings" metric={s?.criticalFindings ?? 0} metricColor={(s?.criticalFindings ?? 0) > 0 ? '#ef4444' : '#22c55e'}
            supporting="By stage" chart={<StatBars bars={criticalByStage} />} footer="Immediate action" />
        ) },
        { key: 'closed', node: (
          <StatsCard icon="fa-circle-check" title="Closed YTD" supporting="Resolution snapshot"
            chart={<StatTiles tiles={[
              { value: s?.closedFindingsYtd ?? 0, label: 'Closed', color: '#22c55e' },
              { value: openFindings.length, label: 'Open', color: '#f59e0b' },
              { value: s?.criticalFindings ?? 0, label: 'Critical', color: '#ef4444' },
            ]} />} footer="Year to date" />
        ) },
        { key: 'closure', node: (
          <StatsCard icon="fa-chart-pie" title="Closure Rate"
            chart={<StatGauge percent={closureRate} caption="Findings closed within SLA" color={closureRate >= 90 ? '#22c55e' : closureRate >= 70 ? '#f59e0b' : '#ef4444'} />}
            footer="Target 90%" />
        ) },
      ]} />
    );
  }

  return (
    <MetricRow pageKey="hse.inspections.schedule" rowClass="ui-stat-row" cards={[
      { key: 'scheduled', node: (
        <StatsCard icon="fa-calendar-check" title="Scheduled This Month" metric={s?.scheduledThisMonth ?? 0}
          supporting="New inspections by month" chart={<StatColumns points={inspTrend} labels={monthLabels} color="#2563eb" />}
          footer="Last 6 months" />
      ) },
      { key: 'overdue', node: (
        <StatsCard icon="fa-triangle-exclamation" title="Overdue" metric={overdue.length} metricColor={overdue.length > 0 ? '#ef4444' : '#22c55e'}
          supporting="By type" chart={<StatBars bars={overdueBars} />} footer={overdue.length > 0 ? 'Action required' : 'On track'} />
      ) },
      { key: 'completion', node: (
        <StatsCard icon="fa-chart-pie" title="Completion Rate"
          chart={<StatGauge percent={completionRate} caption="YTD completed on time" color={completionRate >= 90 ? '#22c55e' : completionRate >= 70 ? '#f59e0b' : '#ef4444'} />}
          footer="Target 90%" />
      ) },
      { key: 'findings', node: (
        <StatsCard icon="fa-magnifying-glass" title="Open Findings" supporting="By severity"
          chart={<StatDonut total={openFindings.length} centerLabel="Open" segments={sevSegments} />}
          footer="Require corrective action" />
      ) },
    ]} />
  );
}
