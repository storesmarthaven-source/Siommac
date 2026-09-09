import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { MeetingsStagedWorkspace } from './MeetingsStagedWorkspace';
import { meetingStagingScenarios } from './meetingStaging';

describe('MeetingsStagedWorkspace', () => {
  it('renders the completed meeting through the canonical detail contract', () => {
    render(<MeetingsStagedWorkspace />);

    expect(screen.getByRole('heading', { name: 'Pelican Platform Deck Inspection Review' })).toBeTruthy();
    expect(screen.getByText('Meeting Details')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Recording and transcript' })).toBeTruthy();
    expect(screen.getAllByText('Interface Preview')).toHaveLength(2);
    expect(screen.getByText('Key Points')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Action Items' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Transcripts' })).toBeTruthy();
  });

  it('uses the UI Kit tabs to expose snippets, actions, decisions, speakers, and keywords', () => {
    render(<MeetingsStagedWorkspace />);

    fireEvent.click(screen.getByRole('tab', { name: 'Snippets' }));
    expect(screen.getByText('Evidence Snippets')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Action Items' }));
    expect(screen.getByText('Upload final ladder repair photo')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    expect(screen.getByText('Meeting Decisions')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Speakers' }));
    expect(screen.getByText('Speaker Activity')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Keywords' }));
    expect(screen.getByText('Transcript Keywords')).toBeTruthy();
  });

  it('searches the staged transcript without pretending to run AI', () => {
    render(<MeetingsStagedWorkspace />);

    const search = screen.getByRole('searchbox', { name: 'Search transcript' });
    fireEvent.input(search, { target: { value: 'ladder verification' } });
    expect(screen.getByText(/only remaining risk is the ladder verification/i)).toBeTruthy();

    fireEvent.input(search, { target: { value: 'not in this transcript' } });
    expect(screen.getByText('No transcript matches')).toBeTruthy();
  });

  it('does not expose protected detail in the restricted scenario', () => {
    const restricted = meetingStagingScenarios().filter(scenario => scenario.kind === 'restricted');
    render(<MeetingsStagedWorkspace scenarios={restricted} />);

    expect(screen.getByText('Meeting access restricted')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Recording and transcript' })).toBeNull();
  });

  it('returns to the meetings overview through the supplied navigation handler', () => {
    const onBack = vi.fn();
    render(<MeetingsStagedWorkspace onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to meetings' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
