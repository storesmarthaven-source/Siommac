import { buildPayPolicySources, defaultComponentBinding, isCrewPolicyType, payPolicyDraftStepInvalid } from './payPolicyRules';
import type { PayPolicyDraftInput } from '@api/finance/payPolicies';

const draft = (policyType: PayPolicyDraftInput['policyType'] = 'standard_salary'): PayPolicyDraftInput => ({
  code: 'TT-MONTHLY', name: 'T&T Monthly Salary', description: '', policyType, ownerId: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, changeSummary: 'Initial governed policy',
  dayBoundary: policyType === 'standard_salary' ? 'calendar_day' : 'shift_start',
  components: [{
    componentId: '00000000-0000-4000-8000-000000000001',
    calculationBasis: policyType === 'standard_salary' ? 'salary_period' : 'approved_hours',
    rateSource: policyType === 'standard_salary' ? 'employee_contract' : 'employee_assignment',
    eligibilitySource: policyType === 'standard_salary' ? 'approved_compensation' : 'approved_time',
    ruleParameters: policyType === 'standard_salary' ? { proration: 'working_days' } : {},
    required: true, sortOrder: 0,
  }],
  sourceRules: buildPayPolicySources(policyType === 'hourly_shift'),
});

describe('pay-policy wizard rules', () => {
  it('builds the exact governed T&T source set for salary and hourly policies', () => {
    expect(buildPayPolicySources(false).map(x => x.sourceType)).toEqual([
      'approved_compensation', 'approved_leave', 'statutory_profile', 'payment_destination',
    ]);
    expect(buildPayPolicySources(true).map(x => x.sourceType)).toEqual([
      'approved_compensation', 'approved_time', 'approved_leave', 'statutory_profile', 'payment_destination',
    ]);
  });

  it('blocks incomplete identity, components, sources and governance across the 7 steps', () => {
    // 0 Identity · 1 Work Pattern · 2 Components · 3 Sources · 4 Statutory · 5 Costing · 6 Governance.
    expect([0, 1, 2, 3, 4, 5, 6].map(step => payPolicyDraftStepInvalid(draft(), step)))
      .toEqual([false, false, false, false, false, false, false]);
    expect(payPolicyDraftStepInvalid({ ...draft(), code: '' }, 0)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft(), components: [] }, 2)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft('hourly_shift'), sourceRules: buildPayPolicySources(false) }, 3)).toBe(true);
    // Dates + change summary now gate the final Governance step (6), not step 1.
    expect(payPolicyDraftStepInvalid({ ...draft(), effectiveTo: '2025-12-31' }, 6)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft(), changeSummary: '' }, 6)).toBe(true);
  });

  it('classifies crew policy types', () => {
    expect(isCrewPolicyType('offshore_rotation')).toBe(true);
    expect(isCrewPolicyType('marine_voyage')).toBe(true);
    expect(isCrewPolicyType('standard_salary')).toBe(false);
    expect(isCrewPolicyType('hourly_shift')).toBe(false);
  });

  it('authors the exact component binding each engine expects (matches the backend zod)', () => {
    const cid = '00000000-0000-4000-8000-000000000009';
    expect(defaultComponentBinding('standard_salary', cid, 0)).toEqual({
      componentId: cid, calculationBasis: 'salary_period', rateSource: 'employee_contract',
      eligibilitySource: 'approved_compensation', ruleParameters: { proration: 'working_days' }, required: true, sortOrder: 0,
    });
    expect(defaultComponentBinding('hourly_shift', cid, 1)).toEqual({
      componentId: cid, calculationBasis: 'approved_hours', rateSource: 'employee_assignment',
      eligibilitySource: 'approved_time', ruleParameters: {}, required: true, sortOrder: 1,
    });
    // Crew day-rate: per-qualifying-day, contract rate, crew-movement eligibility, no parameters.
    for (const t of ['offshore_rotation', 'marine_voyage'] as const) {
      expect(defaultComponentBinding(t, cid, 2)).toEqual({
        componentId: cid, calculationBasis: 'per_qualifying_day', rateSource: 'employee_contract',
        eligibilitySource: 'crew_movement', ruleParameters: {}, required: true, sortOrder: 2,
      });
    }
  });
});
