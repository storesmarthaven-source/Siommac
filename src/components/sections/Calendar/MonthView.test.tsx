import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { CalendarItemDTO } from '@api/calendar';
import { AgendaView } from './AgendaView';
import { MonthView } from './MonthView';

function item(id: string, title: string, startsOn = '2026-07-08'): CalendarItemDTO {
  return {
    id,
    type: 'task',
    origin: 'calendar',
    title,
    notes: 'Supporting detail',
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
});

describe('AgendaView', () => {
  it('renders a compact chronological list and opens an entry', () => {
    const open = vi.fn();
    const later = item('later', 'Later task', '2026-07-09');
    const first = item('first', 'First task', '2026-07-08');
    render(<AgendaView items={[later, first]} loading={false} onOpenItem={open} />);

    const rows = screen.getAllByRole('button');
    expect(rows.map(row => row.textContent).join('|')).toMatch(/First task.*Later task/);
    fireEvent.click(screen.getByRole('button', { name: /First task/ }));
    expect(open).toHaveBeenCalledWith(first);
  });
});
