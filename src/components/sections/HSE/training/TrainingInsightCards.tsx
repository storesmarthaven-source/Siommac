/**
 * src/components/sections/HSE/training/TrainingInsightCards.tsx
 *
 * The 4 top StatsCards for Training — each a DIFFERENT visualisation so the row
 * reads richly (page-guide: page-specific chart content):
 *   Matrix tab: Compliance→gauge · Workforce→worker-status donut ·
 *               Competency Gaps→bars by competency · Renewals→expiry columns
 *   Certs tab:  Current→issued-trend columns · Due→bars by course ·
 *               Expired→bars by course · Certificate Mix→status donut
 * All computed from live data (no synthetic series).
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow } from '@ui';
import {
  useTrainingStats, useCompetencyMatrix, useCertificates,
  type MatrixRow, type CertificateRow,
} from '@api/hse/training';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PALETTE = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#fb923c', '#f472b6'];
const _titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const isExpiredCert = (c: CertificateRow) => c.status === 'expired' || (!!c.expires_at && new Date(c.expires_at).getTime() < Date.now() && !['revoked', 'archived', 'rejected'].includes(c.status));

function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; }
  return m;
}
function issuedTrend(dates: (string | null | undefined)[], months = 6): number[] {
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
/** Certificates expiring per month over the next `months` (bucket 0 = this month). */
function expiryTrend(certs: CertificateRow[], months = 6): number[] {
  const now = new Date();
  const buckets = new Array<number>(months).fill(0);
  for (const c of certs) {
    if (!c.expires_at || ['revoked', 'archived', 'rejected'].includes(c.status)) continue;
    const d = new Date(c.expires_at);
    const diff = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
    if (diff >= 0 && diff < months) buckets[diff]! += 1;
  }
  return buckets;
}
function lastSixMonthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, idx) => MONTH_ABBR[(now.getMonth() - (5 - idx) + 12) % 12]!);
}
function nextSixMonthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, idx) => MONTH_ABBR[(now.getMonth() + idx) % 12]!);
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

// ── helpers over the matrix ───────────────────────────────────────────────────────

function gapBars(matrix: MatrixRow[]): { label: string; value: number; color: string }[] {
  const m: Record<string, number> = {};
  for (const row of matrix) {
    for (const c of row.competencies) {
      if (c.status === 'missing' || c.status === 'expired') m[c.competencyName] = (m[c.competencyName] ?? 0) + 1;
    }
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ label: k, value: v, color: '#ef4444' }));
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function TrainingInsightCards({ active }: { active: string }): VNode {
  const s = useTrainingStats().data?.data;
  const matrix = useCompetencyMatrix({}).data?.data ?? [];
  const certs = useCertificates({ limit: 200 }).data?.data ?? [];

  const compliancePct = s?.overallCompliancePercent ?? 0;
  const currentCerts = s?.currentCerts ?? 0;
  const dueForRenewal = s?.dueForRenewal ?? 0;
  const expired = s?.expired ?? 0;
  const trackedWorkers = s?.trackedWorkers ?? matrix.length;

  const workerSegments = [
    { label: 'Compliant', value: matrix.filter(m => m.overallStatus === 'compliant').length, color: '#22c55e' },
    { label: 'Due Soon', value: matrix.filter(m => m.overallStatus === 'due_soon').length, color: '#f59e0b' },
    { label: 'Non-compliant', value: matrix.filter(m => m.overallStatus === 'non_compliant').length, color: '#ef4444' },
    { label: 'Pending', value: matrix.filter(m => m.overallStatus === 'pending_verification').length, color: '#60a5fa' },
  ];
  const statusSegments = [
    { label: 'Current', value: certs.filter(c => c.status === 'current').length, color: '#22c55e' },
    { label: 'Due Soon', value: certs.filter(c => c.status === 'due_soon').length, color: '#f59e0b' },
    { label: 'Pending', value: certs.filter(c => c.status === 'pending_verification').length, color: '#60a5fa' },
    { label: 'Expired', value: certs.filter(isExpiredCert).length, color: '#ef4444' },
  ];
  const dueByCourse = Object.entries(tally(certs.filter(c => c.status === 'due_soon'), c => c.course_name))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v], i) => ({ label: k, value: v, color: PALETTE[i % PALETTE.length] ?? '#f59e0b' }));
  const expiredByCourse = Object.entries(tally(certs.filter(isExpiredCert), c => c.course_name))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ label: k, value: v, color: '#ef4444' }));

  if (active === 'certs') {
    return (
      <MetricRow pageKey="hse.training.certs" rowClass="ui-stat-row" cards={[
        { key: 'current', node: (
          <StatsCard icon="fa-certificate" title="Current Certs" metric={currentCerts} supporting="Issued by month"
            chart={<StatColumns points={issuedTrend(certs.map(c => c.issued_at))} labels={lastSixMonthLabels()} color="#2563eb" />}
            footer="Last 6 months" />
        ) },
        { key: 'due', node: (
          <StatsCard icon="fa-hourglass-half" title="Due For Renewal" metric={dueForRenewal} metricColor={dueForRenewal > 0 ? '#f59e0b' : '#22c55e'}
            supporting="By course" chart={<StatBars bars={dueByCourse} />} footer="Within 90 days" />
        ) },
        { key: 'expired', node: (
          <StatsCard icon="fa-triangle-exclamation" title="Expired" metric={expired} metricColor={expired > 0 ? '#ef4444' : '#22c55e'}
            supporting="By course" chart={<StatBars bars={expiredByCourse} />} footer={expired > 0 ? 'Must not perform task' : 'None expired'} />
        ) },
        { key: 'mix', node: (
          <StatsCard icon="fa-chart-pie" title="Certificate Mix" supporting="By status"
            chart={<StatDonut total={certs.length} centerLabel="Certs" segments={statusSegments} />}
            footer="All certificates" />
        ) },
      ]} />
    );
  }

  return (
    <MetricRow pageKey="hse.training.matrix" rowClass="ui-stat-row" cards={[
      { key: 'compliance', node: (
        <StatsCard icon="fa-chart-pie" title="Overall Compliance"
          chart={<StatGauge percent={compliancePct} caption={`${s?.compliantSlots ?? 0}/${s?.totalRequiredSlots ?? 0} competency slots`} color={compliancePct >= 85 ? '#22c55e' : compliancePct >= 60 ? '#f59e0b' : '#ef4444'} />}
          footer="Target 85%" />
      ) },
      { key: 'workforce', node: (
        <StatsCard icon="fa-users" title="Workforce Readiness" supporting="By worker status"
          chart={<StatDonut total={trackedWorkers} centerLabel="Workers" segments={workerSegments} />}
          footer="Tracked workers" />
      ) },
      { key: 'gaps', node: (
        <StatsCard icon="fa-user-xmark" title="Competency Gaps" supporting="Missing / expired by competency"
          chart={<StatBars bars={gapBars(matrix)} />} footer="Action required" />
      ) },
      { key: 'renewals', node: (
        <StatsCard icon="fa-hourglass-half" title="Upcoming Renewals" metric={dueForRenewal} metricColor={dueForRenewal > 0 ? '#f59e0b' : '#22c55e'}
          supporting="Certs expiring by month" chart={<StatColumns points={expiryTrend(certs)} labels={nextSixMonthLabels()} color="#f59e0b" />}
          footer="Next 6 months" />
      ) },
    ]} />
  );
}
