/**
 * P0-2 / P0-3 component contract (certification WP-2, doc §9.3–9.4):
 * HeaderActions renders lifecycle actions EXCLUSIVELY from the server-computed
 * capability object — never from broad canManage/canApprove flags — and the
 * Export command appears only when the server says canExport (released runs).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { HeaderActions } from '../PayRunDetailPage';
import type { PayrollRun, PayrollRunActions } from '@api/finance/payroll';
import type { PayRunDrawerActions } from './interactiveTabs';

function makeRun(over: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: 'run-1', runNo: 'PAY-2026-07-M01', periodMonth: '2026-07-01', status: 'locked',
    employeeCount: 3, grossTotal: 1000, deductionTotal: 100, netTotal: 900,
    createdBy: 'u-prep', approvedBy: null, payGroup: null, payGroupId: null,
    payDate: null, cutOffDate: null, payPolicy: null,
    ...over,
  } as PayrollRun;
}

const noCaps: PayrollRunActions = {
  canLockInputs: false, canCalculate: false, canCertify: false, canSubmit: false,
  canApprove: false, canReject: false, canLock: false, canReopen: false,
  canConfirmFunding: false, canRelease: false, canGeneratePayslips: false,
  canDistributePayslips: false, canPreviewGl: false, canPostGl: false, canExport: false,
  disabledReasons: {},
};
const drawerActions = {
  onLockInputs: vi.fn(), onCalculate: vi.fn(), onSubmit: vi.fn(), onApprove: vi.fn(),
  onReject: vi.fn(), onLockRun: vi.fn(), onExport: vi.fn(), onReopen: vi.fn(), onGenPayslips: vi.fn(),
} as unknown as PayRunDrawerActions;

describe('P0-2 HeaderActions renders from server capabilities only', () => {
  it('renders no commands (loading) before capabilities arrive', () => {
    render(<HeaderActions run={makeRun()} caps={undefined} actions={drawerActions} />);
    expect(screen.getByText('Loading actions…')).toBeTruthy();
  });

  it('renders nothing actionable when every capability is false — even for a locked run', () => {
    render(<HeaderActions run={makeRun({ status: 'locked' })} caps={noCaps} actions={drawerActions} />);
    expect(screen.getByText('No actions available')).toBeTruthy();
    expect(screen.queryByText('Export')).toBeNull();
    expect(screen.queryByText('Lock Inputs')).toBeNull();
  });

  it('P0-3: a LOCKED run with canExport=false shows no Export; a RELEASED run with canExport shows it', () => {
    // Locked: backend export command would 422 — the button must not exist.
    const { unmount } = render(
      <HeaderActions run={makeRun({ status: 'locked' })}
        caps={{ ...noCaps, canGeneratePayslips: true, canReopen: true }} actions={drawerActions} />,
    );
    expect(screen.queryByText('Export')).toBeNull();
    expect(screen.getByText('Generate Payslips')).toBeTruthy();
    expect(screen.getByText('Reopen')).toBeTruthy();
    unmount();
    // Released: server grants canExport → the command appears.
    render(<HeaderActions run={makeRun({ status: 'released' })}
      caps={{ ...noCaps, canExport: true }} actions={drawerActions} />);
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('SoD: approve/reject render only when the server capability allows them', () => {
    render(<HeaderActions run={makeRun({ status: 'pending_approval' })}
      caps={{ ...noCaps, disabledReasons: { canApprove: 'Separation of duties: the preparer of a run cannot decide its approval.' } }}
      actions={drawerActions} />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('preparer flow: draft shows Lock Inputs; failed run shows Retry Calculation', () => {
    const { unmount } = render(
      <HeaderActions run={makeRun({ status: 'draft' })} caps={{ ...noCaps, canLockInputs: true }} actions={drawerActions} />,
    );
    expect(screen.getByText('Lock Inputs')).toBeTruthy();
    unmount();
    render(<HeaderActions run={makeRun({ status: 'calculation_failed' })}
      caps={{ ...noCaps, canCalculate: true }} actions={drawerActions} />);
    expect(screen.getByText('Retry Calculation')).toBeTruthy();
  });
});
