/**
 * src/ui/hrfin/DeadlineList.tsx — Aurora "upcoming deadlines" rows (1:1 with the
 * mockup `.hrfin-date-row`): a two-line date badge + title + meta. The badge
 * lines are caller-supplied (day/month for AP, weekday/day for the Overview).
 */

import { type VNode } from 'preact';

export interface DeadlineItem {
  top: string;
  bottom: string;
  title: string;
  meta: string;
}

export function DeadlineList({ items }: { items: DeadlineItem[] }): VNode {
  if (!items.length) return <div class="hrfin-empty">Nothing scheduled.</div>;
  return (
    <>
      {items.map((d, i) => (
        <div class="hrfin-date-row" key={i}>
          <span class="hrfin-date-badge">{d.top}<br />{d.bottom}</span>
          <div><b>{d.title}</b><small>{d.meta}</small></div>
          <span />
        </div>
      ))}
    </>
  );
}
