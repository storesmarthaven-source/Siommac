/**
 * src/components/sections/HSE/ptw/PtwInsightCards.tsx
 *
 * The four standard summary cards for the Permit-to-Work page — built on the
 * app-wide StatsCard + MetricRow skeleton (the Incidents / Risk & JSA standard).
 *
 * Cards:
 *   1. Active Permits       — count + type breakdown bars
 *   2. Expiring Soon        — count + time-band tiles (<2h / 2-8h)
 *   3. Isolation Readiness  — % + progress bar (required per StatsCard spec)
 *   4. Approval Bottlenecks — count + stage breakdown bars
 *
 * Data comes from the existing /api/hse/ptw/permits/stats endpoint
 * via the usePermitStats() hook.
 */

import { type VNode } from 'preact';
import { StatsCard, MetricRow } from '@ui';
import { usePermitStats } from '@api/hse/ptw';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PtwInsightCardsProps {
  onFilterActive:    () => void;
  onFilterExpiring:  () => void;
  onFilterApprovals: () => void;
}

// ── Local chart sub-components (NOT imported from Incidents/Risk) ──────────────

const TYPE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4'] as const;

/** Horizontal proportional bars with permit type labels. Max 5 bars. */
function PtwTypeBarChart({ bars }: {
  bars: Array<{ type: string; count: number }>;
}): VNode {
  const visible = bars.slice(0, 5);
  const max = Math.max(1, ...visible.map(b => b.count));

  if (visible.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No active permits</div>
    );
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '11px' }}>
      {visible.map((b, i) => {
        const color = TYPE_COLORS[i % TYPE_COLORS.length] ?? '#22c55e';
        const pct = Math.round((b.count / max) * 100);
        return (
          <div key={b.type} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '84px', fontSize: '0.72rem', color: 'var(--text-muted)',
              flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {b.type.replace(/_/g, ' ')}
            </span>
            <div style={{ flex: 1, height: '9px', borderRadius: '999px', background: '#eef0f5', overflow: 'hidden', minWidth: 0 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '999px' }} />
            </div>
            <span style={{ width: '22px', textAlign: 'right', fontWeight: 700, fontSize: '0.8rem', color: 'var(--siomac-navy)', flexShrink: 0 }}>
              {b.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Time-band tiles: large number + label.
 * <2h is red when count > 0, else green; 2-8h is amber.
 */
function ExpiryBandChart({ buckets, withinTwo }: {
  buckets: Array<{ label: string; count: number }>;
  withinTwo: number;
}): VNode {
  const lt2  = buckets.find(b => b.label === '<2h');
  const lt8  = buckets.find(b => b.label === '2-8h');
  const lt2Count = lt2?.count ?? withinTwo;
  const lt8Count = lt8?.count ?? 0;

  const tiles = [
    { value: lt2Count, label: '<2h',  color: lt2Count > 0 ? '#ef4444' : '#22c55e' },
    { value: lt8Count, label: '2-8h', color: '#f59e0b' },
  ];

  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
      {tiles.map(t => (
        <div key={t.label} style={{
          background: 'var(--bg-subtle, #f8fafe)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '14px 6px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: t.color, lineHeight: 1 }}>{t.value}</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: '6px' }}>
            {t.label}
          </div>
        </div>
      ))}
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  awaiting_approval: 'Area Authority',
  changes_requested: 'Changes Req.',
  risk_review:       'Risk Review',
  isolation_pending: 'Isolation',
  gas_test_pending:  'Gas Test',
  submitted:         'Submitted',
};

/** Horizontal bars with stage labels. Shows green check message when empty. */
function BottleneckBars({ stages }: {
  stages: Array<{ stage: string; count: number }>;
}): VNode {
  if (stages.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#22c55e', fontSize: '0.78rem' }}>
        <i class="fas fa-circle-check" style={{ fontSize: '1rem' }} />
        <span>All clear — no bottlenecks</span>
      </div>
    );
  }

  const max = Math.max(1, ...stages.map(s => s.count));

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '11px' }}>
      {stages.map(s => {
        const label = STAGE_LABELS[s.stage] ?? s.stage.replace(/_/g, ' ');
        const pct = Math.round((s.count / max) * 100);
        return (
          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '84px', fontSize: '0.72rem', color: 'var(--text-muted)',
              flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {label}
            </span>
            <div style={{ flex: 1, height: '9px', borderRadius: '999px', background: '#eef0f5', overflow: 'hidden', minWidth: 0 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#f59e0b', borderRadius: '999px' }} />
            </div>
            <span style={{ width: '22px', textAlign: 'right', fontWeight: 700, fontSize: '0.8rem', color: 'var(--siomac-navy)', flexShrink: 0 }}>
              {s.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function PtwInsightCards({ onFilterActive, onFilterExpiring, onFilterApprovals }: PtwInsightCardsProps): VNode {
  const { data, isLoading } = usePermitStats();
  const stats = data?.data;

  // Card 1 — Active Permits
  const total         = stats?.activePermits.total          ?? 0;
  const highRisk      = stats?.activePermits.highRisk        ?? 0;
  const criticalAreas = stats?.activePermits.criticalAreas   ?? 0;
  const byType        = stats?.activePermits.byType          ?? [];
  const activeColor   = highRisk > 0 ? '#ef4444' : criticalAreas > 0 ? '#f59e0b' : '#22c55e';
  const activeSupporting = highRisk > 0 || criticalAreas > 0
    ? `${highRisk} high-risk · ${criticalAreas} critical areas`
    : 'All within normal risk';

  // Card 2 — Expiring Soon
  const expiring      = stats?.expiringSoon.total            ?? 0;
  const withinTwo     = stats?.expiringSoon.withinTwoHours   ?? 0;
  const buckets       = stats?.expiringSoon.buckets          ?? [];
  const expiryColor   = withinTwo > 0 ? '#ef4444' : expiring > 0 ? '#f59e0b' : '#22c55e';
  const expirySupporting = withinTwo > 0
    ? `${withinTwo} expire within 2 hours`
    : 'No permits expiring soon';

  // Card 3 — Isolation Readiness
  const isoPct        = stats?.isolationReadiness.percentage ?? 100;
  const isoVerified   = stats?.isolationReadiness.verified   ?? 0;
  const isoRequired   = stats?.isolationReadiness.required   ?? 0;
  const isoColor      = isoPct >= 90 ? '#22c55e' : isoPct >= 70 ? '#f59e0b' : '#ef4444';
  const isoSupporting = `${isoVerified} of ${isoRequired} isolation points verified`;

  // Card 4 — Approval Bottlenecks
  const bottlenecks          = stats?.approvalBottlenecks.total     ?? 0;
  const byStage              = stats?.approvalBottlenecks.byStage   ?? [];
  const bottleneckColor      = bottlenecks > 0 ? '#f59e0b' : '#22c55e';
  const bottleneckSupporting = bottlenecks > 0
    ? 'Permits stalled awaiting decision'
    : 'All clear — no bottlenecks';

  const dash = '—';

  return (
    <MetricRow pageKey="hse.ptw" rowClass="ui-stat-row" cards={[
      {
        key: 'active',
        node: (
          <StatsCard
            icon="fa-file-shield"
            title="Active Permits"
            metric={isLoading ? dash : total}
            metricColor={activeColor}
            supporting={activeSupporting}
            chart={<PtwTypeBarChart bars={byType} />}
            footer="Breakdown by permit type"
            onClick={onFilterActive}
            style={{ cursor: 'pointer' }}
          />
        ),
      },
      {
        key: 'expiring',
        node: (
          <StatsCard
            icon="fa-clock"
            title="Expiring Soon"
            metric={isLoading ? dash : expiring}
            metricColor={expiryColor}
            supporting={expirySupporting}
            chart={<ExpiryBandChart buckets={buckets} withinTwo={withinTwo} />}
            footer="Time bands: <2h · 2–8h"
            onClick={onFilterExpiring}
            style={{ cursor: 'pointer' }}
          />
        ),
      },
      {
        key: 'isolation',
        node: (
          <StatsCard
            icon="fa-lock"
            title="Isolation Readiness"
            variant="navy"
            metric={isLoading ? dash : `${isoPct}%`}
            metricColor={isoColor}
            supporting={isoSupporting}
            percent={isoPct}
            percentColor={isoColor}
            percentTarget="Target 100%"
            footer={`${isoVerified} verified / ${isoRequired} required`}
          />
        ),
      },
      {
        key: 'bottlenecks',
        node: (
          <StatsCard
            icon="fa-triangle-exclamation"
            title="Approval Bottlenecks"
            variant="navy"
            metric={isLoading ? dash : bottlenecks}
            metricColor={bottleneckColor}
            supporting={bottleneckSupporting}
            chart={<BottleneckBars stages={byStage} />}
            footer="Queue breakdown by stage"
            onClick={onFilterApprovals}
            style={{ cursor: 'pointer' }}
          />
        ),
      },
    ]} />
  );
}
