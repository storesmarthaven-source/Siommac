import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { calendarItemIsPast, isToday, itemDateKey, monthGrid, timeLabel, toLocalDateKey } from '@lib/calendar/date';
import { calendarItemTone, sourceLabel } from './calendarViewModel';
import { calendarCustomColorVariables } from './calendarColor';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';
import type { CalendarMonthEventLimit, CalendarWeekStart } from '../../../../types/uiPreferences';

const WEEKDAY_LABELS: Readonly<Record<CalendarWeekStart, readonly string[]>> = {
  monday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  sunday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

function EventCard({ item, full, entering, dimPastEvents, showCardIcons, onOpen, onEntryAnimationEnd }: { item: CalendarItemDTO; full: boolean; entering: boolean; dimPastEvents: boolean; showCardIcons: boolean; onOpen: (item: CalendarItemDTO) => void; onEntryAnimationEnd?: (id: string) => void }): VNode {
  return (
    <button type="button" class={`cal-event tone-${calendarItemTone(item)}${item.customColor ? ' has-custom-color' : ''}${full ? ' is-full' : ''}${item.status === 'done' ? ' is-done' : ''}${dimPastEvents && calendarItemIsPast(item) ? ' is-past' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
      style={calendarCustomColorVariables(item.customColor) || undefined}
      onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}
      onClick={event => { event.stopPropagation(); onOpen(item); }}>
      <span class="cal-event-title">{showCardIcons ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /> : null}<span>{item.title}</span>{item.recurrenceRule ? <i class="fas fa-rotate" aria-label="Recurring" /> : null}</span>
      <small>{item.allDay ? sourceLabel(item) : `${item.startsAt ? timeLabel(item.startsAt) : 'Time pending'} · ${sourceLabel(item)}`}</small>
      {full && item.notes ? <span class="cal-event-notes">{item.notes}</span> : null}
    </button>
  );
}
export function MonthView({ month, items, selectedKey, loading, weekStartsOn = 'monday', showWeekends = true, eventLimit = 3, dimPastEvents = false, showCardIcons = true, enteringItemId = null, onSelectDay, onOpenItem, onEntryAnimationEnd }: {
  month: Date;
  items: CalendarItemDTO[];
  selectedKey: string;
  loading: boolean;
  weekStartsOn?: CalendarWeekStart;
  showWeekends?: boolean;
  eventLimit?: CalendarMonthEventLimit;
  dimPastEvents?: boolean;
  showCardIcons?: boolean;
  enteringItemId?: string | null;
  onSelectDay: (key: string) => void;
  onOpenItem: (item: CalendarItemDTO) => void;
  onEntryAnimationEnd?: (id: string) => void;
}): VNode {
  const days = monthGrid(month, weekStartsOn).filter(day => showWeekends || (day.getDay() !== 0 && day.getDay() !== 6));
  const weekdayLabels = WEEKDAY_LABELS[weekStartsOn].filter((_, index) => showWeekends || (weekStartsOn === 'sunday' ? index > 0 && index < 6 : index < 5));
  const monthIndex = month.getMonth();
  const byDay = new Map<string, CalendarItemDTO[]>();
  for (const day of days) {
    const key = toLocalDateKey(day);
    const dayItems = items.filter(item => itemDateKey(item) === key);
    if (dayItems.length) byDay.set(key, dayItems);
  }

  return (
    <div class={`cal-month${showWeekends ? '' : ' is-workweek'}`} aria-busy={loading}>
      <div class="cal-weekdays">{weekdayLabels.map(day => <div key={day}>{day}</div>)}</div>
      <div class="cal-month-grid">
        {days.map(day => {
          const key = toLocalDateKey(day);
          const dayItems = (byDay.get(key) ?? []).slice().sort((a, b) => (a.startsAt ?? a.startsOn ?? '').localeCompare(b.startsAt ?? b.startsOn ?? ''));
          const shown = dayItems.slice(0, eventLimit);
          const extra = dayItems.length - shown.length;
          return (
            <div key={key} role="button" tabIndex={0}
              aria-label={`${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${dayItems.length} item${dayItems.length === 1 ? '' : 's'}`}
              class={`cal-day${day.getMonth() !== monthIndex ? ' is-out' : ''}${isToday(day) ? ' is-today' : ''}${selectedKey === key ? ' is-selected' : ''}`}
              onClick={() => onSelectDay(key)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectDay(key); } }}>
              <span class="cal-day-number">{day.getDate()}</span>
              {loading ? <div class="cal-skeleton cal-skeleton-event" /> : shown.map(item => <EventCard key={item.id} item={item} full={dayItems.length === 1} dimPastEvents={dimPastEvents} showCardIcons={showCardIcons} entering={item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`)} onOpen={onOpenItem} onEntryAnimationEnd={onEntryAnimationEnd} />)}
              {extra > 0 ? <button type="button" class="cal-more" onClick={event => { event.stopPropagation(); onSelectDay(key); }}>+{extra} more</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
