/**
 * src/components/sections/HSE/risk-jsa/RiskJsaInsightCards.tsx
 *
 * The four standard summary cards under the Risk & JSA header — built on the
 * app-wide StatsCard skeleton (the Incidents "Severity Mix / Corrective Actions"
 * standard): fixed size, coloured header, body that always fills.
 *
 * They CHANGE by active tab — Hazard Register, Risk Assessments and JSA Library
 * each get their own four cards (donut · count · % · trend) so the page answers
 * "what's happening / what needs attention / where to act" per tab.
 *
 * Metrics are computed from the live list data (useHazards / useAssessments /
 * useJsaList).
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow, Sparkline } from '@ui';
import { useHazards, useAssessments, useJsaList, type RiskLevel } from '@api/hse/riskJsa';

const SEV_COLOR: Record<RiskLevel, string> = { low: '#4ade80', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function within(days: number, iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime() - Date.now();
  return d >= 0 && d <= days * 86400000;
}
function overdue(iso?: string | null): boolean {
  return iso ? new Date(iso).getTime() < Date.now() : false;
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

// ── Shared chart nodes (match the Incidents StatsCard standard exactly) ─────────

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
            <span style={{ color: 'var(--text-muted)', flex: 1 }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--siomac-navy)' }}>{s.value}</span>
          </div>
        ))}
      </div>
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

export function RiskJsaInsightCards({ activeTab }: { activeTab: 'hazards' | 'assessments' | 'jsa' }): VNode {
  if (activeTab === 'assessments') return <AssessmentCards />;
  if (activeTab === 'jsa')         return <JsaCards />;
  return <HazardCards />;
}

// ── Hazard Register ─────────────────────────────────────────────────────────────

function HazardCards(): VNode {
  const { data } = useHazards({});
  const hz = data?.data ?? [];
  const by = (l: RiskLevel) => hz.filter(h => h.risk_level === l).length;
  const low = by('low'), medium = by('medium'), high = by('high'), critical = by('critical');
  const total = hz.length;
  const highCrit = high + critical;
  const overdueRev = hz.filter(h => overdue(h.review_due_at)).length;
  const withControls = hz.filter(h => h.status === 'approved' || h.status === 'monitoring').length;
  const coverage = total > 0 ? Math.round((withControls / total) * 100) : 0;
  const trend = monthlyTrend(hz.map(h => h.created_at));

  return (
    <MetricRow pageKey="hse.risk.hazards" rowClass="ui-stat-row" cards={[
      { key: 'profile', node: (
        <StatsCard icon="fa-radiation" title="Hazard Profile"
          chart={<StatDonut total={total} centerLabel="On register" segments={[
            { label: 'Critical', value: critical, color: SEV_COLOR.critical },
            { label: 'High',     value: high,     color: SEV_COLOR.high },
            { label: 'Medium',   value: medium,   color: SEV_COLOR.medium },
            { label: 'Low',      value: low,      color: SEV_COLOR.low },
          ]} />}
          footer={`${highCrit} high-risk on the register`} />
      ) },
      { key: 'highcrit', node: (
        <StatsCard icon="fa-triangle-exclamation" title="High / Critical"
          metric={highCrit} metricUnit="hazards"
          supporting={overdueRev > 0 ? `${overdueRev} overdue reviews` : 'Reviews current'}
          statuses={[
            { label: 'Critical', value: critical, color: SEV_COLOR.critical },
            { label: 'High',     value: high,     color: SEV_COLOR.high },
          ]}
          footer="Need control verification" />
      ) },
      { key: 'coverage', node: (
        <StatsCard icon="fa-shield-halved" title="Control Coverage" variant="navy"
          metric={`${coverage}%`} supporting={`${withControls} of ${total} hazards controlled`}
          percent={coverage} percentColor={coverage >= 85 ? '#4ade80' : '#fbbf24'} percentTarget="Target 85%"
          footer="Approved / monitoring" />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-line" title="Hazard Trend"
          metric={total} metricUnit="logged"
          supporting="New hazards by month"
          chart={<StatTrend points={trend} color="#ef4444" labels={lastSixMonthLabels()} />}
          footer="Hazards — last 6 months" />
      ) },
    ]} />
  );
}

// ── Risk Assessments ────────────────────────────────────────────────────────────

function AssessmentCards(): VNode {
  const { data } = useAssessments({});
  const a = data?.data ?? [];
  const total = a.length;
  const active = a.filter(x => x.status === 'active' || x.status === 'approved').length;
  const underReview = a.filter(x => x.status === 'under_review' || x.status === 'submitted').length;
  const expired = a.filter(x => x.status === 'expired').length;
  const returned = a.filter(x => x.status === 'returned').length;
  const highResidual = a.filter(x => x.risk_level === 'high' || x.risk_level === 'critical').length;
  const acceptable = total > 0 ? Math.round(((total - highResidual) / total) * 100) : 0;
  const dueWeek = a.filter(x => within(7, x.review_due_at)).length;
  const trend = monthlyTrend(a.map(x => x.created_at));

  return (
    <MetricRow pageKey="hse.risk.assessments" rowClass="ui-stat-row" cards={[
      { key: 'status', node: (
        <StatsCard icon="fa-table-cells-large" title="Assessment Status"
          chart={<StatDonut total={total} centerLabel="Assessments" segments={[
            { label: 'Active',       value: active,      color: '#4ade80' },
            { label: 'Under review', value: underReview, color: '#f59e0b' },
            { label: 'Expired',      value: expired,     color: '#ef4444' },
          ]} />}
          footer={`${underReview} pending approval`} />
      ) },
      { key: 'approvals', node: (
        <StatsCard icon="fa-clipboard-check" title="Approval Queue"
          metric={underReview} metricUnit="in review"
          supporting={`${dueWeek} due this week`}
          statuses={[
            { label: 'Awaiting', value: underReview, color: '#f59e0b' },
            { label: 'Returned', value: returned,    color: returned > 0 ? '#ef4444' : '#4ade80' },
          ]}
          footer="HSE review" />
      ) },
      { key: 'residual', node: (
        <StatsCard icon="fa-arrow-down-wide-short" title="Residual Risk" variant="navy"
          metric={`${acceptable}%`} supporting={`${highResidual} high residual after controls`}
          percent={acceptable} percentColor={acceptable >= 85 ? '#4ade80' : '#fbbf24'} percentTarget="Target 85%"
          footer="Acceptable after controls" />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-line" title="Assessment Trend"
          metric={total} metricUnit="logged"
          supporting="New assessments by month"
          chart={<StatTrend points={trend} color="#60a5fa" labels={lastSixMonthLabels()} />}
          footer="Assessments — last 6 months" />
      ) },
    ]} />
  );
}

// ── JSA Library ─────────────────────────────────────────────────────────────────

function JsaCards(): VNode {
  const { data } = useJsaList({});
  const j = data?.data ?? [];
  const total = j.length;
  const active = j.filter(x => x.status === 'active' || x.status === 'approved').length;
  const inReview = j.filter(x => x.status === 'submitted' || x.status === 'hse_review').length;
  const by = (l: RiskLevel) => j.filter(x => x.risk_level === l).length;
  const low = by('low'), medium = by('medium'), high = by('high'), critical = by('critical');
  const highRisk = high + critical;
  const dueWeek = j.filter(x => within(7, x.review_due_at)).length;
  const readiness = total > 0 ? Math.round((active / total) * 100) : 0;
  const trend = monthlyTrend(j.map(x => x.created_at));

  return (
    <MetricRow pageKey="hse.risk.jsa" rowClass="ui-stat-row" cards={[
      { key: 'band', node: (
        <StatsCard icon="fa-list-ol" title="Risk Band"
          chart={<StatDonut total={total} centerLabel="In library" segments={[
            { label: 'Critical', value: critical, color: SEV_COLOR.critical },
            { label: 'High',     value: high,     color: SEV_COLOR.high },
            { label: 'Medium',   value: medium,   color: SEV_COLOR.medium },
            { label: 'Low',      value: low,      color: SEV_COLOR.low },
          ]} />}
          footer={`${highRisk} high-risk jobs`} />
      ) },
      { key: 'highrisk', node: (
        <StatsCard icon="fa-triangle-exclamation" title="High-Risk Jobs"
          metric={highRisk} metricUnit="jobs"
          supporting="Hot work · confined space · lifting"
          statuses={[
            { label: 'In review', value: inReview, color: '#f59e0b' },
            { label: 'Due soon',  value: dueWeek,  color: dueWeek > 0 ? '#ef4444' : '#4ade80' },
          ]}
          footer="By risk band" />
      ) },
      { key: 'readiness', node: (
        <StatsCard icon="fa-user-graduate" title="Training / PPE Readiness" variant="navy"
          metric={`${readiness}%`} supporting={`${active} of ${total} JSAs active`}
          percent={readiness} percentColor={readiness >= 90 ? '#4ade80' : '#fbbf24'} percentTarget="Target 90%"
          footer="Competency + PPE coverage" />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-line" title="JSA Trend"
          metric={total} metricUnit="logged"
          supporting="New JSAs by month"
          chart={<StatTrend points={trend} color="#4ade80" labels={lastSixMonthLabels()} />}
          footer="JSAs — last 6 months" />
      ) },
    ]} />
  );
}
