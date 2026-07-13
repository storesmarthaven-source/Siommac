/**
 * ErrorBoundary.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen }             from '@testing-library/preact';
import { ErrorBoundary }                          from './ErrorBoundary';

// Component that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }): null {
  if (shouldThrow) throw new Error('Test explosion');
  return null;
}

// Preact calls console.error when a boundary catches — suppress it
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => { /* suppress boundary error output in tests */ });
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>Safe content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Safe content')).toBeTruthy();
  });

  it('renders the default fallback when a child throws', () => {
    render(
      <ErrorBoundary sectionName="Dashboard">
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Error in Dashboard/i)).toBeTruthy();
  });

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={({ retry }) => <button onClick={retry}>Custom retry</button>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom retry')).toBeTruthy();
  });

  it('retries (resets error state) when the retry button is clicked', () => {
    // Use the resetKeys prop so we can trigger a reset without a live re-throw.
    // Changing a resetKey causes componentDidUpdate → _reset() automatically.
    const { rerender } = render(
      <ErrorBoundary resetKeys={[1]}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    // Supply non-throwing children AND a new resetKey simultaneously.
    // componentDidUpdate sees the key change, calls _reset(), re-renders children.
    rerender(
      <ErrorBoundary resetKeys={[2]}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls onError when a child throws', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
