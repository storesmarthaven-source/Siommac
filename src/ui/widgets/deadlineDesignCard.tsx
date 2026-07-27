import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';
import './calendarPlanningWidgets.css';
import './deadlineDesigns.css';

/**
 * Unified Upcoming Deadlines card. ONE card shell — header + month row with
 * Today/Upcoming tabs + week strip — whose BODY layout is chosen via the `design`
 * setting (the widget's "Layout" config field). Everything is derived from real
 * authorised Calendar data; the "Due in N days" status is computed from the
 * deadline date, never faked, and all-day deadlines show the 11:59 PM cutoff.
 */

/** Status tones (urgency) plus the department icon palette (source module). Purple is retired. */
export type DesignTone =
  | 'blue' | 'green' | 'orange' | 'red' | 'teal'
  | 'hr' | 'finance' | 'payroll' | 'hse' | 'it' | 'operations' | 'calendar';

/** Caught-up panel ("Key upcoming dates"). Carries the next THREE upcoming days — one date per
 *  day — and shows them ONE AT A TIME, with the panel's ‹ › buttons switching between them.
 *  The scan stays inside the already loaded today+62 calendar window, so it never asks for data
 *  the card doesn't already hold. */
const UPCOMING_SCAN_DAYS = 62;
const UPCOMING_PER_DAY = 1;
const UPCOMING_MAX_DAYS = 3;
const UPCOMING_DAYS_PER_PAGE = 1;
/** At or below this many rows the list leaves room, so the upcoming panel joins it. */
const UPCOMING_INLINE_MAX_ROWS = 2;

/** Selectable body layouts (widget setting: "Layout"). */
export type DeadlineDesign = 'keyDates' | 'list' | 'timeline' | 'summary' | 'agenda' | 'checklist';

export interface DesignDeadline {
  id: string;
  title: string;
  sub: string;
  icon: LucideName;
  tone: DesignTone;
  statusLabel: string;
  statusTone: DesignTone;
  /** Time of day for timed items ("9:00 AM"), or the end-of-day cutoff for all-day items. */
  whenLabel: string;
  /** True when the item has a real time of day (a calendar event), false for all-day deadlines. */
  timed: boolean;
  dueDate: Date;
  onOpen?: () => void;
}

