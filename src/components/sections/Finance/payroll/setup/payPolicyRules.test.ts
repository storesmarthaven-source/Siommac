import { buildPayPolicySources, payPolicyDraftStepInvalid } from './payPolicyRules';
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

  it('blocks incomplete identity, dates, components and required sources', () => {
    expect([0, 1, 2, 3, 4].map(step => payPolicyDraftStepInvalid(draft(), step))).toEqual([false, false, false, false, false]);
    expect(payPolicyDraftStepInvalid({ ...draft(), code: '' }, 0)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft(), effectiveTo: '2025-12-31' }, 1)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft(), components: [] }, 2)).toBe(true);
    expect(payPolicyDraftStepInvalid({ ...draft('hourly_shift'), sourceRules: buildPayPolicySources(false) }, 3)).toBe(true);
  });
});
