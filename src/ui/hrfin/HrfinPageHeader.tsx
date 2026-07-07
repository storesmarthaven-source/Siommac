/**
 * src/ui/hrfin/HrfinPageHeader.tsx — Aurora page title row (1:1 with the mockup):
 * icon chip + h1 + sub on the left, count chips on the right.
 */

import { type VNode } from 'preact';
import { HrfinIcon, type HrfinIconName } from './icon';

export interface HrfinChip {
  icon?: HrfinIconName;
  label: string;
  tone?: 'danger' | 'success' | 'warning';
}

export interface HrfinPageHeaderProps {
  icon?: HrfinIconName;
  title: string;
  sub?: string;
  chips?: HrfinChip[];
}

export function HrfinPageHeader({ icon = 'grid', title, sub, chips = [] }: HrfinPageHeaderProps): VNode {
  return (
    <section class="hrfin-title-row">
      <div class="hrfin-title-main">
        <span class="hrfin-title-icon"><HrfinIcon name={icon} /></span>
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {chips.length > 0 && (
        <div class="hrfin-header-chips">
          {chips.map((c, i) => (
            <span class={`hrfin-chip${c.tone ? ` is-${c.tone}` : ''}`} key={i}>
              {c.icon && <HrfinIcon name={c.icon} />}{c.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
