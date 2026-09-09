import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarItemDTO } from '@api/calendar';
import { CalendarItemPreview } from './CalendarItemPreview';

const ITEM: CalendarItemDTO = {
  id: 'event-1', type: 'activity', kind: 'event', categoryId: 'category-1', categoryKey: 'operations', categoryName: 'Operations', categoryIcon: 'BriefcaseBusiness', availability: 'busy',
  calendarId: 'calendar-1', calendarName: 'My Calendar',
  origin: 'calendar', title: 'Operations review', notes: 'Review priorities and confirm owners.', colorKey: 'blue', customColor: null, locationLabel: 'Conference Room',
  allDay: false, startsOn: null, endsOn: null, startsAt: '2026-09-08T09:00:00-04:00', endsAt: '2026-09-08T10:00:00-04:00', status: null, priority: null,
  ownerUserId: 'user-1', ownerName: 'Asha Singh', assigneeUserId: null, assigneeName: null, departmentId: 'department-1', departmentName: 'Operations', attendeeCount: 2,
  visibility: 'team', sourceModule: null, sourceRef: null, sourceRoute: null, sourceLabel: null, sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar',
  recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: true, completable: false, assignable: false, cancelable: true, drillThrough: false,
};

function anchor(): HTMLButtonElement {
  const value = document.createElement('button');
  document.body.append(value);
  return value;
}

describe('CalendarItemPreview', () => {
  it('keeps card selection compact with event details and reminder controls', () => {
    const edit = vi.fn();
    const duplicate = vi.fn();
    const remove = vi.fn();
    const reminder = vi.fn();
    const close = vi.fn();
    render(<CalendarItemPreview item={ITEM} anchor={anchor()} people={[{ id: 'user-2', name: 'Marcus Allen' }]} reminderLabel="15 min before" onEdit={edit} onDuplicate={duplicate} onDelete={remove} onSetReminder={reminder} onClose={close} />);

    expect(screen.getByRole('dialog', { name: 'Operations review' })).toBeTruthy();
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(screen.getByText('Conference Room')).toBeTruthy();
    expect(screen.getByText('About this event')).toBeTruthy();
    expect(screen.getByText('15 min before')).toBeTruthy();
    expect(screen.getByText('Reminder').parentElement?.textContent).toBe('Reminder15 min before');
    expect(screen.queryByLabelText(/^Title/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Duplicate Operations review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Operations review' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Operations review' }));
    expect(duplicate).toHaveBeenCalledWith(ITEM);
    expect(close).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(close).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledWith(ITEM);
  });

  it('uses meeting copy and opens a linked source without showing legacy details', () => {
    const openSource = vi.fn();
    const close = vi.fn();
    const meeting = { ...ITEM, editable: false, kind: 'meeting' as const, sourceModule: 'meetings', sourceRoute: 'meetings' };
    render(<CalendarItemPreview item={meeting} anchor={anchor()} agenda={['Review blockers', 'Confirm owners']} onOpenSource={openSource} onClose={close} />);

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText('What we’ll cover')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map(entry => entry.textContent)).toEqual(['Review blockers', 'Confirm owners']);
    expect(screen.queryByText('Reminder')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View Details' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open meeting' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(openSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }));
  });

  it('does not label a non-meeting linked card as a meeting', () => {
    render(<CalendarItemPreview item={{ ...ITEM, sourceModule: 'meetings', sourceRoute: 'meetings' }} anchor={anchor()} onOpenSource={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Open source' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open meeting' })).toBeNull();
  });
});
