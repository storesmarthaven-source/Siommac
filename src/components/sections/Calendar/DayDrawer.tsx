/**
 * src/components/sections/Calendar/DayDrawer.tsx
 *
 * Right-hand day panel: the long date, a day-overview (count + type-breakdown
 * donut), and the day's agenda (timed items with start time + duration, all-day
 * items grouped first). Clicking an agenda row opens that item.
 */

import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { longDayLabel, timeLabel, durationMinutes } from '@lib/calendar/date';
import { typeIcon } from './MonthView';

const TYPE_COLOR: Record<string, string> = { deadline: '#d97706', task: '#16a34a', activity: '#7c3aed' };

/** A 3-segment donut of the day's deadline/task/activity split. */
function Donut({ counts, total }: { counts: Record<string, number>; total: number }): VNode {
  const order = ['deadline', 'task', 'activity'] as const;
  const C = 2 * Math.PI * 15.9155;
  let offset = 0;
  return (
    <svg width="88" height="88" viewBox="0 0 42 42" style="flex:none">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef1f5" stroke-width="5" />
      {total > 0 && order.map(t => {
        const frac = (counts[t] ?? 0) / total;
        if (frac === 0) return null;
        const seg = (
          <circle key={t} cx="21" cy="21" r="15.9155" fill="none" stroke={TYPE_COLOR[t]} stroke-width="5"
            stroke-dasharray={`${(frac * C).toFixed(3)} ${(C - frac * C).toFixed(3)}`}
            stroke-dashoffset={(-offset * C).toFixed(3)} transform="rotate(-90 21 21)" />
        );
        offset += frac;
        return seg;
      })}
      <text x="21" y="20.5" text-anchor="middle" font-size="8" font-weight="700" fill="#111827">{total}</text>
      <text x="21" y="26" text-anchor="middle" font-size="3.2" fill="#6b7280">items</text>
    </svg>
  );
}

function AgendaRow({ item, onOpen }: { item: CalendarItemDTO; onOpen: (i: CalendarItemDTO) => void }): VNode {
  const dur = durationMinutes(item.startsAt, item.endsAt);
  return (
    <div class="cal-agenda-item" onClick={() => onOpen(item)}>
      <div class="cal-agenda-time">
        {item.allDay ? 'All day' : (item.startsAt ? timeLabel(item.startsAt) : '')}
        {dur ? <div style="font-size:11px;color:var(--cal-faint)">{dur} min</div> : null}
      </div>
      <div class="cal-agenda-body">
        <div class="cal-agenda-title">
          <span class={`cal-type-tag cal-type-tag--${item.type}`}><i class={`fas ${typeIcon(item.type)}`} style="margin-right:4px;font-size:9px" />{item.type}</span>
          <span style={item.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''}>{item.title}</span>
        </div>
        <div class="cal-agenda-meta">
          {item.assigneeName ? <span><i class="fas fa-user" style="margin-right:4px" />{item.assigneeName}</span> : null}
          {item.type === 'activity' && item.attendeeCount > 0 ? <span>{item.assigneeName ? ' · ' : ''}{item.attendeeCount} attendee{item.attendeeCount > 1 ? 's' : ''}</span> : null}
          {item.type === 'deadline' && item.sourceLabel ? <span>{item.sourceLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function DayDrawer({ date, items, loading, onClose, onOpenItem }: {
  date: Date;
  items: CalendarItemDTO[];
  loading: boolean;
  onClose: () => void;
  onOpenItem: (item: CalendarItemDTO) => void;
}): VNode {
  const counts: Record<string, number> = { deadline: 0, task: 0, activity: 0 };
  for (const it of items) counts[it.type] = (counts[it.type] ?? 0) + 1;
  const total = items.length;
  const sorted = items.slice().sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startsAt ?? '').localeCompare(b.startsAt ?? '');
  });

  return (
    <aside class="cal-drawer" aria-label="Day details">
      <div class="cal-drawer-head">
        <div class="cal-drawer-title">{longDayLabel(date)}</div>
        <button class="cal-drawer-close" onClick={onClose} aria-label="Close day panel"><i class="fas fa-times" /></button>
      </div>
      <div class="cal-drawer-body">
        <div style="font-size:12px;font-weight:600;color:var(--cal-muted);margin-bottom:10px">Day overview</div>
        <div class="cal-overview">
          <Donut counts={counts} total={total} />
          <div class="cal-donut-legend">
            <div class="row"><span class="cal-dot cal-dot--deadline" style="width:9px;height:9px;border-radius:50%" /> {counts.deadline} Deadline{counts.deadline === 1 ? '' : 's'}</div>
            <div class="row"><span class="cal-dot cal-dot--task" style="width:9px;height:9px;border-radius:50%" /> {counts.task} Task{counts.task === 1 ? '' : 's'}</div>
            <div class="row"><span class="cal-dot cal-dot--activity" style="width:9px;height:9px;border-radius:50%" /> {counts.activity} Activit{counts.activity === 1 ? 'y' : 'ies'}</div>
          </div>
        </div>

        {loading ? (
          <div class="cal-agenda">{[0, 1, 2].map(i => <div key={i} class="cal-skel" style="height:56px" />)}</div>
        ) : sorted.length ? (
          <div class="cal-agenda">{sorted.map(it => <AgendaRow key={it.id} item={it} onOpen={onOpenItem} />)}</div>
        ) : (
          <div class="cal-empty"><i class="fas fa-calendar-check" style="font-size:22px;display:block;margin-bottom:8px;opacity:.5" />Nothing scheduled</div>
        )}
      </div>
    </aside>
  );
}
