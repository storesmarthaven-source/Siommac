import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { MeetingsOverview } from './MeetingsOverview';
import { meetingStagingScenarios } from './meetingStaging';

describe('MeetingsOverview', () => {
  const items = meetingStagingScenarios().map(scenario => scenario.listItem);

  it('renders the module landing page before a meeting is opened', () => {
    render(<MeetingsOverview items={items} staged onOpen={() => undefined} />);

    expect(screen.getByText('New meeting')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Online meeting' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'In-person meeting' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Upload recording' })).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Weekly Operations Briefing')).toBeTruthy();
    expect(screen.getByText('Staged capture UI')).toBeTruthy();
    expect(screen.queryByText('Meeting Details')).toBeNull();
  });

  it('opens the selected meeting from the overview', () => {
    const onOpen = vi.fn();
    render(<MeetingsOverview items={items} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Weekly Operations Briefing' }));
    expect(onOpen).toHaveBeenCalledWith(items[0]?.id);
  });

  it('expands from the two-card recent view to the full meeting collection', () => {
    render(<MeetingsOverview items={items} onOpen={() => undefined} />);

    expect(screen.queryByText('Payroll Cut-off Check-in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to meetings' }));

    expect(screen.getByText('Payroll Cut-off Check-in')).toBeTruthy();
  });

  it('opens the real scheduler from the new-meeting launcher', () => {
    const onCreate = vi.fn();
    render(<MeetingsOverview items={items} onOpen={() => undefined} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('shows the capture fields without enabling an unconnected capture flow', () => {
    render(<MeetingsOverview items={items} onOpen={() => undefined} />);

    expect(screen.getByLabelText('Meeting URL preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start capturing' })).toHaveProperty('disabled', true);
  });
});
