import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { durationMinutes, isToday, timeLabel } from '@lib/calendar/date';
import { groupItemsByDate, sourceLabel, sourceTone } from './calendarViewModel';

function AgendaTime({ item }: { item: CalendarItemDTO }): VNode {
  if (item.allDay) return <span>All day</span>;
  const duration = durationMinutes(item.startsAt, item.endsAt);
  return (
    <span>
      <strong>{item.startsAt ? timeLabel(item.startsAt) : 'Time pending'}</strong>
      {duration !== null && duration > 0 ? <small>{duration} min</small> : null}
    </span>
  );
}
export function AgendaView({ items, loading, onOpenItem }: {
  items: CalendarItemDTO[];
  loading: boolean;
  onOpenItem: (item: CalendarItemDTO) => void;
}): VNode {
  const groups = groupItemsByDate(items);
  if (loading) {
    return <div class="cal-agenda-view">{[0, 1, 2, 3].map(i => <div key={i} class="cal-skeleton cal-skeleton-row" />)}</div>;
  }
  if (!groups.length) {
    return (
      <div class="cal-empty-state">
        <i class="fas fa-calendar-check" aria-hidden="true" />
        <strong>No matching calendar items</strong>
        <span>Try another month, scope, search term, or filter.</span>
      </div>
    );
  }

  return (
    <div class="cal-agenda-view" aria-label="Calendar agenda">
      <header class="cal-agenda-summary">
        <div><span>Agenda</span><strong>Scheduled items</strong><small>Compact chronological view of the authorised calendar result.</small></div>
        <div><strong>{items.length}</strong><span>items shown</span></div>
      </header>
      <div class="cal-agenda-groups">
        {groups.map(group => (
          <section class="cal-agenda-group" key={group.key}>
            <time class={`cal-agenda-date${isToday(group.date) ? ' is-today' : ''}`} dateTime={group.key}>
              <span>{group.date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{group.date.getDate()}</strong>
              <small>{group.date.toLocaleDateString('en-US', { month: 'short' })}</small>
            </time>
            <div class="cal-agenda-rows">
              {group.items.map(item => (
                <button class="cal-agenda-row" type="button" key={item.id} onClick={() => onOpenItem(item)}>
                  <span class="cal-agenda-time"><AgendaTime item={item} /></span>
                  <span class={`cal-agenda-icon ${sourceTone(item)}`}><i class={`fas ${item.type === 'deadline' ? 'fa-clock' : item.type === 'task' ? 'fa-list-check' : 'fa-calendar-day'}`} /></span>
                  <span class="cal-agenda-copy">
                    <small>{sourceLabel(item)}</small>
                    <strong>{item.title}</strong>
                    <span>{item.assigneeName ?? item.ownerName ?? item.notes ?? 'No additional details'}</span>
                  </span>
                  <span class={`cal-status ${item.status ?? 'scheduled'}`}>{item.status?.replace(/_/g, ' ') ?? 'Scheduled'}</span>
                  <i class="fas fa-chevron-right cal-agenda-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