export interface DeadlineCardProps {
  /** Body layout chosen in the widget settings. */
  design: DeadlineDesign;
  /** Real deadlines that fall on the given day. */
  deadlinesOn: (date: Date) => DesignDeadline[];
  /** Total open deadlines before today (real overdue count) — the "summary" layout counter. */
  overdueCount?: number;
  /** Show the "Due in N days" urgency pill on each row. Off by default (config-gated). */
  showStatus?: boolean;
  loading?: boolean;
  error?: string | null;
  onViewCalendar?: () => void;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function DsnRow({ d, compact = false, showStatus = false }: { d: DesignDeadline; compact?: boolean; showStatus?: boolean }): VNode {
  const inner = <>
    <span class={`dsn-ic dsn-ic--${d.tone}`}><LucideIcon name={d.icon} size={compact ? 15 : 17} /></span>
    <span class="dsn-copy"><strong>{d.title}</strong><span>{d.sub}</span></span>
    <span class="dsn-meta">
      {d.whenLabel ? <span class="dsn-when"><LucideIcon name="Clock" size={11} />{d.whenLabel}</span> : null}
      {showStatus ? <span class={`dsn-status dsn-status--${d.statusTone}`}>{d.statusLabel}</span> : null}
    </span>
    <LucideIcon name="ChevronRight" size={15} class="dsn-chev" />
  </>;
  return d.onOpen
    ? <button type="button" class={`dsn-row${compact ? ' is-compact' : ''}`} onClick={d.onOpen}>{inner}</button>
    : <div class={`dsn-row${compact ? ' is-compact' : ''}`}>{inner}</div>;
}

/** Plain empty state, used by every layout. */
function DsnEmpty({ label }: { label: string }): VNode {
  return (
    <div class="dsn-empty">
      <LucideIcon name="CalendarCheck" size={44} strokeWidth={1.5} />
      <strong>{label}</strong>
      <span>Calendar events and authorised deadlines will appear here.</span>
    </div>
  );
}

/** "15 JUL", or "28 FEB 2027" once the date leaves the current year. */
function badgeLabel(date: Date, today: Date): string {
  const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  return date.getFullYear() === today.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/**
 * Rich caught-up state — the "keyDates" layout's whole reason to exist (mockup design 10,
 * "Rich empty state"). A clear day is the COMMON case for this card, so instead of going blank
 * it confirms the day is clear and answers the next question: what's coming after it.
 * Re-implemented at tile scale — the mockup is a 920px showcase (260×220 art, 28px title); this
 * runs in a 332px tile, so the illustration is a compact calendar-and-tick and the plant is
 * dropped rather than shrunk into noise.
 */
function DsnCaughtUp({ label, upcoming, today, page, pageCount, onPage }: {
  label: string;
  /** The visible page — one deadline per day, up to UPCOMING_DAYS_PER_PAGE days. */
  upcoming: DesignDeadline[];
  today: Date;
  page: number;
  pageCount: number;
  onPage: (direction: -1 | 1) => void;
}): VNode {
  return (
    <div class="dsn-caught">
      {/* Reuses .dsn-empty verbatim — same CalendarCheck icon and typography every other layout
          shows on a clear day. Only the sub-line changes, to hand off to the panel below. */}
      <div class="dsn-empty">
        <LucideIcon name="CalendarCheck" size={44} strokeWidth={1.5} />
        <strong>{label}</strong>
        <span>
          {upcoming.length
            ? 'No filings are due. Here’s what’s coming up next.'
            : 'Calendar events and authorised deadlines will appear here.'}
        </span>
      </div>
      {upcoming.length > 0 && (
        <DsnUpcomingBox upcoming={upcoming} today={today} page={page} pageCount={pageCount} onPage={onPage} />
      )}
    </div>
  );
}

/** The "Key Upcoming Dates" panel on its own. Extracted so it can appear BOTH on a clear day
 *  (inside DsnCaughtUp) and beneath a short list, where the card has room going spare. */
function DsnUpcomingBox({ upcoming, today, page, pageCount, onPage }: {
  upcoming: DesignDeadline[];
  today: Date;
  page: number;
  pageCount: number;
  onPage: (direction: -1 | 1) => void;
}): VNode {
  return (
    <div class="dsn-upbox">
      <div class="dsn-upbox-head">
        <LucideIcon name="CalendarDays" size={14} />
        <span class="dsn-upbox-title">Key Upcoming Dates</span>
        {pageCount > 1 && (
          <span class="dsn-upnav">
            <button type="button" aria-label="Earlier dates" disabled={page <= 0} onClick={() => onPage(-1)}>
              <LucideIcon name="ChevronLeft" size={13} />
            </button>
            <button type="button" aria-label="Later dates" disabled={page >= pageCount - 1} onClick={() => onPage(1)}>
              <LucideIcon name="ChevronRight" size={13} />
            </button>
          </span>
        )}
      </div>
      {upcoming.map(d => (
        <div class="dsn-uprow" key={d.id}>
          <span class={`dsn-ic dsn-ic--${d.tone}`}><LucideIcon name={d.icon} size={15} /></span>
          <span class="dsn-copy"><strong>{d.title}</strong><span>{d.sub}</span></span>
          <span class={`dsn-datebadge${sameDay(d.dueDate, today) ? '' : ' is-later'}`}>{badgeLabel(d.dueDate, today)}</span>
        </div>
      ))}
    </div>
  );
}

/** Filing-guidance panel — shown by the "agenda" layout. */
function DsnGuidance(): VNode {
  return (
    <div class="dsn-guidance">
      <div class="dsn-guide-row"><span class="dsn-guide-ic"><LucideIcon name="Lightbulb" size={17} /></span><div><strong>Filing guidance</strong><p>NIS and PAYE remittances are due on the 15th of each month; the TD4 return by 28 February.</p></div></div>
      <div class="dsn-guide-row"><span class="dsn-guide-ic is-soft"><LucideIcon name="Bell" size={17} /></span><div><strong>Stay on track</strong><p>Set reminders to never miss a deadline.</p></div></div>
    </div>
  );
}

export function DeadlineCard({ design, deadlinesOn, overdueCount = 0, showStatus = false, loading = false, error = null, onViewCalendar }: DeadlineCardProps): VNode {
  const today = useMemo(startOfToday, []);
  const [weekStart, setWeekStart] = useState(today);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [listView, setListView] = useState<'today' | 'upcoming'>('today');
  // Page index for the caught-up panel's "Key upcoming dates" list (3 days per page).
  const [upcomingPage, setUpcomingPage] = useState(0);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + index); return d; }),
    [weekStart],
  );
  // Any change of focused day re-bases the "next dates" list, so the panel returns to page 1.
  const shiftWeek = (direction: -1 | 1): void => {
    const d = new Date(weekStart); d.setDate(d.getDate() + direction * 7); setWeekStart(d); setSelectedDay(null); setListView('upcoming'); setUpcomingPage(0);
  };
  const showToday = (): void => { setListView('today'); setSelectedDay(null); setUpcomingPage(0); };
  const showUpcoming = (): void => { setListView('upcoming'); setSelectedDay(null); setUpcomingPage(0); };
  const monthLabel = weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const weekItems = weekDays.flatMap(d => deadlinesOn(d)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const focusedDay = selectedDay ?? (listView === 'today' ? today : null);
  const visible = focusedDay ? deadlinesOn(focusedDay) : weekItems;
  const listTitle = focusedDay
    ? sameDay(focusedDay, today) ? 'Today' : focusedDay.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : 'Next 7 days';
  // "No Scheduled Items for 26 Jul" — naming the day beats "today", because the card can be
  // showing any day in the strip and a bare "today" then reads as wrong.
  const emptyLabel = focusedDay
    ? `No Scheduled Items for ${focusedDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    : 'No Scheduled Items in the Next 7 Days';

  // Next key dates for the caught-up panel — the first few deadlines AFTER the focused day.
  // Walks forward day by day through `deadlinesOn`, which is a pure lookup over the already
  // loaded, authorised calendar window (today−14 → today+62), so this reads no new data and
  // invents nothing: an empty result simply renders the confirmation without a list.
  const nextKeyDates = useMemo(() => {
    const from = focusedDay ?? today;
    const found: DesignDeadline[] = [];
    for (let offset = 1; offset <= UPCOMING_SCAN_DAYS && found.length < UPCOMING_MAX_DAYS; offset++) {
      const day = new Date(from);
      day.setDate(from.getDate() + offset);
      // One per day — the panel lists DAYS, not every item on them.
      found.push(...deadlinesOn(day).slice(0, UPCOMING_PER_DAY));
    }
    return found.slice(0, UPCOMING_MAX_DAYS);
  }, [focusedDay, today, deadlinesOn]);
  const upcomingPageCount = Math.max(1, Math.ceil(nextKeyDates.length / UPCOMING_DAYS_PER_PAGE));
  // Clamp rather than store out-of-range: the list shrinks when the focused day moves forward,
  // and a stale page index would otherwise render an empty panel.
  const safeUpcomingPage = Math.min(upcomingPage, upcomingPageCount - 1);
  const visibleKeyDates = nextKeyDates.slice(
    safeUpcomingPage * UPCOMING_DAYS_PER_PAGE,
    safeUpcomingPage * UPCOMING_DAYS_PER_PAGE + UPCOMING_DAYS_PER_PAGE,
  );

  // Hidden when the current view has no deadlines: every design falls back to an empty /
  // caught-up state there, and a lone "View Full Calendar" button under it reads as clutter.
  // (loading + error return early, so they never reach the footer either.)
  const footer = onViewCalendar && visible.length
    ? <button type="button" class="dsn-footer" onClick={onViewCalendar}><LucideIcon name="CalendarDays" size={15} />View Full Calendar<LucideIcon name="ChevronRight" size={15} /></button>
    : null;
  const head = <div class="dsn-section-head"><span class="dsn-section-title"><LucideIcon name="Clock" size={16} />{listTitle}</span><span class="dsn-section-count">{visible.length} item{visible.length === 1 ? '' : 's'}</span></div>;

  const body = ((): VNode => {
    if (loading) return <div class="dsn-empty"><LucideIcon name="LoaderCircle" size={38} class="dsn-spin" /><strong>Loading deadlines</strong></div>;
    if (error) return <div class="dsn-empty" role="alert"><LucideIcon name="TriangleAlert" size={38} /><strong>Deadlines could not be loaded</strong><span>{error}</span></div>;

    switch (design) {
      case 'timeline':
        return <div class="dsn-body">
          {head}
          {visible.length ? <div class="dsn-timeline">{visible.map(d => <div class="dsn-tl-row" key={d.id}><span class={`dsn-tl-dot dsn-tl-dot--${d.tone}`} /><div class="dsn-tl-card"><span class={`dsn-ic dsn-ic--${d.tone}`}><LucideIcon name={d.icon} size={15} /></span><span class="dsn-copy"><strong>{d.title}</strong><span>{d.sub}</span></span><span class="dsn-meta">{d.whenLabel ? <span class="dsn-when"><LucideIcon name="Clock" size={11} />{d.whenLabel}</span> : null}{showStatus ? <span class={`dsn-status dsn-status--${d.statusTone}`}>{d.statusLabel}</span> : null}</span></div></div>)}</div> : <DsnEmpty label={emptyLabel} />}
          {footer}
        </div>;

      case 'summary':
        return <div class="dsn-body">
          <div class="dsn-stats">
            <div class="dsn-stat dsn-stat--green"><span class="dsn-stat-h"><LucideIcon name="CircleCheck" size={15} />Due Today</span><b>{deadlinesOn(today).length}</b><span class="dsn-stat-l">items</span></div>
            <div class="dsn-stat dsn-stat--blue"><span class="dsn-stat-h"><LucideIcon name="CalendarDays" size={15} />This Week</span><b>{weekItems.length}</b><span class="dsn-stat-l">items</span></div>
            <div class="dsn-stat dsn-stat--red"><span class="dsn-stat-h"><LucideIcon name="TriangleAlert" size={15} />Overdue</span><b>{overdueCount}</b><span class="dsn-stat-l">item{overdueCount === 1 ? '' : 's'}</span></div>
          </div>
          {head}
          {visible.length ? <div class="dsn-rows dsn-rows--flush">{visible.map(d => <DsnRow key={d.id} d={d} compact showStatus={showStatus} />)}</div> : <DsnEmpty label={emptyLabel} />}
          {footer}
        </div>;

      case 'checklist':
        return <div class="dsn-body">
          {head}
          {visible.length ? <div class="dsn-rows dsn-checklist">{visible.map(d => {
            const soon = sameDay(d.dueDate, today);
            return <div class="dsn-check-row" key={d.id}>
              <span class={`dsn-check${soon ? ' is-soon' : ''}`} aria-hidden="true"><LucideIcon name={soon ? 'Clock' : 'Square'} size={16} /></span>
              <DsnRow d={d} compact showStatus={showStatus} />
            </div>;
          })}</div> : <DsnEmpty label={emptyLabel} />}
          {footer}
        </div>;

      case 'agenda':
        return <div class="dsn-body">
          {head}
          {visible.length ? <div class="dsn-rows">{visible.map(d => <DsnRow key={d.id} d={d} showStatus={showStatus} />)}</div> : <DsnEmpty label={emptyLabel} />}
          <DsnGuidance />
          {footer}
        </div>;

      case 'list':
        return <div class="dsn-body">
          {head}
          {visible.length ? <div class="dsn-rows">{visible.map(d => <DsnRow key={d.id} d={d} showStatus={showStatus} />)}</div> : <DsnEmpty label={emptyLabel} />}
          {footer}
        </div>;

      case 'keyDates':
      default:
        return <div class="dsn-body">
          {visible.length
            ? <>
                {head}
                <div class="dsn-rows">{visible.map(d => <DsnRow key={d.id} d={d} showStatus={showStatus} />)}</div>
                {/* One or two rows leaves the card half empty — spend that space on what's
                    coming next rather than on whitespace. */}
                {visible.length <= UPCOMING_INLINE_MAX_ROWS && visibleKeyDates.length > 0 && (
                  <DsnUpcomingBox upcoming={visibleKeyDates} today={today}
                    page={safeUpcomingPage} pageCount={upcomingPageCount}
                    onPage={direction => setUpcomingPage(p => Math.min(Math.max(0, p + direction), upcomingPageCount - 1))} />
                )}
              </>
            : <DsnCaughtUp label={emptyLabel} upcoming={visibleKeyDates} today={today}
                page={safeUpcomingPage} pageCount={upcomingPageCount}
                onPage={direction => setUpcomingPage(p => Math.min(Math.max(0, p + direction), upcomingPageCount - 1))} />}
          {footer}
        </div>;
    }
  })();

  return (
    <article class="sdb-card sdb-ch sdb-cal sdb-wgt-fill cpw-deadlines dsn-deadlines dsn-v0" data-widget-content-root aria-label="Upcoming deadlines">
      <div class="sdb-ch-hd" data-widget-fit-required>
        <LucideIcon name="CalendarDays" size={18} class="cpw-deadlines__icon" />
        <h2>Schedule &amp; Deadlines</h2>
        <div class="sdb-ch-tools">
          <button type="button" class="sdb-ready-nav" aria-label="Previous week" onClick={() => shiftWeek(-1)}><LucideIcon name="ChevronLeft" size={14} /></button>
          <button type="button" class="sdb-ready-nav" aria-label="Next week" onClick={() => shiftWeek(1)}><LucideIcon name="ChevronRight" size={14} /></button>
        </div>
      </div>
      <div class="sdb-cal-month-row">
        <div class="sdb-cal-month">{monthLabel}</div>
        <div class="sdb-cal-list-tabs" role="group" aria-label="Deadline list view">
          <button type="button" class={`today${listView === 'today' ? ' active' : ''}`} aria-pressed={listView === 'today'} onClick={showToday}>Today</button>
          <button type="button" class={listView === 'upcoming' ? 'active' : ''} aria-pressed={listView === 'upcoming'} onClick={showUpcoming}>Upcoming</button>
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
              onClick={() => { setListView(sameDay(date, today) ? 'today' : 'upcoming'); setSelectedDay(new Date(date)); setUpcomingPage(0); }}>
              <span>{date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>
      {body}
    </article>
  );
}
