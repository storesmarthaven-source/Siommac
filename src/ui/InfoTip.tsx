// src/ui/InfoTip.tsx — the STANDARD info-icon + tooltip.
//
// A small Lucide "i" that reveals a dark tooltip on hover/focus (keyboard-accessible).
// The look matches the wizard forms' field-hint icon (see statutoryForms.css .sfp-info),
// promoted here so every surface uses ONE info-icon + tooltip design. Pure CSS tooltip
// (no portal) — for icons inside `overflow:hidden` cards, pass placement to point the
// bubble where there's room.
import type { VNode } from 'preact';
import { LucideIcon } from './LucideIcon';
import './InfoTip.css';

export interface InfoTipProps {
  /** Tooltip text. Required — we never render a dead, tip-less info icon. */
  tip: string;
  /** Icon size in px (default 15). */
  size?: number;
  /** Which side the bubble points (default 'top'). Use 'bottom' near a container's top edge. */
  placement?: 'top' | 'bottom';
  class?: string;
}

export function InfoTip({ tip, size = 15, placement = 'top', class: cls }: InfoTipProps): VNode {
  return (
    <span
      class={`ui-infotip ui-infotip--${placement}${cls ? ` ${cls}` : ''}`}
      data-tip={tip} tabIndex={0} role="img" aria-label={tip}
    >
      <LucideIcon name="Info" size={size} strokeWidth={2} />
    </span>
  );
}
