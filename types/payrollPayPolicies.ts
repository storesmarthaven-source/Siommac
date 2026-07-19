export type PayPolicyType = 'standard_salary' | 'hourly_shift';
export type PayPolicyStatus = 'draft' | 'active' | 'retired';
export type PayPolicyVersionStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'active' | 'superseded' | 'rejected' | 'retired';
export type PayCalculationBasis = 'salary_period' | 'approved_hours';
export type PayRateSource = 'employee_contract' | 'employee_assignment';
export type PayEligibilitySource = 'effective_employment' | 'approved_compensation' | 'approved_time';
export type PayPolicySourceType =
  | 'approved_compensation' | 'approved_time' | 'approved_leave' | 'statutory_profile' | 'payment_destination';
export type PayConflictOutcome =
  | 'exclude_unapproved_input' | 'create_review_finding' | 'block_employee_calculation'
  | 'block_input_lock' | 'create_correction_candidate';

export interface PayPolicyComponentInput {
  componentId: string;
  calculationBasis: PayCalculationBasis;
  rateSource: PayRateSource;
  eligibilitySource: PayEligibilitySource;
  ruleParameters: { proration: 'calendar_days' | 'working_days' } | Record<string, never>;
  required: boolean;
  sortOrder: number;
}

export interface PayPolicySourceRuleInput {
  sourceType: PayPolicySourceType;
  ownerRole: 'hr_manager' | 'finance_staff' | 'finance_manager' | 'manager';
  required: boolean;
  reconciliationKey: 'employee_effective_date' | 'employee_period' | 'employee_work_date';
  lateInputPolicy: 'exclude_and_review' | 'correction_candidate';
  conflictSeverity: 'warning' | 'blocker';
  conflictOutcome: PayConflictOutcome;
}

export interface PayPolicyDraftInput {
  code: string;
  name: string;
  description: string;
  policyType: PayPolicyType;
  ownerId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeSummary: string;
  dayBoundary: 'calendar_day' | 'shift_start';
  components: PayPolicyComponentInput[];
  sourceRules: PayPolicySourceRuleInput[];
}

export interface PayPolicySummary {
  id: string;
  code: string;
  name: string;
  description: string;
  policyType: PayPolicyType;
  workforceType: 'salaried' | 'hourly';
  status: PayPolicyStatus;
  ownerId: string | null;
  currentVersion: { id: string; versionNo: number; status: PayPolicyVersionStatus; effectiveFrom: string; effectiveTo: string | null; checksum: string | null } | null;
  versionCount: number;
  assignmentCount: number;
  updatedAt: string;
}

export interface PayPolicyVersionDto {
  id: string;
  policyId: string;
  versionNo: number;
  status: PayPolicyVersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeSummary: string;
  timezone: 'America/Port_of_Spain';
  dayBoundary: 'calendar_day' | 'shift_start';
  statutoryBinding: 'approved_by_pay_date';
  currency: 'TTD';
  paymentDestination: 'primary_bank_account';
  missingBankOutcome: 'block_release';
  workflowId: string | null;
  checksum: string | null;
  lockVersion: number;
  preparedBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  activatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayPolicyPreflight {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  checksum: string;
  statutoryVersionId: string | null;
  counts: { components: number; requiredSources: number; costingRules: number };
}

export interface PayPolicyWorkspace {
  policy: PayPolicySummary;
  version: PayPolicyVersionDto | null;
  components: Array<PayPolicyComponentInput & { id: string; componentCode: string; componentName: string; componentKind: 'earning' | 'deduction' }>;
  sourceRules: Array<PayPolicySourceRuleInput & { id: string }>;
  versions: PayPolicyVersionDto[];
  assignments: Array<{ id: string; payGroupId: string; payGroupCode: string; payGroupName: string; frequency: string; memberCount: number; versionId: string; versionNo: number; effectiveFrom: string; effectiveTo: string | null; status: 'active' | 'ended' }>;
  audit: Array<{ id: string; type: string; actorId: string | null; occurredAt: string; payload: Record<string, unknown> }>;
}
