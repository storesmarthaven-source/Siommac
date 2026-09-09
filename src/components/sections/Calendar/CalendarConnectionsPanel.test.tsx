import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startOAuth = vi.hoisted(() => vi.fn());
const connectCredentials = vi.hoisted(() => vi.fn());
const toggleCalendar = vi.hoisted(() => vi.fn());
const syncConnection = vi.hoisted(() => vi.fn());
const disconnectConnection = vi.hoisted(() => vi.fn());

vi.mock('@api/calendar', () => ({
  useCalendarConnections: () => ({
    data: {
      success: true,
      providers: [
        { provider: 'google', configured: true, connectionMethod: 'oauth', configurationMessage: null },
        { provider: 'microsoft', configured: true, connectionMethod: 'oauth', configurationMessage: null },
        { provider: 'apple', configured: true, connectionMethod: 'credentials', configurationMessage: null },
        { provider: 'exchange', configured: false, connectionMethod: 'credentials', configurationMessage: 'Exchange is not configured.' },
      ],
      connections: [{
        id: 'connection-1', provider: 'google', displayName: 'Pat James', accountEmail: 'pat@example.com', status: 'active', syncDirection: 'import', lastSyncedAt: null,
        calendars: [{ id: 'external-1', providerCalendarId: 'primary', name: 'Personal', description: null, providerColor: '#4285f4', timeZone: 'America/Port_of_Spain', accessRole: 'owner', isPrimary: true, enabled: true, collectionId: 'calendar-1' }],
        canSync: true, canDisconnect: true,
      }],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useStartCalendarOAuth: () => ({ mutateAsync: startOAuth, isPending: false }),
  useConnectCalendarCredentials: () => ({ mutateAsync: connectCredentials, isPending: false }),
  useToggleExternalCalendar: () => ({ mutateAsync: toggleCalendar, isPending: false }),
  useSyncCalendarConnection: () => ({ mutateAsync: syncConnection, isPending: false }),
  useDisconnectCalendarConnection: () => ({ mutateAsync: disconnectConnection, isPending: false }),
}));

import { CalendarConnectionsPanel } from './CalendarConnectionsPanel';

describe('CalendarConnectionsPanel', () => {
  beforeEach(() => {
    startOAuth.mockReset(); connectCredentials.mockReset(); toggleCalendar.mockReset(); syncConnection.mockReset(); disconnectConnection.mockReset();
    startOAuth.mockResolvedValue({ success: false, message: 'OAuth unavailable in this test.' });
    connectCredentials.mockResolvedValue({ success: true });
    toggleCalendar.mockResolvedValue({ success: true });
    syncConnection.mockResolvedValue({ success: true });
    disconnectConnection.mockResolvedValue({ success: true });
  });

  it('manages a connected provider and its imported calendars', async () => {
    render(<CalendarConnectionsPanel />);
    expect(screen.getByText('Google Calendar')).toBeTruthy();
    expect(screen.getByText('pat@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    const calendarSwitch = screen.getByRole('switch', { name: 'Stop importing Personal' });
    fireEvent.click(calendarSwitch);
    await waitFor(() => expect(toggleCalendar).toHaveBeenCalledWith(expect.objectContaining({ externalCalendarId: 'external-1', enabled: false })));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncConnection).toHaveBeenCalledWith({ connectionId: 'connection-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnectConnection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    await waitFor(() => expect(disconnectConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'connection-1' })));
  });

  it('shows the governed Apple credential form and keeps unavailable providers disabled', async () => {
    const { container } = render(<CalendarConnectionsPanel />);
    expect(container.querySelector('.cal-provider-mark.is-apple svg')).toBeTruthy();
    expect(container.querySelector('.cal-provider-mark.is-exchange svg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Apple Calendar' }));
    fireEvent.input(screen.getByLabelText(/^Apple ID/), { target: { value: 'pat@icloud.com' } });
    fireEvent.input(screen.getByLabelText(/^Password/), { target: { value: 'abcd-efgh-ijkl-mnop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    await waitFor(() => expect(connectCredentials).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apple', username: 'pat@icloud.com', password: 'abcd-efgh-ijkl-mnop' })));
    expect((screen.getByRole('button', { name: 'Connect Exchange Server Calendars' })).disabled).toBe(true);
  });
});
