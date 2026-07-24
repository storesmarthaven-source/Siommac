/**
 * PayrollExceptionQueuePage.test.tsx — F-06/F-07 work-queue page unit coverage.
 *
 *  PXQ1  Tabs render with their tabCounts.
 *  PXQ2  Finding rows show title/run + an "Open" CTA; approval rows show "Review".
 *  PXQ3  No selection → the detail-empty prompt.
 *  PXQ4  A selected finding → detail facts + allowedActions buttons + activity.
 *  PXQ5  Empty items → the honest empty state.
 *
 * useWorkQueue is mocked so the page renders deterministically without a live query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type {
  PayrollWorkQueueResult, PayrollFindingQueueItem, PayrollFindingDetail,
} from '@api/finance/payrollExceptions';

const mockUseWorkQueue = vi.fn<(req: unknown) => unknown>();
const stubMut = (): { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean } => ({ mutateAsync: vi.fn(), isPending: false });
vi.mock('@api/finance/payrollExceptions', () => ({
  useWorkQueue: (req: unknown) => mockUseWorkQueue(req),
  useWorkQueueMutations: () => ({
    escalate: stubMut(), comment: stubMut(), assign: stubMut(),
    resolve: stubMut(), waive: stubMut(), reopen: stubMut(),
  }),
}));
// The run filter reads the runs register; stub it so the page renders without a live query.
vi.mock('@api/finance/payrollRunsRegister', () => ({
  useRunsRegister: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

import { PayrollExceptionQueuePage } from './PayrollExceptionQueuePage';

function findingRow(over: Partial<PayrollFindingQueueItem> = {}): PayrollFindingQueueItem {
  return {
    id: 'f-1', kind: 'blocker', severity: 'critical', state: 'open', version: 2,
    run: { id: 'run-1', reference: 'PAY-2026-07-W04', payDate: '2026-07-24' },
    title: 'Statutory profiles incomplete', summary: 'PAYE election missing for 2 employees',
    owner: { type: 'team', id: 't-hr', displayName: 'HR Payroll Data' },
    dueAt: '2026-07-24T12:00:00Z', impact: { currency: 'TTD', amount: null, employeeCount: 2, label: 'Two records' },
    allowedActions: ['assign', 'escalate', 'comment', 'resolve'], workflowTaskId: null, ...over,
  };
}
function approvalRow(): PayrollFindingQueueItem {
  return {
    id: 'task:wt-1', kind: 'approval', severity: 'high', state: 'pending_approval', version: 1,
    run: { id: 'run-2', reference: 'PAY-2026-07-OC03', payDate: '2026-07-30' },
    title: 'Approve off-cycle payroll', summary: '43 employees · threshold approval',
    owner: { type: 'user', id: 'u-me', displayName: 'Maya Joseph' },
    dueAt: '2026-07-30T14:00:00Z', impact: { currency: 'TTD', amount: 438560, employeeCount: 43, label: 'Net payroll' },
    allowedActions: ['review'], workflowTaskId: 'wt-1',
  };
}
function detail(over: Partial<PayrollFindingDetail> = {}): PayrollFindingDetail {
  return {
    ...findingRow(), id: 'f-1',
    trigger: { ruleKey: 'statutory.profile.incomplete', threshold: null, observed: '2 employees' },
    subject: { employeeId: null, displayName: null, scopeLabel: 'PAY-2026-07-W04 · 2 employees' },
    sourceEvidence: [], requiredEvidence: ['Approved PAYE election', 'NIS class'],
    resolution: null,
    activity: { items: [{ id: 'a-1', findingId: 'f-1', actorId: 'u-1', actorName: 'Keisha Grant', activityType: 'created', body: null, fromState: null, toState: 'open', findingVersion: 1, createdAt: '2026-07-24T09:00:00Z' }], nextCursor: null, total: 1, asOf: '2026-07-24T10:00:00Z' },
    ...over,
  };
}
function result(over: Partial<PayrollWorkQueueResult> = {}): PayrollWorkQueueResult {
  return {
    items: [findingRow(), approvalRow()], nextCursor: null, total: 2,
    tabCounts: { all: 17, approvals: 2, blockers: 4, warnings: 11, resolved: 9 },
    asOf: '2026-07-24T10:00:00Z', selected: null, ...over,
  };
}
const asQuery = (data: PayrollWorkQueueResult | undefined, over: object = {}) =>
  ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...over });

beforeEach(() => { mockUseWorkQueue.mockReset(); });

describe('F-06/F-07 PayrollExceptionQueuePage', () => {
  it('PXQ1 — tabs render with their counts', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result()));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('All Open')).toBeTruthy();
    expect(screen.getByText('My Approvals')).toBeTruthy();
    // Counts appear in both the KPI strip and the tab chips (mockup design),
    // so assert presence via getAllByText rather than a unique match.
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);   // blockers
    expect(screen.getAllByText('11').length).toBeGreaterThan(0);  // warnings
  });

  it('PXQ2 — finding row shows Open, approval row shows Review', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result()));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('Statutory profiles incomplete')).toBeTruthy();
    expect(screen.getByText('Approve off-cycle payroll')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();     // finding CTA
    expect(screen.getByText('Review')).toBeTruthy();   // approval CTA (review-only)
  });

  it('PXQ3 — no selection shows the detail-empty prompt', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result({ selected: null })));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('Select a finding')).toBeTruthy();
  });

  it('PXQ4 — a selected finding renders detail facts + its allowed actions + activity', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result({ selected: detail() })));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('Statutory profile incomplete')).toBeTruthy();   // trigger (humanized, no raw key)
    expect(screen.getByText('Resolve')).toBeTruthy();                        // allowedActions button
    expect(screen.getByText('Escalate')).toBeTruthy();
    expect(screen.getByText('Approved PAYE election')).toBeTruthy();         // required evidence
    expect(screen.getByText('Finding raised')).toBeTruthy();                 // activity entry
  });

  it('PXQ5 — empty items renders the empty state', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result({ items: [], total: 0 })));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('No queue items match this view')).toBeTruthy();
  });

  it('PXQ6 — rows surface the run pay date for triage', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result()));
    render(<PayrollExceptionQueuePage />);
    // 2026-07-24 → "Pay 24 Jul" in the row meta line.
    expect(screen.getByText(/Pay 24 Jul/)).toBeTruthy();
  });

  it('PXQ7 — selecting an open finding reveals the bulk bar; Waive is disabled for a blocker', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result()));
    render(<PayrollExceptionQueuePage />);
    fireEvent.click(screen.getByLabelText('Select Statutory profiles incomplete'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByText('Reassign')).toBeTruthy();
    // Blocker findings can't be waived → the bulk Waive verb is disabled.
    const waive = screen.getByText('Waive').closest('button') as HTMLButtonElement;
    expect(waive.disabled).toBe(true);
  });

  it('PXQ8 — a selected finding renders its source evidence (humanized, no raw id)', () => {
    mockUseWorkQueue.mockReturnValue(asQuery(result({ selected: detail({
      sourceEvidence: [{ type: 'calculation_warning', id: 'src-uuid-should-not-show', label: 'calculation_warning', occurredAt: '2026-07-24T09:00:00Z' }],
    }) })));
    render(<PayrollExceptionQueuePage />);
    expect(screen.getByText('Source evidence')).toBeTruthy();
    expect(screen.getByText('Calculation warning')).toBeTruthy();
    expect(screen.queryByText(/src-uuid-should-not-show/)).toBeNull();   // no raw id
  });
});
