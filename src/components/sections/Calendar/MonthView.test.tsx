import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { CalendarItemDTO } from '@api/calendar';
import { AgendaView } from './AgendaView';
import { MonthView } from './MonthView';

function item(id: string, title: string, startsOn = '2026-07-08'): CalendarItemDTO {
  return {
    id,
    type: 'task',
    kind: 'task',
    categoryId: 'category-general',
    categoryKey: 'general',
    categoryName: 'General',
    categoryIcon: 'CalendarDays',
    availability: null,
    origin: 'calendar',
    title,
    notes: 'Supporting detail',
    colorKey: null,
    customColor: null,
    locationLabel: null,
    allDay: true,
    startsOn,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    status: 'not_started',
    priority: 'medium',
    ownerUserId: 'user-1',
    ownerName: 'Asha Singh',
    assigneeUserId: 'user-1',
    assigneeName: 'Asha Singh',
    departmentId: null,
    departmentName: null,
    attendeeCount: 0,
    visibility: 'team',
    sourceModule: null,
    sourceRef: null,
    sourceRoute: null,
    sourceLabel: null,
    sourceDepartment: 'calendar',
    sourceDepartmentLabel: 'Calendar',
    recurrenceSeriesId: null,
    recurrenceRule: null,
    occurrenceDate: null,
    editable: true,
    completable: true,
    assignable: false,
    cancelable: true,
    drillThrough: false,
  };
}

describe('MonthView', () => {
  it('renders all six calendar rows so late dates in the month remain reachable', () => {
    const { container } = render(
      <MonthView
        month={new Date(2026, 7, 1)}
        items={[]}
        selectedKey="2026-08-01"
        loading={false}
        onSelectDay={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );

    const days = container.querySelectorAll('.cal-month-grid > .cal-day');
    expect(days).toHaveLength(42);
    expect(screen.getByRole('button', { name: /Monday 31 August/ })).toBeTruthy();
  });

  it('uses a full event card when a day has exactly one item', () => {
    const onlyItem = item('only', 'Monthly payroll cutoff');
    render(
      <MonthView
        month={new Date(2026, 6, 1)}
        items={[onlyItem]}
        selectedKey="2026-07-08"
        loading={false}
        onSelectDay={() => undefined}
        onOpenItem={() => undefined}
      />,
    );

    const event = screen.getByRole('button', { name: /Monthly payroll cutoff/ });
    expect(event.classList.contains('is-full')).toBe(true);
    expect(screen.getByText('Supporting detail')).toBeTruthy();
    expect(screen.getAllByText(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/).slice(0, 7).map(node => node.textContent))
      .toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('keeps multiple items compact and opens the selected item', () => {
    const open = vi.fn();
    const first = item('first', 'First task');
    const second = item('second', 'Second task');
    render(
      <MonthView
        month={new Date(2026, 6, 1)}
        items={[first, second]}
        selectedKey="2026-07-08"
        loading={false}
        onSelectDay={() => undefined}
        onOpenItem={open}
      />,
    );

    const event = screen.getByRole('button', { name: /First task/ });
    expect(event.classList.contains('is-full')).toBe(false);
    fireEvent.click(event);
    expect(open).toHaveBeenCalledWith(first);
  });

  it('updates the month card palette immediately when an editor draft changes', () => {
    const amber = { ...item('palette', 'Palette preview'), colorKey: 'amber' as const };
    const view = render(<MonthView month={new Date(2026, 6, 1)} items={[amber]} selectedKey="2026-07-08" loading={false} onSelectDay={vi.fn()} onOpenItem={vi.fn()} />);
    const card = screen.getByRole('button', { name: /Palette preview/ });
    expect(card.classList.contains('tone-amber')).toBe(true);

    view.rerender(<MonthView month={new Date(2026, 6, 1)} items={[{ ...amber, colorKey: 'purple' }]} selectedKey="2026-07-08" loading={false} onSelectDay={vi.fn()} onOpenItem={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Palette preview/ }).classList.contains('tone-purple')).toBe(true);
  });

  it('shows a multi-day item only once on its start day', () => {
    const multiDay = { ...item('multi', 'Two-day shutdown', '2026-07-08'), endsOn: '2026-07-09' };
    render(<MonthView month={new Date(2026, 6, 1)} items={[multiDay]} selectedKey="2026-07-08" loading={false} onSelectDay={vi.fn()} onOpenItem={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: /Two-day shutdown/ })).toHaveLength(1);
  });

  it('can present a five-day workweek without compressing weekend columns', () => {
    const { container } = render(<MonthView month={new Date(2026, 7, 1)} items={[]} selectedKey="2026-08-03" loading={false} showWeekends={false} onSelectDay={vi.fn()} onOpenItem={vi.fn()} />);

    expect(container.querySelector('.cal-month')?.classList.contains('is-workweek')).toBe(true);
    expect(container.querySelectorAll('.cal-weekdays > div')).toHaveLength(5);
    expect(container.querySelectorAll('.cal-month-grid > .cal-day')).toHaveLength(30);
    expect(container.querySelector('.cal-weekdays')?.textContent).toBe('MonTueWedThuFri');
  });

  it('uses the configured Month card capacity before showing overflow', () => {
    const items = ['One', 'Two', 'Three', 'Four'].map((title, index) => item(`${index}`, title));
    const { container } = render(<MonthView month={new Date(2026, 6, 1)} items={items} selectedKey="2026-07-08" loading={false} eventLimit={2} onSelectDay={vi.fn()} onOpenItem={vi.fn()} />);

    expect(container.querySelectorAll('.cal-event')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '+2 more' })).toBeTruthy();
  });
});

describe('AgendaView', () => {
  it('renders a compact chronological list and opens an entry', () => {
    const open = vi.fn();
    const later = item('later', 'Later task', '2026-07-09');
    const first = item('first', 'First task', '2026-07-08');
    render(<AgendaView items={[later, first]} loading={false} onOpenItem={open} />);

    expect(screen.getByLabelText('Calendar schedule')).toBeTruthy();
    expect(screen.getByText('Schedule')).toBeTruthy();
    const rows = screen.getAllByRole('button');
    expect(rows.map(row => row.textContent).join('|')).toMatch(/First task.*Later task/);
    fireEvent.click(screen.getByRole('button', { name: /First task/ }));
    expect(open).toHaveBeenCalledWith(first);
  });
});
