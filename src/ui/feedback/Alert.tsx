import { type ComponentChildren, type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import './feedback.recipe.css';

export type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type AlertPlacement = 'inline' | 'page';

export interface AlertProps {
  tone?: AlertTone;
  placement?: AlertPlacement;
  title?: string;
  children: ComponentChildren;
  icon?: VNode | null;
  actions?: ComponentChildren;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Announce an alert inserted after page load. Static page content should leave this false. */
  announce?: boolean;
  class?: string;
}

const ICONS: Record<AlertTone, Parameters<typeof LucideIcon>[0]['name']> = {
  neutral: 'Info', info: 'Info', success: 'CircleCheck', warning: 'TriangleAlert', danger: 'CircleAlert',
};

export function Alert({
  tone = 'info', placement = 'inline', title, children, icon, actions,
  onDismiss, dismissLabel = 'Dismiss message', announce = false, class: extra,
}: AlertProps): VNode {
  const liveRole = announce ? (tone === 'warning' || tone === 'danger' ? 'alert' : 'status') : undefined;
  const resolvedIcon = icon === undefined ? <LucideIcon name={ICONS[tone]} /> : icon;
  return (
    <section class={`ui-alert ui-alert--${tone} ui-alert--${placement}${extra ? ` ${extra}` : ''}`} role={liveRole}>
      {resolvedIcon && <span class="ui-alert__icon" aria-hidden="true">{resolvedIcon}</span>}
      <div class="ui-alert__copy">
        {title && <strong class="ui-alert__title">{title}</strong>}
        <div class="ui-alert__body">{children}</div>
        {actions && <div class="ui-alert__actions">{actions}</div>}
      </div>
      {onDismiss && (
        <Button variant="ghost" size="sm" iconOnly aria-label={dismissLabel} iconLeft={<LucideIcon name="X" />} onClick={onDismiss} class="ui-alert__dismiss" />
      )}
    </section>
  );
}

