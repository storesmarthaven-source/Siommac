// The standard information-icon treatment, composed with canonical Tooltip.
import type { VNode } from 'preact';
import { LucideIcon } from './LucideIcon';
import { Tooltip } from './overlays/Tooltip';
import './InfoTip.css';

export interface InfoTipProps {
  /** Tooltip text. Required: a dead information icon is not rendered. */
  tip: string;
  /** Icon size in px (default 15). */
  size?: number;
  /** Retained for source compatibility; collision now chooses the safe side. */
  placement?: 'top' | 'bottom';
  /** Accessible name for the information trigger. */
  label?: string;
  class?: string;
}

export function InfoTip({ tip, size = 15, placement = 'top', label = 'More information', class: cls }: InfoTipProps): VNode {
  return (
    <Tooltip content={tip} placement={placement}>
      <span
        class={`ui-infotip ui-infotip--${placement}${cls ? ` ${cls}` : ''}`}
        tabIndex={0}
        role="img"
        aria-label={label}
      >
        <LucideIcon name="Info" size={size} strokeWidth={2} />
      </span>
    </Tooltip>
  );
}
