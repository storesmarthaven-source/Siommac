/**
 * src/components/sections/Calendar/MonthView.tsx
 *
 * Month grid (6×7, Sunday-start). Each cell shows up to 3 item chips + "+N more".
 * Items are coloured by type (deadline/task/activity); done items strike through,
 * overdue items get a red ring. Clicking a day selects it (opens the day drawer);
 * clicking a chip opens that item.
 */

import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { monthGrid, toLocalDateKey, isToday, itemDateKey, isOverdue } from '@lib/calendar/date';

const MAX_CHIPS = 3;

export function typeIcon(type: string): string {
  if (type === 'deadline') return 'fa-clock';
  if (type === 'activity') return 'fa-calendar-day';
  return 'fa-circle-check';   // task
}

function Chip({ item, onOpen }: { item: CalendarItemDTO; onOpen: (i: CalendarItemDTO) => void }): VNode {
  const done = item.status === 'done';
  const overdue = isOverdue(item);
  return (
    <div
      class={`cal-chip cal-chip--${item.type}${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}
      title={item.title}
      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
    >
      <i class={`fas ${typeIcon(item.type)}`} aria-hidden="true" />
      <span style="overflow:hidden;text-overflow:ellipsis">{item.title}</span>
    </div>
  );
}

export function MonthView({ month, items, selectedKey, onSelectDay, onOpenItem }: {
  month: Date;
  items: CalendarItemDTO[];
  selectedKey: string | null;
  onSelectDay: (key: string) => void;
  onOpenItem: (item: CalendarItemDTO) => void;
}): VNode {
  const days = monthGrid(month);
  const monthIndex = month.getMonth();

  // Bucket items by their local day key.
  const byDay = new Map<string, CalendarItemDTO[]>();
  for (const it of items) {
    const key = itemDateKey(it);
    if (!key) continue;
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(it);
  }

  return (
    <div class="cal-surface">
      <div class="cal-weekhead">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div class="cal-grid">
        {days.map(day => {
          const key = toLocalDateKey(day);
          const dayItems = (byDay.get(key) ?? []).slice().sort((a, b) =>
            (a.startsAt ?? a.startsOn ?? '').localeCompare(b.startsAt ?? b.startsOn ?? ''));
          const shown = dayItems.slice(0, MAX_CHIPS);
          const extra = dayItems.length - shown.length;
          const out = day.getMonth() !== monthIndex;
          return (
            <div
              key={key}
              class={`cal-cell${out ? ' is-out' : ''}${isToday(day) ? ' is-today' : ''}${key === selectedKey ? ' is-selected' : ''}`}
              onClick={() => onSelectDay(key)}
            >
              <div class="cal-daynum">{day.getDate()}</div>
              {shown.map(it => <Chip key={it.id} item={it} onOpen={onOpenItem} />)}
              {extra > 0 && <div class="cal-more" onClick={(e) => { e.stopPropagation(); onSelectDay(key); }}>+{extra} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
