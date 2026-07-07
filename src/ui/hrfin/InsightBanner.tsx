/**
 * src/ui/hrfin/InsightBanner.tsx — Aurora alert banner (1:1 with the mockup
 * `.hrfin-alert`): an alert icon + title/sub on the left, one or more action
 * buttons on the right. Optionally dismissible (stays until the condition clears).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { HrfinIcon } from './icon';

export interface InsightAction { label: string; onClick?: () => void; primary?: boolean; }

export interface InsightBannerProps {
  title: string;
  sub?: string;
  actions?: InsightAction[];
  dismissible?: boolean;
}

export function InsightBanner({ title, sub, actions = [], dismissible }: InsightBannerProps): VNode | null {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <section class="hrfin-alert">
      <div class="hrfin-alert-copy">
        <HrfinIcon name="alert" />
        <div><strong>{title}</strong>{sub && <p>{sub}</p>}</div>
      </div>
      <div class="hrfin-alert-actions">
        {actions.map((a, i) => (
          <button key={i} type="button" class={`hrfin-action${a.primary ? ' is-primary' : ''}`} onClick={a.onClick}>{a.label}</button>
        ))}
        {dismissible && <button type="button" class="hrfin-action" aria-label="Dismiss" onClick={() => setDismissed(true)}><HrfinIcon name="close" /></button>}
      </div>
    </section>
  );
}
