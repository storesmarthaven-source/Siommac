// Onboarding Command Center — ActivationCompletionCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import type { CaseRow, DashboardMode, KpiRow } from '../../OnboardingCommandCenter.helpers';
import { Icon, MetricGauge } from '../primitives';

function ActivationCompletionCard({
  kpis,
  cases,
  mode,
  onOpenReadiness,
}: {
  kpis: KpiRow[];
  cases: CaseRow[];
  mode: DashboardMode;
  onOpenReadiness: () => void;
}): VNode {
  const activation = kpis.find(kpi => kpi.key === 'activation_completion');
  const totalCases = kpis.find(kpi => kpi.key === 'total_cases');
  const dueThisWeek = kpis.find(kpi => kpi.key === 'due_this_week');
  const readyCases = cases.filter(row => row.ready).length;
  const progress = Math.min(100, activation?.gaugePercent ?? 0);

  return (
    <article class="obv-health-card obv-activation-side-card">
      <div class="obv-activation-side-head">
        <div class="obv-activation-title-row">
          <span class="obv-activation-main-icon"><Icon name="check" /></span>
          <div>
            <h2>{mode === 'staff' ? 'Ready For HR Review' : 'Readiness Gates'}</h2>
            <p>Day‑1 Readiness Across Active Onboarding.</p>
          </div>
        </div>
      </div>

      <div class="obv-activation-score-row">
        <div class="obv-activation-score-copy">
          <span>Current</span>
          <strong>{activation?.value ?? '0%'}</strong>
          <em>{readyCases} ready case{readyCases === 1 ? '' : 's'}</em>
        </div>
        <MetricGauge tone="green" percent={progress} change="" trend="up" />
      </div>

      <div class="obv-activation-info-grid">
        <button type="button" onClick={onOpenReadiness}>
          <span>Total Cases</span>
          <strong>{totalCases?.value ?? '0'}</strong>
        </button>
        <button type="button" onClick={onOpenReadiness}>
          <span>Due This Week</span>
          <strong>{dueThisWeek?.value ?? '0'}</strong>
        </button>
      </div>

      <button class="obv-activation-open" type="button" onClick={onOpenReadiness}>Open Readiness Work</button>
    </article>
  );
}

export { ActivationCompletionCard };
