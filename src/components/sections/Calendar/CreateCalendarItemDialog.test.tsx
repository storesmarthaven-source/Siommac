import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@store/session';
import { localTimestamp } from '@lib/calendar/date';

const createActivity = vi.hoisted(() => vi.fn());
const createTask = vi.hoisted(() => vi.fn());
const createMeeting = vi.hoisted(() => vi.fn());

vi.mock('@lib/permissions', () => ({ can: () => true }));
vi.mock('@api/calendar', () => ({
  useCreateActivity: () => ({ mutateAsync: createActivity, isPending: false }),
  useCreateTask: () => ({ mutateAsync: createTask, isPending: false }),
  useCalendarDepartments: () => ({ data: [{ id: 'dept-1', name: 'Operations' }], isLoading: false }),
  useCalendarCategories: () => ({ data: [{ id: '00000000-0000-4000-8000-000000000099', key: 'operations', name: 'Operations', iconName: 'BriefcaseBusiness', scope: 'system', sortOrder: 1, active: true, canManage: false }], isLoading: false, isError: false }),
}));
vi.mock('@api/meetings', () => ({ useCreateMeeting: () => ({ mutateAsync: createMeeting, isPending: false }) }));
vi.mock('@api/communications', () => ({
  useMessageRecipients: () => ({
    data: [{ userId: 'person-2', displayName: 'Marcus Allen', username: 'marcus', role: 'Supervisor', department: 'Operations', profileImage: null }],
    isFetching: false,
    isError: false,
  }),
}));

import { CreateCalendarItemDialog } from './CreateCalendarItemDialog';

const CALENDARS = [{ id: '00000000-0000-4000-8000-000000000001', name: 'My Calendar', description: null, ownerUserId: 'user-1', ownerName: 'User', visibility: 'team' as const, departmentId: 'dept-1', departmentName: 'Operations', colorKey: 'blue' as const, customColor: null, isDefault: true, status: 'active' as const, canEdit: true, canArchive: false, provider: null, readOnly: false }];
const CATEGORIES = [{ id: '00000000-0000-4000-8000-000000000099', key: 'operations', name: 'Operations', iconName: 'BriefcaseBusiness', scope: 'system' as const, sortOrder: 1, active: true, canManage: false }];

describe('CreateCalendarItemDialog', () => {
  beforeEach(() => {
    createActivity.mockReset(); createTask.mockReset();
    createActivity.mockResolvedValue({ success: true, id: 'event-1' });
    createTask.mockResolvedValue({ success: true, id: 'task-1' });
    useSessionStore.setState({ isAuthenticated: true, userId: 'person-1', departmentId: 'dept-1' });
  });

  it('uses the canonical Calendar form and sends selected invitations atomically with the event', async () => {
    const close = vi.fn();
    const created = vi.fn();
    render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" onClose={close} onCreated={created} />);

    expect(screen.getByRole('dialog', { name: 'Create Event' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Appearance/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recurrence & Reminders/ })).toBeNull();
    expect(screen.getByLabelText('Repeat')).toBeTruthy();
    expect(screen.getByLabelText('Reminder')).toBeTruthy();
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Operations Review' } });
    fireEvent.input(screen.getByLabelText('Location'), { target: { value: 'Training Room' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Mint' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Invitees' }));
    fireEvent.pointerDown(await screen.findByRole('option', { name: /Marcus Allen/ }));
    await screen.findByRole('button', { name: 'Remove Marcus Allen' });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(createActivity).toHaveBeenCalledTimes(1));
    expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Operations Review',
      attendeeUserIds: ['person-2'],
      visibility: 'team',
      allDay: false,
      colorKey: 'mint',
      customColor: null,
      locationLabel: 'Training Room',
    }));
    expect(created).toHaveBeenCalledWith('event-1');
    expect(close).toHaveBeenCalled();
  });

  it('switches to the task contract without accepting event invitees', async () => {
    render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" initialType="task" initialColorKey="purple" onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Review roster' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Assignee' }));
    fireEvent.pointerDown(await screen.findByRole('option', { name: /Marcus Allen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Review roster', priority: 'medium', colorKey: 'purple', assigneeUserId: 'person-2', departmentId: 'dept-1' }));
    expect(screen.queryByRole('combobox', { name: 'Invitees' })).toBeNull();
  });

  it('keeps Meeting in the same governed editor and submits the meeting contract', async () => {
    createMeeting.mockResolvedValue({ success: true, data: { id: 'meeting-1', schedule: { calendarEntryId: 'entry-1' } } });
    render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" canCreateMeeting onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Meeting' }));
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Operations meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule Meeting' }));

    await waitFor(() => expect(createMeeting).toHaveBeenCalledWith(expect.objectContaining({ title: 'Operations meeting', calendarId: CALENDARS[0]!.id })));
    expect(createActivity).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('offers Event, Meeting, and Task in the same creation drawer', () => {
    render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" canCreateMeeting onClose={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Event' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Meeting' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Task' })).toBeTruthy();
  });

  it('passes a custom card colour through the full event form', async () => {
    render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Custom event' } });
    fireEvent.input(screen.getByLabelText(/^End Date/), { target: { value: '2026-09-08' } });
    fireEvent.input(screen.getByLabelText(/^Start Time/), { target: { value: '22:00' } });
    fireEvent.input(screen.getByLabelText(/^End Time/), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom colour' }));
    fireEvent.input(screen.getByLabelText('Hex color'), { target: { value: '#357a62' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Custom event',
      startsAt: localTimestamp('2026-09-06', '22:00'),
      endsAt: localTimestamp('2026-09-08', '02:00'),
      colorKey: null,
      customColor: '#357a62',
    })));
  });

  it('keeps the preset palette on one deliberate row without the Rose option', () => {
    const { container } = render(<CreateCalendarItemDialog open calendars={CALENDARS} initialDate="2026-09-06" onClose={vi.fn()} />);

    const palette = container.querySelector('.cal-color-picker');
    expect(palette).toBeTruthy();
    expect(palette?.getAttribute('style')).toContain('--cal-color-option-count: 10');
    expect(palette?.querySelectorAll('[role="radio"]')).toHaveLength(10);
    expect(screen.queryByRole('radio', { name: 'Rose' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Custom colour' })).toBeTruthy();
  });

  it('uses the session-local adapter in staged preview without calling the live API', async () => {
    const createPreview = vi.fn(() => 'preview-entry-1');
    const created = vi.fn();
    render(<CreateCalendarItemDialog open preview calendars={CALENDARS} categoriesOverride={CATEGORIES} initialDate="2026-09-06" initialTime="13:00" initialEndTime="14:30" onPreviewCreate={createPreview} onCreated={created} onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Staged design review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(createPreview).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Staged design review',
      startsAt: localTimestamp('2026-09-06', '13:00'),
      endsAt: localTimestamp('2026-09-06', '14:30'),
    })));
    expect(created).toHaveBeenCalledWith('preview-entry-1');
    expect(createActivity).not.toHaveBeenCalled();
  });
});
