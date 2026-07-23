/**
 * payRunDetail.test.tsx — F-02 run-workspace unit coverage (UT-PPR-U1..U5).
 *
 *  U1  PolicyChip renders the pinned policy name / version / short checksum.
 *  U2  PolicyEvidencePanel renders the manifest component + source-rule arrays.
 *  U3  matchCreateBlocker maps every typed create-time failure code.
 *  U4  CalendarChip renders the working-days period denominator + scope.
 *  U5  PolicyEvidencePanel renders per-employee working-days rows (numerator /
 *      denominator / excludedCount), resolved names, NO raw UUID.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { PolicyChip, CalendarChip, lifecycleSteps, statusIntent, fmtCompact } from './parts';
import { PolicyEvidencePanel } from './panels';
import { matchCreateBlocker } from '../PayNewRunWizard';
import { type PayrollRun, type PolicyEvidence } from '@api/finance/payroll';

const CHECKSUM = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function makeRun(over: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: 'run-1', runNo: 'PR-2026-07', periodMonth: '2026-07-01', payFrequency: 'monthly',
    status: 'calculated', statutoryVersionId: 'stat-1', weeksInPeriod: 4.333,
    payGroup: 'Monthly Salaried', payGroupId: 'pg-1', payDate: '2026-07-31', cutOffDate: '2026-07-25',
    employeeCount: 3, grossTotal: 9000, deductionTotal: 1400, netTotal: 7600, nisEmployerTotal: 430,
    workflowId: null, currentInputSnapshotId: 'snap-1', inputLockedBy: null, inputLockedAt: null,
    createdBy: 'u-1', approvedBy: null, lockedBy: null, lockedAt: null, reopenedBy: null,
    reopenedAt: null, reopenReason: null, exportedAt: null, createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z', templateId: null,
    payPolicy: {
      versionId: 'ppv-1', checksum: CHECKSUM, required: true, policyName: 'Standard Salary',
      versionNo: 3,
      calendar: { workCalendarVersionId: 'wc-1', workCalendarChecksum: CHECKSUM, holidayCalendarChecksum: CHECKSUM, scope: 'pay_group', periodDenominator: '22' },
    },
    ...over,
  };
}

function makeEvidence(over: Partial<PolicyEvidence> = {}): PolicyEvidence {
  return {
    runId: 'run-1', inputSnapshotId: 'snap-1', checksum: CHECKSUM,
    components: [{ componentId: 'c-1', componentCode: 'basic', calculationBasis: 'salary_period', rateSource: 'employee_contract', eligibilitySource: 'effective_employment', ruleParameters: {}, isRequired: true, sortOrder: 0 }],
    sourceRules: [{ sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', cutoffPolicy: null, lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' }],
    costingRules: [{ dimension: 'cost_centre', resolutionSource: 'employee_assignment', required: true, missingOutcome: 'block_input_lock' }],
    statutory: { currency: 'TTD' },
    sourceConflicts: [], excludedEmployees: [],
    calendar: {
      workCalendarName: 'TT Standard Week', workCalendarVersionNo: 2, holidayCalendarName: 'TT Public Holidays',
      holidayChecksumShort: 'abcdef012345', resolution: { scope: 'pay_group', assignmentId: 'asg-1' }, periodDenominator: '22',
      employees: [{ employeeId: 'emp-uuid-1', employeeName: 'Andre Baptiste', numerator: '20', denominator: '22', clampFrom: '2026-07-01', clampTo: '2026-07-31', excludedCount: 0 }],
    },
    ...over,
  };
}

describe('F-02 policy/calendar chips (UT-PPR-U1 / U4)', () => {
  it('U1 — PolicyChip shows the pinned policy name, version and short checksum', () => {
    render(<PolicyChip run={makeRun()} />);
    expect(screen.getByText('Standard Salary')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText(CHECKSUM.slice(0, 8))).toBeTruthy();
  });

  it('U1 — PolicyChip renders nothing for a legacy/unpinned run', () => {
    const { container } = render(<PolicyChip run={makeRun({ payPolicy: null })} />);
    expect(container.textContent).toBe('');
  });

  it('U4 — CalendarChip shows the working-days denominator + scope', () => {
    render(<CalendarChip run={makeRun()} />);
    expect(screen.getByText('22 days')).toBeTruthy();
    expect(screen.getByText('pay group')).toBeTruthy();
  });

  it('U4 — CalendarChip renders nothing when the run is not calendar-pinned', () => {
    const run = makeRun();
    run.payPolicy = { ...run.payPolicy!, calendar: null };
    const { container } = render(<CalendarChip run={run} />);
    expect(container.textContent).toBe('');
  });
});

describe('F-02 policy-evidence panel (UT-PPR-U2 / U5)', () => {
  it('U2 — renders the manifest component + source-rule arrays', () => {
    render(<PolicyEvidencePanel evidence={makeEvidence()} />);
    expect(screen.getByText('basic')).toBeTruthy();                 // component code
    expect(screen.getByText('Payment Destination')).toBeTruthy();   // humanized source type
    expect(screen.getByText(CHECKSUM.slice(0, 12))).toBeTruthy();   // manifest checksum chip
  });

  it('U5 — renders per-employee working-days rows with resolved names and no raw UUID', () => {
    const { container } = render(<PolicyEvidencePanel evidence={makeEvidence()} />);
    expect(screen.getByText('Andre Baptiste')).toBeTruthy();   // resolved name
    expect(screen.getByText('20')).toBeTruthy();               // numerator
    // denominator 22 appears both in the header line and the row — at least one present
    expect(screen.getAllByText('22').length).toBeGreaterThan(0);
    // the raw employee UUID must NOT be shown anywhere
    expect(container.textContent).not.toContain('emp-uuid-1');
  });

  it('U5 — surfaces excluded employees when present', () => {
    render(<PolicyEvidencePanel evidence={makeEvidence({ excludedEmployees: [{ employeeId: 'emp-2', reasonCode: 'block_employee_calculation' }] })} />);
    expect(screen.getByText(/1 employee\(s\) excluded/)).toBeTruthy();
  });
});

describe('F-02 create-run typed blockers (UT-PPR-U3)', () => {
  // P0-5: matchCreateBlocker resolves by EXACT typed error code (PayrollApiError.code),
  // never by scanning message text — codes embedded in prose must NOT match.
  it('maps a pay-group-required failure to the payGroupId field', () => {
    const b = matchCreateBlocker('policy.pay_group_required');
    expect(b?.field).toBe('payGroupId');
    expect(b?.title).toMatch(/pay group/i);
  });

  it('maps each policy + calendar create code to an actionable title', () => {
    const cases: [string, RegExp][] = [
      ['policy.missing', /no active pay policy/i],
      ['policy.ambiguous', /more than one/i],
      ['calendar.unresolved', /no work calendar/i],
      ['calendar.split_period', /changes mid-period/i],
      ['calendar.jurisdiction_mismatch', /jurisdiction/i],
      ['calendar.zero_working_days', /no working days/i],
    ];
    for (const [code, re] of cases) {
      const b = matchCreateBlocker(code);
      expect(b, code).toBeTruthy();
      expect(b!.code).toBe(code);
      expect(b!.title).toMatch(re);
    }
  });

  it('matches the base token when the code carries a :qualifier suffix', () => {
    expect(matchCreateBlocker('calendar.version_unpublished')?.code).toBe('calendar.version_unpublished');
    expect(matchCreateBlocker('policy.missing:whole_period')?.code).toBe('policy.missing');
  });

  it('does NOT match a code embedded in prose (typed codes only), nor unknown/absent codes', () => {
    expect(matchCreateBlocker('some prefix policy.missing')).toBeNull();
    expect(matchCreateBlocker('some unrelated 500 error')).toBeNull();
    expect(matchCreateBlocker(null)).toBeNull();
    expect(matchCreateBlocker(undefined)).toBeNull();
  });
});

describe('lifecycle + format helpers', () => {
  it('marks the current step and completes the earlier ones', () => {
    const steps = lifecycleSteps('calculated');
    expect(steps.find(s => s.key === 'draft')?.state).toBe('done');
    expect(steps.find(s => s.key === 'calculated')?.state).toBe('cur');
    expect(steps.find(s => s.key === 'released')?.state).toBe('pend');
  });

  it('flags a returned run as a fail at the approval step', () => {
    const steps = lifecycleSteps('returned');
    expect(steps.find(s => s.key === 'pending_approval')?.state).toBe('fail');
  });

  it('statusIntent + fmtCompact behave', () => {
    expect(statusIntent('locked')).toBe('green');
    expect(statusIntent('returned')).toBe('red');
    expect(fmtCompact(9_243_600)).toBe('TTD 9.24M');
    expect(fmtCompact(500)).toBe('TTD 500');
  });
});
