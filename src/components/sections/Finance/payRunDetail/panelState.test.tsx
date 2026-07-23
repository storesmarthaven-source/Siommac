/**
 * WP-4 (P1-7) — PayrollPanelState contract: loading, typed error (code +
 * correlation id + Retry), generic error, truthful empty, content + stale.
 * The load-bearing claim: an error is NEVER rendered as an empty state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { PayrollPanelState } from './PanelState';
import { PayrollApiError } from '@api/finance/payroll';

describe('PayrollPanelState (P1-7)', () => {
  it('loading renders an accessible skeleton — no empty text, no content', () => {
    render(
      <PayrollPanelState loading error={undefined} label="warnings" emptyText="No warnings for this run.">
        <div>CONTENT</div>
      </PayrollPanelState>,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No warnings for this run.')).toBeNull();
    expect(screen.queryByText('CONTENT')).toBeNull();
  });

  it('typed error renders alert + code + correlation id + working Retry — never the empty state', () => {
    const onRetry = vi.fn();
    render(
      <PayrollPanelState loading={false}
        error={new PayrollApiError({ code: 'payroll.error', message: 'Boom', correlationId: 'corr-9', retryable: true })}
        onRetry={onRetry} empty label="warnings" emptyText="No warnings for this run." />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Couldn’t load warnings/)).toBeTruthy();
    expect(screen.getByText(/payroll\.error · ref corr-9/)).toBeTruthy();
    expect(screen.queryByText('No warnings for this run.')).toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('generic Error renders its message without a correlation line', () => {
    render(<PayrollPanelState loading={false} error={new Error('plain failure')} label="exports" />);
    expect(screen.getByText('plain failure')).toBeTruthy();
    expect(screen.queryByText(/ref /)).toBeNull();
  });

  it('empty renders ONLY after a successful empty response', () => {
    render(<PayrollPanelState loading={false} error={undefined} empty label="run lines"
      emptyText="No run lines — run Calculate first." />);
    expect(screen.getByText('No run lines — run Calculate first.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('content renders with a stale-refresh hint during background refetch', () => {
    render(
      <PayrollPanelState loading={false} error={undefined} empty={false} stale label="payslips">
        <div>ROWS</div>
      </PayrollPanelState>,
    );
    expect(screen.getByText('ROWS')).toBeTruthy();
    expect(screen.getByText(/Refreshing payslips/)).toBeTruthy();
  });
});
