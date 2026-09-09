import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { calendarStagingHolidays, calendarStagingItems, calendarStagingPeople } from './calendarStaging';
import { TimeGridView } from './TimeGridView';
import { addDays, toLocalDateKey } from '@lib/calendar/date';
import type { CalendarItemDTO } from '@api/calendar';

type ItemPointHandler = (item: CalendarItemDTO, point: { x: number; y: number }) => void;

function cardShell(button: HTMLElement): HTMLElement {
  const shell = button.closest<HTMLElement>('.cal-tg-event');
  if (!shell) throw new Error('Calendar card shell was not rendered.');
  return shell;
}

describe('TimeGridView', () => {
  it('renders Sunday-to-Saturday as day rows against a shared horizontal time scale', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const days = Array.from({ length: 7 }, (_, offset) => addDays(sunday, offset));
    const { container } = render(<TimeGridView mode="week" days={days} items={[]} onOpenItem={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>('.cal-tg')!;
    const rows = [...container.querySelectorAll('.cal-tg-week-row')];

    expect(grid.style.getPropertyValue('--cal-week-width')).toBe('2496px');
    expect(container.querySelectorAll('.cal-week-hours > span')).toHaveLength(24);
    expect(rows).toHaveLength(7);
    expect(rows[0]?.textContent).toContain('Sun');
    expect(rows[6]?.textContent).toContain('Sat');
  });

  it('places the single Week card icon at the top-left of its text block', () => {
    const sunday = new Date(2026, 8, 6, 12);
    const item = calendarStagingItems(sunday).find(candidate => candidate.titleIconType === 'lucide' && Boolean(candidate.startsAt))!;
    const { container } = render(<TimeGridView mode="week" days={[sunday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event')!;

    expect(card.querySelector('.cal-tg-week-card-icon')).toBeTruthy();
    expect(card.querySelector('.cal-week-event-main')?.firstElementChild?.classList.contains('cal-tg-week-card-icon')).toBe(true);
    expect(card.querySelector('.cal-tg-event-head')).toBeNull();
    expect(card.querySelectorAll('.cal-tg-week-card-icon')).toHaveLength(1);
  });

  it('renders the reference-density workday and opens a staged event', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const items = calendarStagingItems(monday);
    const active = items.find(item => item.title === 'Weekly Operations Briefing')!;
    const open = vi.fn<ItemPointHandler>();

    render(<TimeGridView days={[tuesday]} items={items} onOpenItem={open} />);

    expect(screen.getByText('9:00 AM')).toBeTruthy();
    const event = screen.getByRole('button', { name: /Weekly Operations Briefing/i });
    expect(cardShell(event).className).toMatch(/tone-(mint|blue|coral|amber|purple)/);
    fireEvent.click(event);
    expect(open.mock.calls[0]?.[0]).toBe(active);
    expect(typeof open.mock.calls[0]?.[1].x).toBe('number');
    expect(typeof open.mock.calls[0]?.[1].y).toBe('number');
  });

  it('uses a column double-click as the create gesture', () => {
    const monday = new Date(2026, 7, 31, 12);
    const create = vi.fn();
    const { container } = render(<TimeGridView days={[monday]} items={[]} onOpenItem={vi.fn()} onCreateForDay={create} />);

    fireEvent.dblClick(container.querySelector('.cal-tg-col')!, { clientX: 120, clientY: 0 });
    expect(create).toHaveBeenCalledWith('2026-08-31', '00:00', 'event', { x: 120, y: 0 });
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

  it('keeps holiday context compact in the Week day rail', () => {
    const days = Array.from({ length: 4 }, (_, offset) => new Date(2026, 8, 7 + offset, 12));
    const { container } = render(<TimeGridView days={days} items={[]} holidays={calendarStagingHolidays(days)} showAllDay={false} onOpenItem={vi.fn()} />);
    const labels = [...container.querySelectorAll<HTMLElement>('.cal-tg-week-holiday')];
    expect(labels).toHaveLength(4);
    expect(labels.map(label => label.textContent)).toEqual(['Independence Day', 'African Emancipation Day', 'Divali', 'Eid-ul-Fitr']);
    expect(container.querySelectorAll('.cal-tg-week-row-track')).toHaveLength(4);
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
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const openSource = vi.fn();
    const edit = vi.fn<ItemPointHandler>();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={edit} onOpenSource={openSource} />);

    const card = cardShell(screen.getByRole('button', { name: /Weekly Operations Briefing/i }));
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    expect(await screen.findByRole('menuitem', { name: 'Minimize' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit event' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Set reminder' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Open source' }).querySelector('.ui-menu-item-trailing')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    expect(edit.mock.calls[0]?.[0]).toBe(item);
    expect(typeof edit.mock.calls[0]?.[1].x).toBe('number');
    expect(typeof edit.mock.calls[0]?.[1].y).toBe('number');

    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open source' }));

    expect(openSource).toHaveBeenCalledWith(item);
  });

  it('uses right-click for card actions and does not render three-dot triggers', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} />);

    fireEvent.contextMenu(cardShell(screen.getByRole('button', { name: /Weekly Operations Briefing/i })), { clientX: 220, clientY: 170 });

    expect(await screen.findByRole('menu', { name: 'Calendar item actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('routes recurring entries through the recurrence-aware full editor', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const base = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const item = { ...base, recurrenceRule: 'FREQ=DAILY;COUNT=3' };
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.contextMenu(cardShell(screen.getByRole('button', { name: /Weekly Operations Briefing/i })), { clientX: 220, clientY: 170 });

    expect((await screen.findByRole('menuitem', { name: 'Edit event' })).getAttribute('aria-disabled')).toBeNull();
  });

  it('actually minimizes and restores a card from the context menu', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = screen.getByRole('button', { name: /Weekly Operations Briefing/i });

    fireEvent.contextMenu(cardShell(card), { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Minimize' }));
    expect(card.getAttribute('data-card-size')).toBe('small');
    expect(cardShell(card).classList.contains('is-minimized')).toBe(true);
    expect(cardShell(card).querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();

    fireEvent.contextMenu(cardShell(card), { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand' }));
    expect(card.getAttribute('data-card-size')).toBe('medium');
    expect(cardShell(card).classList.contains('is-minimized')).toBe(false);
    expect(cardShell(card).querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
  });

  it('applies the compact minimized height in Day view', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const { container } = render(<TimeGridView mode="day" days={[monday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;

    expect(card.style.height).toBe('168px');
    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Minimize' }));

    expect(card.classList.contains('size-small')).toBe(true);
    expect(card.style.height).toBe('40px');
  });

  it('resizes editable Day-view cards in 15-minute increments', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const move = vi.fn();
    render(<TimeGridView mode="day" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 135);
  });

  it('exposes the same governed resize control in Week view', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const move = vi.fn();
    render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 135);
  });

  it('resizes Week cards horizontally against the shared time scale', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const track = container.querySelector<HTMLElement>('.cal-tg-week-row-track')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ x: 118, y: 104, top: 104, left: 118, right: 2614, bottom: 182, width: 2496, height: 78, toJSON: () => ({}) });
    const handle = screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 14, clientX: 300, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 14, clientX: 352, clientY: 160 });
    fireEvent.pointerUp(handle, { pointerId: 14, clientX: 352, clientY: 160 });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(monday), expect.any(String), 150);
  });

  it('uses Ctrl plus wheel to reach a complete 24-hour Week overview', () => {
    const monday = new Date(2026, 7, 31, 12);
    const zoomChange = vi.fn();
    const { container, rerender } = render(<TimeGridView mode="week" days={[monday]} items={[]} zoom={0.45} onZoomChange={zoomChange} onOpenItem={vi.fn()} />);

    fireEvent.wheel(container.querySelector('.cal-week-timeline')!, { ctrlKey: true, deltaY: 100, clientX: 400 });
    expect(zoomChange).toHaveBeenCalledWith(0.35);

    rerender(<TimeGridView mode="week" days={[monday]} items={[]} zoom={0.35} onZoomChange={zoomChange} onOpenItem={vi.fn()} />);
    const overview = container.querySelector<HTMLElement>('.cal-week-timeline')!;
    expect(overview.classList.contains('is-week-overview')).toBe(true);
    expect(overview.style.getPropertyValue('--cal-week-width')).toBe('864px');
  });

  it('does not resize a Day-view card below the readable 45-minute minimum', () => {
    const monday = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const startsAt = new Date(base.startsAt!);
    const item = { ...base, endsAt: new Date(startsAt.getTime() + 45 * 60_000).toISOString() };
    const move = vi.fn();
    render(<TimeGridView mode="day" days={[monday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);

    fireEvent.keyDown(screen.getByRole('button', { name: `Resize ${item.title} in 15-minute increments` }), { key: 'ArrowUp' });

    expect(move).not.toHaveBeenCalled();
  });

  it('routes the Delete key on a focused card through the governed delete action', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = { ...calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!, cancelable: true };
    const deleteItem = vi.fn();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onDeleteItem={deleteItem} />);

    fireEvent.keyDown(screen.getByRole('button', { name: /Operations briefing/i }), { key: 'Delete' });

    expect(deleteItem).toHaveBeenCalledWith(item);
  });

  it('exposes real reminder and delete callbacks only for capable native items', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const staged = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const item = { ...staged, sourceModule: null, sourceRoute: null, sourceLabel: null, status: 'not_started' as const, editable: true, cancelable: true };
    const setReminder = vi.fn();
    const deleteItem = vi.fn();
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onSetReminder={setReminder} onDeleteItem={deleteItem} />);

    const card = cardShell(screen.getByRole('button', { name: /Weekly Operations Briefing/i }));
    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(item);

    fireEvent.contextMenu(card, { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(deleteItem).toHaveBeenCalledWith(item);
  });

  it('keeps the standard card menu available for reminders by right-click', async () => {
    const sunday = new Date(2026, 8, 6, 12);
    const reminder = calendarStagingItems(sunday).find(item => item.title === 'Submit Permit Pack')!;
    render(<TimeGridView days={[sunday]} items={[reminder]} onOpenItem={vi.fn()} />);

    const card = cardShell(screen.getByRole('button', { name: /Submit Permit Pack/i }));
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
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const create = vi.fn();
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} onCreateForDay={create} />);
    const grid = container.querySelector<HTMLElement>('.cal-tg-grid')!;
    const gutter = container.querySelector<HTMLElement>('.cal-tg-gutter')!;
    const card = screen.getByRole('button', { name: /Weekly Operations Briefing/i });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 4804, left: 0, right: 800, width: 800, height: 4704, x: 0, y: 100, toJSON: () => ({}) });

    fireEvent.contextMenu(gutter, { clientX: 55, clientY: 100 + ((10 * 60 + 20) / 60) * 196 });

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
      expect(create).toHaveBeenCalledWith('2026-09-01', '10:20', 'task', { x: 55, y: 100 + ((10 * 60 + 20) / 60) * 196 });
  });

  it('does not add a hover information tip before or after a card is minimized', async () => {
    const monday = new Date(2026, 7, 31, 12);
    const thursday = addDays(monday, 3);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Contractor Mobilisation Review')!;
    render(<TimeGridView days={[thursday]} items={[item]} onOpenItem={vi.fn()} />);

    const event = screen.getByRole('button', { name: /Contractor Mobilisation Review/i });
    expect(event.querySelector('.cal-tg-event-notes')).toBeNull();
    event.focus();
    expect(screen.queryByRole('tooltip')).toBeNull();
    event.blur();

    fireEvent.contextMenu(cardShell(event), { clientX: 220, clientY: 170 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Minimize' }));
    event.focus();

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps descriptions in the quick information surface instead of rendering them on cards', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const staged = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const item = { ...staged, notes: 'Review readiness, assign open actions and align mobilisation priorities with every department lead before the next shift starts.' };
    render(<TimeGridView days={[tuesday]} items={[item]} onOpenItem={vi.fn()} />);

    const event = screen.getByRole('button', { name: /Weekly Operations Briefing/i });
    expect(event.querySelector('.cal-tg-event-notes')).toBeNull();
    event.focus();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders the live current-time indicator whenever today is visible', () => {
    const { container } = render(<TimeGridView days={[new Date()]} items={[]} onOpenItem={vi.fn()} />);
    expect(screen.getByLabelText(/Current time/i)).toBeTruthy();
    expect(container.querySelector('.cal-tg-hour-ticks')).toBeNull();
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

    const locationCard = cardShell(screen.getByRole('button', { name: /Pelican Platform Safety Review/i }));
    const meetingCard = cardShell(screen.getByRole('button', { name: /Weekly Operations Briefing/i }));
    expect(locationCard.className).not.toMatch(/backdrop-/);
    expect(meetingCard.className).not.toMatch(/backdrop-/);
    expect(locationCard.querySelector('.cal-card-map, .cal-card-zoom')).toBeNull();
    expect(meetingCard.querySelector('.cal-card-map, .cal-card-zoom')).toBeNull();
  });

  it('keeps meeting identity in the standard card icon', () => {
    const start = new Date(2026, 7, 31, 12);
    const meeting = calendarStagingItems(start).find(item => item.title === 'Weekly Operations Briefing')!;
    const { container } = render(<TimeGridView days={[addDays(start, 1)]} items={[meeting]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card).toBeTruthy();
    expect(card?.querySelector('.cal-tg-event-source')?.textContent).toContain('Meeting');
    expect(card?.classList.contains('tone-blue')).toBe(true);
    expect(card?.querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
    expect(card?.getAttribute('data-card-size')).toBe('medium');
  });

  it('keeps participant avatars in the adaptive right slot on standard cards', () => {
    const start = new Date(2026, 7, 31, 12);
    const thursday = addDays(start, 3);
    const titles = ['CAPA Owner Check-in', 'Contractor Mobilisation Review'];
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
    expect(first?.style.height).toBe('58px');
    expect(second?.style.height).toBe(first?.style.height);
  });

  it('gives tasks the same standard treatment and a readable minimum card height', () => {
    const start = new Date(2026, 7, 31, 12);
    const task = calendarStagingItems(start).find(item => item.title === 'Permit Handover')!;
    const { container } = render(<TimeGridView mode="week" days={[start]} items={[task]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event');

    expect(card).toBeTruthy();
    expect(card?.classList.contains('size-medium')).toBe(true);
    expect(Number.parseFloat(card?.style.height ?? '0')).toBeGreaterThanOrEqual(58);
    expect(card?.className).not.toMatch(/backdrop-/);
    expect(card?.querySelector('.cal-tg-event-time')?.textContent).toMatch(/11:15 AM.*12:00 PM/);
    expect(card?.querySelector('.cal-tg-time-icon')).toBeNull();
    expect(card?.querySelector('.cal-tg-event-notes')).toBeNull();
  });

  it('marks user-selected palettes on the standard card', () => {
    const start = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(start).find(item => item.title === 'Vendor Access Briefing')!;
    const item = { ...base, origin: 'calendar' as const, sourceModule: null, sourceLabel: null, sourceRoute: null, colorKey: 'coral' as const };
    const { container } = render(<TimeGridView days={[start]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card?.classList.contains('tone-coral')).toBe(true);
    expect(card?.classList.contains('has-custom-tone')).toBe(true);
  });

  it('renders a validated custom colour through derived card tokens', () => {
    const start = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(start).find(item => item.title === 'Vendor Access Briefing')!;
    const item = { ...base, origin: 'calendar' as const, sourceModule: null, sourceLabel: null, sourceRoute: null, colorKey: null, customColor: '#2a8f64' };
    const { container } = render(<TimeGridView days={[start]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event');

    expect(card?.classList.contains('has-custom-color')).toBe(true);
    expect(card?.style.getPropertyValue('--cal-custom-color')).toBe('#2a8f64');
    expect(card?.style.getPropertyValue('--cal-custom-head-strong')).toBeTruthy();
  });

  it('renders a multi-day event once on its start day with a readable date range', () => {
    const monday = new Date(2026, 7, 31, 12);
    const base = calendarStagingItems(monday).find(item => item.title === 'Weekly Operations Briefing')!;
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
    expect(segments[0]?.style.width).toContain('calc(');
    expect(segments[0]?.style.minWidth).toBe('76px');
    expect(overlappingCard?.style.width).toContain('calc(');
    expect(segments[0]?.style.left).toContain('91.666');
    expect(overlappingCard?.style.left).toContain('93.75');

    fireEvent.pointerEnter(segments[0]!);
    expect(segments[0]?.style.top).toBe('34px');
    expect(overlappingCard?.style.top).toBe('10px');
    expect(segments[0]?.classList.contains('is-stack-promoted')).toBe(true);
  });

  it('places overlapping Day events in equal side-by-side lanes', () => {
    const day = new Date(2026, 8, 8, 12);
    const items = calendarStagingItems(day).filter(item => item.title === 'Site Readiness Sync' || item.title === 'Vendor Access Briefing');
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

  it('animates only the newly created entry and reports when its entrance completes', () => {
    const start = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(start).find(candidate => candidate.title === 'Permit Handover')!;
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
    const staged = calendarStagingItems(start).filter(item => ['Pre-job Safety Talk', 'Weekly Operations Briefing'].includes(item.title));
    render(<TimeGridView days={[tuesday]} items={staged} zoom={0.8} onOpenItem={vi.fn()} />);

    for (const title of ['Pre-job Safety Talk', 'Weekly Operations Briefing']) {
      const card = cardShell(screen.getByRole('button', { name: new RegExp(title, 'i') }));
      expect(card.getAttribute('data-calendar-lanes')).toBe('1');
      expect(card.style.left).toBe('50%');
    }
  });

  it('keeps meetings and deadlines on the same standard card tier', () => {
    const start = new Date(2026, 7, 31, 12);
    const wednesday = addDays(start, 2);
    const items = calendarStagingItems(start).filter(item => ['Contractor Kickoff', 'Insurance Certificate Due'].includes(item.title));
    render(<TimeGridView mode="week" days={[wednesday]} items={items} onOpenItem={vi.fn()} />);
    const meeting = cardShell(screen.getByRole('button', { name: /Contractor Kickoff/i }));
    const deadline = cardShell(screen.getByRole('button', { name: /Insurance Certificate Due/i }));

    expect(meeting.classList.contains('size-medium')).toBe(true);
    expect(meeting.style.width).toContain('calc(');
    expect(meeting.style.minWidth).toBe('76px');
    expect(meeting.querySelector('.cal-tg-event-time')).toBeTruthy();
    expect(meeting.querySelector('.cal-tg-event-notes')).toBeNull();
    expect(meeting.querySelector('.cal-tg-event-people-slot')).toBeTruthy();
    expect(deadline.classList.contains('size-medium')).toBe(true);
    expect(deadline.style.width).toContain('calc(');
    expect(deadline.querySelector('.cal-tg-event-time')?.textContent).toMatch(/11:00 AM.*11:30 AM/);
    expect(deadline.querySelector('.cal-tg-event-notes')).toBeNull();
    expect(deadline.querySelector('.ui-avatar-group')).toBeNull();
  });

  it('maps a standard task card width to its duration', () => {
    const start = new Date(2026, 7, 31, 12);
    const wednesday = addDays(start, 2);
    const task = calendarStagingItems(start).find(item => item.title === 'Approve September Crew Roster')!;
    const { container } = render(<TimeGridView mode="week" days={[wednesday]} items={[task]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('[data-calendar-item-id]')!;

    expect(card.getAttribute('data-card-size')).toBe('medium');
    expect(card.style.height).toBe('58px');
    expect(card.style.width).toContain('calc(');
    expect(card.style.minWidth).toBe('76px');
  });

  it('renders a location deadline as a standard all-day card without invented participants', () => {
    const monday = new Date(2026, 7, 31, 12);
    const items = calendarStagingItems(monday);
    const item = items.find(candidate => candidate.title === 'Offshore Supply Arrival')!;
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
    const meeting = calendarStagingItems(monday).find(item => item.title === 'Weekly Operations Briefing')!;
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
    const first = calendarStagingItems(monday).find(item => item.title === 'Offshore Supply Arrival')!;
    const second = { ...first, id: 'all-day-second', title: 'Certification Cut-off', colorKey: 'rose' as const };
    const sunday = new Date(2026, 8, 6, 12);
    const { container } = render(<TimeGridView days={[sunday]} items={[first, second]} showAllDay onOpenItem={vi.fn()} />);

    expect(container.querySelectorAll('.cal-tg-allday-card')).toHaveLength(2);
    expect(container.querySelectorAll('.cal-tg-allday-col')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Certification Cut-off, All Day' })).toBeTruthy();
  });

  it('can hide the all-day section when the setting is disabled', () => {
    const start = new Date(2026, 7, 31, 12);
    const sunday = addDays(start, 6);
    const item = calendarStagingItems(start).find(candidate => candidate.title === 'Offshore Supply Arrival')!;
    const { container } = render(<TimeGridView days={[sunday]} items={[item]} showAllDay={false} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeNull();
  });

  it('keeps a field-operation source, time, and place readable on the card', () => {
    const monday = new Date(2026, 7, 31, 12);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const { container } = render(<TimeGridView mode="week" days={[monday]} items={[item]} onOpenItem={vi.fn()} />);
    const card = container.querySelector('.cal-tg-event');

    expect(card?.querySelector('.cal-tg-week-card-icon')).toBeTruthy();
    expect(card?.querySelector('.cal-tg-event-time')?.textContent).toMatch(/7:00 AM.*9:00 AM/);
    expect(card?.querySelector('.cal-tg-event-location')?.textContent).toContain('North Field · Gate 2');
    expect(card?.querySelector('.cal-card-zoom, .cal-card-map')).toBeNull();
  });

  it('does not reserve an all-day lane when the visible dates have no all-day items', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} showAllDay={false} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeNull();
    expect(screen.getByRole('button', { name: /Weekly Operations Briefing/i })).toBeTruthy();
  });

  it('keeps the enabled all-day lane visible when the current dates are empty', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'Weekly Operations Briefing')!;
    const { container } = render(<TimeGridView days={[tuesday]} items={[item]} showAllDay onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-tg-allday')).toBeTruthy();
    expect(container.querySelector('.cal-tg-allday-label')?.textContent).toBe('All Day');
    expect(container.querySelectorAll('.cal-tg-allday-col')).toHaveLength(0);
    expect(screen.getByText('No All-Day Events Scheduled')).toBeTruthy();
    expect(container.querySelector('.cal-tg-allday-empty svg')).toBeTruthy();
  });

  it('gives Day view a full date heading and a condensed timeline and card scale', () => {
    const monday = new Date(2026, 7, 31, 12);
    const meeting = calendarStagingItems(monday).find(item => item.title === 'North Field Mobilisation')!;
    const { container } = render(<TimeGridView mode="day" days={[monday]} items={[meeting]} showAllDay onOpenItem={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Monday August 31, 2026' })).toBeTruthy();
    expect(container.querySelector<HTMLElement>('.cal-tg')?.style.getPropertyValue('--cal-tg-hour')).toBe('88px');
    expect(container.querySelector('.cal-tg-allday')).toBeTruthy();
    const card = container.querySelector<HTMLElement>('.cal-tg-event');
    expect(card?.style.height).toBe('168px');
    expect(card?.style.maxWidth).toBe('none');
  });

  it('uses a single-row extra-small layout for a 30-minute Day card', () => {
    const today = new Date(2026, 8, 8, 12);
    const reminder = calendarStagingItems(today).find(item => item.title === 'Submit Permit Pack')!;
    const { container } = render(<TimeGridView mode="day" days={[today]} items={[reminder]} onOpenItem={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;

    expect(card.classList.contains('is-extra-small')).toBe(true);
    expect(card.style.height).toBe('40px');
    expect(card.querySelector('.cal-tg-event-title')?.textContent).toBe('Submit Permit Pack');
    expect(card.querySelector('.cal-tg-event-time')?.textContent).toMatch(/3:30 PM.*4:00 PM/);
  });

  it('draws a snapped ghost selection and opens create with its start and end time', () => {
    const day = new Date(2026, 8, 8, 12);
    const create = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} onOpenItem={vi.fn()} onCreateForDay={create} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2112, width: 800, height: 2112, toJSON: () => ({}) });

    fireEvent.pointerDown(column, { button: 0, pointerId: 7, clientX: 200, clientY: 88 });
    expect(container.querySelector('.cal-tg-create-ghost')).toBeNull();
    fireEvent.pointerMove(column, { pointerId: 7, clientX: 200, clientY: 132 });
    expect(container.querySelector('.cal-tg-create-ghost')?.textContent).toContain('New calendar item');
    fireEvent.pointerUp(column, { pointerId: 7, clientX: 200, clientY: 132 });

    expect(create).toHaveBeenCalledWith('2026-09-08', '01:00', 'event', { x: 200, y: 132 }, '01:45');
  });

  it('keeps the selected-time ghost visible while the create drawer is open', () => {
    const day = new Date(2026, 8, 8, 12);
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[]} draftSelection={{ key: '2026-09-08', startTime: '13:00', endTime: '14:30' }} onOpenItem={vi.fn()} onCreateForDay={vi.fn()} />);

    const ghost = container.querySelector<HTMLElement>('.cal-tg-create-ghost.is-pending-create');
    expect(ghost).toBeTruthy();
    expect(ghost?.textContent).toContain('1:00 PM – 2:30 PM');
    expect(ghost?.textContent).toContain('New calendar item');
  });

  it('moves an existing card while preserving its duration', () => {
    const day = new Date(2026, 8, 8, 12);
    const item = calendarStagingItems(day).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="day" days={[day]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    const card = container.querySelector<HTMLElement>('.cal-tg-event')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2112, width: 800, height: 2112, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 72, y: 616, top: 616, left: 72, right: 864, bottom: 748, width: 792, height: 132, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 9, clientX: 200, clientY: 626 });
    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeNull();
    fireEvent.pointerMove(card, { pointerId: 9, clientX: 200, clientY: 802 });
    expect(container.querySelector('.cal-tg-event.is-being-moved')).toBeTruthy();
    fireEvent.pointerUp(card, { pointerId: 9, clientX: 200, clientY: 802 });

    expect(move).toHaveBeenCalledWith(item, '2026-09-08', '09:00', 120);
  });

  it('moves a Week card across both the time scale and day rows', () => {
    const monday = new Date(2026, 7, 31, 12);
    const tuesday = addDays(monday, 1);
    const item = calendarStagingItems(monday).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const move = vi.fn();
    const { container } = render(<TimeGridView mode="week" days={[monday, tuesday]} items={[item]} onOpenItem={vi.fn()} onMoveItem={move} />);
    const scroll = container.querySelector<HTMLElement>('.cal-week-scroll')!;
    const card = container.querySelector<HTMLElement>('.cal-week-event')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 180, y: 114, top: 114, left: 180, right: 284, bottom: 172, width: 104, height: 58, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 13, clientX: 200, clientY: 130 });
    const activeTracks = [...container.querySelectorAll<HTMLElement>('.cal-tg-week-row-track')];
    expect(activeTracks.map(track => track.dataset.dateKey)).toEqual([toLocalDateKey(monday), toLocalDateKey(tuesday)]);
    vi.spyOn(activeTracks[0]!, 'getBoundingClientRect').mockReturnValue({ x: 118, y: 104, top: 104, left: 118, right: 2614, bottom: 182, width: 2496, height: 78, toJSON: () => ({}) });
    vi.spyOn(activeTracks[1]!, 'getBoundingClientRect').mockReturnValue({ x: 118, y: 182, top: 182, left: 118, right: 2614, bottom: 260, width: 2496, height: 78, toJSON: () => ({}) });
    fireEvent.pointerMove(activeTracks[1]!, { pointerId: 13, clientX: 600, clientY: 210 });
    fireEvent.pointerUp(scroll, { pointerId: 13, clientX: 600, clientY: 210 });

    expect(move).toHaveBeenCalledWith(item, toLocalDateKey(tuesday), expect.any(String), 120);
  });

  it('smoothly previews a dragged card entering and leaving an overlap lane', () => {
    const day = new Date(2026, 8, 8, 12);
    const items = calendarStagingItems(day).filter(candidate => ['North Field Mobilisation', 'Site Readiness Sync', 'Vendor Access Briefing'].includes(candidate.title));
    const moving = items.find(candidate => candidate.title === 'North Field Mobilisation')!;
    const { container } = render(<TimeGridView mode="day" days={[day]} items={items} onOpenItem={vi.fn()} onMoveItem={vi.fn()} />);
    const column = container.querySelector<HTMLElement>('.cal-tg-col')!;
    const card = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ x: 68, y: 0, top: 0, left: 68, right: 868, bottom: 2112, width: 800, height: 2112, toJSON: () => ({}) });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 72, y: 616, top: 616, left: 72, right: 864, bottom: 748, width: 792, height: 132, toJSON: () => ({}) });

    fireEvent.pointerDown(card, { button: 0, pointerId: 12, clientX: 200, clientY: 626 });
    fireEvent.pointerMove(card, { pointerId: 12, clientX: 200, clientY: 802 });
    const splitPreview = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    expect(splitPreview.classList.contains('is-being-moved')).toBe(true);
    expect(splitPreview.getAttribute('data-calendar-lanes')).toBe('3');
    expect(splitPreview.style.width).toBe('calc(33.3333% - 8px)');

    fireEvent.pointerMove(splitPreview, { pointerId: 12, clientX: 200, clientY: 626 });
    const fullPreview = container.querySelector<HTMLElement>(`[data-calendar-item-id="${moving.id}"]`)!;
    expect(fullPreview.getAttribute('data-calendar-lanes')).toBe('1');
    expect(fullPreview.style.width).toBe('calc(100% - 8px)');
  });

  it('still opens quick info after a press that never becomes a drag', () => {
    const day = new Date(2026, 8, 8, 12);
    const item = calendarStagingItems(day).find(candidate => candidate.title === 'North Field Mobilisation')!;
    const open = vi.fn();
    render(<TimeGridView mode="day" days={[day]} items={[item]} onOpenItem={open} onMoveItem={vi.fn()} />);
    const button = screen.getByRole('button', { name: /^Field operation: North Field Mobilisation$/i });

    fireEvent.pointerDown(button, { button: 0, pointerId: 11, clientX: 200, clientY: 626 });
    fireEvent.pointerUp(button, { pointerId: 11, clientX: 200, clientY: 626 });
    fireEvent.click(button);

    expect(open).toHaveBeenCalledWith(item, expect.any(Object));
  });

  it('stages talk, reminder, deadline, and milestone cards without participant avatars', () => {
    const today = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(today);
    const names = ['Submit Permit Pack', 'Pre-job Safety Talk', 'Insurance Certificate Due', 'Mobilisation Gate Ready'];
    const staged = items.filter(item => names.includes(item.title));
    const attendeePeople = Object.fromEntries(staged.map(item => [item.id, calendarStagingPeople(item).map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))]));
    render(<TimeGridView days={[today, addDays(today, 1), addDays(today, 2), addDays(today, 4)]} items={staged} attendeePeople={attendeePeople} onOpenItem={vi.fn()} />);

    expect(cardShell(screen.getByRole('button', { name: /Submit Permit Pack/i })).className).not.toMatch(/backdrop-/);

    expect(cardShell(screen.getByRole('button', { name: /Pre-job Safety Talk/i })).getAttribute('data-card-size')).toBe('medium');
    expect(cardShell(screen.getByRole('button', { name: /Pre-job Safety Talk/i })).classList.contains('tone-navy')).toBe(true);
    for (const name of ['Submit Permit Pack', 'Pre-job Safety Talk', 'Insurance Certificate Due', 'Mobilisation Gate Ready']) {
      const card = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(cardShell(card).getAttribute('data-card-size')).toBe('medium');
      expect(card.querySelector('.cal-tg-event-time')).toBeTruthy();
      expect(cardShell(card).style.height).toBe('58px');
    }
    for (const name of names) expect(screen.getByRole('button', { name: new RegExp(name, 'i') }).querySelector('.ui-avatar-group')).toBeNull();
  });
});
