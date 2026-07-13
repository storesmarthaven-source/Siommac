/**
 * src/ui/components/MetricCard.tsx
 *
 * The STANDARD CARD for the whole ERP — one outline/window, different data inside.
 * Every "card" on every page (dashboard stat tiles, sub-module metric strips,
 * register insight cards) renders this same shell:
 *
 *   ┌ header: icon chip + title ............ headerRight ┐
 *   │ body: whatever the page needs (children)           │
 *   └────────────────────────────────────────────────────┘
 *
 * Wraps the existing `.inc-mini-card` markup (+ `inc-mini-card-navy` for the dark
 * variant) so it's a zero-visual-change drop-in. Any extra DOM props (draggable,
 * onDrag*, style, …) are forwarded to the root, so a Card can be made
 * rearrangeable just by spreading drag handlers onto it.
 *
 * Exported as both `Card` (canonical) and `MetricCard` (back-compat).
 */

import { type VNode, type ComponentChildren, type HTMLAttributes, type CSSProperties } from 'preact';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'icon' | 'title'> {
  /** FontAwesome icon class, e.g. "fa-list-check". */
  icon?: string;
  title?: ComponentChildren;
  /** Right-aligned header content (a badge, a "MTD · 6 total" note, a select). */
  headerRight?: ComponentChildren;
  /** 'navy' = the dark card used for "watch"/control tiles. */
  variant?: 'default' | 'navy';
  /** Back-compat shorthand for variant="navy". */
  navy?: boolean;
  /** Inline colour override for the header icon (e.g. a status token). */
  iconColor?: string;
  /** Style/class for the inner body wrapper. */
  bodyStyle?: CSSProperties;
  bodyClass?: string;
  children?: ComponentChildren;
}

export function Card({
  icon, title, headerRight, variant, navy, iconColor,
  class: extra, bodyStyle, bodyClass, children, ...rest
}: CardProps): VNode {
  const isNavy = variant === 'navy' || navy;
  const cardCls = `inc-mini-card${isNavy ? ' inc-mini-card-navy' : ''}${extra ? ' ' + (extra as string) : ''}`;
  const headCls = `inc-mini-card-header${isNavy ? ' inc-mini-card-header-navy' : ''}`;
  const hasHeader = icon ?? title ?? headerRight;
  return (
    <div class={cardCls} {...rest}>
      {hasHeader && (
        <div class={headCls}>
          {icon && <i class={`fas ${icon}`} style={iconColor ? { color: iconColor } : undefined} />}
          {title && <span>{title}</span>}
          {headerRight}
        </div>
      )}
      <div class={`inc-mini-card-body${bodyClass ? ' ' + bodyClass : ''}`} style={bodyStyle}>{children}</div>
    </div>
  );
}

/** Back-compat alias. */
export const MetricCard = Card;
