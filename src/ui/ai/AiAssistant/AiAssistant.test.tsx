import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { AiAssistant } from './AiAssistant';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AiAssistant', () => {
  it('renders nothing while closed', () => {
    render(<AiAssistant open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the canonical dialog and clearly labels the frontend-only preview', () => {
    render(<AiAssistant open onClose={vi.fn()} contextLabel="Roster Planner" />);
    expect(screen.getByRole('dialog').className).toContain('ui-ai-assistant');
    expect(screen.getByText('New Conversation')).toBeTruthy();
    expect(screen.getByText('Interface Preview · Responses Are Not Generated, Sent, Or Saved.')).toBeTruthy();
  });

  it('shows the generating animation before the deterministic preview response', () => {
    vi.useFakeTimers();
    render(<AiAssistant open onClose={vi.fn()} contextLabel="Roster Planner" />);

    fireEvent.click(screen.getByRole('button', { name: 'Summarize Roster Planner' }));
    expect(screen.getByRole('status').textContent).toContain('Generating Preview Response');

    void act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.getByRole('heading', { name: 'Roster Planner Summary' })).toBeTruthy();
    expect(screen.getByText('Recommended Actions')).toBeTruthy();
  });

  it('starts a fresh prompt from the composer with Enter', () => {
    vi.useFakeTimers();
    render(<AiAssistant open onClose={vi.fn()} />);
    const composer = screen.getByRole('textbox', { name: 'Ask SIOMAC AI' });
    fireEvent.input(composer, { target: { value: 'Create an operational summary.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText('Create an operational summary.')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('supports window expansion, local voice preview and close', () => {
    const onClose = vi.fn();
    render(<AiAssistant open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Assistant Window' }));
    expect(screen.getByRole('dialog').className).toContain('is-expanded');
    expect(screen.getByRole('button', { name: 'Restore Assistant Window' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Preview' }));
    expect(screen.getByText('No Audio Is Being Recorded')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
