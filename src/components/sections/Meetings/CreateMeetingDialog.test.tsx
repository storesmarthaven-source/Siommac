import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@store/session';
import type { MeetingCreateRequest } from '../../../../types/meetings';

const mutateAsync = vi.hoisted(() => vi.fn<(request: MeetingCreateRequest) => Promise<{ success: boolean; data?: { id: string } }>>());
const reset = vi.hoisted(() => vi.fn());

vi.mock('@api/communications', () => ({
  useMessageRecipients: () => ({ data: [], isFetching: false, isError: false }),
}));

vi.mock('@api/meetings', () => ({
  useCreateMeeting: () => ({ mutateAsync, reset, isPending: false }),
}));

vi.mock('@api/calendar', () => ({
  useCalendarCollections: () => ({ data: [{ id: '00000000-0000-4000-8000-000000000001', name: 'My Calendar', isDefault: true, readOnly: false }], isLoading: false }),
  useCalendarCategories: () => ({ data: [{ id: '00000000-0000-4000-8000-000000000099', key: 'general', name: 'General' }], isLoading: false }),
  useCalendarDepartments: () => ({ data: [{ id: '00000000-0000-4000-8000-000000000055', name: 'Operations' }], isLoading: false }),
}));

import { CreateMeetingDialog } from './CreateMeetingDialog';

describe('CreateMeetingDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    reset.mockReset();
    mutateAsync.mockResolvedValue({ success: true, data: { id: 'meeting-created' } });
    useSessionStore.setState({ isAuthenticated: true, userId: 'organizer-1', departmentId: '00000000-0000-4000-8000-000000000055' });
  });

  it('uses the canonical dialog and shared person picker', () => {
    render(<CreateMeetingDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Schedule a Meeting' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Add Participant' })).toBeTruthy();
    expect(screen.getByText('One audited action creates the Calendar event, meeting record and Messages conversation.')).toBeTruthy();
    expect(screen.getByText('AI Meeting Capture')).toBeTruthy();
    expect(screen.getByText(/Processing is not connected yet/)).toBeTruthy();
  });

  it('submits one command that keeps Calendar, Meetings and Messages aligned', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CreateMeetingDialog open onClose={onClose} onCreated={onCreated} />);

    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Operations Review' } });
    fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Review open actions.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Topic' }));
    fireEvent.input(screen.getByLabelText(/Topic 1/), { target: { value: 'Safety readiness' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule Meeting' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const request = mutateAsync.mock.calls[0]?.[0];
    expect(request?.title).toBe('Operations Review');
    expect(request?.description).toBe('Review open actions.');
    expect(request?.participants).toEqual([]);
    expect(request?.agendaItems).toEqual([{ title: 'Safety readiness', plannedMinutes: 15 }]);
    expect(request?.provider).toBe('none');
    expect(request?.schedule).toMatchObject({ allDay: false, visibility: 'team' });
    expect(onCreated).toHaveBeenCalledWith('meeting-created');
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks an invalid time range before calling the API', () => {
    render(<CreateMeetingDialog open onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Invalid Schedule' } });
    fireEvent.input(screen.getByLabelText(/^End Time/), { target: { value: '08:00' } });

    const submit = screen.getByRole('button', { name: 'Schedule Meeting' });
    expect(screen.getByText('End time must be after the start time.')).toBeTruthy();
    expect(submit.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(submit);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
