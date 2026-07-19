// tests/unit/payrollControlCenter.test.ts
// Unit tests for the Payroll Command Center PURE derivations (approved §10):
// health scoring, cursor encode/decode + filter fingerprint, deadline classification,
// readiness (register + 7-gate), funding state, event-label projection. No DB.

import {
  activityLabel,
  classifyDeadline,
  evaluateReadinessGates,
  fundingKpiState,
  healthScore,
  healthState,
  registerReadinessState,
} from '../../netlify/functions/lib/finance/payroll/controlCenterDerive';
import {
  decodeCursor,
  encodeCursor,
  filterFingerprint,
  type RegisterCursorTuple,
} from '../../netlify/functions/lib/finance/payroll/controlCenterCursor';

describe('healthScore (score + state derive from the SAME concrete risk counts)', () => {
  const base = { criticalRunCount: 0, atRiskRunCount: 0, overdueTaskCount: 0, nearDueUnfunded: false };
  it('perfect portfolio scores 100', () => {
    expect(healthScore(base)).toBe(100);
  });
  it('subtracts 40 per critical run, capped at 80', () => {
    expect(healthScore({ ...base, criticalRunCount: 1 })).toBe(60);
    expect(healthScore({ ...base, criticalRunCount: 2 })).toBe(20);
    expect(healthScore({ ...base, criticalRunCount: 3 })).toBe(20); // cap 80
  });
  it('subtracts 20 per at-risk run, capped at 60', () => {
    expect(healthScore({ ...base, atRiskRunCount: 1 })).toBe(80);
    expect(healthScore({ ...base, atRiskRunCount: 2 })).toBe(60);
    expect(healthScore({ ...base, atRiskRunCount: 3 })).toBe(40);
    expect(healthScore({ ...base, atRiskRunCount: 5 })).toBe(40); // cap 60
  });
  it('subtracts 10 per overdue task, capped at 20', () => {
    expect(healthScore({ ...base, overdueTaskCount: 1 })).toBe(90);
    expect(healthScore({ ...base, overdueTaskCount: 2 })).toBe(80);
    expect(healthScore({ ...base, overdueTaskCount: 5 })).toBe(80); // cap 20
  });
  it('subtracts exactly 10 once for near-due unfunded (portfolio-level)', () => {
    expect(healthScore({ ...base, nearDueUnfunded: true })).toBe(90);
  });
  it('combines and clamps to 0..100', () => {
    expect(healthScore({ criticalRunCount: 1, atRiskRunCount: 1, overdueTaskCount: 1, nearDueUnfunded: true })).toBe(20);
    expect(healthScore({ criticalRunCount: 9, atRiskRunCount: 9, overdueTaskCount: 9, nearDueUnfunded: true })).toBe(0);
  });
});

describe('healthState (count-driven — gap-free; never contradicts the counts the band shows)', () => {
  const base = { criticalRunCount: 0, atRiskRunCount: 0, overdueTaskCount: 0, nearDueUnfunded: false };
  it('critical when any run is critical (dominates everything else)', () => {
    expect(healthState({ ...base, criticalRunCount: 1 })).toBe('critical');
    expect(healthState({ criticalRunCount: 1, atRiskRunCount: 5, overdueTaskCount: 5, nearDueUnfunded: true })).toBe('critical');
  });
  it('at_risk when there are at-risk runs but none critical', () => {
    expect(healthState({ ...base, atRiskRunCount: 1 })).toBe('at_risk');
    expect(healthState({ ...base, atRiskRunCount: 3 })).toBe('at_risk');
  });
  it('attention for overdue tasks or near-due unfunded only (no at-risk/critical runs)', () => {
    expect(healthState({ ...base, overdueTaskCount: 1 })).toBe('attention');
    expect(healthState({ ...base, nearDueUnfunded: true })).toBe('attention');
  });
  it('healthy ONLY with zero risk of any kind', () => {
    expect(healthState(base)).toBe('healthy');
  });
});

