import { type VNode } from 'preact';
import { Legend, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from 'recharts';
import '../feedback/feedback.recipe.css';

export type ActivityGaugeSize = 'xs' | 'sm' | 'md' | 'lg';
export interface ActivityGaugeSeries { label: string; value: number; color?: string; }
export interface ActivityGaugeProps {
  value?: number; label?: string; max?: number; size?: ActivityGaugeSize;
  color?: string;
  series?: readonly ActivityGaugeSeries[]; showLabel?: boolean; showValue?: boolean;
  showLegend?: boolean; showTooltip?: boolean;
  formatValue?: (value: number) => string; class?: string;
}

const SIZE_CONFIG: Record<ActivityGaugeSize, { height: number; innerRadius: number; outerRadius: number }> = {
  xs: { height: 220, innerRadius: 52, outerRadius: 86 },
  sm: { height: 268, innerRadius: 61, outerRadius: 110 },
  md: { height: 312, innerRadius: 74, outerRadius: 132 },
  lg: { height: 356, innerRadius: 84, outerRadius: 154 },
};
const DEFAULT_SERIES: readonly ActivityGaugeSeries[] = [
  { label: 'Overdue', value: 660 }, { label: 'Scheduled', value: 774 }, { label: 'Active', value: 866 },
];
const SERIES_COLORS = ['var(--ui-activity-gauge-fill-tertiary)', 'var(--ui-activity-gauge-fill-secondary)', 'var(--ui-activity-gauge-fill)'] as const;

/** A bounded multi-series KPI gauge using the same Recharts radial model as the reference. */
export function ActivityGauge({
  value = 866, label = 'Active users', max = 1000, size = 'md', color = '#7f56d9', series,
  showLabel = true, showValue = true, showLegend = true, showTooltip = true,
  formatValue = number => number.toLocaleString(), class: extra,
}: ActivityGaugeProps): VNode {
  const safeMax = max > 0 ? max : 1;
  const clamp = (candidate: number): number => Number.isFinite(candidate) ? Math.min(safeMax, Math.max(0, candidate)) : 0;
  const config = SIZE_CONFIG[size];
  const chartData = (series?.length ? series : DEFAULT_SERIES).slice(0, 3).map((item, index) => ({
    name: item.label, value: clamp(item.value), fill: item.color ?? SERIES_COLORS[index] ?? SERIES_COLORS[2],
  }));
  const primaryValue = clamp(value);

  return (
    <div class={`ui-activity-gauge ui-activity-gauge--${size}${extra ? ` ${extra}` : ''}`}
      role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={primaryValue} aria-valuetext={formatValue(primaryValue)}
      style={`--ui-activity-gauge-fill: ${color}`}>
      <ResponsiveContainer width="100%" height={config.height}>
        <RadialBarChart data={chartData} innerRadius={config.innerRadius} outerRadius={config.outerRadius}
          startAngle={90} endAngle={450} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <PolarAngleAxis tick={false} domain={[0, safeMax]} type="number" reversed />
          {showLegend && <Legend position="bottom" layout="horizontal" iconType="circle" iconSize={8}
            formatter={(legendValue: string) => <span class="ui-activity-gauge__legend-label">{legendValue}</span>} />}
          {showTooltip && <Tooltip cursor={false} contentStyle={{ borderRadius: 8, borderColor: 'var(--ui-color-border-default)', fontSize: 12 }} />}
          <RadialBar isAnimationActive={false} dataKey="value" cornerRadius={99} fill="currentColor"
            background={{ fill: 'var(--ui-activity-gauge-track)' }} />
          {(showLabel || showValue) && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
            {showLabel && <tspan x="50%" dy={showValue ? '-1.35em' : '1%'} class="ui-activity-gauge__label">{label}</tspan>}
            {showValue && <tspan x="50%" dy={showLabel ? '1.15em' : '1%'} class="ui-activity-gauge__text">{formatValue(primaryValue)}</tspan>}
          </text>}
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}
