import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { LucideIcon } from '@ui/LucideIcon';

export interface UpcomingDeadlineCardItem {
  id: string;
  title: string;
  note: string;
  tagLabel: string;
  tagCls: 'sdb-tag--finance' | 'sdb-tag--human-resource' | 'sdb-tag--payroll' | 'sdb-tag--hse' | 'sdb-tag--it' | 'sdb-tag--calendar' | 'sdb-tag--upcoming' | 'sdb-tag--pending' | 'sdb-tag--planned';
  priorityLabel?: string;
  priorityCls?: 'cpw-priority--low' | 'cpw-priority--normal' | 'cpw-priority--high' | 'cpw-priority--critical';
  onOpen?: () => void;
}

export interface UpcomingDeadlinesCardProps {
  deadlinesOn: (date: Date) => UpcomingDeadlineCardItem[];
  className?: string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: (date: Date) => string;
  emptyDescription?: string;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function UpcomingDeadlinesCard({
  deadlinesOn,
  className = '',
  loading = false,
  error = null,
  emptyTitle = date => `No Filings Due on ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
  emptyDescription = 'NIS and PAYE remittances are due on the 15th; the TD4 return by 28 February.',
}: UpcomingDeadlinesCardProps): VNode {
  const today = useMemo(startOfToday, []);
  const [weekStart, setWeekStart] = useState(today);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [listView, setListView] = useState<'upcoming' | 'today'>('today');
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    }),
    [weekStart],
  );
  const itemsOn = (date: Date) => deadlinesOn(date).map(item => ({ ...item, date }));
  const weekDeadlines = weekDays.flatMap(itemsOn)
    .sort((left, right) => left.date.getTime() - right.date.getTime() || left.title.localeCompare(right.title));
  const focusedDay = selectedDay ?? (listView === 'today' ? today : null);
  const visibleDeadlines = focusedDay ? itemsOn(focusedDay) : weekDeadlines;
  const listTitle = focusedDay
    ? sameDay(focusedDay, today) ? 'Today' : focusedDay.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : 'Next 7 days';
  const shiftWeek = (direction: -1 | 1): void => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + direction * 7);
    setWeekStart(date);
    setSelectedDay(null);
    setListView('upcoming');
  };
  const showUpcoming = (): void => { setListView('upcoming'); setSelectedDay(null); };
  const showToday = (): void => { setListView('today'); setSelectedDay(null); };

  return (
    <article class={`${className ? `${className} ` : ''}sdb-card sdb-ch sdb-cal sdb-wgt-fill`} data-widget-content-root aria-label="Upcoming deadlines">
      <div class="sdb-ch-hd" data-widget-fit-required>
        <LucideIcon name="CalendarDays" size={18} class="cpw-deadlines__icon" />
        <h2>Upcoming Deadlines</h2>
        <div class="sdb-ch-tools">
          <button type="button" class="sdb-ready-nav" aria-label="Previous week" onClick={() => shiftWeek(-1)}><LucideIcon name="ChevronLeft" size={14} /></button>
          <button type="button" class="sdb-ready-nav" aria-label="Next week" onClick={() => shiftWeek(1)}><LucideIcon name="ChevronRight" size={14} /></button>
        </div>
      </div>
      <div class="sdb-cal-month-row">
        <div class="sdb-cal-month">{weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <div class="sdb-cal-list-tabs" role="group" aria-label="Deadline list view" data-widget-fit-required>
          <button type="button" aria-pressed={listView === 'today'} class={`today${listView === 'today' ? ' active' : ''}`} onClick={showToday}>Today</button>
          <button type="button" aria-pressed={listView === 'upcoming'} class={listView === 'upcoming' ? 'active' : ''} onClick={showUpcoming}>Upcoming</button>
        </div>
      </div>
      <div class="sdb-cal-strip" data-widget-fit-required>
        {weekDays.map(date => {
          const current = sameDay(date, today);
          const selected = selectedDay ? sameDay(date, selectedDay) : listView === 'today' && current;
          const hasDeadline = deadlinesOn(date).length > 0;
          return (
            <button type="button" key={date.toISOString()}
              class={`sdb-cal-day${selected ? ' is-on' : ''}${current ? ' is-today' : ''}${hasDeadline ? ' has-deadline' : ''}`}
              aria-pressed={selected}
              onClick={() => { setListView(sameDay(date, today) ? 'today' : 'upcoming'); setSelectedDay(new Date(date)); }}>
              <span>{date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div class="sdb-cal-list" data-widget-fit-required>
        <div class="sdb-cal-list-head"><span>{listTitle}</span>{selectedDay ? <button type="button" onClick={showUpcoming}>Clear</button> : null}</div>
        {loading ? (
          <div class="sdb-cal-empty"><LucideIcon name="LoaderCircle" size={42} class="cpw-spin sdb-cal-empty-ic" /><div class="sdb-cal-empty-t">Loading deadlines</div></div>
        ) : error ? (
          <div class="sdb-cal-empty" role="alert"><LucideIcon name="TriangleAlert" size={42} class="sdb-cal-empty-ic" /><div class="sdb-cal-empty-t">Deadlines could not be loaded</div><div class="sdb-cal-empty-s">{error}</div></div>
        ) : visibleDeadlines.length === 0 ? (
          <div class="sdb-cal-empty">
            <LucideIcon name="CalendarCheck" size={52} strokeWidth={1.5} class="sdb-cal-empty-ic" />
            <div class="sdb-cal-empty-t">{focusedDay ? emptyTitle(focusedDay) : 'No Upcoming Deadlines'}</div>
            <div class="sdb-cal-empty-s">{emptyDescription}</div>
          </div>
        ) : visibleDeadlines.map(deadline => {
          const content = <>
            {listView === 'upcoming' ? <span class="cpw-deadline-calendar" aria-hidden="true">
              <span>{deadline.date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</span>
              <strong>{deadline.date.getDate()}</strong>
            </span> : <span class="cpw-deadline-today-icon" aria-hidden="true"><LucideIcon name="CalendarClock" size={14} /></span>}
            <span class="cpw-deadline-row__copy">
              <strong class="sdb-up-t">{deadline.title}</strong>
              <span class="sdb-up-s cpw-deadline-row__meta">
                <span class={`sdb-tag ${deadline.tagCls}`}>{deadline.tagLabel}</span>
                {deadline.priorityLabel && deadline.priorityCls ? <span class={`cpw-deadline-priority ${deadline.priorityCls}`}>{deadline.priorityLabel}</span> : null}
              </span>
            </span>
          </>;
          const rowClass = `sdb-cal-item cpw-deadline-row${listView === 'today' ? ' cpw-deadline-row--plain' : ''}`;
          return <span class="cpw-deadline-row-wrap" key={deadline.id}>
            {deadline.onOpen
              ? <button type="button" class={rowClass} onClick={deadline.onOpen}>{content}</button>
              : <div class={rowClass}>{content}</div>}
          </span>;
        })}
      </div>
    </article>
  );
}
