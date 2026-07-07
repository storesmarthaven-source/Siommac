/**
 * src/ui/hrfin/ActivityFeed.tsx — Aurora "recent activity" list (1:1 with the
 * mockup `.hrfin-activity-list`): glyph + title + meta per row.
 */

import { type VNode } from 'preact';
import { HrfinIcon, type HrfinIconName } from './icon';

export interface ActivityItem {
  icon: HrfinIconName;
  title: string;
  meta: string;
}

export function ActivityFeed({ items }: { items: ActivityItem[] }): VNode {
  if (!items.length) return <div class="hrfin-empty">No recent activity.</div>;
  return (
    <ul class="hrfin-activity-list">
      {items.map((a, i) => (
        <li key={i}>
          <span><HrfinIcon name={a.icon} /></span>
          <div><b>{a.title}</b><small>{a.meta}</small></div>
        </li>
      ))}
    </ul>
  );
}
