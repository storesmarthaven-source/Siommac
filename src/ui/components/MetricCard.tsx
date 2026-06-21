/**
 * src/ui/components/MetricCard.tsx
 *
 * The summary card used in the top-card strip on register pages (Incidents,
 * CAPA, …). Wraps the existing `.inc-mini-card` markup — header (icon + title)
 * over a body — with an optional dark `navy` variant for "watch" cards.
 *
 * It is intentionally a SHELL: pass whatever body content you need as children
 * (a big number, a list of signal rows, a progress bar). This matches how the
 * real pages use these cards — the header is uniform, the body varies.
 */

import { type VNode, type ComponentChildren } from 'preact';

interface MetricCardProps {
  /** FontAwesome icon class, e.g. "fa-list-check". */
  icon: string;
  title: string;
  /** Dark navy "regulatory watch" styling. */
  navy?: boolean;
  /** Inline colour override for the header icon (e.g. a status token). */
  iconColor?: string;
  class?: string;
  children?: ComponentChildren;
}

export function MetricCard({ icon, title, navy, iconColor, class: extra, children }: MetricCardProps): VNode {
  const cardCls = `inc-mini-card${navy ? ' inc-mini-card-navy' : ''}${extra ? ' ' + extra : ''}`;
  const headCls = `inc-mini-card-header${navy ? ' inc-mini-card-header-navy' : ''}`;
  return (
    <div class={cardCls}>
      <div class={headCls}>
        <i class={`fas ${icon}`} style={iconColor ? { color: iconColor } : undefined} />
        <span>{title}</span>
      </div>
      <div class="inc-mini-card-body">{children}</div>
    </div>
  );
}
