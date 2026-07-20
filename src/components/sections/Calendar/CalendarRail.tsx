import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { itemDateKey, longDayLabel, parseLocalDate, timeLabel } from '@lib/calendar/date';
import { calendarSource, sourceLabel, sourceTone, upcomingActionItems } from './calendarViewModel';

function countTypes(items: CalendarItemDTO[]): string {
  const deadlines = items.filter(item => item.type === 'deadline').length;
  const tasks = items.filter(item => item.type === 'task').length;
  const activities = items.filter(item => item.type === 'activity').length;
  return `${deadlines} deadline${deadlines === 1 ? '' : 's'} · ${tasks} task${tasks === 1 ? '' : 's'} · ${activities} activit${activities === 1 ? 'y' : 'ies'}`;
}

function RailItem({ item, onOpen }: { item: CalendarItemDTO; onOpen: (item: CalendarItemDTO) => void }): VNode {
  return (
    <button class="cal-rail-item" type="button" onClick={() => onOpen(item)}>
      <span class={`cal-rail-item-icon ${sourceTone(item)}`}><i class={`fas ${item.type === 'deadline' ? 'fa-clock' : item.type === 'task' ? 'fa-list-check' : 'fa-calendar-day'}`} /></span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.allDay ? 'All day' : item.startsAt ? timeLabel(item.startsAt) : 'Time pending'} · {sourceLabel(item)}</small>
      </span>
      <i class="fas fa-chevron-right" aria-hidden="true" />
    </button>
  );
}

export function CalendarRail({ selectedKey, todayKey, selectedItems, upcomingItems, allItems, loading, canCreate, onOpenItem, onCreateForDay, onOpenAgenda }: {
  selectedKey: string;
  todayKey: string;
  selectedItems: CalendarItemDTO[];
  upcomingItems: CalendarItemDTO[];
  allItems: CalendarItemDTO[];
  loading: boolean;
  canCreate: boolean;
  onOpenItem: (item: CalendarItemDTO) => void;
  onCreateForDay: (key: string) => void;
  onOpenAgenda: () => void;
}): VNode {
  const selectedDate = parseLocalDate(selectedKey);
  const upcoming = upcomingActionItems(upcomingItems, todayKey);
  const sources = [...new Set(allItems.map(calendarSource))].sort();

  return (
    <aside class="cal-side-rail" aria-label="Calendar context">
      <section class="cal-rail-card">
        <header class="cal-rail-head">
          <div><span>Selected day</span><h2>{longDayLabel(selectedDate)}</h2></div>
          <span class="cal-pill blue">{selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}</span>
        </header>
        <div class="cal-selected-summary">
          <time dateTime={selectedKey}><small>{selectedDate.toLocaleDateString('en-US', { month: 'short' })}</small><strong>{selectedDate.getDate()}</strong></time>
          <div><strong>Day agenda</strong><span>{countTypes(selectedItems)}</span></div>
          {canCreate && <button type="button" onClick={() => onCreateForDay(selectedKey)} aria-label="Add item for selected day"><i class="fas fa-plus" /></button>}
        </div>
        <div class="cal-rail-list">
          {loading ? [0, 1].map(i => <div key={i} class="cal-skeleton cal-skeleton-row" />)
            : selectedItems.length ? selectedItems.map(item => <RailItem item={item} onOpen={onOpenItem} key={item.id} />)
            : <div class="cal-rail-empty">Nothing scheduled for this day.</div>}
        </div>
        <footer class="cal-rail-foot"><span>Select any calendar day to update this panel.</span></footer>
      </section>

      <section class="cal-rail-card">
        <header class="cal-rail-head">
          <div><span>Shared deadline source</span><h2>Upcoming deadlines</h2></div>
          <span class="cal-pill blue">{upcoming.length} event{upcoming.length === 1 ? '' : 's'}</span>
        </header>
        <div class="cal-deadline-list">
          {upcoming.length ? upcoming.map(item => {
            const key = itemDateKey(item)!;
            const date = parseLocalDate(key);
            return (
              <button type="button" class="cal-deadline-row" key={item.id} onClick={() => onOpenItem(item)}>
                <time dateTime={key}><strong>{date.getDate()}</strong><small>{date.toLocaleDateString('en-US', { month: 'short' })}</small></time>
                <span><strong>{item.title}</strong><small>{item.allDay ? 'All day' : item.startsAt ? timeLabel(item.startsAt) : 'Time pending'} · {sourceLabel(item)}</small></span>
                <span class={`cal-pill ${sourceTone(item) === 'overdue' ? 'red' : 'blue'}`}>{sourceTone(item) === 'overdue' ? 'Overdue' : 'Upcoming'}</span>
              </button>
            );
          }) : <div class="cal-rail-empty">No upcoming deadlines in the next 45 days.</div>}
        </div>
        <footer class="cal-rail-foot"><span>One authorised read model</span><button type="button" onClick={onOpenAgenda}>Open agenda</button></footer>
      </section>

      <section class="cal-rail-card">
        <header class="cal-rail-head">
          <div><span>Shared deadline source</span><h2>Connected sources</h2></div>
          <span class="cal-pill green">Live</span>
        </header>
        <div class="cal-source-list">
          {sources.length ? sources.map(source => (
            <div key={source}>
              <i class={`fas ${source === 'calendar' ? 'fa-calendar-days' : source.includes('finance') ? 'fa-landmark' : source.includes('hr') ? 'fa-user-group' : 'fa-layer-group'}`} />
              <span><strong>{source === 'calendar' ? 'Calendar native items' : source.split(/[-_]/g).map(p => `${p.slice(0, 1).toUpperCase()}${p.slice(1)}`).join(' ')}</strong><small>Authorised items present in this view</small></span>
            </div>
          )) : <div class="cal-rail-empty">Sources appear when authorised items are available.</div>}
        </div>
        <footer class="cal-rail-foot"><span>Modules remain authoritative</span></footer>
      </section>
    </aside>
  );
}
