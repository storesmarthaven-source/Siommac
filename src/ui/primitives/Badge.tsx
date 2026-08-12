/**
 * src/ui/primitives/Badge.tsx — the ONE badge system.
 *
 * Status pill, tag, chip, priority indicator and risk indicator are all this
 * component. The audit found TEN implementations across the app — `StatusPill`,
 * `HrfinPill`, `InfoCard.Pill`, `@shared/Badge`, and six private ones inside HSE,
 * Finance, Settings, HR and the messenger — each with its own hexes for "active".
 *
 *   tone     what it MEANS      success | warning | danger | info | neutral | accent
 *   variant  how loud it is     soft (default) | solid | outline
 *   onRemove makes it a tag     a removable chip, not a second component
 *
 * A dot is available for dense rows where a filled pill is too heavy — still the
 * same component, because "status shown small" is not a different concept.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { LucideIcon } from '../LucideIcon';
import './Badge.recipe.css';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

export interface BadgeProps {
  children: ComponentChildren;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** Leading icon. Keep it to a glyph — a badge is not a button. */
  icon?: VNode;
  /**
   * Leading status dot. For dense tables where a filled pill per row is heavier
   * than the data it describes.
   */
  dot?: boolean;
  size?: 'sm' | 'md';
  /** Makes it a removable tag. */
  onRemove?: () => void;
  /** Accessible name for the remove control — defaults from the label. */
  removeLabel?: string;
  class?: string;
}

export function Badge({
  children, tone = 'neutral', variant = 'soft', icon, dot = false,
  size = 'md', onRemove, removeLabel, class: extra,
}: BadgeProps): VNode {
  return (
    <span
      class={[
        'ui-badge',
        `ui-badge--${tone}`,
        `ui-badge--${variant}`,
        size !== 'md' ? `ui-badge--${size}` : '',
        extra ?? '',
      ].filter(Boolean).join(' ')}
    >
      {dot && <span class="ui-badge-dot" aria-hidden="true" />}
      {icon}
      <span class="ui-badge-label">{children}</span>
      {onRemove && (
        <button
          type="button"
          class="ui-badge-remove"
          aria-label={removeLabel ?? `Remove ${typeof children === 'string' ? children : 'item'}`}
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >
          <LucideIcon name="X" />
        </button>
      )}
    </span>
  );
}
