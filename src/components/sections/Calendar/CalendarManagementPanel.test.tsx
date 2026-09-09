import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import type { CalendarCollectionDTO } from '@api/calendar';
import { CalendarManagementPanel } from './CalendarManagementPanel';

vi.mock('./CalendarConnectionsPanel', () => ({
  CalendarConnectionsPanel: ({ enabled }: { enabled: boolean }) => <div data-testid="connections-panel">{enabled ? 'Provider accounts' : 'Provider accounts unavailable'}</div>,
  CalendarProviderMark: ({ provider }: { provider: string }) => <span data-testid={`${provider}-mark`}>{provider}</span>,
}));
vi.mock('./CalendarCollectionDialog', () => ({
  CalendarCollectionEditor: ({ calendar }: { calendar: CalendarCollectionDTO }) => <div data-testid="inline-calendar-editor">{calendar.name} calendar settings</div>,
}));

const CALENDARS: CalendarCollectionDTO[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'My Calendar', description: null, ownerUserId: 'user-1', ownerName: 'User', visibility: 'personal', departmentId: null, departmentName: null, colorKey: 'blue', customColor: null, isDefault: true, status: 'active', canEdit: true, canArchive: false, provider: null, readOnly: false },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Work', description: null, ownerUserId: 'user-1', ownerName: 'User', visibility: 'personal', departmentId: null, departmentName: null, colorKey: 'mint', customColor: null, isDefault: false, status: 'active', canEdit: false, canArchive: false, provider: 'google', readOnly: true },
];

describe('CalendarManagementPanel', () => {
  it('orders SIOMAC creation and native calendars before external providers', () => {
    const create = vi.fn();
    const { container } = render(<CalendarManagementPanel calendars={CALENDARS} onCreateCalendar={create} />);

    expect(screen.getByRole('heading', { name: 'Connect an External Calendar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Connect your calendars.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'SIOMAC Calendars' })).toBeTruthy();
    expect(screen.getByText('My Calendar')).toBeTruthy();
    expect(screen.getByText('My Calendar').closest('.cal-manage-calendar-row')?.querySelector('.cal-manage-calendar-icon svg')).toBeTruthy();
    expect(screen.queryByText('Work')).toBeNull();
    expect(screen.getByTestId('connections-panel').textContent).toContain('Provider accounts');
    const managerSections = container.querySelector('.cal-manage-panel')?.children;
    expect(managerSections?.[0]?.classList.contains('cal-manage-intro')).toBe(true);
    expect(managerSections?.[1]?.classList.contains('cal-manage-directory')).toBe(true);
    expect(managerSections?.[1]?.children[0]?.classList.contains('cal-manage-native')).toBe(true);
    expect(managerSections?.[1]?.children[0]?.children[0]?.classList.contains('cal-manage-feature-surface')).toBe(true);
    expect(managerSections?.[1]?.children[0]?.children[1]?.classList.contains('cal-manage-library')).toBe(true);
    expect(managerSections?.[1]?.children[1]?.classList.contains('cal-manage-connect')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Create a SIOMAC Calendar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit My Calendar' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('inline-calendar-editor').textContent).toBe('My Calendar calendar settings');
    expect(screen.queryByRole('dialog', { name: 'Calendar Settings' })).toBeNull();
  });
});
