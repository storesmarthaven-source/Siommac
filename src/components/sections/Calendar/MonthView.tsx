import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { isToday, itemDateKey, monthGrid, timeLabel, toLocalDateKey } from '@lib/calendar/date';
import { sourceLabel, sourceTone } from './calendarViewModel';
import { calendarCustomColorVariables } from './calendarColor';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';

const MAX_ITEMS = 3;

function EventCard({ item, full, entering, onOpen, onEntryAnimationEnd }: { item: CalendarItemDTO; full: boolean; entering: boolean; onOpen: (item: CalendarItemDTO) => void; onEntryAnimationEnd?: (id: string) => void }): VNode {
  return (
    <button type="button" class={`cal-event ${sourceTone(item)}${item.customColor ? ' has-custom-color' : ''}${full ? ' is-full' : ''}${item.status === 'done' ? ' is-done' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
      style={calendarCustomColorVariables(item.customColor) || undefined}
      onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}
      onClick={event => { event.stopPropagation(); onOpen(item); }}>
      <span class="cal-event-title"><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /><span>{item.title}</span>{item.recurrenceRule ? <i class="fas fa-rotate" aria-label="Recurring" /> : null}</span>
      <small>{item.allDay ? sourceLabel(item) : `${item.startsAt ? timeLabel(item.startsAt) : 'Time pending'} · ${sourceLabel(item)}`}</small>
      {full && item.notes ? <span class="cal-event-notes">{item.notes}</span> : null}
    </button>
  );
}
export function MonthView({ month, items, selectedKey, loading, enteringItemId = null, onSelectDay, onOpenItem, onEntryAnimationEnd }: {
  month: Date;
  items: CalendarItemDTO[];
  selectedKey: string;
  loading: boolean;
  enteringItemId?: string | null;
  onSelectDay: (key: string) => void;
  onOpenItem: (item: CalendarItemDTO) => void;
  onEntryAnimationEnd?: (id: string) => void;
}): VNode {
  const days = monthGrid(month);
  const monthIndex = month.getMonth();
  const byDay = new Map<string, CalendarItemDTO[]>();
  for (const day of days) {
    const key = toLocalDateKey(day);
    const dayItems = items.filter(item => itemDateKey(item) === key);
    if (dayItems.length) byDay.set(key, dayItems);
  }

  return (
    <div class="cal-month" aria-busy={loading}>
      <div class="cal-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day}>{day}</div>)}</div>
      <div class="cal-month-grid">
        {days.map(day => {
          const key = toLocalDateKey(day);
          const dayItems = (byDay.get(key) ?? []).slice().sort((a, b) => (a.startsAt ?? a.startsOn ?? '').localeCompare(b.startsAt ?? b.startsOn ?? ''));
          const shown = dayItems.slice(0, MAX_ITEMS);
          const extra = dayItems.length - shown.length;
          return (
            <div key={key} role="button" tabIndex={0}
              aria-label={`${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${dayItems.length} item${dayItems.length === 1 ? '' : 's'}`}
              class={`cal-day${day.getMonth() !== monthIndex ? ' is-out' : ''}${isToday(day) ? ' is-today' : ''}${selectedKey === key ? ' is-selected' : ''}`}
              onClick={() => onSelectDay(key)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectDay(key); } }}>
              <span class="cal-day-number">{day.getDate()}</span>
              {loading ? <div class="cal-skeleton cal-skeleton-event" /> : shown.map(item => <EventCard key={item.id} item={item} full={dayItems.length === 1} entering={item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`)} onOpen={onOpenItem} onEntryAnimationEnd={onEntryAnimationEnd} />)}
              {extra > 0 ? <button type="button" class="cal-more" onClick={event => { event.stopPropagation(); onSelectDay(key); }}>+{extra} more</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
