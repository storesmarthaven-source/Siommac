// @vitest-environment jsdom
//
// The Start Offboarding dialog must open the canonical offboarding CASE (hr/offboarding/start),
// which creates the case, its exit tasks and the IT access-removal handoff. It previously called
// the ordinary status-change endpoint with newStatus='terminated', which skipped the entire
// clearance workflow and terminated the employee on the spot.

import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startOffboarding = vi.fn((_args: unknown) => Promise.resolve({ caseId: 'case-1', caseNo: 'OFB-0001', taskCount: 7, handoffCount: 4 }));
const changeStatus = vi.fn();

vi.mock('@api/hr/offboarding', () => ({
  hrOffboardingApi: { start: (args: unknown) => startOffboarding(args) },
  useOffboardingMutation: (fn: (a: unknown) => Promise<unknown>) => ({
    isPending: false,
    mutate: (args: unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      fn(args).then(r => opts?.onSuccess?.(r)).catch(e => opts?.onError?.(e));
    },
  }),
}));
vi.mock('@api/hr/employees', () => ({
  useChangeHrStatus: () => ({ mutate: changeStatus, isPending: false }),
  useUpdateHrContact: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateHrChangeRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadHrDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateHrStatutory: () => ({ mutate: vi.fn(), isPending: false }),
  useHrOrgUnits: () => ({ data: [] }),
  useHrSites: () => ({ data: [] }),
  useHrEmployees: () => ({ data: [{ id: 'hr-1', full_name: 'Asha Singh', position: 'HR Manager' }] }),
  useHrEmployee: () => ({ data: null }),
}));

import { OffboardingDialog } from './ActionDialogs';

const onClose = vi.fn();
const onToast = vi.fn();
const setup = () => render(<OffboardingDialog employeeId="emp-1" onClose={onClose} onToast={onToast} />);
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Start Offboarding' }));
/** Selects bind the native `change`; text/date/number inputs bind `input`. fireEvent's
 *  `target: { value }` shim does not drive Preact's controlled <select>, so set the value
 *  and dispatch the real event the browser would. */
const pick = (label: string, value: string) => {
  const el = screen.getByLabelText(label);
  if (el.tagName === 'SELECT') {
    (el as HTMLSelectElement).value = value;
    fireEvent(el, new Event('change', { bubbles: true }));
  } else {
    fireEvent.input(el, { target: { value } });
  }
};

describe('Start Offboarding dialog', () => {
  beforeEach(() => { startOffboarding.mockClear(); changeStatus.mockClear(); onClose.mockClear(); onToast.mockClear(); });

  it('starts an offboarding case and never calls the status-change endpoint', async () => {
    setup();
    submit();
    await vi.waitFor(() => expect(startOffboarding).toHaveBeenCalledOnce());

    expect(changeStatus).not.toHaveBeenCalled();
    expect(startOffboarding).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-1', reason: 'resignation',
    }));
    // No direct-termination shortcut survives anywhere in the payload.
    expect(JSON.stringify(startOffboarding.mock.calls[0])).not.toContain('terminated');
  });

  it('sends the full start contract, not a hardcoded subset', async () => {
    setup();
    pick('Reason *', 'redundancy');
    pick('Last Working Day', '2026-09-30');
    pick('Notice Period (days)', '30');
    submit();
    await vi.waitFor(() => expect(startOffboarding).toHaveBeenCalledOnce());

    expect(startOffboarding).toHaveBeenCalledWith({
      employeeId: 'emp-1', reason: 'redundancy', lastWorkingDay: '2026-09-30',
      noticePeriodDays: 30, ownerId: null,
    });
  });

  it('offers only the reasons the backend accepts', () => {
    setup();
    const options = Array.from(screen.getByLabelText('Reason *').querySelectorAll('option')).map(o => o.value);
    expect(options).toEqual(['resignation', 'termination', 'redundancy', 'end_of_contract', 'retirement']);
  });

  it('validates the notice period inline and blocks submit', () => {
    setup();
    pick('Notice Period (days)', '900');
    submit();

    expect(startOffboarding).not.toHaveBeenCalled();
    expect(screen.getByText('Notice period must be a whole number of days between 0 and 365.')).toBeTruthy();
  });

  it('reports the created case, not a termination, on success', async () => {
    setup();
    submit();
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledOnce());

    expect(onToast).toHaveBeenCalledWith('Offboarding case OFB-0001 created — 7 tasks, 4 handoffs');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
