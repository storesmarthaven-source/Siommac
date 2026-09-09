import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@store/session';
import type { CreateCalendarCollectionRequest } from '@api/calendar';

const createCalendar = vi.hoisted(() => vi.fn<(request: CreateCalendarCollectionRequest) => Promise<{ success: boolean }>>());
const updateCalendar = vi.hoisted(() => vi.fn());
const archiveCalendar = vi.hoisted(() => vi.fn());

vi.mock('@lib/permissions', () => ({ can: () => true }));
vi.mock('@api/calendar', () => ({
  useCalendarDepartments: () => ({ data: [{ id: 'dept-1', name: 'Operations' }], isLoading: false }),
  useCreateCalendarCollection: () => ({ mutateAsync: createCalendar, isPending: false }),
  useUpdateCalendarCollection: () => ({ mutateAsync: updateCalendar, isPending: false }),
  useArchiveCalendarCollection: () => ({ mutateAsync: archiveCalendar, isPending: false }),
}));

import { CalendarCollectionDialog, CalendarCollectionEditor } from './CalendarCollectionDialog';

const CALENDAR = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Operations',
  description: 'Team schedule',
  ownerUserId: 'user-1',
  ownerName: 'User',
  visibility: 'team' as const,
  departmentId: 'dept-1',
  departmentName: 'Operations',
  colorKey: 'mint' as const,
  customColor: null,
  isDefault: false,
  status: 'active' as const,
  canEdit: true,
  canArchive: true,
  provider: null,
  readOnly: false,
};

describe('CalendarCollectionDialog', () => {
  beforeEach(() => {
    createCalendar.mockReset(); updateCalendar.mockReset(); archiveCalendar.mockReset();
    createCalendar.mockResolvedValue({ success: true, id: 'calendar-new' });
    updateCalendar.mockResolvedValue({ success: true, id: CALENDAR.id });
    archiveCalendar.mockResolvedValue({ success: true, id: CALENDAR.id });
    useSessionStore.setState({ isAuthenticated: true, userId: 'user-1', departmentId: 'dept-1' });
  });

  it('creates a named department calendar with a governed colour and default choice', async () => {
    const close = vi.fn();
    render(<CalendarCollectionDialog open onClose={close} />);

    fireEvent.input(screen.getByLabelText(/^Calendar Name/), { target: { value: 'Field Programme' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Audience' }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Department' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }));
    fireEvent.click(screen.getByLabelText('Use as my default calendar'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Calendar' }));

    await waitFor(() => expect(createCalendar).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Field Programme',
      visibility: 'team',
      departmentId: 'dept-1',
      colorKey: 'amber',
      customColor: null,
      makeDefault: true,
    })));
    expect(createCalendar.mock.calls[0]?.[0]?.idempotencyKey).toBeTruthy();
    expect(close).toHaveBeenCalled();
  });

  it('updates all settings inline and requires a second explicit action before archiving', async () => {
    const complete = vi.fn();
    render(<CalendarCollectionEditor calendar={CALENDAR} embedded onCancel={vi.fn()} onComplete={complete} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.input(screen.getByLabelText(/^Calendar Name/), { target: { value: 'Operations Plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(updateCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: CALENDAR.id, name: 'Operations Plan' })));
    expect(complete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(archiveCalendar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Archive' }));
    await waitFor(() => expect(archiveCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: CALENDAR.id })));
  });
});
