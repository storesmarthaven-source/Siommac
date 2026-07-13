/**
 * src/ui/components/KpiTile.tsx
 *
 * The app-wide STANDARD *plain* KPI tile — a compact metric card for the KPI
 * strip at the top of a module page. Modelled on the Access Control overview
 * cards: a coloured icon chip beside the number + name, one muted supporting
 * line, and an optional footer "View" link that drills into the related view.
 *
 * This is the PLAIN tile (number + context). It is deliberately distinct from
 * the richer chart cards (`StatsCard` / the Aurora KPI cards), which carry
 * sparklines / donuts / percent bars. Reach for those when the card needs a
 * visual; reach for this when it's a number with a drill-through.
 *
 * Two shapes:
 *   • variant="metric" (default) — big number + name inline, sub line, link.
 *   • variant="text"             — a label + a text value (e.g. "Active
 *                                  Version") over a neutral foot band; `sub`
 *                                  renders inside the foot band.
 *
 * Styled by `.ui-kpi*` in assets/styles/uikit-layout.css. `loading` renders a
 * cold-load shimmer instead of a fake "0" — gate with `isLoading && !data`.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { Skeleton } from './Skeleton';

export type KpiTone = 'blue' | 'purple' | 'teal' | 'amber' | 'coral' | 'green' | 'red' | 'neutral';

export interface KpiTileLink {
  label: string;
  onClick: () => void;
}

export interface KpiTileProps {
  /** Font Awesome solid icon class, e.g. `fa-users`. */
  icon: string;
  /** Icon-chip + link accent colour. Default `blue`. Ignored (neutral) for the text variant. */
  tone?: KpiTone;
  /** The metric — a number/short value (metric) or a text label (text). */
  value: ComponentChildren;
  /** Caption beside the value (metric) or above it (text). */
  label: string;
  /** One supporting line — sits under the metric, or inside the foot band for the text variant. */
  sub?: ComponentChildren;
  /** Footer drill link (metric variant only). */
  link?: KpiTileLink;
  /** `metric` (default): number + name inline. `text`: label + text value + foot band. */
  variant?: 'metric' | 'text';
  /** Cold-load — shimmer instead of value/sub. Gate with `q.isLoading && !q.data`. */
  loading?: boolean;
  /** Extra classes appended to the root. */
  class?: string;
}

export function KpiTile({
  icon, tone = 'blue', value, label, sub, link, variant = 'metric', loading, class: className,
}: KpiTileProps): VNode {
  const root = `ui-kpi ui-kpi--${tone}${variant === 'text' ? ' ui-kpi--text' : ''}${className ? ` ${className}` : ''}`;

  if (variant === 'text') {
    return (
      <div class={root}>
        <div class="ui-kpi-main">
          <span class="ui-kpi-ic ui-kpi-ic--neutral"><i class={`fa-solid ${icon}`} /></span>
          <div class="ui-kpi-body">
            <div class="ui-kpi-lbl">{label}</div>
            <div class="ui-kpi-val">{loading ? <Skeleton height={16} width="70%" /> : value}</div>
          </div>
        </div>
        {(sub != null || loading) && (
          <div class="ui-kpi-foot">{loading ? <Skeleton height={11} width="55%" /> : sub}</div>
        )}
      </div>
    );
  }

  return (
    <div class={root}>
      <div class="ui-kpi-main">
        <span class={`ui-kpi-ic ui-kpi-ic--${tone}`}><i class={`fa-solid ${icon}`} /></span>
        <div class="ui-kpi-body">
          <div class="ui-kpi-numrow">
            <span class="ui-kpi-num">{loading ? <Skeleton height={20} width={28} radius={6} /> : value}</span>
            <span class="ui-kpi-name">{label}</span>
          </div>
          {(sub != null || loading) && (
            <div class="ui-kpi-sub">{loading ? <Skeleton height={11} width="60%" /> : sub}</div>
          )}
        </div>
      </div>
      {link && (
        <button type="button" class="ui-kpi-link" onClick={link.onClick}>
          {link.label} <LucideIcon name="ArrowRight" size={14} />
        </button>
      )}
    </div>
  );
}
