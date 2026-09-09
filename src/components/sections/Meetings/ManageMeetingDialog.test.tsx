import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingStagingScenarios } from './meetingStaging';
import type { MeetingUpdateRequest } from '../../../../types/meetings';

const commands = vi.hoisted(() => ({
  update: vi.fn<(request: MeetingUpdateRequest) => Promise<{ success: boolean }>>(),
  cancel: vi.fn(),
  archive: vi.fn(),
  invite: vi.fn(),
  remove: vi.fn(),
  agenda: vi.fn(),
}));

const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({ mutateAsync, isPending: false });

vi.mock('@api/communications', () => ({
  useMessageRecipients: () => ({ data: [], isFetching: false, isError: false }),
}));

vi.mock('@api/meetings', () => ({
  useUpdateMeeting: () => mutation(commands.update),
  useCancelMeeting: () => mutation(commands.cancel),
  useArchiveMeeting: () => mutation(commands.archive),
  useInviteMeetingParticipants: () => mutation(commands.invite),
  useRemoveMeetingParticipant: () => mutation(commands.remove),
  useUpdateMeetingAgenda: () => mutation(commands.agenda),
}));

import { ManageMeetingDialog } from './ManageMeetingDialog';

const meetingScenario = meetingStagingScenarios(new Date('2026-09-06T12:00:00.000Z')).find(value => value.kind === 'completed_recording');
if (!meetingScenario?.detail) throw new Error('Completed meeting staging scenario is required.');
const meeting = meetingScenario.detail;

describe('ManageMeetingDialog', () => {
  beforeEach(() => {
    Object.values(commands).forEach(command => {
      command.mockReset();
      command.mockResolvedValue({ success: true });
    });
  });

  it('updates meeting details through the lifecycle endpoint', async () => {
    const onClose = vi.fn();
    render(<ManageMeetingDialog action="edit" meeting={meeting} onClose={onClose} />);

    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Updated Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(commands.update).toHaveBeenCalledTimes(1));
    const request = commands.update.mock.calls[0]?.[0];
    expect(request?.meetingId).toBe(meeting.id);
    expect(request?.expectedVersion).toBe(meeting.version);
    expect(request?.patch.title).toBe('Updated Review');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows current participants and protects the organiser from removal', () => {
    render(<ManageMeetingDialog action="participants" meeting={meeting} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Manage Participants' })).toBeTruthy();
    expect(screen.getByText('Organizer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Remove ${meeting.organizer.displayName}` })).toBeNull();
    const attendee = meeting.participants[1];
    if (!attendee) throw new Error('Staged attendee is required.');
    expect(screen.getByRole('button', { name: `Remove ${attendee.person.displayName}` })).toBeTruthy();
  });

  it('saves agenda topics through the agenda command', async () => {
    render(<ManageMeetingDialog action="agenda" meeting={meeting} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Topic' }));
    fireEvent.input(screen.getAllByLabelText(/Topic/).at(-1)!, { target: { value: 'Close open actions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agenda' }));
    await waitFor(() => expect(commands.agenda).toHaveBeenCalledTimes(1));
    expect(commands.agenda.mock.calls[0]?.[0]).toMatchObject({ meetingId: meeting.id, expectedVersion: meeting.version });
  });
});
