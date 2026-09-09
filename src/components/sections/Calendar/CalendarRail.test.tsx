import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';

const mockedReminderOffsets = [15];

vi.mock('@api/calendar', async importOriginal => ({
  ...await importOriginal<typeof import('@api/calendar')>(),
  useCalendarItem: () => ({ data: { attendees: [] }, isLoading: false }),
  useCalendarReminders: () => ({ data: mockedReminderOffsets, isLoading: false }),
  useRespondToCalendarActivity: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetCalendarReminders: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@api/communications', () => ({
  useMessageRecipients: () => ({ data: [], isFetching: false, isError: false }),
}));
import { calendarStagingItems } from './calendarStaging';
import { CalendarRail } from './CalendarRail';

describe('CalendarRail', () => {
  it('presents the selected schedule in an information-only drawer', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const active = items.find(item => item.type === 'activity' && item.sourceModule !== 'meetings')!;
    render(<CalendarRail
      focusedItem={active}
      onCollapse={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: active.title })).toBeTruthy();
    expect(screen.getByText(/Scheduled on/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Manage schedule' })).toBeNull();
  });

  it('marks staged content as read-only and disables response mutations', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const active = items.find(item => item.sourceModule === 'meetings')!;
    render(<CalendarRail
      focusedItem={active}
      readOnly
      onCollapse={vi.fn()}
    />);

    expect(screen.getByText('Last updated')).toBeTruthy();
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join meeting room' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Accept' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText("You haven't responded to this invite yet")).toBeTruthy();
    expect(screen.getByLabelText('Meeting comments are available in the meeting workspace')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Manage schedule' })).toBeNull();
  });

  it('collapses the detail rail from its header control', () => {
    const collapse = vi.fn();
    render(<CalendarRail focusedItem={null} onCollapse={collapse} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close schedule details' }));
    expect(collapse).toHaveBeenCalledTimes(1);
  });
});
