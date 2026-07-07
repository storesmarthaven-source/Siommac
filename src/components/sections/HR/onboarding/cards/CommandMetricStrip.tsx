// Onboarding Command Center — CommandMetricStrip (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import type { DashboardMode, KpiRow } from '../../OnboardingCommandCenter.helpers';
import { Icon, MetricMicroChart } from '../primitives';

function CommandMetricStrip({ kpis, mode }: { kpis: KpiRow[]; mode: DashboardMode }): VNode {
  return (
    <section class={`obv-command-metric-strip mode-${mode}`} aria-label={`${mode === 'manager' ? 'Manager' : 'HR staff'} command metrics`}>
      {kpis.map((kpi, index) => (
        <article class={`obv-command-metric-card metric-${kpi.tone}`} key={kpi.key}>
          <div class="obv-command-metric-head">
            <span class={`obv-command-metric-icon metric-${kpi.tone}`}><Icon name={kpi.icon} /></span>
            {kpi.change ? <small class={kpi.trend === 'up' ? 'up' : 'down'}>{kpi.change}</small> : null}
          </div>
          <div class="obv-command-metric-body">
            <div>
              <p>{kpi.title}</p>
              <strong>{kpi.value}</strong>
              <em>{kpi.subtitle}</em>
            </div>
            <MetricMicroChart tone={kpi.tone} index={index} percent={kpi.gaugePercent ?? 64} />
          </div>
        </article>
      ))}
    </section>
  );
}

export { CommandMetricStrip };
