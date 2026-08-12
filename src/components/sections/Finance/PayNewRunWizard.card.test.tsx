import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';

vi.mock('@api/finance/payroll', async (importOriginal) => {
  const original = await importOriginal<typeof import('@api/finance/payroll')>();
  const idleQuery = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };

  return {
    ...original,
    usePayrollMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    usePopulationPreview: () => idleQuery,
    usePopulationReconciliation: () => idleQuery,
    useInputReadiness: () => idleQuery,
    usePayGroups: () => ({ ...idleQuery, data: [] }),
    useReasonCodes: () => ({ ...idleQuery, data: [] }),
  };
});

import { PayNewRunWizard } from './PayNewRunWizard';

describe('PayNewRunWizard canonical Card family', () => {
  it('uses canonical panel surfaces without retaining the legacy card wrapper', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayNewRunWizard onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Run type and ownership', level: 2 })).toBeTruthy();
    expect(container.querySelectorAll('.ui-card--panel')).toHaveLength(3);
    expect(container.querySelector('.card')).toBeNull();
    expect(container.querySelector('.sec-head')).toBeNull();
    expect(container.querySelector('.panel-body')).toBeNull();
  });
});
