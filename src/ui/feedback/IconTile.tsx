import { type VNode } from 'preact';
import { LucideIcon, type LucideName } from '../LucideIcon';
import './notifications.recipe.css';

export type IconTileTone =
  | 'neutral' | 'navy' | 'group'
  | 'blue' | 'indigo' | 'cyan' | 'teal' | 'violet' | 'rose'
  | 'amber' | 'orange' | 'danger' | 'success';
export type IconTileSize = 'sm' | 'md' | 'lg';
export type IconTileShape = 'rounded' | 'circle';

export interface IconTileProps {
  icon: LucideName | VNode;
  tone?: IconTileTone;
  size?: IconTileSize;
  shape?: IconTileShape;
  label?: string;
  class?: string;
}

/** A reusable soft icon surface for notifications, activity feeds and compact summaries. */
export function IconTile({
  icon,
  tone = 'neutral',
  size = 'md',
  shape = 'rounded',
  label,
  class: extra,
}: IconTileProps): VNode {
  const classes = [
    'ui-icon-tile',
    `ui-icon-tile--${tone}`,
    `ui-icon-tile--${size}`,
    `ui-icon-tile--${shape}`,
    extra,
  ].filter(Boolean).join(' ');

  return (
    <span class={classes} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      {typeof icon === 'string' ? <LucideIcon name={icon} /> : icon}
    </span>
  );
}
