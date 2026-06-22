/**
 * src/components/sections/HSE/risk-jsa/RiskJsaInsightCards.tsx
 *
 * The four operational insight cards under the Risk & JSA header. They CHANGE by
 * active tab — Hazard Register, Risk Assessments and JSA Library each get their
 * own four cards (different metrics, different InsightCard variants) so the page
 * answers "what's happening / what needs attention / where to act" per tab.
 *
 * Metrics are computed from the live list data (useHazards / useAssessments /
 * useJsaList); fields not yet in the lists use available proxies until the
 * /summary payload is extended (spec §14).
 */

import { type VNode } from 'preact';
import { SparkCard } from '@ui';
import { useHazards, useAssessments, useJsaList, type RiskLevel } from '@api/hse/riskJsa';
import { InsightCard } from './shared/InsightCard';

const WEEK_LABELS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];

const SEV_COLOR: Record<RiskLevel, string> = { low: '#16a34a', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };

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

/** Real series: items falling due in each of the next `weeks` weeks (overdue → week 0). */
function dueTrend(dates: Array<string | null | undefined>, weeks = 6): number[] {
  const now = Date.now();
  const buckets = new Array<number>(weeks).fill(0);
  for (const iso of dates) {
    if (!iso) continue;
    const wk = Math.floor((new Date(iso).getTime() - now) / (7 * 86400000));
    const idx = wk < 0 ? 0 : wk;
    if (idx >= 0 && idx < weeks) buckets[idx]! += 1;
  }
  return buckets;
}

export function RiskJsaInsightCards({ activeTab }: { activeTab: 'hazards' | 'assessments' | 'jsa' }): VNode {
  if (activeTab === 'assessments') return <AssessmentCards />;
  if (activeTab === 'jsa')         return <JsaCards />;
  return <HazardCards />;
}

const ROW: preact.JSX.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px', marginBottom: '20px' };

// ── Hazard Register ─────────────────────────────────────────────────────────────

function HazardCards(): VNode {
  const { data } = useHazards({});
  const hz = data?.data ?? [];
  const by = (l: RiskLevel) => hz.filter(h => h.risk_level === l).length;
  const low = by('low'), medium = by('medium'), high = by('high'), critical = by('critical');
  const total = hz.length;
  const highCrit = high + critical;
  const overdueRev = hz.filter(h => overdue(h.review_due_at)).length;
  const dueWeek = hz.filter(h => within(7, h.review_due_at)).length;
  const withControls = hz.filter(h => h.status === 'approved' || h.status === 'monitoring').length;
  const coverage = total > 0 ? Math.round((withControls / total) * 100) : 0;

  const cat = new Map<string, number>();
  hz.filter(h => h.risk_level === 'high' || h.risk_level === 'critical').forEach(h => cat.set(h.category, (cat.get(h.category) ?? 0) + 1));
  const byCat = [...cat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, value]) => ({ label, value, color: '#ef4444' }));

  return (
    <div style={ROW}>
      <SparkCard spark={{
        label: 'Review Cycle',
        value: `${overdueRev + dueWeek}`,
        sub: `${overdueRev} overdue · ${dueWeek} due this week`,
        sparkPoints: dueTrend(hz.map(h => h.review_due_at)),
        sparkColor: overdueRev > 0 ? '#f87171' : '#60a5fa',
        months: WEEK_LABELS,
        delta: `${dueWeek}`,
        deltaUp: overdueRev > 0,
      }} />
      <InsightCard icon="fa-radiation" title="Hazard Profile" value={total} subtitle={`${critical} critical · ${high} high · ${medium} medium · ${low} low`}
        variant="donut" data={{ segments: [{ value: critical, color: SEV_COLOR.critical }, { value: high, color: SEV_COLOR.high }, { value: medium, color: SEV_COLOR.medium }, { value: low, color: SEV_COLOR.low }] }}
        footer="On the register" />
      <InsightCard icon="fa-triangle-exclamation" title="High / Critical Hazards" value={`${highCrit}`} subtitle={overdueRev > 0 ? `${overdueRev} overdue reviews` : 'Need control verification'}
        variant="bar" tone={highCrit > 0 ? 'danger' : 'neutral'} data={{ bars: byCat }}
        footer={byCat.map(c => `${c.label} ${c.value}`).join(' · ') || 'No high-risk hazards'} />
      <InsightCard icon="fa-shield-halved" title="Control Coverage" value={`${coverage}%`} subtitle={`${withControls} of ${total} hazards controlled`}
        variant="progress" tone="navy" data={{ pct: coverage, color: coverage >= 80 ? '#4ade80' : '#fbbf24', target: 'Target 85%' }}
        footer="Approved / monitoring" />
    </div>
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
  const dueMonth = a.filter(x => within(30, x.review_due_at)).length;

  return (
    <div style={ROW}>
      <SparkCard spark={{
        label: 'Reviews Due',
        value: `${dueMonth}`,
        sub: `${dueWeek} this week · ${dueMonth - dueWeek} this month`,
        sparkPoints: dueTrend(a.map(x => x.review_due_at)),
        sparkColor: '#60a5fa',
        months: WEEK_LABELS,
        delta: `${dueWeek}`,
        deltaUp: dueWeek > 0,
      }} />
      <InsightCard icon="fa-table-cells-large" title="Assessment Status" value={total} subtitle={`${active} active · ${underReview} under review · ${expired} expired`}
        variant="donut" data={{ segments: [{ value: active, color: '#16a34a' }, { value: underReview, color: '#f59e0b' }, { value: expired, color: '#ef4444' }] }}
        footer={`${underReview} pending approval`} />
      <InsightCard icon="fa-arrow-down-wide-short" title="Residual Risk" value={`${highResidual}`} subtitle={`${acceptable}% acceptable after controls`}
        variant="progress" tone={highResidual > 0 ? 'warning' : 'neutral'} data={{ pct: acceptable, color: acceptable >= 85 ? '#22c55e' : '#f59e0b', target: 'Target 85%' }}
        footer="High residual remaining" />
      <InsightCard icon="fa-clipboard-check" title="Approval Queue" value={`${underReview}`} subtitle={`${returned} returned · ${underReview} awaiting review`}
        variant="status-grid" tone="navy" data={{ tiles: [{ value: underReview, label: 'Awaiting' }, { value: returned, label: 'Returned', tone: returned > 0 ? '#fca5a5' : '#4ade80' }] }}
        footer="HSE review" />
    </div>
  );
}

