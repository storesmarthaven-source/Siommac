import type { PayPolicyDraftInput, PayPolicySourceRuleInput } from '@api/finance/payPolicies';

export function buildPayPolicySources(hourly: boolean): PayPolicySourceRuleInput[] {
  return [
    { sourceType: 'approved_compensation', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
    ...(hourly ? [{ sourceType: 'approved_time', ownerRole: 'manager', required: true, reconciliationKey: 'employee_work_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'exclude_unapproved_input' } as const] : []),
    { sourceType: 'approved_leave', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_period', lateInputPolicy: 'correction_candidate', conflictSeverity: 'warning', conflictOutcome: 'create_review_finding' },
    { sourceType: 'statutory_profile', ownerRole: 'finance_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
    { sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' },
  ];
}

export function payPolicyDraftStepInvalid(draft: PayPolicyDraftInput, step: number): boolean {
  const invalid = [
    draft.code.trim().length < 2 || draft.name.trim().length < 3 || draft.description.length > 1000,
    !draft.effectiveFrom || (!!draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
      || draft.changeSummary.trim().length < 3,
    !draft.components.length,
    !draft.sourceRules.some(x => x.sourceType === 'statutory_profile' && x.required)
      || !draft.sourceRules.some(x => x.sourceType === 'payment_destination' && x.required)
      || (draft.policyType === 'hourly_shift' && !draft.sourceRules.some(x => x.sourceType === 'approved_time' && x.required)),
    false,
  ];
  return invalid[step] ?? true;
}
