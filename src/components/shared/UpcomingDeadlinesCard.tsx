import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { LucideIcon } from '@ui/LucideIcon';

export interface UpcomingDeadlineCardItem {
  id: string;
  title: string;
  note: string;
  tagLabel: string;
  tagCls: 'sdb-tag--upcoming' | 'sdb-tag--pending' | 'sdb-tag--planned';
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
  const [selectedDay, setSelectedDay] = useState(today);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    }),
    [weekStart],
  );
  const selectedDeadlines = deadlinesOn(selectedDay);
  const shiftWeek = (direction: -1 | 1): void => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + direction * 7);
    setWeekStart(date);
    setSelectedDay(date);
  };

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
      <div class="sdb-cal-month">{weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
      <div class="sdb-cal-strip" data-widget-fit-required>
        {weekDays.map(date => {
          const selected = sameDay(date, selectedDay);
          const current = sameDay(date, today);
          const hasDeadline = deadlinesOn(date).length > 0;
          return (
            <button type="button" key={date.toISOString()}
              class={`sdb-cal-day${selected ? ' is-on' : ''}${current ? ' is-today' : ''}${hasDeadline ? ' has-deadline' : ''}`}
              onClick={() => setSelectedDay(new Date(date))}>
              <span>{date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div class="sdb-cal-list" data-widget-fit-required>
        {loading ? (
          <div class="sdb-cal-empty"><LucideIcon name="LoaderCircle" size={42} class="cpw-spin sdb-cal-empty-ic" /><div class="sdb-cal-empty-t">Loading deadlines</div></div>
        ) : error ? (
          <div class="sdb-cal-empty" role="alert"><LucideIcon name="TriangleAlert" size={42} class="sdb-cal-empty-ic" /><div class="sdb-cal-empty-t">Deadlines could not be loaded</div><div class="sdb-cal-empty-s">{error}</div></div>
        ) : selectedDeadlines.length === 0 ? (
          <div class="sdb-cal-empty">
            <LucideIcon name="CalendarCheck" size={52} strokeWidth={1.5} class="sdb-cal-empty-ic" />
            <div class="sdb-cal-empty-t">{emptyTitle(selectedDay)}</div>
            <div class="sdb-cal-empty-s">{emptyDescription}</div>
          </div>
        ) : selectedDeadlines.map(deadline => {
          const content = <><span class={`sdb-cal-dot ${deadline.tagCls}`} /><span class="cpw-deadline-row__copy"><strong class="sdb-up-t">{deadline.title}</strong><span class="sdb-up-s">{deadline.note}</span></span><span class={`sdb-tag ${deadline.tagCls}`}>{deadline.tagLabel}</span></>;
          return deadline.onOpen
            ? <button type="button" key={deadline.id} class="sdb-cal-item cpw-deadline-row" onClick={deadline.onOpen}>{content}</button>
            : <div key={deadline.id} class="sdb-cal-item">{content}</div>;
        })}
      </div>
    </article>
  );
}