// ── JSA Library ─────────────────────────────────────────────────────────────────

function JsaCards(): VNode {
  const { data } = useJsaList({});
  const j = data?.data ?? [];
  const active = j.filter(x => x.status === 'active' || x.status === 'approved').length;
  const highRisk = j.filter(x => x.risk_level === 'high' || x.risk_level === 'critical').length;
  const dueWeek = j.filter(x => within(7, x.review_due_at)).length;
  const inReview = j.filter(x => x.status === 'submitted' || x.status === 'hse_review').length;

  const bandBars = (['critical', 'high', 'medium'] as RiskLevel[])
    .map(l => ({ label: l.charAt(0).toUpperCase() + l.slice(1), value: j.filter(x => x.risk_level === l).length, color: SEV_COLOR[l] }))
    .filter(b => b.value > 0);

  return (
    <div style={ROW}>
      <SparkCard spark={{
        label: 'Active JSAs',
        value: `${active}`,
        sub: `${j.length} in the library · ${inReview} in review`,
        sparkPoints: monthlyTrend(j.map(x => x.created_at)),
        sparkColor: '#4ade80',
        delta: `${active}`,
        deltaUp: false,
      }} />
      <InsightCard icon="fa-triangle-exclamation" title="High-Risk Jobs" value={`${highRisk}`} subtitle="Hot work · confined space · lifting"
        variant="bar" tone={highRisk > 0 ? 'danger' : 'neutral'} data={{ bars: bandBars }}
        footer="By risk band" />
      <InsightCard icon="fa-file-shield" title="Permit-Linked JSAs" value={`${j.filter(x => x.status === 'active').length}`} subtitle="Hot work, confined space, general"
        variant="status-grid" tone="navy" data={{ tiles: [{ value: highRisk, label: 'High-risk' }, { value: dueWeek, label: 'Due soon' }] }}
        footer="Permit references" />
      <InsightCard icon="fa-user-graduate" title="Training / PPE Readiness" value={`${j.length > 0 ? Math.round((active / j.length) * 100) : 0}%`} subtitle="Competency + PPE coverage"
        variant="progress" tone="navy" data={{ pct: j.length > 0 ? Math.round((active / j.length) * 100) : 0, color: '#4ade80', target: 'Target 90%' }}
        footer="PPE requirements active" />
    </div>
  );
}
