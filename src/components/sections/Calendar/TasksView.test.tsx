import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarItemDTO } from '@api/calendar';
import { TasksView } from './TasksView';

const task = (id: string, title: string, date: string, status: CalendarItemDTO['status'] = 'not_started'): CalendarItemDTO => ({
  id, origin: 'calendar', type: 'task', kind: 'task', title, notes: null, allDay: true, startsOn: date, endsOn: date,
  startsAt: null, endsAt: null, ownerUserId: 'user-1', assigneeUserId: 'user-1', ownerName: 'Avery Lewis', assigneeName: 'Avery Lewis',
  visibility: 'team', status, priority: 'medium', recurrenceRule: null, recurrenceSeriesId: null, sourceModule: 'calendar', sourceRef: null,
  sourceLabel: null, sourceRoute: null, cancelable: true, colorKey: 'blue', customColor: null, locationLabel: null,
} as CalendarItemDTO);

describe('TasksView', () => {
  it('shows only tasks in actionable groups and opens the selected task', () => {
    const open = vi.fn();
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const item = task('task-1', 'Review permit pack', key);
    const event = { ...item, id: 'event-1', type: 'activity' as const, kind: 'event' as const, title: 'Briefing' };
    render(<TasksView items={[item, event]} loading={false} onOpenItem={open} />);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.queryByText('Briefing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Review permit pack/ }));
    expect(open).toHaveBeenCalledWith(item);
  });
});
