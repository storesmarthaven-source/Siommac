/**
 * CloseReleaseCard.test.tsx — F-08 Close & Release governance coverage.
 *
 *  CR1  Draft + controls NOT ready → attestation + Issue are disabled.
 *  CR2  Draft + ready but NOT attested → Issue stays disabled (attestation gate).
 *  CR3  Draft + ready + attested → Issue enabled.
 *  CR4  Released → certificate shows "Issued" + the manifest checksum.
 *
 * useReleaseCertificate + `can` are mocked; QueryClientProvider satisfies useMutation.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import type { PayrollRun, PayrollReleasePreflight, PayrollReleaseCertificate } from '@api/finance/payroll';

const mockCert = vi.fn<() => { data: PayrollReleaseCertificate | undefined }>();
vi.mock('@api/finance/payroll', () => ({
  useReleaseCertificate: () => mockCert(),
  financePayrollApi: { releaseRun: vi.fn(), confirmFunding: vi.fn() },
}));
vi.mock('@lib/permissions', () => ({ can: () => true }));

import { CloseReleaseCard } from './CloseReleaseCard';

function makeRun(status: string): PayrollRun {
  return {
    id: 'run-1', runNo: 'PAY-2026-07-M01', periodMonth: '2026-07-01', payFrequency: 'monthly',
    status: status, statutoryVersionId: 's-1', weeksInPeriod: 4.333,
    payGroup: 'Monthly Salaried', payGroupId: 'pg-1', payDate: '2026-07-31', cutOffDate: '2026-07-25',
    employeeCount: 302, grossTotal: 9243600, deductionTotal: 1428680, netTotal: 7814920, nisEmployerTotal: 431000,
    workflowId: null, currentInputSnapshotId: 'snap-1', inputLockedBy: null, inputLockedAt: null,
    createdBy: 'u-1', approvedBy: null, lockedBy: null, lockedAt: null, reopenedBy: null,
    reopenedAt: null, reopenReason: null, exportedAt: null, createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z', templateId: null, payPolicy: null,
  };
}
function preflight(over: Partial<PayrollReleasePreflight> = {}): PayrollReleasePreflight {
  return {
    runId: 'run-1', runNo: 'PAY-2026-07-M01', status: 'locked', ready: true, alreadyReleased: false,
    blockers: [], calculationVersionId: 'cv-3', certificationId: 'cert-1', fundingConfirmationId: 'fnd-1',
    glJournalId: 'gl-1', glDebit: 9675740, glCredit: 9675740, invalidGlAccountCount: 0, invalidNisPeriodCount: 0,
    payslipCount: 302, renderedPayslipCount: 302, missingBankAccountCount: 0, disbursementId: 'disb-1',
    netPayroll: 7814920, employeeCount: 302, ...over,
  };
}
const renderCard = (run: PayrollRun, pf: PayrollReleasePreflight | undefined) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CloseReleaseCard run={run} preflight={pf} /></QueryClientProvider>);
};
const issueBtn = (): HTMLElement => screen.getByRole('button', { name: /Issue release certificate/i });
const isDisabled = (el: HTMLElement): boolean => el.hasAttribute('disabled');

describe('F-08 CloseReleaseCard', () => {
  it('CR1 — not-ready draft disables attestation and Issue', () => {
    mockCert.mockReturnValue({ data: undefined });
    renderCard(makeRun('locked'), preflight({ ready: false, glJournalId: null }));
    expect(isDisabled(screen.getByRole('checkbox'))).toBe(true);
    expect(isDisabled(issueBtn())).toBe(true);
  });

  it('CR2 — ready but not attested keeps Issue disabled (attestation gate)', () => {
    mockCert.mockReturnValue({ data: undefined });
    renderCard(makeRun('locked'), preflight());
    expect(isDisabled(issueBtn())).toBe(true);   // attestation not yet ticked
  });

  it('CR3 — ready + attested enables Issue', () => {
    mockCert.mockReturnValue({ data: undefined });
    renderCard(makeRun('locked'), preflight());
    fireEvent.click(screen.getByRole('checkbox'));
    expect(isDisabled(issueBtn())).toBe(false);
  });

  it('CR4 — a released run shows the issued certificate + checksum', () => {
    mockCert.mockReturnValue({ data: {
      id: 'rc-1', runId: 'run-1', calculationVersionId: 'cv-3', certificationId: 'cert-1',
      fundingConfirmationId: 'fnd-1', glJournalId: 'gl-1', disbursementId: 'disb-1',
      controlTotals: {}, payslipManifest: {}, artifactChecksums: {}, checksum: '96c28ae1deadbeef',
      releasedBy: 'u-2', releasedAt: '2026-07-30T17:00:00Z', createdAt: '2026-07-30T17:00:00Z',
      remittances: [{ id: 'rm-1', authority: 'paye_bir', periodYear: 2026, periodMonth: 7 }],
    } });
    renderCard(makeRun('released'), preflight({ status: 'released', alreadyReleased: true }));
    expect(screen.getByText('Issued')).toBeTruthy();
    expect(screen.getByText('96c28ae1dead…')).toBeTruthy();   // truncated checksum
    expect(screen.queryByText(/Issue release certificate/)).toBeNull();   // no issue action once released
  });
});
