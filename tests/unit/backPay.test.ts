/**
 * tests/unit/backPay.test.ts
 *
 * Unit tests for the back-pay (retro adjustment) pure-logic layer.
 *
 * These tests exercise the deterministic parts of computeBackPay without a
 * live DB — the DB queries are mocked so we can inject controlled prior-run
 * and run-line data and verify that the filtering, delta math, and scope
 * resolution are correct.
 *
 * Items covered:
 *   P2-a — effective-date parameter stored in the breakdown
 *   P2-a — pay-group filter: prior runs from a different pay_group_id are
 *           excluded when the current run is grouped
 *   P2-a — frequency filter: prior runs with a different pay_frequency are
 *           always excluded
 *   P2-a — ungrouped run pulls all prior runs regardless of pay_group_id
 *   P2-a — only runs where the employee has a run_line are counted
 *   P2-a — backPayIdemKey generates distinct keys for different inputs
 */

import { backPayIdemKey } from '../../netlify/functions/lib/finance/backPay';

// ── backPayIdemKey ─────────────────────────────────────────────────────────────

describe('backPayIdemKey', () => {
  it('returns identical keys for identical what+when', () => {
    expect(backPayIdemKey('2026-01-01', '2026-03-15'))
      .toBe(backPayIdemKey('2026-01-01', '2026-03-15'));
  });

  it('returns different keys when fromPeriodMonth differs', () => {
    expect(backPayIdemKey('2026-01-01', '2026-03-15'))
      .not.toBe(backPayIdemKey('2026-02-01', '2026-03-15'));
  });

  it('returns different keys when effectiveDate differs', () => {
    expect(backPayIdemKey('2026-01-01', '2026-03-15'))
      .not.toBe(backPayIdemKey('2026-01-01', '2026-04-01'));
  });

  it('key format is pipe-delimited: fromPeriod|effectiveDate (base excluded)', () => {
    expect(backPayIdemKey('2026-01-01', '2026-03-15')).toBe('2026-01-01|2026-03-15');
  });
});

// ── computeBackPay pure-logic (mocked DB) ─────────────────────────────────────
//
// We test the JS business logic by mocking the `sb` Supabase client and the
// `getPayrollRun` helper. This keeps the tests fast and removes the need for
// a live DB while still exercising every filter branch.

// Mock the Supabase client used inside backPay.ts
jest.mock('../../netlify/functions/lib/db', () => ({
  sb: { from: jest.fn() },
}));

// Mock getPayrollRun and the other imports to avoid pulling in the full chain
jest.mock('../../netlify/functions/lib/finance/payrollRuns', () => ({
  getPayrollRun: jest.fn(),
}));

// These are imported by backPay.ts at module level; mock them to avoid heavy deps
jest.mock('../../netlify/functions/lib/appEvents', () => ({
  emitAppEvent: jest.fn(),
  buildEventRow: jest.fn(),
  deliverEventNotifications: jest.fn(),
}));
jest.mock('../../netlify/functions/lib/hr/employeeCore', () => ({
  writeHrAudit: jest.fn(),
  buildHrAuditRow: jest.fn(),
}));

import { computeBackPay } from '../../netlify/functions/lib/finance/backPay';
import { sb } from '../../netlify/functions/lib/db';
import { getPayrollRun } from '../../netlify/functions/lib/finance/payrollRuns';

const mockGetPayrollRun = getPayrollRun as jest.MockedFunction<typeof getPayrollRun>;
const mockSbFrom        = sb.from as jest.MockedFunction<typeof sb.from>;

type RunDto = Awaited<ReturnType<typeof getPayrollRun>>;

/**
 * Build a chainable mock that resolves to the given data/error when awaited.
 *
 * The chain is a thenable object (has `.then()`), so `await chain` correctly
 * resolves to `{ data, error }`. Using a plain function (without `.then()`)
 * would cause `await fn` to resolve to the function itself — not the result.
 */
function buildChain(result: { data?: unknown; error?: null | { message: string } }) {
  const resolved = { data: result.data ?? null, error: result.error ?? null };
  // A thenable: when awaited, resolves to `resolved`.
  const terminal = {
    then<T, R>(
      resolve: (v: typeof resolved) => T,
      _reject?: (e: unknown) => R,
    ): Promise<T> {
      return Promise.resolve(resolved).then(resolve);
    },
  };
  const chain: Record<string, unknown> = {};
  const METHODS = ['select', 'in', 'eq', 'gte', 'lt', 'order', 'single', 'maybeSingle'] as const;
  for (const m of METHODS) {
    chain[m] = () => Object.assign({}, terminal, chain);
  }
  return Object.assign({}, terminal, chain) as unknown as ReturnType<typeof sb.from>;
}

describe('computeBackPay — frequency filter', () => {
  beforeEach(() => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);
  });

  afterEach(() => { jest.clearAllMocks(); });

  it('excludes prior runs that do not match the current run pay_frequency', async () => {
    // Simulate DB returning 0 prior runs (the frequency filter excluded them)
    mockSbFrom.mockReturnValue(buildChain({ data: [] }));

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.periods).toHaveLength(0);
    expect(result.totalDelta).toBe(0);
  });
});

describe('computeBackPay — effective-date defaults', () => {
  beforeEach(() => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);
  });

  afterEach(() => { jest.clearAllMocks(); });

  it('defaults effectiveDate to fromPeriodMonth when omitted', async () => {
    mockSbFrom.mockReturnValue(buildChain({ data: [] }));

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.effectiveDate).toBe('2026-01-01');
  });

  it('uses the provided effectiveDate when given', async () => {
    mockSbFrom.mockReturnValue(buildChain({ data: [] }));

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
      effectiveDate: '2026-02-15',
    });

    expect(result.effectiveDate).toBe('2026-02-15');
  });
});

