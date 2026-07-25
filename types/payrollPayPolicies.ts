// CP7b: 'offshore_rotation'/'marine_voyage' + the per_qualifying_day/crew_movement
// pair are authorable — the crew day-rate engine honors them. 'project' and
// 'standby_callout' stay OUT of the unions until an engine exists (§14.4).
export type PayPolicyType = 'standard_salary' | 'hourly_shift' | 'offshore_rotation' | 'marine_voyage';
export type PayPolicyStatus = 'draft' | 'active' | 'retired';
export type PayPolicyVersionStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'active' | 'superseded' | 'rejected' | 'retired';
export type PayCalculationBasis = 'salary_period' | 'approved_hours' | 'per_qualifying_day';
export type PayRateSource = 'employee_contract' | 'employee_assignment';
export type PayEligibilitySource = 'effective_employment' | 'approved_compensation' | 'approved_time' | 'crew_movement';
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

// ── Setup command-center overview (read model behind the Pay Policies dashboard) ──
// Every field is DERIVED from the real policy/version/assignment/member/event tables +
// live preflight over the in-review versions — no static or faked values.
export interface PayPolicyOverview {
  generatedAt: string;
  band: {
    configuredPolicies: number;   // total non-retired policies
    coveredEmployees: number;     // distinct active members of pay groups with an active policy assignment
    payGroupsAssigned: number;    // distinct pay groups with an active policy assignment
    draftVersions: number;        // versions in draft / pending_approval / approved (in review)
    nextEffectiveDate: string | null;
    integrityFindings: number;    // total preflight blockers across in-review versions
  };
  metrics: {
    activePolicies: number;
    retiringPolicies: number;     // active policies whose current version has a scheduled effective-to
    pendingVersions: number;      // versions in pending_approval / approved
    assignedEmployees: number;    // == band.coveredEmployees
    workPatterns: number;         // distinct policy types among active policies
    workPatternLabels: string[];
    setupFindings: number;        // in-review versions with ≥1 blocker
    blockingFindings: number;     // in-review versions whose blocker set blocks activation
    versionsThisYear: number;
  };
  banner: {
    policyId: string; policyCode: string; policyName: string;
    versionId: string; versionNo: number; ownerLabel: string; title: string; detail: string;
  } | null;
  integrity: Array<{ code: string; label: string; value: string; tone: 'ok' | 'warning' | 'danger' }>;
  upcoming: Array<{ policyId: string; tone: 'blue' | 'amber' | 'red'; title: string; detail: string; meta: string }>;
  activity: Array<{ id: string; tone: 'blue' | 'amber' | 'green' | 'red'; label: string; detail: string; occurredAt: string }>;
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
