import { type VNode } from 'preact';
import { useRef } from 'preact/hooks';
import type { CalendarAttendeeResponse, CalendarCategoryDTO, CalendarCollectionDTO, CalendarItemDTO } from '@api/calendar';
import { Accordion, AvatarGroup, Button, Checkbox, EmptyState, EmptyStateIconCluster, LucideIcon, type AvatarGroupPerson } from '@ui';
import { durationMinutes, isToday, itemDateKey, monthGrid, parseLocalDate, timeLabel, toLocalDateKey, weekDays } from '@lib/calendar/date';
import type { CalendarCategory } from './calendarViewModel';
import { calendarCollectionPresentation } from './calendarCollectionPresentation';
import { CalendarProviderMark } from './CalendarProviderMark';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const EMPTY_EVENT_DATE_KEYS: ReadonlySet<string> = new Set();
function eventDateLabel(item: CalendarItemDTO): string {
  const key = itemDateKey(item);
  if (!key) return 'Date pending';
  return parseLocalDate(key).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function eventTimeLabel(item: CalendarItemDTO): string {
  if (item.allDay) return 'All day';
  if (!item.startsAt) return 'Time pending';
  const start = timeLabel(item.startsAt);
  const end = item.endsAt ? timeLabel(item.endsAt) : null;
  const minutes = durationMinutes(item.startsAt, item.endsAt);
  const duration = minutes === null ? null : minutes >= 60
    ? `${Math.floor(minutes / 60)}${minutes % 60 ? ` hr ${minutes % 60} min` : ' hr'}`
    : `${minutes} min`;
  return `${start}${end ? ` – ${end}` : ''}${duration ? ` · ${duration}` : ''}`;
}

function eventActionLabel(item: CalendarItemDTO): string {
  if (item.kind === 'meeting' && item.sourceModule === 'meetings') return 'Open meeting';
  if (item.drillThrough) return 'Open source';
  if (item.editable) return item.type === 'task' ? 'Edit task' : 'Edit event';
  return 'No additional actions';
}

export function CalendarDashboardRail({
  month,
  selectedKey,
  focusedItem = null,
  focusedPeople = [],
  responseStatus = null,
  acceptedCount = 0,
  awaitingCount = 0,
  reminderLabel = null,
  responsePending = false,
  focusedIndex = 0,
  focusedCount = 0,
  categories = [],
  hiddenCategories = new Set<CalendarCategory>(),
  calendars = [],
  hiddenCalendarIds = new Set<string>(),
  eventDateKeys = EMPTY_EVENT_DATE_KEYS,
  expandedSections = ['navigator'],
  onPreviousMonth,
  onNextMonth,
  onSelectDate,
  onRespond,
  onOpenFocusedItem,
  onPreviousFocusedItem,
  onNextFocusedItem,
  onToggleCategory,
  onToggleCalendar,
  onExpandedSectionsChange,
}: {
  month: Date;
  selectedKey: string;
  focusedItem?: CalendarItemDTO | null;
  focusedPeople?: readonly AvatarGroupPerson[];
  responseStatus?: CalendarAttendeeResponse | null;
  acceptedCount?: number;
  awaitingCount?: number;
  reminderLabel?: string | null;
  responsePending?: boolean;
  focusedIndex?: number;
  focusedCount?: number;
  categories?: readonly CalendarCategoryDTO[];
  hiddenCategories?: ReadonlySet<CalendarCategory>;
  calendars?: readonly CalendarCollectionDTO[];
  hiddenCalendarIds?: ReadonlySet<string>;
  eventDateKeys?: ReadonlySet<string>;
  expandedSections?: readonly string[];
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (key: string) => void;
  onRespond?: (response: Exclude<CalendarAttendeeResponse, 'invited'>) => void;
  onOpenFocusedItem?: () => void;
  onPreviousFocusedItem?: () => void;
  onNextFocusedItem?: () => void;
  onToggleCategory?: (category: CalendarCategory) => void;
  onToggleCalendar?: (id: string) => void;
  onExpandedSectionsChange?: (sections: readonly string[]) => void;
}): VNode {
  const railRef = useRef<HTMLElement>(null);
  const days = monthGrid(month);
  const hasParticipants = Boolean(focusedItem && (focusedPeople.length > 0 || focusedItem.attendeeCount > 0));
  const selectedDate = parseLocalDate(selectedKey);
  const selectedWeekStart = weekDays(selectedDate)[0]!;
  const selectedWeekStartKey = toLocalDateKey(selectedWeekStart);
  return (
    <aside ref={railRef} class={`cal-board-rail${focusedItem ? '' : ' is-event-empty'}`} aria-label="Calendar navigation and visibility">
      <section class="cal-mini-month">
        <header>
          <Button variant="secondary" size="sm" iconOnly aria-label="Previous month" iconLeft={<LucideIcon name="ChevronLeft" size={15} />} onClick={onPreviousMonth} />
          <strong>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
          <Button variant="secondary" size="sm" iconOnly aria-label="Next month" iconLeft={<LucideIcon name="ChevronRight" size={15} />} onClick={onNextMonth} />
        </header>
        <div class="cal-mini-weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <div class="cal-mini-grid">
          {Array.from({ length: 6 }, (_, weekIndex) => {
            const week = days.slice(weekIndex * 7, (weekIndex + 1) * 7);
            const activeWeek = week.some(day => toLocalDateKey(day) === selectedWeekStartKey);
            return <div class={`cal-mini-week${activeWeek ? ' is-active' : ''}`} key={toLocalDateKey(week[0]!)}>
              {week.map(day => {
                const key = toLocalDateKey(day);
                const outside = day.getMonth() !== month.getMonth();
                const hasEvents = eventDateKeys.has(key);
                const dateLabel = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                return <button type="button" key={key} class={`${key === selectedKey ? 'is-selected ' : ''}${isToday(day) ? 'is-today ' : ''}${outside ? 'is-outside ' : ''}${hasEvents ? 'has-events' : ''}`} aria-label={`${dateLabel}${hasEvents ? ', has events' : ''}`} aria-pressed={key === selectedKey} onClick={() => onSelectDate(key)}><span>{day.getDate()}</span>{hasEvents ? <i class="cal-mini-event-dot" aria-hidden="true" /> : null}</button>;
              })}
            </div>;
          })}
        </div>
      </section>

      <section class="cal-rail-event-preview" aria-label="Selected calendar event">
        {focusedItem ? <>
          <div class="cal-rail-event-navigator">
            <span>{Math.min(focusedIndex + 1, focusedCount || 1)} of {focusedCount || 1}</span>
            {focusedCount > 1 ? <span class="cal-rail-event-stepper">
              <Button variant="ghost" size="sm" iconOnly aria-label="Previous actionable event on selected date" disabled={!onPreviousFocusedItem} iconLeft={<LucideIcon name="ChevronLeft" size={15} />} onClick={onPreviousFocusedItem} />
              <Button variant="ghost" size="sm" iconOnly aria-label="Next actionable event on selected date" disabled={!onNextFocusedItem} iconLeft={<LucideIcon name="ChevronRight" size={15} />} onClick={onNextFocusedItem} />
            </span> : null}
          </div>
          <header>
            <h2 class="cal-title-with-icon"><CalendarTitleIcon type={focusedItem.titleIconType} value={focusedItem.titleIconValue} size={17} /><span>{focusedItem.title}</span></h2>
            {reminderLabel ? <span class="cal-rail-event-reminder"><LucideIcon name="AlarmClock" size={13} />{reminderLabel}</span> : null}
          </header>
          <div class="cal-rail-event-meta">
            <span><LucideIcon name="CalendarDays" size={14} />{eventDateLabel(focusedItem)}</span>
            <span><LucideIcon name="Clock3" size={14} />{eventTimeLabel(focusedItem)}</span>
          </div>
          <div class="cal-rail-event-about">
            <strong>About this event</strong>
            <p>{focusedItem.notes?.trim() ? focusedItem.notes.trim() : 'No description was added to this event.'}</p>
          </div>
          {hasParticipants ? <div class="cal-rail-event-people">
            {focusedPeople.length ? <AvatarGroup people={focusedPeople} max={4} size={28} label={`${focusedItem.title} attendees`} /> : <span class="cal-rail-event-people-empty"><LucideIcon name="UsersRound" size={16} /></span>}
            <div class="cal-rail-event-counts">
              <span><strong>{focusedItem.attendeeCount > 0 ? focusedItem.attendeeCount : focusedPeople.length}</strong> Guests</span>
              <i aria-hidden="true" />
              <span><strong>{acceptedCount}</strong> Yes</span>
              <i aria-hidden="true" />
              <span><strong>{awaitingCount}</strong> Awaiting</span>
            </div>
          </div> : null}
          {focusedItem.type === 'activity' && responseStatus ? <div class="cal-rail-event-rsvp" aria-label="Respond to invitation">
            <strong>Are you coming to the meeting?</strong>
            <div>
              <Button class="cal-rail-rsvp-yes" variant="primary" size="sm" pressed={responseStatus === 'accepted'} disabled={responsePending || !onRespond} onClick={() => onRespond?.('accepted')}>Yes</Button>
              <Button variant="secondary" size="sm" pressed={responseStatus === 'tentative'} disabled={responsePending || !onRespond} onClick={() => onRespond?.('tentative')}>Maybe</Button>
              <Button variant="secondary" size="sm" pressed={responseStatus === 'declined'} disabled={responsePending || !onRespond} onClick={() => onRespond?.('declined')}>No</Button>
            </div>
          </div> : onOpenFocusedItem ? <Button class="cal-rail-event-open" variant="secondary" size="sm" fullWidth onClick={onOpenFocusedItem} iconRight={<LucideIcon name="ArrowUpRight" size={13} />}>{eventActionLabel(focusedItem)}</Button> : null}
        </> : <EmptyState
          size="compact"
          visual={<EmptyStateIconCluster compact tone="navy" accentIndex={2} icons={[
            <LucideIcon name="Clock3" />,
            <LucideIcon name="MapPin" />,
            <LucideIcon name="CalendarSearch" />,
            <LucideIcon name="UsersRound" />,
            <LucideIcon name="ListChecks" />,
          ]} />}
          title="No Event Selected"
          text="Choose a calendar card to review its schedule, attendees and available actions."
          role="status"
        />}
      </section>

      <Accordion
        class="cal-rail-navigator"
        variant="bare"
        animated={false}
        expanded={expandedSections}
        onChange={expanded => {
          onExpandedSectionsChange?.(expanded);
          window.requestAnimationFrame(() => railRef.current?.querySelector<HTMLElement>('.cal-rail-navigator')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
        }}
        items={[{
          id: 'navigator',
          title: 'Schedule',
          icon: <LucideIcon name="CalendarDays" size={16} />,
          trailing: <span class="cal-rail-calendar-total">{calendars.length}</span>,
          content: <div class="cal-rail-navigator-groups">
            <section class="cal-rail-nav-group">
              <div class="cal-rail-nav-group-head"><strong>My Calendars</strong></div>
              {calendars.length ? <div class="cal-rail-my-calendar-list">
                {calendars.map(calendar => {
                  const enabled = !hiddenCalendarIds.has(calendar.id);
                  const dotStyle = calendar.customColor ? { background: calendar.customColor } : undefined;
                  const presentation = calendarCollectionPresentation(calendar);
                  return <div class="cal-rail-my-calendar-row" key={calendar.id}>
                    <Button class="cal-rail-nav-row cal-rail-my-calendar-toggle" variant="ghost" size="sm" pressed={enabled} disabled={!onToggleCalendar} aria-label={`${enabled ? 'Hide' : 'Show'} ${calendar.name}`} onClick={() => onToggleCalendar?.(calendar.id)} iconLeft={calendar.provider ? <span class="cal-rail-provider-mark"><CalendarProviderMark provider={calendar.provider} /></span> : <span class="cal-rail-collection-icon" aria-hidden="true"><LucideIcon name={presentation.icon} size={15} /><i class={`cal-rail-collection-dot is-${calendar.colorKey ?? 'custom'}`} style={dotStyle} /></span>}>
                      <span class="cal-rail-my-calendar-name"><strong>{calendar.name}</strong><small>{presentation.meta}</small></span>
                    </Button>
                  </div>;
                })}
              </div> : <span class="cal-rail-calendar-empty">No calendars available.</span>}
            </section>
            <section class="cal-rail-nav-group">
              <div class="cal-rail-nav-group-head"><strong>Categories</strong></div>
              <div class="cal-rail-nav-list">
                {categories.map(category => {
                  const enabled = !hiddenCategories.has(category.key);
                  return <Checkbox key={category.id} class="cal-rail-category-choice" checked={enabled} disabled={!onToggleCategory} label={category.name} aria-label={`${enabled ? 'Disable' : 'Enable'} ${category.name} category`} onChange={() => onToggleCategory?.(category.key)} />;
                })}
              </div>
            </section>
          </div>,
        }]}
      />

    </aside>
  );
}
