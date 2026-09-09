import { render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { CalendarManagementDialog } from './CalendarManagementDialog';

vi.mock('./CalendarManagementPanel', () => ({
  CalendarManagementPanel: () => <div>Calendar manager content</div>,
}));

describe('CalendarManagementDialog', () => {
  it('is an independent management surface without preference navigation', () => {
    render(<CalendarManagementDialog open calendars={[]} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Manage Calendars' })).toBeTruthy();
    expect(screen.getByText('Calendar manager content')).toBeTruthy();
    expect(screen.queryByText('Preferences')).toBeNull();
    expect(screen.queryByText('Calendar Settings')).toBeNull();
  });
});
