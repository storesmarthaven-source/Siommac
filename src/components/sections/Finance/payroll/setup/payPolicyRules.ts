import type {
  PayPolicyComponentInput, PayPolicyDraftInput, PayPolicySourceRuleInput, PayPolicyType,
} from '@api/finance/payPolicies';

export const isCrewPolicyType = (t: PayPolicyType): boolean =>
  t === 'offshore_rotation' || t === 'marine_voyage';

// The wizard fixes each bound component's calculation model by policy type — the backend
// zod + preflight enforce the exact same shape, so what the wizard authors always validates.
// Crew (offshore/marine) day-rate: per-qualifying-day, rate from the employee contract,
// eligibility from crew movements, no parameters (CP7b §14.4 locked decision).
export function defaultComponentBinding(
  policyType: PayPolicyType, componentId: string, sortOrder: number,
): PayPolicyComponentInput {
  if (isCrewPolicyType(policyType)) {
    return {
      componentId, calculationBasis: 'per_qualifying_day', rateSource: 'employee_contract',
      eligibilitySource: 'crew_movement', ruleParameters: {}, required: true, sortOrder,
    };
  }
  if (policyType === 'hourly_shift') {
    return {
      componentId, calculationBasis: 'approved_hours', rateSource: 'employee_assignment',
      eligibilitySource: 'approved_time', ruleParameters: {}, required: true, sortOrder,
    };
  }
  return {
    componentId, calculationBasis: 'salary_period', rateSource: 'employee_contract',
    eligibilitySource: 'approved_compensation', ruleParameters: { proration: 'working_days' },
    required: true, sortOrder,
  };
}

export function buildPayPolicySources(hourly: boolean): PayPolicySourceRuleInput[] {
  return [
    { sourceType: 'approved_compensation', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
    ...(hourly ? [{ sourceType: 'approved_time', ownerRole: 'manager', required: true, reconciliationKey: 'employee_work_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'exclude_unapproved_input' } as const] : []),
    { sourceType: 'approved_leave', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_period', lateInputPolicy: 'correction_candidate', conflictSeverity: 'warning', conflictOutcome: 'create_review_finding' },
    { sourceType: 'statutory_profile', ownerRole: 'finance_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
    { sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' },
  ];
}

// Seven-step wizard (create-crew-package.html): 0 Identity · 1 Work Pattern ·
// 2 Pay Components · 3 Source Controls · 4 Statutory · 5 Cost & Payment · 6 Governance.
// Steps 4/5 are governed-display (fixed by the contract) so they never block.
export const PAY_POLICY_WIZARD_STEPS = 7;
export function payPolicyDraftStepInvalid(draft: PayPolicyDraftInput, step: number): boolean {
  const invalid = [
    draft.code.trim().length < 2 || draft.name.trim().length < 3 || draft.description.length > 1000,
    !draft.dayBoundary,
    !draft.components.length,
    !draft.sourceRules.some(x => x.sourceType === 'statutory_profile' && x.required)
      || !draft.sourceRules.some(x => x.sourceType === 'payment_destination' && x.required)
      || (draft.policyType === 'hourly_shift' && !draft.sourceRules.some(x => x.sourceType === 'approved_time' && x.required)),
    false,
    false,
    !draft.effectiveFrom || (!!draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
      || draft.changeSummary.trim().length < 3,
  ];
  return invalid[step] ?? true;
}
