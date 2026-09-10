import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { calendarStagingHolidays, calendarStagingItems, calendarStagingPeople } from './calendarStaging';
import { initialTimelineFocusMinutes, TimeGridView, visibleTimelineStartMinutes } from './TimeGridView';
import { addDays, toLocalDateKey } from '@lib/calendar/date';
import type { CalendarItemDTO } from '@api/calendar';

type ItemPointHandler = (item: CalendarItemDTO, point?: { x: number; y: number }) => void;

function cardShell(button: HTMLElement): HTMLElement {
  const shell = button.closest<HTMLElement>('.cal-tg-event');
  if (!shell) throw new Error('Calendar card shell was not rendered.');
  return shell;
}

describe('TimeGridView', () => {
  it('focuses today at the current time, populated dates before the first item, and empty dates at 8 AM', () => {
    const moment = new Date(2026, 8, 9, 14, 37);
    const today = new Date(2026, 8, 9, 12);
    const future = new Date(2026, 8, 10, 12);
    const item = {
      ...calendarStagingItems(future).find(candidate => Boolean(candidate.startsAt))!,
      startsAt: new Date(2026, 8, 10, 10, 30).toISOString(),
      endsAt: new Date(2026, 8, 10, 11, 30).toISOString(),
    };

    expect(initialTimelineFocusMinutes([today], [item], moment)).toBe(14 * 60 + 37);
    expect(initialTimelineFocusMinutes([future], [item], moment)).toBe(9 * 60 + 30);
    expect(initialTimelineFocusMinutes([future], [], moment)).toBe(8 * 60);
  });

  it('starts the visible timeline at the hour containing the first event, including overnight events', () => {
    const day = new Date(2026, 8, 10, 12);
    const base = calendarStagingItems(day).find(candidate => Boolean(candidate.startsAt))!;
    const morning = { ...base, startsAt: new Date(2026, 8, 10, 10, 30).toISOString() };
    const overnight = { ...base, startsAt: new Date(2026, 8, 10, 2, 15).toISOString() };

    expect(visibleTimelineStartMinutes([day], [morning])).toBe(10 * 60);
    expect(visibleTimelineStartMinutes([day], [overnight, morning])).toBe(2 * 60);
    expect(visibleTimelineStartMinutes([day], [])).toBe(6 * 60);
  });

  it.each([
    ['day', 'columns', '78px'],
    ['week', 'columns', '80px'],
    ['week', 'timeline', '64px'],
  ] as const)('aligns the first %s/%s card inside the trimmed timeline', (mode, weekLayout, expectedOffset) => {
    const day = new Date(2026, 8, 10, 12);
    const source = calendarStagingItems(day).find(candidate => Boolean(candidate.startsAt))!;
    const item = {
      ...source,
      startsAt: new Date(2026, 8, 10, 10, 30).toISOString(),
      endsAt: new Date(2026, 8, 10, 11, 30).toISOString(),
    };
    const { container } = render(<TimeGridView mode={mode} weekLayout={weekLayout} days={[day]} items={[item]} onOpenItem={vi.fn()} />);
    const firstHour = mode === 'week' && weekLayout === 'timeline'
      ? container.querySelector('.cal-week-hours > span')
      : container.querySelector('.cal-tg-hour > span');
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;

    expect(firstHour?.textContent).toBe('10:00 AM');
    expect(mode === 'week' && weekLayout === 'timeline' ? card.style.left : card.style.top).toBe(expectedOffset);
  });

  it('fits a complete Sunday-to-Saturday week into the calendar frame', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const days = Array.from({ length: 7 }, (_, offset) => addDays(sunday, offset));
    const { container } = render(<TimeGridView mode="week" days={days} items={[]} onOpenItem={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>('.cal-tg')!;
    const headers = [...container.querySelectorAll('.cal-tg-dayhead')];

    expect(grid.style.getPropertyValue('--cal-tg-cols')).toBe('7');
    expect(grid.style.getPropertyValue('--cal-tg-hour')).toBe('136px');
    expect(grid.style.getPropertyValue('--cal-tg-day-w')).toBe('0px');
    expect(grid.style.getPropertyValue('--cal-tg-min-width')).toBe('0px');
    expect(headers).toHaveLength(7);
    expect(headers[0]?.textContent).toContain('Sun');
    expect(headers[6]?.textContent).toContain('Sat');
  });

  it('keeps the horizontal Week timeline available as a separate layout', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const days = Array.from({ length: 7 }, (_, index) => addDays(sunday, index));
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={days} items={calendarStagingItems(sunday)} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-week-timeline')).toBeTruthy();
    expect(container.querySelectorAll('.cal-tg-week-row')).toHaveLength(7);
    expect(container.querySelector('.cal-tg-head')).toBeNull();
    expect(container.querySelector<HTMLElement>('.cal-week-timeline')?.style.getPropertyValue('--cal-week-start-inset')).toBe('12px');
    expect(container.querySelector<HTMLElement>('.cal-week-timeline')?.style.getPropertyValue('--cal-week-day-rail')).toBe('136px');
    expect(screen.getByRole('heading', { name: /September 2026.*Sep 6.*Sep 12/i })).toBeTruthy();
    expect(container.querySelector('.cal-week-period-head')?.nextElementSibling?.classList.contains('cal-week-scroll')).toBe(true);
    expect(container.querySelector('.cal-week-time-head .cal-week-period')).toBeNull();
  });

  it('replaces the Shift pan indicator with the native grabbing cursor while dragging', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={[sunday]} items={[]} onOpenItem={vi.fn()} />);
    const scroller = container.querySelector<HTMLElement>('.cal-week-scroll')!;

    fireEvent.pointerEnter(scroller, { clientX: 320, clientY: 240 });
    fireEvent.keyDown(window, { key: 'Shift' });

    expect(scroller.classList.contains('is-shift-pan-ready')).toBe(true);
    expect(container.querySelector<HTMLElement>('.cal-week-shift-pan-cursor')?.style.left).toBe('320px');

    fireEvent.pointerDown(scroller, { button: 0, pointerId: 5, shiftKey: true, clientX: 320, clientY: 240 });

    expect(scroller.classList.contains('is-panning')).toBe(true);
    expect(container.querySelector('.cal-week-shift-pan-cursor')).toBeNull();

    fireEvent.pointerUp(scroller, { pointerId: 5, clientX: 320, clientY: 240 });
    fireEvent.keyUp(window, { key: 'Shift' });
  });

  it('shows Week Timeline maximum zoom as 100% in the bottom-right HUD', () => {
    const day = new Date(2026, 8, 6, 12);
    const source = calendarStagingItems(day).find(candidate => Boolean(candidate.startsAt) && !candidate.allDay)!;
    const item = {
      ...source,
      startsAt: new Date(2026, 8, 6, 9, 0).toISOString(),
      endsAt: new Date(2026, 8, 6, 10, 0).toISOString(),
    };
    const zoomChange = vi.fn();
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={[day]} items={[item]} zoom={1.6} onZoomChange={zoomChange} onOpenItem={vi.fn()} />);

    fireEvent.wheel(container.querySelector('.cal-week-timeline')!, { ctrlKey: true, deltaY: -100, clientX: 420 });

    const hud = container.querySelector('.cal-tg-zoom-hud');
    const card = container.querySelector<HTMLElement>('.cal-week-event');
    expect(hud?.textContent).toBe('100%');
    expect(hud?.classList.contains('is-visible')).toBe(true);
    expect(card?.style.height).toBe('72px');
    expect(container.querySelector<HTMLElement>('.cal-week-timeline')?.style.getPropertyValue('--cal-week-title-size')).toBe('12.00px');
    expect(zoomChange).toHaveBeenCalledWith(1.6);
  });

  it('uses the standard translucent all-day card in Week Timeline', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const item = calendarStagingItems(sunday).find(candidate => candidate.allDay)!;
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={[sunday]} items={[item]} showAllDay onOpenItem={vi.fn()} />);

    const card = container.querySelector('.cal-week-all-day-card');
    const label = container.querySelector('.cal-week-all-day-label');
    expect(card?.classList.contains('cal-tg-allday-card')).toBe(true);
    expect(card?.classList.contains('cal-week-all-day-chip')).toBe(false);
    expect(card?.querySelector('.cal-tg-allday-time')?.textContent).toContain('All Day');
    expect(label?.textContent).toBe('All Day');
    expect(label?.querySelector('svg')).toBeNull();
  });

  it('uses the same empty all-day message and icon in Week Timeline as Columns', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={[sunday]} items={[]} showAllDay onOpenItem={vi.fn()} />);

    const empty = container.querySelector('.cal-week-all-day-empty');
    expect(empty?.textContent).toBe('No All-Day Events Scheduled');
    expect(empty?.querySelector('svg')).toBeTruthy();
  });

  it('keeps Week Timeline width aligned to duration while resizing smaller', () => {
    const monday = new Date(2026, 7, 31, 12);
    const source = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const startsAt = new Date(2026, 7, 31, 9, 0).toISOString();
    const item = { ...source, startsAt, endsAt: new Date(2026, 7, 31, 10, 0).toISOString() };
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="week" weekLayout="timeline" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const card = container.querySelector<HTMLElement>('.cal-week-event')!;
    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });

    expect(card.style.width).toBe('104px');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 45, clientX: 300, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 45, clientX: 248, clientY: 160 });
    expect(container.querySelector<HTMLElement>('.cal-week-event')?.style.width).toBe('52px');
    fireEvent.pointerUp(window, { pointerId: 45, clientX: 248, clientY: 160 });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), '09:00', 30);
  });

  it('keeps the single card icon in the Week card corner without taking title space', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const item = calendarStagingItems(sunday).find(candidate => candidate.titleIconType === 'lucide' && Boolean(candidate.startsAt))!;
    const { container } = render(<TimeGridView mode="week" days={[sunday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event')!;

    expect(card.querySelector('.cal-tg-week-card-icon')).toBeTruthy();
    expect(card.querySelector('.cal-tg-event-head')).toBeNull();
    expect(card.querySelectorAll('.cal-tg-week-card-icon')).toHaveLength(1);
    expect(card.classList.contains('cal-week-column-event')).toBe(true);
    expect((card as HTMLElement).style.maxWidth).toBe('none');
  });

  it('applies the event-card content visibility preferences to Week cards', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const item = calendarStagingItems(sunday).find(candidate => candidate.sourceModule === 'meetings' && Boolean(candidate.startsAt))!;
    const people = calendarStagingPeople(item).map(person => ({ id: person.userId, name: person.name, src: person.profileImage }));
    const { container } = render(<TimeGridView mode="week" days={[sunday]} items={[item]} attendeePeople={{ [item.id]: people }} showCardLocations={false} showCardAttendees={false} showCardIcons={false} onOpenItem={vi.fn()} />);

    const card = container.querySelector('.cal-tg-event')!;
    expect(card.querySelector('.cal-tg-event-location')).toBeNull();
    expect(card.querySelector('.cal-tg-event-people-slot')).toBeNull();
    expect(card.querySelector('.cal-tg-week-card-icon')).toBeNull();
    expect(card.classList.contains('has-participants')).toBe(false);
  });

  it('de-emphasises a finished card only when the preference is enabled', () => {
    const day = new Date(2020, 0, 6, 12);
    const source = calendarStagingItems(day).find(candidate => Boolean(candidate.startsAt))!;
    const item = { ...source, startsAt: new Date(2020, 0, 6, 9).toISOString(), endsAt: new Date(2020, 0, 6, 10).toISOString() };
    const view = render(<TimeGridView mode="day" days={[day]} items={[item]} dimPastEvents onOpenItem={vi.fn()} />);

    expect(view.container.querySelector('.cal-tg-event')?.classList.contains('is-past')).toBe(true);
    view.rerender(<TimeGridView mode="day" days={[day]} items={[item]} dimPastEvents={false} onOpenItem={vi.fn()} />);
    expect(view.container.querySelector('.cal-tg-event')?.classList.contains('is-past')).toBe(false);
  });

  it('keeps Day cards icon-free and marks clipped titles for the UI-kit overflow tooltip', () => {
    const day = new Date(2026, 8, 9, 12);
    const staged = calendarStagingItems(day);
    const timed = staged.find(item => item.title === 'Equipment Readiness Walk')!;
    const allDay = staged.find(item => item.title === 'Marine Operations Day')!;
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[timed, allDay]} showAllDay onOpenItem={vi.fn()} />);

    expect(container.querySelectorAll('.cal-tg-event-head, .cal-tg-title-glyph, .cal-tg-allday-icon, .cal-tg-week-card-icon')).toHaveLength(0);
    expect(container.querySelectorAll('.cal-day-overflow-title')).toHaveLength(2);
  });

  it('renders the reference-density workday and opens a staged event', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const items = calendarStagingItems(monday);
    const active = items.find(item => item.title === 'Monday Mobilisation Sync')!;
    const open = vi.fn<ItemPointHandler>();

    render(<TimeGridView days={[tuesday]} items={items} onOpenItem={open} />);

    expect(screen.getByText('9:00 AM')).toBeTruthy();
    const event = screen.getByRole('button', { name: /Monday Mobilisation Sync/i });
    expect(cardShell(event).className).toMatch(/tone-(mint|blue|coral|amber|purple)/);
    fireEvent.click(event);
    expect(open.mock.calls[0]?.[0]).toBe(active);
    expect(typeof open.mock.calls[0]?.[1]?.x).toBe('number');
    expect(typeof open.mock.calls[0]?.[1]?.y).toBe('number');
  });

  it('uses a column double-click as the create gesture', () => {
    const monday = new Date(2026, 7, 31, 12);
    const create = vi.fn();
    const { container } = render(<TimeGridView days={[monday]} items={[]} onOpenItem={vi.fn()} onCreateForDay={create} />);

    fireEvent.dblClick(container.querySelector('.cal-tg-col')!, { clientX: 120, clientY: 0 });
    expect(create).toHaveBeenCalledWith('2026-08-31', '06:00', 'event', { x: 120, y: 0 });
  });

  it('moves the visible period from the time-grid controls', () => {
    const previous = vi.fn();
    const next = vi.fn();
    render(<TimeGridView days={[new Date(2026, 7, 31, 12)]} items={[]} onOpenItem={vi.fn()} onPrevious={previous} onNext={next} />);

    fireEvent.click(screen.getByRole('button', { name: 'Previous calendar period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next calendar period' }));
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('shows weather and holidays in the day header without creating an all-day entry', () => {
    const monday = new Date(2026, 7, 31, 12);
    const { container } = render(<TimeGridView days={[monday]} items={[]} weatherLocationLabel="Port of Spain" weatherDays={[{
      date: '2026-08-31', minC: 25, maxC: 31, code: 2, label: 'Partly cloudy', precipitationProbabilityPct: 30, sunrise: null, sunset: null, uvIndexMax: 9,
    }]} holidays={[{
      id: 'holiday-1', date: '2026-08-31', name: 'Independence Day', statutoryName: 'Independence Day', holidayType: 'statutory', dayFraction: 1, calendarName: 'Trinidad & Tobago National', sourceReference: 'Public Holidays Act',
    }]} showAllDay={false} onOpenItem={vi.fn()} />);

    expect(screen.getByLabelText('Partly Cloudy, high 31 degrees Celsius')).toBeTruthy();
    expect(screen.getByText('Partly Cloudy')).toBeTruthy();
    expect(screen.getByText('Independence Day')).toBeTruthy();
    expect(container.querySelector('.cal-tg-holiday-card')).toBeTruthy();
    expect(container.querySelector('.cal-tg-allday')).toBeNull();
  });

  it('renders rich holiday artwork in the headers without styling the full day columns', () => {
    const days = Array.from({ length: 4 }, (_, offset) => new Date(2026, 8, 7 + offset, 12));
    const { container } = render(<TimeGridView days={days} items={[]} holidays={calendarStagingHolidays(days)} showAllDay={false} onOpenItem={vi.fn()} />);
    const cards = [...container.querySelectorAll<HTMLElement>('.cal-tg-holiday-card')];
    const headers = [...container.querySelectorAll<HTMLElement>('.cal-tg-dayhead')];
    const columns = [...container.querySelectorAll<HTMLElement>('.cal-tg-col')];

    expect(cards).toHaveLength(4);
    expect(cards.map(card => card.dataset.holidayTheme)).toEqual(['national', 'emancipation', 'divali', 'eid']);
    expect(cards.every(card => Boolean(card.querySelector('.cal-tg-holiday-art')))).toBe(true);
    expect(headers.map(header => header.classList.contains('is-holiday'))).toEqual([true, true, true, true]);
    expect(columns.map(column => column.classList.contains('is-holiday'))).toEqual([false, false, false, false]);
    expect(container.querySelector('.cal-tg-allday')).toBeNull();
  });

  it('opens slot creation actions from the calendar context menu', async () => {
    const create = vi.fn();
    const { container } = render(<TimeGridView days={[new Date(2026, 7, 31, 12)]} items={[]} onOpenItem={vi.fn()} onCreateForDay={create} />);

    fireEvent.contextMenu(container.querySelector('.cal-tg-col')!, { clientX: 120, clientY: 160 });
      fireEvent.click(await screen.findByRole('menuitem', { name: /Create event/ }));

    expect(create).toHaveBeenCalledWith('2026-08-31', expect.any(String), 'event', expect.objectContaining({ x: 120, y: 160 }));
  });

  it('opens card actions from the item context menu', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const openSource = vi.fn();
    const edit = vi.fn<ItemPointHandler>();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={edit} onOpenSource={openSource} />);

    const card = cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i }));
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    expect(await screen.findByRole('menuitem', { name: 'Edit event' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Minimize|Expand/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit event' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Set reminder' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Open source' }).querySelector('.ui-menu-item-trailing')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    expect(edit.mock.calls[0]?.[0]).toBe(item);
    expect(typeof edit.mock.calls[0]?.[1]?.x).toBe('number');
    expect(typeof edit.mock.calls[0]?.[1]?.y).toBe('number');

    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open source' }));

    expect(openSource).toHaveBeenCalledWith(item);
  });

  it('uses right-click for card actions and does not render three-dot triggers', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.contextMenu(cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i })), { clientX: 220, clientY: 170 });

    expect(await screen.findByRole('menu', { name: 'Calendar item actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('opens a pointer-anchored card menu inside a calendar that has already scrolled', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={vi.fn()} />);

    const scroller = container.querySelector<HTMLElement>('.cal-tg-scroll')!;
    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);
    fireEvent.contextMenu(cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i })), { clientX: 420, clientY: 730 });

    const menu = await screen.findByRole('menu', { name: 'Calendar item actions' });
    expect(menu.getAttribute('data-placement')).toBe('top');
    fireEvent.scroll(scroller);
    expect(screen.queryByRole('menu', { name: 'Calendar item actions' })).toBeNull();
  });

  it('routes recurring entries through the recurrence-aware full editor', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const base = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const item = { ...base, recurrenceRule: 'FREQ=DAILY;COUNT=3' };
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.contextMenu(cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i })), { clientX: 220, clientY: 170 });

    expect((await screen.findByRole('menuitem', { name: 'Edit event' })).getAttribute('aria-disabled')).toBeNull();
  });

  it('resizes editable Day-view cards in 15-minute increments', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    render(<TimeGridView mode="day" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 165);
  });

  it('exposes the same governed vertical resize control in Week view', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 165);
  });

  it('updates a Week Columns card height when its duration changes', () => {
    const monday = new Date(2026, 7, 31, 12);
    const source = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const startsAt = new Date(2026, 7, 31, 9, 0).toISOString();
    const oneHourItem = { ...source, startsAt, endsAt: new Date(2026, 7, 31, 10, 0).toISOString() };
    const { container, rerender } = render(<TimeGridView mode="week" weekLayout="columns" days={[monday]} items={[oneHourItem]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;

    expect(card.style.height).toBe('136px');

    const twoHourItem = { ...oneHourItem, endsAt: new Date(2026, 7, 31, 11, 0).toISOString() };
    rerender(<TimeGridView mode="week" weekLayout="columns" days={[monday]} items={[twoHourItem]} onOpenItem={vi.fn()} />);

    expect(container.querySelector<HTMLElement>('.cal-tg-event')?.style.height).toBe('272px');
  });

  it('resizes Week cards vertically against the shared hour grid', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 14, clientX: 300, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 14, clientX: 300, clientY: 228 });
    fireEvent.pointerUp(handle, { pointerId: 14, clientX: 300, clientY: 228 });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 180);
  });

  it.each([
    ['day', 66],
    ['week', 68],
  ] as const)('shrinks an editable %s card upward in visible 15-minute increments', (mode, pointerDelta) => {
    const monday = new Date(2026, 7, 31, 12);
    const source = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const startsAt = new Date(2026, 7, 31, 9, 0).toISOString();
    const item = { ...source, startsAt, endsAt: new Date(2026, 7, 31, 10, 0).toISOString() };
    const move = vi.fn();
    const { container } = render(<TimeGridView mode={mode} days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 44, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 44, clientX: 300, clientY: 200 - pointerDelta });

    expect(container.querySelector<HTMLElement>('.cal-tg-event')?.style.height).toBe(`${pointerDelta}px`);
    fireEvent.pointerUp(window, { pointerId: 44, clientX: 300, clientY: 200 - pointerDelta });
    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), '09:00', 30);
  });

  it('uses Ctrl plus wheel to zoom the restored vertical Week grid', () => {
    const monday = new Date(2026, 7, 31, 12);
    const zoomChange = vi.fn();
    const { container } = render(<TimeGridView mode="week" days={[monday]} items={[]} zoom={1} onZoomChange={zoomChange} onOpenItem={vi.fn()} />);

    fireEvent.wheel(container.querySelector('.cal-tg')!, { ctrlKey: true, deltaY: 100, clientY: 400 });

    expect(zoomChange).toHaveBeenCalledWith(0.9);
  });

  it('does not resize a Day-view card below the usable 30-minute minimum', () => {
    const monday = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const startsAt = new Date(base.startsAt!);
    const item = { ...base, endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() };
    const move = vi.fn();
    render(<TimeGridView mode="day" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    fireEvent.keyDown(screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` }), { key: 'ArrowUp' });

    expect(move).not.toHaveBeenCalled();
  });

  it('uses the configured precision for keyboard resizing', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    render(<TimeGridView mode="day" days={[monday]} items={[item]} snapMinutes={30} onOpenItem={vi.fn()} onMoveItem={move} />);

    fireEvent.keyDown(screen.getByRole('button', { name: `Resize ${item.title} in 30-minute increments` }), { key: 'ArrowUp' });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), '06:30', 120);
  });

  it('routes the Delete key on a focused card through the governed delete action', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = { ...calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!, cancelable: true };
    const deleteItem = vi.fn();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onDeleteItem={deleteItem} />);

    fireEvent.keyDown(screen.getByRole('button', { name: /Monday Mobilisation Sync/i }), { key: 'Delete' });

    expect(deleteItem).toHaveBeenCalledWith(item);
  });

  it('exposes real reminder and delete callbacks only for capable native items', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const staged = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const item = { ...staged, sourceModule: null, sourceRoute: null, sourceLabel: null, status: 'not_started' as const, editable: true, cancelable: true };
    const setReminder = vi.fn();
    const deleteItem = vi.fn();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onSetReminder={setReminder} onDeleteItem={deleteItem} />);

    const card = cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i }));
    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(item);

    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(deleteItem).toHaveBeenCalledWith(item);
  });

  it('keeps the standard card menu available for reminders by right-click', async () => {
    const sunday = new Date(2026, 8, 6, 12);
    const reminder = calendarStagingItems(sunday).find(item => item.title === 'Send Access Reminder')!;
    render(<TimeGridView days={[sunday]} items={[reminder]} onOpenItem={vi.fn()} onEditItem={vi.fn()} />);

    const card = cardShell(screen.getByRole('button', { name: /Send Access Reminder/i }));
    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    expect(await screen.findByRole('menu', { name: 'Calendar item actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('does not add a grey ruler or floating time while the pointer moves across the grid', () => {
    const { container } = render(<TimeGridView days={[new Date(2026, 7, 31, 12)]} items={[]} onOpenItem={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>('.cal-tg-grid')!;
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 4804, left: 0, right: 800, width: 800, height: 4704, x: 0, y: 100, toJSON: () => ({}) });

    fireEvent.mouseMove(container.querySelector('.cal-tg-col')!, { clientY: 100 + ((10 * 60 + 22) / 60) * 196 });
    expect(screen.queryByLabelText('Timeline cursor 10:22 AM')).toBeNull();
  });

  it('opens slot quick actions from a ruler right-click without selecting an intersected card', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const create = vi.fn();
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onCreateForDay={create} />);
    const grid = container.querySelector<HTMLElement>('.cal-tg-grid')!;
    const gutter = container.querySelector<HTMLElement>('.cal-tg-gutter')!;
    const scroller = container.querySelector<HTMLElement>('.cal-tg-scroll')!;
    const card = screen.getByRole('button', { name: /Monday Mobilisation Sync/i });
    const slotY = 100 + 12 + ((10 * 60 + 20 - 9 * 60) / 60) * 196;
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 3052, left: 0, right: 800, width: 800, height: 2952, x: 0, y: 100, toJSON: () => ({}) });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 2400, left: 0, right: 800, width: 800, height: 2400, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.contextMenu(gutter, { clientX: 55, clientY: slotY });

    expect(cardShell(card).classList.contains('is-time-selected')).toBe(false);
    expect(screen.queryByRole('menuitem', { name: 'Minimize' })).toBeNull();
      const slotMenu = await screen.findByRole('menu', { name: 'Calendar slot actions' });
      expect(slotMenu.getAttribute('data-placement')).toBe('right');
      expect(slotMenu.classList.contains('ui-menu--pointer')).toBe(false);
      expect(screen.getByRole('menuitem', { name: /Add standalone reminder/ }).getAttribute('aria-disabled')).not.toBe('true');
      expect(screen.queryByRole('menuitem', { name: /Add deadline/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /Create agenda/ })).toBeNull();
      expect(screen.getByText('2026-09-01 at 10:20')).toBeTruthy();
      expect(screen.queryByText('Add owned work at this time.')).toBeNull();
      expect(screen.queryByText('Invite participants and prepare an agenda.')).toBeNull();
      fireEvent.click(await screen.findByRole('menuitem', { name: /Create task/ }));
      expect(create).toHaveBeenCalledWith('2026-09-01', '10:20', 'task', { x: 55, y: slotY });
  });

  it('does not add a hover information tip to a card', () => {
    const monday = new Date(2026, 7, 31, 12);
    const thursday = addDays(monday, 3);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Midweek Control Handoff')!;
    render(<TimeGridView days={[thursday]} items={[item]} onOpenItem={vi.fn()} />);

    const event = screen.getByRole('button', { name: /Midweek Control Handoff/i });
    expect(event.querySelector('.cal-tg-event-notes')).toBeNull();
    event.focus();
    expect(screen.queryByRole('tooltip')).toBeNull();
    event.blur();

  });

  it('keeps descriptions in the quick information surface instead of rendering them on cards', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const staged = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const item = { ...staged, notes: 'Review readiness, assign open actions and align mobilisation priorities with every department lead before the next shift starts.' };
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} />);

    const event = screen.getByRole('button', { name: /Monday Mobilisation Sync/i });
    expect(event.querySelector('.cal-tg-event-notes')).toBeNull();
    event.focus();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders the live current-time indicator whenever today is visible', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 10, 0));
    const { container } = render(<TimeGridView days={[new Date(2026, 8, 10, 12)]} items={[]} onOpenItem={vi.fn()} />);
    expect(screen.getByLabelText(/Current time/i)).toBeTruthy();
    expect(container.querySelector('.cal-tg-hour-ticks')).toBeNull();
    vi.useRealTimers();
  });

  it('hides the current-time indicator when that preference is disabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 10, 0));
    const { container } = render(<TimeGridView days={[new Date(2026, 8, 10, 12)]} items={[]} showCurrentTime={false} onOpenItem={vi.fn()} />);
    expect(container.querySelector('.cal-tg-now-row')).toBeNull();
    vi.useRealTimers();
  });

  it('prevents the live-time pill from overlapping the nearest hour label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 21, 11));
    render(<TimeGridView days={[new Date(2026, 8, 6, 12)]} items={[]} onOpenItem={vi.fn()} />);

    expect(screen.getByLabelText('Current time 9:11 PM')).toBeTruthy();
    expect(screen.getByText('9:00 PM').parentElement?.classList.contains('is-obscured-by-now')).toBe(true);
    expect(screen.getByText('8:00 PM').parentElement?.classList.contains('is-obscured-by-now')).toBe(false);
    vi.useRealTimers();
  });

  it('uses one card system without map or meeting backdrops', () => {
    const monday = new Date(2026, 7, 31, 12);
    const items = calendarStagingItems(monday);
    render(<TimeGridView days={[monday, addDays(monday, 1)]} items={items} onOpenItem={vi.fn()} />);

    const locationCard = cardShell(screen.getByRole('button', { name: /Equipment Readiness Walk/i }));
    const meetingCard = cardShell(screen.getByRole('button', { name: /Monday Mobilisation Sync/i }));
    expect(locationCard.className).not.toMatch(/backdrop-/);
    expect(meetingCard.className).not.toMatch(/backdrop-/);
    expect(locationCard.querySelector('.cal-card-map, .cal-card-zoom')).toBeNull();
    expect(meetingCard.querySelector('.cal-card-map, .cal-card-zoom')).toBeNull();
  });

  it('keeps meeting identity in tone while Day cards remain icon-free', () => {
    const start = new Date(2026, 7, 31, 12);
    const meeting = calendarStagingItems(start).find(item => item.title === 'Monday Mobilisation Sync')!;
    const { container } = render(<TimeGridView days={[addDays(start, 1)]} items={[meeting]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card).toBeTruthy();
    expect(card?.querySelector('.cal-tg-event-source, .cal-tg-title-glyph, .cal-tg-week-card-icon')).toBeNull();
    expect(card?.classList.contains('tone-blue')).toBe(true);
    expect(card?.querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
    expect(card?.getAttribute('data-card-size')).toBe('medium');
  });

  it('keeps participant avatars in the adaptive right slot on standard cards', () => {
    const start = new Date(2026, 7, 31, 12);
    const thursday = addDays(start, 3);
    const titles = ['Corrective Action Review', 'Midweek Control Handoff'];
    const items = calendarStagingItems(start).filter(item => titles.includes(item.title));
    const attendeePeople = Object.fromEntries(items.map(item => [item.id, calendarStagingPeople(item).map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))]));
    render(<TimeGridView mode="week" days={[thursday]} items={items} attendeePeople={attendeePeople} onOpenItem={vi.fn()} />);

    for (const title of titles) {
      const card = cardShell(screen.getByRole('button', { name: new RegExp(title, 'i') }));
      expect(card.className).not.toMatch(/backdrop-/);
      expect(card.getAttribute('data-card-size')).toBe('medium');
      expect(card.querySelector('.cal-tg-event-people-slot')).toBeTruthy();
      expect(card.querySelector('.ui-avatar-group')).toBeTruthy();
    }
    const [first, second] = titles.map(title => cardShell(screen.getByRole('button', { name: new RegExp(title, 'i') })));
    expect(first?.style.height).toBe('238px');
    expect(second?.style.height).toBe('204px');
  });

  it('gives short tasks the same standard card treatment with compact density', () => {
    const start = new Date(2026, 7, 31, 12);
    const task = calendarStagingItems(start).find(item => item.title === 'Close Permit Actions')!;
    const { container } = render(<TimeGridView mode="week" days={[start]} items={[task]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event');

    expect(card).toBeTruthy();
    expect(card?.classList.contains('size-small')).toBe(true);
    expect(Number.parseFloat(card?.style.height ?? '0')).toBeGreaterThanOrEqual(58);
    expect(card?.className).not.toMatch(/backdrop-/);
    expect(card?.querySelector('.cal-tg-event-time')?.textContent).toMatch(/11:45 AM.*12:30 PM/);
    expect(card?.querySelector('.cal-tg-time-icon')).toBeNull();
    expect(card?.querySelector('.cal-tg-event-notes')).toBeNull();
  });

  it('marks user-selected palettes on the standard card', () => {
    const start = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(start).find(item => item.title === 'Visitor Escort Coordination')!;
    const item = { ...base, origin: 'calendar' as const, sourceModule: null, sourceLabel: null, sourceRoute: null, colorKey: 'coral' as const };
    const { container } = render(<TimeGridView days={[start]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card?.classList.contains('tone-coral')).toBe(true);
    expect(card?.classList.contains('has-custom-tone')).toBe(true);
  });

  it('renders a validated custom colour through derived card tokens', () => {
    const start = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(start).find(item => item.title === 'Visitor Escort Coordination')!;
    const item = { ...base, origin: 'calendar' as const, sourceModule: null, sourceLabel: null, sourceRoute: null, colorKey: null, customColor: '#2a8f64' };
    const { container } = render(<TimeGridView days={[start]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event');

    expect(card?.classList.contains('has-custom-color')).toBe(true);
    expect(card?.style.getPropertyValue('--cal-custom-color')).toBe('#2a8f64');
    expect(card?.style.getPropertyValue('--cal-custom-head-strong')).toBeTruthy();
  });

  it('renders a multi-day event once on its start day with a readable date range', () => {
    const monday = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(monday).find(item => item.title === 'Monday Mobilisation Sync')!;
    const item = {
      ...base,
      startsAt: new Date(2026, 7, 31, 22, 0).toISOString(),
      endsAt: new Date(2026, 8, 1, 2, 0).toISOString(),
    };
    const overlap = {
      ...base,
      id: 'overlapping-shift',
      startsAt: new Date(2026, 7, 31, 22, 30).toISOString(),
      endsAt: new Date(2026, 7, 31, 23, 30).toISOString(),
    };
    const { container } = render(<TimeGridView days={[monday, addDays(monday, 1)]} items={[item, overlap]} onOpenItem={vi.fn()} />);
    const segments = container.querySelectorAll<HTMLElement>(`[data-calendar-item-id="${item.id}"]`);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.classList.contains('is-multi-day')).toBe(true);
    expect(segments[0]?.querySelector('.cal-tg-event-time')?.textContent).toContain('Aug 31');
    expect(segments[0]?.querySelector('.cal-tg-event-time')?.textContent).toContain('Sep 1');
    expect(Number.parseFloat(segments[0]?.style.height ?? '999')).toBeLessThan(300);
    expect(segments[0]?.getAttribute('data-calendar-lanes')).toBe('2');
    expect(segments[0]?.classList.contains('is-overlapping')).toBe(true);
    const overlappingCard = container.querySelector<HTMLElement>('[data-calendar-item-id="overlapping-shift"]');
    expect(overlappingCard?.getAttribute('data-calendar-lanes')).toBe('2');
    expect(overlappingCard?.classList.contains('is-overlapping')).toBe(true);
    expect(segments[0]?.style.width).toBe('calc(100% - 12px)');
    expect(overlappingCard?.style.width).toBe('calc(100% - 12px)');
    expect(segments[0]?.style.left).toBe('calc(50% - 3px)');
    expect(overlappingCard?.style.left).toBe('calc(50% + 3px)');
  });

  it('places overlapping Day events in equal side-by-side lanes', () => {
    const day = new Date(2026, 8, 8, 12);
    const items = calendarStagingItems(day).filter(item => item.title === 'Sunday Readiness Huddle' || item.title === 'Visitor Escort Coordination');
    const { container } = render(<TimeGridView mode="day" days={[day]} items={items} onOpenItem={vi.fn()} />);
    const first = container.querySelector<HTMLElement>(`[data-calendar-item-id="${items[0]!.id}"]`);
    const second = container.querySelector<HTMLElement>(`[data-calendar-item-id="${items[1]!.id}"]`);

    expect(first?.getAttribute('data-calendar-lanes')).toBe('2');
    expect(second?.getAttribute('data-calendar-lanes')).toBe('2');
    expect(first?.style.left).toBe('25%');
    expect(second?.style.left).toBe('75%');
    expect(first?.style.width).toBe('calc(50% - 8px)');
    expect(second?.style.width).toBe('calc(50% - 8px)');
  });

  it('keeps the complete first card in front and exposes raised headers behind it only for matching Week start times', () => {
    const day = new Date(2026, 8, 8, 12);
    const staged = calendarStagingItems(day);
    const sameStart = staged.filter(item => item.title === 'Sunday Readiness Huddle' || item.title === 'Visitor Escort Coordination');
    const partialOverlap = {
      ...sameStart[1]!,
      id: 'partial-overlap',
      title: 'Later overlapping event',
      startsAt: new Date(2026, 8, 8, 10, 0).toISOString(),
      endsAt: new Date(2026, 8, 8, 11, 0).toISOString(),
    };
    const { container } = render(<TimeGridView mode="week" weekLayout="columns" days={[day]} items={[...sameStart, partialOverlap]} onOpenItem={vi.fn()} />);
    const front = container.querySelector<HTMLElement>(`[data-calendar-item-id="${sameStart[0]!.id}"]`)!;
    const back = container.querySelector<HTMLElement>(`[data-calendar-item-id="${sameStart[1]!.id}"]`)!;
    const later = container.querySelector<HTMLElement>('[data-calendar-item-id="partial-overlap"]')!;

    expect([front, back].filter(card => card.classList.contains('is-start-stack-front'))).toHaveLength(1);
    expect([front, back].filter(card => card.classList.contains('is-start-stack-back'))).toHaveLength(1);
    expect(front.classList.contains('is-start-stack-front')).toBe(true);
    expect(back.classList.contains('is-start-stack-back')).toBe(true);
    expect(front.getAttribute('data-calendar-start-stack-size')).toBe('2');
    expect(front.style.left).toBe('50%');
    expect(back.style.left).toBe('50%');
    expect(Number.parseFloat(front.style.top) - Number.parseFloat(back.style.top)).toBe(22);
    expect(front.style.getPropertyValue('--cal-overlap-layer')).toBe('4');
    expect(back.style.getPropertyValue('--cal-overlap-layer')).toBe('0');
    expect(back.querySelector('.cal-tg-event-title')?.textContent).toBe(sameStart[1]!.title);
    expect(back.querySelector('.cal-week-overflow-title')).toBeTruthy();
    expect(back.style.width).toBe('calc(100% - 20px)');
    expect(later.classList.contains('is-start-stack')).toBe(false);
    expect(container.querySelector<HTMLElement>('.cal-tg')?.style.getPropertyValue('--cal-tg-top-inset')).toBe('34px');
  });

  it('animates only the newly created entry and reports when its entrance completes', () => {
    const start = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(start).find(candidate => candidate.title === 'Close Permit Actions')!;
    const finished = vi.fn();
    const { container } = render(<TimeGridView days={[start]} items={[item]} enteringItemId={item.id} onEntryAnimationEnd={finished} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event');

    expect(card?.classList.contains('cal-entry-is-entering')).toBe(true);
    card!.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(finished).toHaveBeenCalledWith(item.id);
  });

  it('keeps sequential short cards full-width at compact zoom', () => {
    const start = new Date(2026, 7, 31, 12);
    const tuesday = addDays(start, 1);
    const staged = calendarStagingItems(start).filter(item => ['Review Isolation Pack', 'Monday Mobilisation Sync'].includes(item.title));
    render(<TimeGridView days={[tuesday]} items={staged} zoom={0.8} onOpenItem={vi.fn()} />);

    for (const title of ['Review Isolation Pack', 'Monday Mobilisation Sync']) {
      const card = cardShell(screen.getByRole('button', { name: new RegExp(title, 'i') }));
      expect(card.getAttribute('data-calendar-lanes')).toBe('1');
      expect(card.style.left).toBe('50%');
    }
  });

  it('keeps meetings and deadlines on the same standard card design with duration-aware density', () => {
    const start = new Date(2026, 7, 31, 12);
    const wednesday = addDays(start, 2);
    const items = calendarStagingItems(start).filter(item => ['Contractor Delivery Sync', 'Insurance Evidence Cutoff'].includes(item.title));
    render(<TimeGridView mode="week" days={[wednesday]} items={items} onOpenItem={vi.fn()} />);
    const meeting = cardShell(screen.getByRole('button', { name: /Contractor Delivery Sync/i }));
    const deadline = cardShell(screen.getByRole('button', { name: /Insurance Evidence Cutoff/i }));

    expect(meeting.classList.contains('size-medium')).toBe(true);
    expect(meeting.style.maxWidth).toBe('none');
    expect(meeting.querySelector('.cal-tg-event-time')).toBeTruthy();
    expect(meeting.querySelector('.cal-tg-event-notes')).toBeNull();
    expect(meeting.querySelector('.cal-tg-event-people-slot')).toBeTruthy();
    expect(deadline.classList.contains('size-small')).toBe(true);
    expect(deadline.classList.contains('is-extra-small')).toBe(true);
    expect(deadline.style.maxWidth).toBe('none');
    expect(deadline.querySelector('.cal-tg-event-time')?.textContent).toMatch(/12:45 PM.*1:15 PM/);
    expect(deadline.querySelector('.cal-tg-event-notes')).toBeNull();
    expect(deadline.querySelector('.ui-avatar-group')).toBeNull();
  });

  it('sizes standard Week tasks from their exact duration', () => {
    const start = new Date(2026, 7, 31, 12);
    const wednesday = addDays(start, 2);
    const task = calendarStagingItems(start).find(item => item.title === 'Approve Relief Roster')!;
    const { container } = render(<TimeGridView mode="week" days={[wednesday]} items={[task]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('[data-calendar-item-id]')!;

    expect(card.getAttribute('data-card-size')).toBe('small');
    expect(card.style.height).toBe('102px');
  });

  it('renders a location deadline as a standard all-day card without invented participants', () => {
    const monday = new Date(2026, 7, 31, 12);
    const items = calendarStagingItems(monday);
    const item = items.find(candidate => candidate.title === 'Weekend Logistics Day')!;
    const sunday = new Date(2026, 8, 6, 12);
    const { container } = render(<TimeGridView days={[sunday]} items={[item]} showAllDay onOpenItem={vi.fn()} />);

    const card = container.querySelector('.cal-tg-allday-card');
    expect(card?.className).not.toMatch(/backdrop-/);
    expect(card?.querySelector('.cal-card-map, .cal-card-zoom')).toBeNull();
    expect(card?.querySelector('.cal-tg-allday-time')?.textContent).toBe('All Day');
    expect(card?.querySelector('.ui-avatar-group')).toBeNull();
    expect(screen.queryByRole('button', { name: `More actions for ${item.title}` })).toBeNull();
  });

  it('keeps an all-day meeting on the standard template with right-aligned avatars', () => {
    const monday = new Date(2026, 7, 31, 12);
    const meeting = calendarStagingItems(monday).find(item => item.title === 'Monday Mobilisation Sync')!;
    const allDayMeeting = {
      ...meeting,
      allDay: true,
      startsOn: toLocalDateKey(addDays(monday, 1)),
      startsAt: null,
      endsAt: null,
    };
    const people = calendarStagingPeople(meeting).map(person => ({ id: person.userId, name: person.name, src: person.profileImage }));
    const { container } = render(<TimeGridView days={[addDays(monday, 1)]} items={[allDayMeeting]} showAllDay attendeePeople={{ [meeting.id]: people }} onOpenItem={vi.fn()} />);

    const card = container.querySelector('.cal-tg-allday-card');
    expect(card?.className).not.toMatch(/backdrop-/);
    expect(card?.querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
    expect(card?.querySelector('.ui-avatar-group')).toBeTruthy();
  });

  it('stacks multiple compact all-day cards in the same day lane', () => {
    const monday = new Date(2026, 7, 31, 12);
    const first = calendarStagingItems(monday).find(item => item.title === 'Weekend Logistics Day')!;
    const second = { ...first, id: 'all-day-second', title: 'Certification Cut-off', colorKey: 'rose' as const };
    const sunday = new Date(2026, 8, 6, 12);
    const { container } = render(<TimeGridView mode="week" days={[sunday]} items={[first, second]} showAllDay onOpenItem={vi.fn()} />);

    expect(container.querySelectorAll('.cal-tg-allday-card')).toHaveLength(2);
    expect(container.querySelectorAll('.cal-tg-allday-col')).toHaveLength(1);
    expect(container.querySelector('.cal-tg-week-card-icon, .cal-tg-allday-icon')).toBeNull();
    expect(screen.getByRole('button', { name: 'Certification Cut-off, All Day' })).toBeTruthy();
  });

  it('can hide the all-day section when the setting is disabled', () => {
    const start = new Date(2026, 7, 31, 12);
    const sunday = addDays(start, 6);
    const item = calendarStagingItems(start).find(candidate => candidate.title === 'Weekend Logistics Day')!;
    const { container } = render(<TimeGridView days={[sunday]} items={[item]} showAllDay={false} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeNull();
  });

  it('keeps a field-operation source, time, and place readable on the card', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const { container } = render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card?.querySelector('.cal-tg-week-card-icon')).toBeTruthy();
    expect(card?.querySelector('.cal-tg-event-time')?.textContent).toMatch(/6:30 AM.*9:00 AM/);
    expect(card?.querySelector('.cal-tg-event-location')?.textContent).toContain('Marine Base · Operations Desk');
    expect(card?.querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
  });

  it('does not reserve an all-day lane when the visible dates have no all-day items', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} showAllDay={false} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeNull();
    expect(screen.getByRole('button', { name: /Monday Mobilisation Sync/i })).toBeTruthy();
  });

  it('keeps the enabled all-day lane visible when the current dates are empty', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Monday Mobilisation Sync')!;
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} showAllDay onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeTruthy();
    expect(container.querySelector('.cal-tg-allday-label')?.textContent).toBe('All Day');
    expect(container.querySelectorAll('.cal-tg-allday-col')).toHaveLength(0);
    expect(screen.getByText('No All-Day Events Scheduled')).toBeTruthy();
    expect(container.querySelector('.cal-tg-allday-empty svg')).toBeTruthy();
  });

  it('gives Day view a full date heading and a condensed timeline and card scale', () => {
    const monday = new Date(2026, 7, 31, 12);
    const meeting = calendarStagingItems(monday).find(item => item.title === 'Marine Logistics Window')!;
    const { container } = render(<TimeGridView mode="day" days={[monday]} items={[meeting]} showAllDay onOpenItem={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Monday August 31, 2026' })).toBeTruthy();
    expect(container.querySelector<HTMLElement>('.cal-tg')?.style.getPropertyValue('--cal-tg-hour')).toBe('132px');
    expect(container.querySelector('.cal-tg-allday')).toBeTruthy();
    const card = container.querySelector<HTMLElement>('.cal-tg-event');
    expect(card?.style.height).toBe('330px');
    expect(card?.style.maxWidth).toBe('none');
  });

  it('aligns a 30-minute Day card to its exact end-time line with compact content', () => {
    const today = new Date(2026, 8, 8, 12);
    const reminder = calendarStagingItems(today).find(item => item.title === 'Send Access Reminder')!;
    const { container } = render(<TimeGridView mode="day" days={[today]} items={[reminder]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;

    expect(card.classList.contains('size-small')).toBe(true);
    expect(card.style.height).toBe('66px');
    expect(card.classList.contains('is-extra-small')).toBe(false);
    expect(card.querySelector('.cal-tg-event-title')?.textContent).toBe('Send Access Reminder');
    expect(card.querySelector('.cal-tg-event-time')?.textContent).toMatch(/4:00 PM.*4:30 PM/);
  });

  it('draws a snapped ghost selection and opens create with its start and end time', () => {
    const day = new Date(2026, 8, 8, 12);
    const create = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} onOpenItem={vi.fn()} onCreateForDay={create} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2388, width: 800, height: 2388, toJSON: () => ({}) });

    fireEvent.pointerDown(column, { button: 0, pointerId: 7, clientX: 200, clientY: 144 });
    expect(container.querySelector('.cal-tg-create-ghost')).toBeNull();
    fireEvent.pointerMove(column, { pointerId: 7, clientX: 200, clientY: 210 });
    expect(container.querySelector('.cal-tg-create-ghost')?.textContent).toContain('New event');
    fireEvent.pointerUp(column, { pointerId: 7, clientX: 200, clientY: 210 });

    expect(create).toHaveBeenCalledWith('2026-09-08', '07:00', 'event', { x: 200, y: 210 }, '07:45');
  });

  it('keeps the selected-time ghost visible while the create drawer is open', () => {
    const day = new Date(2026, 8, 8, 12);
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} draftSelection={{ key: '2026-09-08', startTime: '13:00', endTime: '14:30' }} onOpenItem={vi.fn()} onCreateForDay={vi.fn()} />);

    const ghost = container.querySelector<HTMLElement>('.cal-tg-create-ghost.is-pending-create');
    expect(ghost).toBeTruthy();
    expect(ghost?.textContent).toContain('1:00 PM – 2:30 PM');
    expect(ghost?.textContent).toContain('New event');
  });

  it('renders live ghost content and schedule with the neutral light-grey ghost tone', () => {
    const day = new Date(2026, 8, 8, 12);
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} draftSelection={{ key: '2026-09-08', startTime: '13:15', endTime: '15:00', kind: 'event', title: 'Live operations review', colorKey: 'mint', customColor: null, locationLabel: 'Assurance Room' }} onOpenItem={vi.fn()} />);

    const ghost = container.querySelector<HTMLElement>('.cal-tg-create-ghost.is-pending-create');
    expect(ghost?.classList.contains('tone-slate')).toBe(true);
    expect(ghost?.classList.contains('tone-mint')).toBe(false);
    expect(ghost?.textContent).toContain('1:15 PM – 3:00 PM');
    expect(ghost?.textContent).toContain('Live operations review');
    expect(ghost?.textContent).toContain('Assurance Room');
  });

  it('moves an all-day live draft into the all-day band', () => {
    const day = new Date(2026, 8, 8, 12);
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} draftSelection={{ key: '2026-09-08', startTime: '13:15', endTime: '15:00', allDay: true, kind: 'task', title: 'Review certification pack', colorKey: 'purple' }} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-create-ghost')).toBeNull();
    const allDayDraft = container.querySelector<HTMLElement>('.cal-tg-create-allday-ghost');
    expect(allDayDraft?.classList.contains('tone-slate')).toBe(true);
    expect(allDayDraft?.textContent).toContain('Review certification pack');
  });

  it('moves an existing card while preserving its duration', () => {
    const day = new Date(2026, 8, 8, 12);
    const item = calendarStagingItems(day).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2388, width: 800, height: 2388, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 72, y: 78, top: 78, left: 72, right: 864, bottom: 408, width: 792, height: 330, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 9, clientX: 200, clientY: 88 });
    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeNull();
    fireEvent.pointerMove(card, { pointerId: 9, clientX: 200, clientY: 418 });
    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeTruthy();
    fireEvent.pointerUp(card, { pointerId: 9, clientX: 200, clientY: 418 });

    expect(move).toHaveBeenCalledWith(item, '2026-09-08', '09:00', 150);
  });

  it('finishes a card move when pointer-up occurs outside the captured card', () => {
    const day = new Date(2026, 8, 8, 12);
    const item = calendarStagingItems(day).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2112, width: 800, height: 2112, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 72, y: 616, top: 616, left: 72, right: 864, bottom: 836, width: 792, height: 220, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 19, clientX: 200, clientY: 626 });
    fireEvent.pointerMove(card, { pointerId: 19, clientX: 200, clientY: 802 });
    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeTruthy();
    fireEvent.pointerUp(window, { pointerId: 19, clientX: 200, clientY: 802 });

    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeNull();
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('moves a Week card across day columns while preserving its duration', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="week" days={[monday, tuesday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const columns = [...container.querySelectorAll<HTMLElement>('.cal-tg-col')];
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;
    vi.spyOn(columns[0]!, 'getBoundingClientRect').mockReturnValue({ x: 78, y: 0, top: 0, left: 78, right: 478, bottom: 2460, width: 400, height: 2460, toJSON: () => ({}) });
    vi.spyOn(columns[1]!, 'getBoundingClientRect').mockReturnValue({ x: 478, y: 0, top: 0, left: 478, right: 878, bottom: 2460, width: 400, height: 2460, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 82, y: 80, top: 80, left: 82, right: 474, bottom: 420, width: 392, height: 340, toJSON: () => ({}) });

    const scroller = container.querySelector<HTMLElement>('.cal-tg-scroll')!;
    const setPointerCapture = vi.fn();
    Object.defineProperty(scroller, 'setPointerCapture', { configurable: true, value: setPointerCapture });

    fireEvent.pointerDown(card, { button: 0, pointerId: 13, clientX: 200, clientY: 90 });
    expect(setPointerCapture).toHaveBeenCalledWith(13);
    fireEvent.pointerMove(scroller, { pointerId: 13, clientX: 600, clientY: 430 });

    const movedCard = container.querySelector<HTMLElement>('.cal-tg-event')!;
    expect(movedCard.closest<HTMLElement>('.cal-tg-col')?.dataset.dateKey).toBe(toLocalDateKey(tuesday));
    fireEvent.pointerUp(window, { pointerId: 13, clientX: 600, clientY: 430 });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(tuesday), '09:00', 150);
  });
  it('smoothly previews a dragged card entering and leaving an overlap lane', () => {
    const day = new Date(2026, 8, 8, 12);
    const items = calendarStagingItems(day).filter(candidate => ['Marine Logistics Window', 'Sunday Readiness Huddle', 'Visitor Escort Coordination'].includes(candidate.title));
    const moving = items.find(candidate => candidate.title === 'Marine Logistics Window')!;
    const { container } = render(<TimeGridView mode="day" days={[day]} items={items} onOpenItem={vi.fn()} onMoveItem={vi.fn()} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    const card = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 1596, width: 800, height: 1596, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 72, y: 56, top: 56, left: 72, right: 864, bottom: 276, width: 792, height: 220, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 12, clientX: 200, clientY: 66 });
    fireEvent.pointerMove(card, { pointerId: 12, clientX: 200, clientY: 330 });
    const splitPreview = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    expect(splitPreview.classList.contains('is-being-moved')).toBe(true);
    expect(splitPreview.getAttribute('data-calendar-lanes')).toBe('3');
    expect(splitPreview.style.width).toBe('calc(33.3333% - 8px)');

    fireEvent.pointerMove(splitPreview, { pointerId: 12, clientX: 200, clientY: 66 });
    const fullPreview = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    expect(fullPreview.getAttribute('data-calendar-lanes')).toBe('1');
    expect(fullPreview.style.width).toBe('calc(100% - 8px)');
  });

  it('opens quick info after viewport pointer capture when a press never becomes a drag', () => {
    const day = new Date(2026, 8, 8, 12);
    const item = calendarStagingItems(day).find(candidate => candidate.title === 'Marine Logistics Window')!;
    const open = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[item]} onOpenItem={open} onMoveItem={vi.fn()} />);
    const button = screen.getByRole('button', { name: /^Field operation: Marine Logistics Window$/i });
    const scroller = container.querySelector<HTMLElement>('.cal-tg-scroll')!;
    Object.defineProperty(scroller, 'setPointerCapture', { configurable: true, value: vi.fn() });

    fireEvent.pointerDown(button, { button: 0, pointerId: 11, clientX: 200, clientY: 626 });
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 200, clientY: 626 });
    expect(open).toHaveBeenCalledWith(item, { x: 200, y: 626 });

    // Some browsers still synthesize a click after capture is released. It is
    // consumed so quick info is never opened twice for one press.
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stages talk, reminder, deadline, and milestone cards without participant avatars', () => {
    const today = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(today);
    const names = ['Send Access Reminder', 'Review Isolation Pack', 'Insurance Evidence Cutoff', 'Permit Activation Cutoff'];
    const staged = items.filter(item => names.includes(item.title));
    const attendeePeople = Object.fromEntries(staged.map(item => [item.id, calendarStagingPeople(item).map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))]));
    render(<TimeGridView days={[today, addDays(today, 1), addDays(today, 2), addDays(today, 4)]} items={staged} attendeePeople={attendeePeople} onOpenItem={vi.fn()} />);

    expect(cardShell(screen.getByRole('button', { name: /Send Access Reminder/i })).className).not.toMatch(/backdrop-/);

    expect(cardShell(screen.getByRole('button', { name: /Review Isolation Pack/i })).getAttribute('data-card-size')).toBe('small');
    expect(cardShell(screen.getByRole('button', { name: /Review Isolation Pack/i })).classList.contains('tone-purple')).toBe(true);
    const expectedHeights = new Map([
      ['Send Access Reminder', '68px'],
      ['Review Isolation Pack', '102px'],
      ['Insurance Evidence Cutoff', '68px'],
      ['Permit Activation Cutoff', '68px'],
    ]);
    for (const name of expectedHeights.keys()) {
      const card = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(cardShell(card).getAttribute('data-card-size')).toBe('small');
      expect(card.querySelector('.cal-tg-event-time')).toBeTruthy();
      expect(cardShell(card).style.height).toBe(expectedHeights.get(name));
    }
    for (const name of names) expect(screen.getByRole('button', { name: new RegExp(name, 'i') }).querySelector('.ui-avatar-group')).toBeNull();
  });
});