describe('cursor codec + filter fingerprint', () => {
  const window = { from: '2029-01-01', to: '2029-12-31' };
  const fp = filterFingerprint({ window, payGroupIds: [], tab: 'all', search: null });
  const tuple: RegisterCursorTuple = { payDate: '2029-06-01', periodEnd: '2029-06-30', runNo: 'PAY-1', id: '11111111-1111-4111-8111-111111111111' };

  it('round-trips a tuple', () => {
    expect(decodeCursor(encodeCursor(tuple, fp), fp)).toEqual(tuple);
  });
  it('round-trips a null pay_date', () => {
    const t2 = { ...tuple, payDate: null };
    expect(decodeCursor(encodeCursor(t2, fp), fp)).toEqual(t2);
  });
  it('rejects a cursor from different filters with 422', () => {
    const other = filterFingerprint({ window, payGroupIds: [], tab: 'released', search: null });
    expect(() => decodeCursor(encodeCursor(tuple, other), fp)).toThrow(/current filters/);
    try { decodeCursor(encodeCursor(tuple, other), fp); } catch (e) { expect((e as { status?: number }).status).toBe(422); }
  });
  it('rejects malformed cursors with 422', () => {
    for (const bad of ['!!!notbase64!!!', Buffer.from('{"nope":1}').toString('base64url'), Buffer.from('not json').toString('base64url')]) {
      let status: number | undefined;
      try { decodeCursor(bad, fp); } catch (e) { status = (e as { status?: number }).status; }
      expect(status).toBe(422);
    }
  });
  it('rejects a well-formed cursor with invalid typed values (bad uuid/date) with 422 — never a PG cast 500', () => {
    const bads: RegisterCursorTuple[] = [
      { payDate: '2029-06-01', periodEnd: '2029-06-30', runNo: 'PAY-1', id: 'not-a-uuid' },
      { payDate: 'not-a-date', periodEnd: '2029-06-30', runNo: 'PAY-1', id: '11111111-1111-4111-8111-111111111111' },
      { payDate: '2029-06-01', periodEnd: 'nope', runNo: 'PAY-1', id: '11111111-1111-4111-8111-111111111111' },
    ];
    for (const bad of bads) {
      let status: number | undefined;
      try { decodeCursor(encodeCursor(bad, fp), fp); } catch (e) { status = (e as { status?: number }).status; }
      expect(status).toBe(422);
    }
  });
  it('fingerprint is stable, filter-sensitive, and pay-group-order-independent', () => {
    expect(filterFingerprint({ window, payGroupIds: ['b', 'a'], tab: 'all', search: null }))
      .toBe(filterFingerprint({ window, payGroupIds: ['a', 'b'], tab: 'all', search: null }));
    expect(filterFingerprint({ window, payGroupIds: [], tab: 'all', search: 'x' })).not.toBe(fp);
    expect(filterFingerprint({ window, payGroupIds: [], tab: 'ready', search: null })).not.toBe(fp);
    expect(filterFingerprint({ window: { from: '2028-01-01', to: '2028-12-31' }, payGroupIds: [], tab: 'all', search: null })).not.toBe(fp);
  });
});

describe('classifyDeadline', () => {
  const today = '2029-06-15';
  it('classifies overdue / today / upcoming (accepts ISO or date-only)', () => {
    expect(classifyDeadline('2029-06-14', today)).toBe('overdue');
    expect(classifyDeadline('2029-06-15', today)).toBe('today');
    expect(classifyDeadline('2029-06-16', today)).toBe('upcoming');
    expect(classifyDeadline('2029-06-15T17:00:00Z', today)).toBe('today');
  });
});

describe('fundingKpiState', () => {
  it('classifies funding coverage', () => {
    expect(fundingKpiState(0, 0)).toBe('not_required');
    expect(fundingKpiState(0, 100)).toBe('unconfirmed');
    expect(fundingKpiState(40, 100)).toBe('partial');
    expect(fundingKpiState(100, 100)).toBe('confirmed');
    expect(fundingKpiState(101, 100)).toBe('confirmed');
  });
});

describe('registerReadinessState', () => {
  it('derives state from status + blocker presence', () => {
    expect(registerReadinessState('released', 0)).toBe('released');
    expect(registerReadinessState('exported', 0)).toBe('released');
    expect(registerReadinessState('calculation_failed', 0)).toBe('blocked');
    expect(registerReadinessState('calculated', 2)).toBe('blocked');
    expect(registerReadinessState('draft', 0)).toBe('not_started');
    expect(registerReadinessState('approved', 0)).toBe('ready');
    expect(registerReadinessState('locked', 0)).toBe('ready');
    expect(registerReadinessState('pending_approval', 0)).toBe('in_progress');
  });
});

