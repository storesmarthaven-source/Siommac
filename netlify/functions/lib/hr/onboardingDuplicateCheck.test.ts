// netlify/functions/lib/hr/onboardingDuplicateCheck.test.ts
//
// Proves the property that makes the detector safe to run outside display scope: a case the
// actor could never see still BLOCKS a duplicate launch, while none of that case's protected
// detail (employee, owner, department, progress, blockers, or even its id) escapes.
//
// If this ever regresses into returning richer rows, it becomes an authorisation bypass —
// an unscoped read reachable from a wizard that any HR user can open.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectActiveOnboardingDuplicate } from './onboardingDuplicateCheck';

const { state, builder } = vi.hoisted(() => {
  const state: { result: { data: unknown; error: unknown }; selected: string | null } =
    { result: { data: [], error: null }, selected: null };
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'eq', 'in', 'limit']) builder[m] = () => builder;
  // Capture the projection so the test can assert the query itself stays narrow.
  builder.select = (cols: string) => { state.selected = cols; return builder; };
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(state.result);
  return { state, builder };
});

vi.mock('../db', () => ({ sb: builder }));

beforeEach(() => { state.result = { data: [], error: null }; state.selected = null; });

describe('hidden duplicate still blocks launch', () => {
  it('flags a duplicate the caller has no scope to read', async () => {
    // A case belonging to another team — invisible to this actor's `my`/`team` scope.
    state.result = { data: [{ case_no: 'ONB-2026-0099' }], error: null };

    const d = await detectActiveOnboardingDuplicate('emp-1');

    expect(d.hasDuplicate).toBe(true);
    expect(d.cases).toEqual([{ caseNo: 'ONB-2026-0099' }]);
  });

  it('leaks no protected detail about the hidden case', async () => {
    state.result = {
      // Even if the row carried more, only case_no may leave the module.
      data: [{ case_no: 'ONB-2026-0099', employee_id: 'emp-secret', owner_id: 'boss', status: 'blocked' }],
      error: null,
    };

    const d = await detectActiveOnboardingDuplicate('emp-1');
    const serialised = JSON.stringify(d);

    for (const secret of ['emp-secret', 'boss', 'blocked', 'caseId', 'employeeId', 'ownerId']) {
      expect(serialised).not.toContain(secret);
    }
    expect(Object.keys(d.cases[0]!)).toEqual(['caseNo']);
  });

  it('queries a narrow projection — it cannot be widened into a case list', async () => {
    await detectActiveOnboardingDuplicate('emp-1');
    expect(state.selected).toBe('case_no');
  });
});

describe('no duplicate', () => {
  it('returns a clean decision with an empty conflict list', async () => {
    state.result = { data: [], error: null };
    const d = await detectActiveOnboardingDuplicate('emp-1');
    expect(d.hasDuplicate).toBe(false);
    expect(d.cases).toEqual([]);
  });

  it('treats a missing employee id as no duplicate without querying', async () => {
    const d = await detectActiveOnboardingDuplicate('');
    expect(d.hasDuplicate).toBe(false);
    expect(state.selected).toBeNull();
  });
});

describe('fails closed', () => {
  it('throws on a query error instead of reporting "no duplicate"', async () => {
    state.result = { data: null, error: { message: 'connection reset' } };
    // Returning hasDuplicate:false here would let a duplicate case launch whenever the
    // database is unreachable — the swallowed-error defect this guard exists to prevent.
    await expect(detectActiveOnboardingDuplicate('emp-1')).rejects.toMatchObject({ status: 500 });
  });
});
