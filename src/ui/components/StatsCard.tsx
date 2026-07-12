/**
 * src/ui/components/StatsCard.tsx
 *
 * The app-wide STANDARD summary card — the default skeleton for the four top
 * cards on every module page. Modelled on the Incidents stats cards
 * ("Severity Mix" / "Overall Compliance"): a coloured header (icon + title)
 * over a body that ALWAYS fills the card.
 *
 * One skeleton, page-specific content. Configure via slots:
 *   • header     — icon + title, customizable background + text colour
 *   • metric     — big number (+ optional unit + colour)
 *   • supporting — one line under the metric
 *   • statuses   — coloured status-dot rows (label + value)
 *   • chart      — any visual (donut / sparkline / bars)
 *   • percent    — renders a compliance/progress bar pinned near the bottom
 *   • footer     — a line pinned to the bottom
 *
 * Standard rules (see PAGE_GUIDE):
 *   1. Cards share a fixed minimum size and stretch to equal heights in the row.
 *   2. The body distributes content so the card never looks empty — the
 *      metric sits up top, the chart/statuses fill the middle, and the
 *      percent bar / footer pin to the bottom.
 *   3. Any card showing a percentage MUST pass `percent` so a progress bar
 *      renders near the bottom (the "Overall Compliance" pattern).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { type JSX } from 'preact';
import { Skeleton } from './Skeleton';

export interface StatStatus {
  label: string;
  value?: number | string;
  /** Dot colour (and value colour). */
  color: string;
}

export interface StatsCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'icon' | 'title'> {
  icon?: string;
  title: string;
  /** Dark navy preset (white text) — the standard "two dark cards per row". */
  variant?: 'light' | 'navy';
  /** Override the header background / text colour (wins over `variant`). */
  headerBg?: string;
  headerColor?: string;
  /** Big metric value. */
  metric?: string | number;
  /** Small uppercase unit beside the metric (e.g. "open"). */
  metricUnit?: string;
  metricColor?: string;
  /** One supporting line under the metric. */
  supporting?: string;
  /** Coloured status-dot rows. */
  statuses?: StatStatus[];
  /** Visual area (donut / sparkline / bar rows) — fills the middle. */
  chart?: ComponentChildren;
  /** 0–100 → a compliance/progress bar near the bottom (required for % cards). */
  percent?: number;
  percentColor?: string;
  /** Small target caption under the bar (e.g. "Target 85%"). */
  percentTarget?: string;
  /** A line pinned to the bottom. */
  footer?: ComponentChildren;
  /** Extra free-form body content. */
  children?: ComponentChildren;
  /** Cold-load state — shows a shimmer body instead of metric/chart (never a "0").
   *  Gate with `loading={q.isLoading && !q.data}` so cached data always wins. */
  loading?: boolean;
}

export function StatsCard({
  icon, title, variant = 'light', headerBg, headerColor,
  metric, metricUnit, metricColor, supporting, statuses, chart,
  percent, percentColor, percentTarget, footer, children, loading,
  class: className, ...rest
}: StatsCardProps): VNode {
  const navy = variant === 'navy';
  const headerStyle: JSX.CSSProperties = {};
  if (headerBg)    headerStyle.background = headerBg;
  if (headerColor) headerStyle.color = headerColor;

  const hasPercent = percent !== undefined && percent !== null;
  const barColor = percentColor ?? (percent != null && percent >= 80 ? '#22c55e' : '#f59e0b');

  return (
    <div class={`ui-stat-card${navy ? ' ui-stat-card--navy' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      <div class="ui-stat-card-header" style={headerStyle}>
        {icon && <i class={`fas ${icon}`} />}
        <span>{title}</span>
      </div>

      <div class="ui-stat-card-body">
        {loading ? (
          <>
            <Skeleton height={38} width="55%" radius={8} />
            <Skeleton height={12} width="80%" />
            <div class="ui-stat-spacer" />
            <Skeleton height={56} width="100%" radius={10} />
          </>
        ) : (
        <>
        {metric !== undefined && (
          <div class="ui-stat-metric-row">
            <span class="ui-stat-metric" style={metricColor ? { color: metricColor } : undefined}>{metric}</span>
            {metricUnit && <span class="ui-stat-metric-unit">{metricUnit}</span>}
          </div>
        )}

        {supporting && <div class="ui-stat-supporting">{supporting}</div>}

        {statuses && statuses.length > 0 && (
          <div class="ui-stat-statuses">
            {statuses.map(s => (
              <div class="ui-stat-status" key={s.label}>
                <span class="ui-stat-dot" style={{ background: s.color }} />
                <span class="ui-stat-status-label">{s.label}</span>
                {s.value !== undefined && <span class="ui-stat-status-val" style={{ color: s.color }}>{s.value}</span>}
              </div>
            ))}
          </div>
        )}

        {chart && <div class="ui-stat-chart">{chart}</div>}

        {children}

        {/* When there's a chart it fills + centres (flex:1); otherwise a spacer
            pins the bar / footer to the bottom so the card never looks empty. */}
        {!chart && (hasPercent || footer) && <div class="ui-stat-spacer" />}

        {hasPercent && (
          <div class="ui-stat-bar-wrap">
            <div class="ui-stat-bar-track">
              <div class="ui-stat-bar-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: barColor }} />
            </div>
            {percentTarget && (
              <div class="ui-stat-bar-labels">
                <span>0%</span>
                <span style={{ color: barColor, fontWeight: 600 }}>{percentTarget}</span>
                <span>100%</span>
              </div>
            )}
          </div>
        )}

        {footer && <div class="ui-stat-footer">{footer}</div>}
        </>
        )}
      </div>
    </div>
  );
}
