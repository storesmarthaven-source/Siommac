/**
 * src/ui/hrfin/QuickActionStrip.tsx — Aurora action row (1:1 with the mockup):
 * `.hrfin-actions` of `.hrfin-action` buttons; one `is-primary`, optional count
 * badge as a trailing `<b>`. The caller omits actions the user can't perform.
 */

import { type VNode } from 'preact';
import { HrfinIcon, type HrfinIconName } from './icon';

export interface QuickAction {
  key: string;
  label: string;
  icon: HrfinIconName;
  variant?: 'primary' | 'secondary' | 'danger';
  badge?: number | string;
  disabled?: boolean;
  onClick: () => void;
}

export function QuickActionStrip({ actions }: { actions: QuickAction[] }): VNode {
  return (
    <section class="hrfin-actions">
      {actions.map(a => (
        <button
          key={a.key}
          type="button"
          class={`hrfin-action${a.variant === 'primary' ? ' is-primary' : a.variant === 'danger' ? ' is-danger' : ''}`}
          disabled={a.disabled}
          onClick={a.onClick}
        >
          <HrfinIcon name={a.icon} />
          <span>{a.label}</span>
          {a.badge !== undefined && a.badge !== null && a.badge !== '' && <b>{a.badge}</b>}
        </button>
      ))}
    </section>
  );
}
