/**
 * CalcFailurePanel.test.tsx — F-05 calculation-failure recovery unit coverage.
 *
 *  CFR1  Attempt band renders the failed attempt no + immutable evidence + short correlation.
 *  CFR2  Root-cause table renders ONLY open/in-progress blocker findings (title + humanized control).
 *  CFR3  Recovery step 4 ("Retry") is Blocked while blockers remain, Ready when clear.
 *  CFR4  Diagnostic code includes error_code, failed_stage and correlation_id (support-safe only).
 *  CFR5  The highest-attempt_no FAILED attempt is chosen (not an earlier/other-status one).
 *  CFR6  With no blocker findings, the honest empty state renders (points at the diagnostic).
 *
 * Findings use null employee/assignee so the id-resolving EmployeeCell hook is never
 * mounted — no QueryClient needed; the muted "Run-level" fallback renders instead.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { CalcFailurePanel } from './CalcFailurePanel';
import {
  type PayrollRun, type PayrollRunWorkspace, type PayrollCalculationAttempt, type PayrollControlFinding,
} from '@api/finance/payroll';

function makeRun(): PayrollRun {
  return {
    id: 'run-1', runNo: 'PR-2026-07-C01', periodMonth: '2026-07-01', payFrequency: 'monthly',
    status: 'calculation_failed', statutoryVersionId: 'stat-1', weeksInPeriod: 4.333,
    payGroup: 'Monthly Salaried', payGroupId: 'pg-1', payDate: '2026-07-31', cutOffDate: '2026-07-25',
    employeeCount: 12, grossTotal: 0, deductionTotal: 0, netTotal: 0, nisEmployerTotal: 0,
    workflowId: null, currentInputSnapshotId: 'snap-1', inputLockedBy: null, inputLockedAt: null,
    createdBy: 'u-1', approvedBy: null, lockedBy: null, lockedAt: null, reopenedBy: null,
    reopenedAt: null, reopenReason: null, exportedAt: null, createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z', templateId: null, payPolicy: null,
  };
}

function makeAttempt(over: Partial<PayrollCalculationAttempt> = {}): PayrollCalculationAttempt {
  return {
    id: 'att-1', runId: 'run-1', inputSnapshotId: 'snap-abcd1234ef', attemptNo: 1,
    status: 'failed', stage: 'statutory_deductions', progress: 0, correlationId: 'corr-7c31e9ab-0000',
    errorCode: 'PAYROLL_STATUTORY_VERSION_INVALID', errorMessage: 'Two employees reference an expired statutory version.',
    createdBy: 'u-1',
    startedAt: '2026-07-28T10:42:03Z', leaseExpiresAt: '2026-07-28T10:47:03Z', completedAt: '2026-07-28T10:42:26Z',
    ...over,
  };
}

function makeFinding(over: Partial<PayrollControlFinding> = {}): PayrollControlFinding {
  return {
    id: 'f-1', runId: 'run-1', calculationVersionId: 'cv-1', sourceType: 'statutory', sourceId: 's1',
    findingType: 'statutory_version_expired', domain: 'statutory', severity: 'blocker', state: 'open',
    title: 'NIS class version expired', detail: 'Effective version required on 4 Aug', employeeId: null, assigneeId: null,
    dueAt: null, version: 1, resolutionNote: null, resolvedBy: null, resolvedAt: null,
    waiverReason: null, waivedBy: null, waivedAt: null, waiverExpiresAt: null,
    createdAt: '2026-07-28T10:42:00Z', updatedAt: '2026-07-28T10:42:00Z',
    ...over,
  };
}

function makeWorkspace(over: Partial<PayrollRunWorkspace> = {}): PayrollRunWorkspace {
  return {
    run: makeRun(), inputSnapshot: null, currentCalculationVersion: null,
    calculationAttempts: [makeAttempt()],
    findingSummary: { total: 1, actionable: 1, blockers: 1, warnings: 0, info: 0, byState: {}, byDomain: {} },
    priorityFindings: [makeFinding()],
    audit: [],
    // P0-2: a failed run for a preparer — retry-calculate is the only open capability.
    actions: {
      canLockInputs: false, canCalculate: true, canCertify: false, canSubmit: false,
      canApprove: false, canReject: false, canLock: false, canReopen: false,
      canConfirmFunding: false, canRelease: false, canGeneratePayslips: false,
      canDistributePayslips: false, canPreviewGl: false, canPostGl: false, canExport: false,
      disabledReasons: {},
    },
    ...over,
  };
}

describe('F-05 CalcFailurePanel', () => {
  it('CFR1 — renders the immutable failed-attempt band with the attempt no and short correlation', () => {
    render(<CalcFailurePanel workspace={makeWorkspace()} />);
    expect(screen.getByText('Attempt 1 is immutable')).toBeTruthy();
    expect(screen.getByText('Correlation ID')).toBeTruthy();
    // short correlation, not the raw id
    expect(screen.getByText('corr…0000')).toBeTruthy();
  });

  it('CFR2 — root-cause table shows only open/in-progress blocker findings', () => {
    const ws = makeWorkspace({
      priorityFindings: [
        makeFinding({ id: 'f-blk', title: 'NIS class version expired' }),
        makeFinding({ id: 'f-warn', severity: 'warning', title: 'Rounding variance' }),
        makeFinding({ id: 'f-done', state: 'resolved', title: 'Already fixed' }),
      ],
    });
    render(<CalcFailurePanel workspace={ws} />);
    expect(screen.getByText('NIS class version expired')).toBeTruthy();
    expect(screen.queryByText('Rounding variance')).toBeNull();   // warning excluded
    expect(screen.queryByText('Already fixed')).toBeNull();       // resolved excluded
    expect(screen.getByText('1 blocking record')).toBeTruthy();
    // humanized control domain, not the raw enum
    expect(screen.getByText('Statutory')).toBeTruthy();
  });

  it('CFR3 — retry step is Blocked with blockers, Ready when clear', () => {
    const blocked = render(<CalcFailurePanel workspace={makeWorkspace()} />);
    expect(blocked.getByText('Blocked')).toBeTruthy();
    blocked.unmount();

    const clear = makeWorkspace({
      priorityFindings: [],
      findingSummary: { total: 0, actionable: 0, blockers: 0, warnings: 0, info: 0, byState: {}, byDomain: {} },
    });
    render(<CalcFailurePanel workspace={clear} />);
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('CFR4 — diagnostic code carries error_code, failed_stage and correlation (support-safe only)', () => {
    const { container } = render(<CalcFailurePanel workspace={makeWorkspace()} />);
    const code = container.querySelector('.failure-code')?.textContent ?? '';
    expect(code).toContain('PAYROLL_STATUTORY_VERSION_INVALID');
    expect(code).toContain('failed_stage: statutory_deductions');
    expect(code).toContain('correlation_id: corr-7c31e9ab-0000');
    expect(code).toContain('Two employees reference an expired statutory version.');
  });

  it('CFR5 — chooses the highest-attempt_no FAILED attempt', () => {
    const ws = makeWorkspace({
      calculationAttempts: [
        makeAttempt({ id: 'a1', attemptNo: 1, status: 'failed', correlationId: 'corr-old00000000' }),
        makeAttempt({ id: 'a2', attemptNo: 2, status: 'failed', correlationId: 'corr-new00000000' }),
        makeAttempt({ id: 'a3', attemptNo: 3, status: 'running', correlationId: 'corr-run00000000' }),
      ],
    });
    render(<CalcFailurePanel workspace={ws} />);
    expect(screen.getByText('Attempt 2 is immutable')).toBeTruthy();  // latest FAILED, not the running one
  });

  it('CFR6 — no blocker findings renders the honest empty state', () => {
    const ws = makeWorkspace({
      priorityFindings: [],
      findingSummary: { total: 0, actionable: 0, blockers: 0, warnings: 0, info: 0, byState: {}, byDomain: {} },
    });
    render(<CalcFailurePanel workspace={ws} />);
    expect(screen.getByText(/No blocking findings were recorded/)).toBeTruthy();
  });
});
