import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { vi } from 'vitest';
import type { CalendarItemDTO } from '@api/calendar';
import { CalendarItemActionDialog } from './CalendarItemActionDialog';

const mocks = vi.hoisted(() => ({
  reminderData: [15] as number[],
  setReminders: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@api/calendar', async importOriginal => ({
  ...await importOriginal<typeof import('@api/calendar')>(),
  useCalendarReminders: () => ({ data: mocks.reminderData, isLoading: false }),
  useSetCalendarReminders: () => ({ isPending: false, mutateAsync: mocks.setReminders }),
  useCancelEntry: () => ({ isPending: false, mutateAsync: mocks.cancel }),
}));

function item(overrides: Partial<CalendarItemDTO> = {}): CalendarItemDTO {
  return {
    id: 'activity-1', type: 'activity', kind: 'event', categoryId: 'category-general', categoryKey: 'general', categoryName: 'General', categoryIcon: 'CalendarDays', availability: 'busy', origin: 'calendar', title: 'Operations briefing', notes: null,
    colorKey: 'blue', customColor: null, locationLabel: null, allDay: false, startsOn: null, endsOn: null,
    startsAt: '2026-09-07T13:00:00-04:00', endsAt: '2026-09-07T14:00:00-04:00',
    status: null, priority: null, ownerUserId: 'owner-1', ownerName: 'Owner', assigneeUserId: null,
    assigneeName: null, departmentId: null, departmentName: null, attendeeCount: 0, visibility: 'team',
    sourceModule: null, sourceRef: null, sourceRoute: null, sourceLabel: null, sourceDepartment: 'calendar',
    sourceDepartmentLabel: 'Calendar', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null,
    editable: true, completable: false, assignable: false, cancelable: true, drillThrough: false,
    ...overrides,
  };
}

describe('CalendarItemActionDialog', () => {
  beforeEach(() => {
    mocks.reminderData = [15];
    mocks.setReminders.mockReset().mockResolvedValue({ success: true });
    mocks.cancel.mockReset().mockResolvedValue({ success: true });
  });

  it('saves selected reminder offsets through the calendar reminder API', async () => {
    const close = vi.fn();
    render(<CalendarItemActionDialog item={item()} action="reminder" onClose={close} />);

    fireEvent.click(screen.getByRole('button', { name: '1 hour before' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));

    await waitFor(() => expect(mocks.setReminders).toHaveBeenCalledWith({ id: 'activity-1', offsetMinutes: [15, 60] }));
    expect(close).toHaveBeenCalled();
  });

  it('requires confirmation and sends the selected recurrence scope to cancellation', async () => {
    const close = vi.fn();
    const recurring = item({ id: 'activity-1::2026-09-07', recurrenceRule: 'FREQ=WEEKLY', occurrenceDate: '2026-09-07' });
    render(<CalendarItemActionDialog item={recurring} action="delete" onClose={close} />);

    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entire series' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ id: recurring.id, scope: 'series' }));
    expect(close).toHaveBeenCalled();
  });

  it('confirms staged deletion through the SweetAlert2 surface without calling the live cancellation API', async () => {
    const close = vi.fn();
    const remove = vi.fn();
    const staged = item({ id: 'calendar-demo-1', cancelable: false });
    render(<CalendarItemActionDialog item={staged} action="delete" preview onPreviewDelete={remove} onClose={close} />);

    expect(screen.getByRole('heading', { name: 'Delete “Operations briefing”?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(staged));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