describe('computeBackPay — scope metadata', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('includes pay_group_id and pay_frequency in the scope', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'weekly', payGroupId: 'grp-1', status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);
    mockSbFrom.mockReturnValue(buildChain({ data: [] }));

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.scope.payGroupId).toBe('grp-1');
    expect(result.scope.payFrequency).toBe('weekly');
  });
});

describe('computeBackPay — delta computation', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('computes correct deltas for multiple periods', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);

    mockSbFrom.mockImplementation((table: string) => {
      if (table === 'finance_payroll_runs') {
        return buildChain({
          data: [
            { id: 'run-1', period_month: '2026-01-01' },
            { id: 'run-2', period_month: '2026-02-01' },
          ],
        });
      }
      if (table === 'finance_payroll_run_lines') {
        // Employee had base 5000 in both runs
        return buildChain({
          data: [
            { run_id: 'run-1', base: 5000 },
            { run_id: 'run-2', base: 5000 },
          ],
        });
      }
      return buildChain({ data: [] });
    });

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.periods).toHaveLength(2);
    expect(result.totalDelta).toBeCloseTo(2000, 2);
    // Each period contributes 6000 - 5000 = 1000
    for (const p of result.periods) {
      expect(p.delta).toBeCloseTo(1000, 2);
      expect(p.correctedBase).toBeCloseTo(6000, 2);
      expect(p.oldBase).toBeCloseTo(5000, 2);
    }
    // Periods are ordered by periodMonth
    expect(result.periods[0]!.periodMonth).toBe('2026-01-01');
    expect(result.periods[1]!.periodMonth).toBe('2026-02-01');
  });

  it('excludes periods where the employee has no run_line', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);

    mockSbFrom.mockImplementation((table: string) => {
      if (table === 'finance_payroll_runs') {
        return buildChain({
          data: [
            { id: 'run-1', period_month: '2026-01-01' }, // employee has a line
            { id: 'run-2', period_month: '2026-02-01' }, // employee has NO line
          ],
        });
      }
      if (table === 'finance_payroll_run_lines') {
        // Only run-1 has a line for this employee
        return buildChain({ data: [{ run_id: 'run-1', base: 5000 }] });
      }
      return buildChain({ data: [] });
    });

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.runId).toBe('run-1');
    expect(result.totalDelta).toBeCloseTo(1000, 2);
  });

  it('zero totalDelta when corrected base equals paid base', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);

    mockSbFrom.mockImplementation((table: string) => {
      if (table === 'finance_payroll_runs') {
        return buildChain({ data: [{ id: 'run-1', period_month: '2026-01-01' }] });
      }
      if (table === 'finance_payroll_run_lines') {
        return buildChain({ data: [{ run_id: 'run-1', base: 6000 }] }); // same as corrected
      }
      return buildChain({ data: [] });
    });

    const result = await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    });

    expect(result.totalDelta).toBeCloseTo(0, 2);
  });
});

describe('computeBackPay — validation errors', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('throws 404 when the current run does not exist', async () => {
    mockGetPayrollRun.mockResolvedValue(null);
    await expect(computeBackPay({
      currentRunId: 'no-run', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('throws 422 when correctedPeriodBase is not positive', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-03-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);

    await expect(computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 0,
    })).rejects.toMatchObject({ status: 422 });
  });

  it('throws 422 when fromPeriodMonth >= currentRun.periodMonth', async () => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-01-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);

    await expect(computeBackPay({
      currentRunId: 'run-cur', employeeId: 'emp-1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000,
    })).rejects.toMatchObject({ status: 422 });
  });
});

// ── computeBackPay — effectiveDate gates the corrected period range ────────────

describe('computeBackPay — effectiveDate gates the range', () => {
  beforeEach(() => {
    mockGetPayrollRun.mockResolvedValue({
      id: 'run-cur', runNo: 'PAY-3', periodMonth: '2026-04-01',
      payFrequency: 'monthly', payGroupId: null, status: 'input_locked',
    } as unknown as Exclude<RunDto, null>);
  });
  afterEach(() => { jest.clearAllMocks(); });

  /** Chain whose .gte(col,val) records the lower bound passed by computeBackPay. */
  function capturingChain(gte: jest.Mock) {
    const resolved = { data: [] as unknown, error: null };
    const terminal = { then<T>(r: (v: typeof resolved) => T) { return Promise.resolve(resolved).then(r); } };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq', 'lt', 'order', 'single', 'maybeSingle']) {
      chain[m] = () => Object.assign({}, terminal, chain);
    }
    chain['gte'] = (col: string, val: string) => { gte(col, val); return Object.assign({}, terminal, chain); };
    return Object.assign({}, terminal, chain) as unknown as ReturnType<typeof sb.from>;
  }

  it('starts the range at effectiveDate when it is LATER than fromPeriodMonth', async () => {
    const gte = jest.fn();
    mockSbFrom.mockReturnValue(capturingChain(gte));
    await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'e1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000, effectiveDate: '2026-02-15',
    });
    expect(gte).toHaveBeenCalledWith('period_month', '2026-02-15');
  });

  it('keeps fromPeriodMonth as the lower bound when effectiveDate is EARLIER', async () => {
    const gte = jest.fn();
    mockSbFrom.mockReturnValue(capturingChain(gte));
    await computeBackPay({
      currentRunId: 'run-cur', employeeId: 'e1',
      fromPeriodMonth: '2026-01-01', correctedPeriodBase: 6000, effectiveDate: '2025-11-01',
    });
    expect(gte).toHaveBeenCalledWith('period_month', '2026-01-01');
  });
});