describe('evaluateReadinessGates (projection of the authoritative preflight — never re-derives)', () => {
  const pf = (over: Partial<Parameters<typeof evaluateReadinessGates>[0]> = {}) =>
    ({ ready: false, alreadyReleased: false, blockers: [], status: 'calculated', ...over });

  it('always returns 7 gates', () => {
    expect(evaluateReadinessGates(pf()).gates).toHaveLength(7);
  });
  it('a ready preflight → all gates pass, state ready, 100%', () => {
    const r = evaluateReadinessGates(pf({ ready: true, status: 'approved' }));
    expect(r.gates.every(g => g.state === 'pass')).toBe(true);
    expect(r.state).toBe('ready');
    expect(r.percent).toBe(100);
    expect(r.passed).toBe(7);
  });
  it('already released → released', () => {
    expect(evaluateReadinessGates(pf({ alreadyReleased: true, ready: true, status: 'released' })).state).toBe('released');
  });
  it('NEVER reports ready when preflight.ready is false (even with an unmapped blocker)', () => {
    const r = evaluateReadinessGates(pf({ ready: false, blockers: [{ code: 'some_future_code', message: 'x' }] }));
    expect(r.state).not.toBe('ready');
    // unknown codes bucket to findings_clear so nothing is silently dropped
    expect(r.gates.find(g => g.key === 'findings_clear')!.state).toBe('fail');
  });

  // Negative test for EVERY preflight blocker category → its owning gate fails and readiness is blocked.
  const CASES: Array<[string, string]> = [
    ['run_not_locked', 'inputs_locked'],
    ['calculation_version_missing', 'calculation_current'],
    ['calculation_version_invalid', 'calculation_current'],
    ['control_blockers_open', 'findings_clear'],
    ['nis_period_evidence_invalid', 'findings_clear'],
    ['certification_missing', 'approval_certified'],
    ['certification_version_mismatch', 'approval_certified'],
    ['funding_confirmation_missing', 'funding_confirmed'],
    ['funding_amount_mismatch', 'funding_confirmed'],
    ['gl_journal_missing', 'journal_posted'],
    ['gl_journal_invalid', 'journal_posted'],
    ['gl_journal_unbalanced', 'journal_posted'],
    ['gl_journal_checksum_mismatch', 'journal_posted'],
    ['gl_accounts_invalid', 'journal_posted'],
    ['bank_accounts_missing', 'bank_accounts_ready'],
    ['payslips_not_ready', 'bank_accounts_ready'],
    ['disbursement_conflict', 'bank_accounts_ready'],
    ['remittance_conflict', 'bank_accounts_ready'],
  ];
  it.each(CASES)('blocker %s fails gate %s and blocks readiness', (code, gateKey) => {
    const r = evaluateReadinessGates(pf({ ready: false, blockers: [{ code, message: `${code} msg` }] }));
    const gate = r.gates.find(g => g.key === gateKey)!;
    expect(gate.state).toBe('fail');
    expect(gate.detail).toBe(`${code} msg`);
    expect(r.state).toBe('blocked');
    expect(r.passed).toBe(6);
  });

  it('a draft-like preflight (everything blocked) → not_started', () => {
    const r = evaluateReadinessGates(pf({ ready: false, status: 'draft', blockers: CASES.map(([code]) => ({ code, message: code })) }));
    expect(r.passed).toBe(0);
    expect(r.state).toBe('not_started');
  });
});

describe('activityLabel', () => {
  it('maps known payroll events to friendly labels', () => {
    expect(activityLabel('finance.payroll.run.certified')).toBe('Processor Certified The Run');
    expect(activityLabel('finance.payroll.run.released')).toBe('Payroll Released');
  });
  it('humanizes unknown event types safely', () => {
    expect(activityLabel('finance.payroll.run.some_new_thing')).toBe('Run Some New Thing');
  });
});
