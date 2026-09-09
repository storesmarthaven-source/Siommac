import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { CalendarDashboardRail } from './CalendarDashboardRail';
import { CALENDAR_STAGING_CALENDARS, calendarStagingDetail, calendarStagingItems } from './calendarStaging';

describe('CalendarDashboardRail', () => {
  it('shows the selected week with calendars first and a focused category navigator', () => {
    const toggleCategory = vi.fn();
    const scrollIntoView = vi.fn();
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    const { container } = render(<CalendarDashboardRail
      month={new Date(2026, 8, 1, 12)}
      selectedKey="2026-09-16"
      eventDateKeys={new Set(['2026-09-16'])}
      categories={[
        { id: 'cat-operations', key: 'operations', name: 'Operations', iconName: 'BriefcaseBusiness', scope: 'system', sortOrder: 1, active: true, canManage: false },
        { id: 'cat-safety', key: 'safety_hse', name: 'Safety & HSE', iconName: 'ShieldCheck', scope: 'system', sortOrder: 2, active: true, canManage: false },
      ]}
      calendars={CALENDAR_STAGING_CALENDARS}
      onToggleCalendar={vi.fn()}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
      onSelectDate={vi.fn()}
      onToggleCategory={toggleCategory}
    />);

    expect(screen.getByText('No Actions Scheduled')).toBeTruthy();
    expect(screen.getByText('Tasks, deadlines, invitations and linked operational items for this day will appear here.')).toBeTruthy();
    expect(container.querySelector('.ui-empty-icon-cluster')).toBeTruthy();
    expect(container.querySelector('.cal-board-rail')?.classList.contains('is-event-empty')).toBe(true);
    expect(screen.getByText('Categories')).toBeTruthy();
    expect(screen.getByText('My Calendars')).toBeTruthy();
    expect(screen.queryByText('Sources')).toBeNull();
    expect(screen.queryByText('Scope')).toBeNull();
    const groupHeadings = [...container.querySelectorAll('.cal-rail-nav-group-head > strong')].map(node => node.textContent);
    expect(groupHeadings).toEqual(['My Calendars', 'Categories']);
    expect(screen.getByRole('button', { name: 'Hide My Calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide My Calendar' }).querySelector('.cal-rail-collection-icon svg')).toBeTruthy();
    expect(screen.getByText('Personal · Default')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide iCloud Personal' }).querySelector('.cal-provider-mark.is-apple svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Google Calendar' }).querySelector('.cal-provider-mark.is-google svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a calendar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Calendar settings for My Calendar' })).toBeNull();
    const eventCategory = screen.getByRole('checkbox', { name: 'Disable Operations category' });
    expect(eventCategory.getAttribute('aria-checked')).toBeNull();
    expect((eventCategory as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('.cal-rail-category-dot')).toBeNull();
    fireEvent.click(eventCategory);
    expect(toggleCategory).toHaveBeenCalledWith('operations');
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(container.querySelectorAll('.cal-mini-week.is-active')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Wednesday, September 16, 2026/i }).closest('.cal-mini-week')?.classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('button', { name: /Wednesday, September 16, 2026, has events/i }).querySelector('.cal-mini-event-dot')).toBeTruthy();
    animationFrame.mockRestore();
    if (previousScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScrollIntoView);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('presents the selected event schedule, people, response counts, and RSVP actions', () => {
    const today = new Date(2026, 8, 16, 12);
    const event = calendarStagingItems(today).find(item => item.sourceModule === 'meetings')!;
    const detail = calendarStagingDetail(event)!;
    const respond = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    const { container } = render(<CalendarDashboardRail
      month={new Date(2026, 8, 1, 12)}
      selectedKey="2026-09-16"
      focusedItem={event}
      focusedPeople={detail.attendees.map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))}
      responseStatus="invited"
      acceptedCount={2}
      awaitingCount={2}
      reminderLabel="15 min before"
      focusedIndex={1}
      focusedCount={3}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
      onSelectDate={vi.fn()}
      onRespond={respond}
      onOpenFocusedItem={vi.fn()}
      onPreviousFocusedItem={previous}
      onNextFocusedItem={next}
    />);

    expect(screen.getByText(event.title)).toBeTruthy();
    expect(container.querySelector('.cal-board-rail')?.classList.contains('is-event-empty')).toBe(false);
    expect(screen.getByText('15 min before')).toBeTruthy();
    expect(screen.getByText('About this event')).toBeTruthy();
    expect(screen.getByText('Are you coming to the meeting?')).toBeTruthy();
    expect(container.querySelector('.cal-rail-event-counts')?.textContent).toContain('2 Yes');
    expect(container.querySelector('.cal-rail-event-counts')?.textContent).toContain('2 Awaiting');
    expect(container.querySelectorAll('.cal-rail-event-people img')).toHaveLength(4);
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous actionable event on selected date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next actionable event on selected date' }));
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: new RegExp(`Duplicate ${event.title}`, 'i') })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`Delete ${event.title}`, 'i') })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`Edit ${event.title}`, 'i') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(respond).toHaveBeenCalledWith('accepted');
  });

  it('does not invent guests or avatars for owner-only tasks', () => {
    const today = new Date(2026, 8, 6, 12);
    const task = calendarStagingItems(today).find(item => item.title === 'Permit Handover')!;
    const { container } = render(<CalendarDashboardRail
      month={new Date(2026, 8, 1, 12)}
      selectedKey="2026-09-06"
      focusedItem={task}
      focusedPeople={[]}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
      onSelectDate={vi.fn()}
      onOpenFocusedItem={vi.fn()}
    />);

    expect(container.querySelector('.cal-rail-event-people')).toBeNull();
    expect(screen.queryByText('Guests')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous actionable event on selected date' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next actionable event on selected date' })).toBeNull();
  });
});
