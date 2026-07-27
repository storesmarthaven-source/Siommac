import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { vi } from 'vitest';
import type { CalendarItemDTO } from '@api/calendar';
import { CalendarItemDialog } from './CalendarItemDialog';

const mocks = vi.hoisted<{
  detail: { data: { item: CalendarItemDTO; attendees: { userId: string; responseStatus: 'invited'; respondedAt: null }[] } | undefined };
  reminderData: number[];
  setReminders: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
}>(() => ({
  detail: { data: undefined },
  reminderData: [15] as number[],
  setReminders: vi.fn(),
  respond: vi.fn(),
}));

vi.mock('@api/calendar', async importOriginal => {
  const original = await importOriginal<typeof import('@api/calendar')>();
  const idle = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    ...original,
    useCalendarItem: () => mocks.detail,
    useCalendarReminders: () => ({ data: mocks.reminderData, isLoading: false }),
    useSetCalendarReminders: () => ({ isPending: false, mutateAsync: mocks.setReminders }),
    useRespondToCalendarActivity: () => ({ isPending: false, mutateAsync: mocks.respond }),
    useUpdateEntry: idle,
    useTaskStatus: idle,
    useCancelEntry: idle,
  };
});

vi.mock('@store/session', () => ({
  useSessionStore: (selector: (state: { userId: string }) => unknown) => selector({ userId: 'attendee-1' }),
}));

vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));

function activity(): CalendarItemDTO {
  return {
    id: 'activity-1',
    type: 'activity',
    origin: 'calendar',
    title: 'Operations briefing',
    notes: null,
    allDay: false,
    startsOn: null,
    endsOn: null,
    startsAt: '2026-07-22T13:00:00-04:00',
    endsAt: '2026-07-22T14:00:00-04:00',
    status: null,
    priority: null,
    ownerUserId: 'owner-1',
    ownerName: 'Calendar Owner',
    assigneeUserId: null,
    assigneeName: null,
    departmentId: null,
    departmentName: null,
    attendeeCount: 1,
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
    editable: false,
    completable: false,
    assignable: false,
    cancelable: false,
    drillThrough: false,
  };
}

describe('CalendarItemDialog reminders and attendee responses', () => {
  beforeEach(() => {
    const item = activity();
    mocks.detail = {
      data: {
        item,
        attendees: [{ userId: 'attendee-1', responseStatus: 'invited', respondedAt: null }],
      },
    };
    mocks.reminderData = [15];
    mocks.setReminders.mockReset().mockResolvedValue({ success: true });
    mocks.respond.mockReset().mockResolvedValue({ success: true });
  });

  it('saves selected reminder offsets and records an invitation response', async () => {
    const item = activity();
    render(<CalendarItemDialog item={item} onClose={vi.fn()} />);

    expect(screen.getByText('My reminders')).toBeTruthy();
    expect(screen.getByText('Current: invited')).toBeTruthy();
    expect(screen.getByRole('button', { name: '15 min' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '1 hour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.setReminders).toHaveBeenCalledWith({
      id: 'activity-1',
      offsetMinutes: [15, 60],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'accepted' }));
    await waitFor(() => expect(mocks.respond).toHaveBeenCalledWith({
      id: 'activity-1',
      responseStatus: 'accepted',
    }));
  });
});
