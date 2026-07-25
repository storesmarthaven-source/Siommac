/**
 * src/api/finance/payroll.ts
 *
 * Typed client + TanStack hooks for the Finance Payroll backend
 * (routes/financePayroll.ts + routes/financeNis.ts — POST `finance/payroll/*`).
 * Finance owns payroll runs, run lines, warnings, payslips, exports, reports, and
 * NIS-profile verification. `actorId` is server-derived — never sent by the client.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { PAYROLL_ERROR_FALLBACK_CODE, type PayrollApiErrorBody } from '../../../types/payrollErrors';
import type { PayrollRunActions, PayrollRunCreateAttestations } from '../../../types/payrollRuns';

export type { PayrollRunActions, PayrollRunCreateAttestations };
import type {
  ReportCatalogEntry,
  ReportKpiTiles,
  ReportRunResult,
  ReportArtifactRow,
  ReportJobStatus,
  ReportDownloadResponse,
  ReportParams,
  ReportFormat,
  PayrollReportKey,
  PageResult,
} from '../../../types/payrollReports';

// ── DTOs ──────────────────────────────────────────────────────────────────────

/** F-02: pinned pay policy (+ work-calendar pin) for the run-detail chips.
 * Mirrors the backend PayrollRunPayPolicy DTO (payrollRuns.ts). Null on
 * legacy/unpinned runs. */
export interface PayrollRunPayPolicy {
  versionId: string;
  checksum: string | null;
  required: boolean;
  policyName: string | null;
  versionNo: number | null;
  calendar: {
    workCalendarVersionId: string;
    workCalendarChecksum: string | null;
    holidayCalendarChecksum: string | null;
    scope: string | null;
    periodDenominator: string | null;
  } | null;
}

export interface PayrollRun {
  id: string;
  runNo: string;
  periodMonth: string;
  payFrequency: string;
  status: string;
  statutoryVersionId: string;
  weeksInPeriod: number;
  payGroup: string | null;
  payGroupId: string | null;
  payDate: string | null;
  cutOffDate: string | null;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  nisEmployerTotal: number;
  workflowId: string | null;
  currentInputSnapshotId: string | null;
  inputLockedBy: string | null;
  inputLockedAt: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
  templateId: string | null;
  /** F-02 (API-PPR-004): pinned policy + calendar; null on legacy/unpinned runs. */
  payPolicy: PayrollRunPayPolicy | null;
}

export interface PayrollRunInput {
  id: string;
  runId: string;
  employeeId: string;
  sourceType: string;
  sourceId: string | null;
  componentCode: string | null;
  label: string | null;
  amount: number | null;
  quantity: number | null;
  rate: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PayrollRunLine {
  id: string;
  runId: string;
  employeeId: string;
  base: number;
  taxableGross: number;
  gross: number;
  nisEmployee: number;
  nisEmployer: number;
  healthSurcharge: number;
  chargeableIncome: number;
  paye: number;
  voluntaryDeductions: number;
  net: number;
  breakdown: Record<string, unknown>;
  departmentId: string | null;
  costCenterId: string | null;
  nisNumberMasked: string | null;
  nisStatus: string | null;
  nisClassNo: number | null;
  openingYtdNisEmployee: number;
  openingYtdNisEmployer: number;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunWarning {
  id: string;
  runId: string;
  employeeId: string | null;
  warningType: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

// ── F-02 policy-evidence (API-PPR-005, contract §6d) ─────────────────────────────
// Mirrors the backend PolicyEvidenceDto (payrollRuns.ts). The manifest item shapes
// mirror the manifest built by finance_payroll_lock_inputs_tx (mig 711).

export interface PolicyEvidenceComponent {
  componentId: string;
  componentCode: string | null;
  calculationBasis: string | null;
  rateSource: string | null;
  eligibilitySource: string | null;
  ruleParameters: Record<string, unknown> | null;
  isRequired: boolean;
  sortOrder: number;
}
export interface PolicyEvidenceSourceRule {
  sourceType: string;
  ownerRole: string | null;
  required: boolean;
  reconciliationKey: string | null;
  cutoffPolicy: string | null;
  lateInputPolicy: string | null;
  conflictSeverity: string | null;
  conflictOutcome: string | null;
}
export interface PolicyEvidenceCostingRule {
  dimension: string;
  resolutionSource: string | null;
  required: boolean;
  missingOutcome: string | null;
}
export interface PolicyEvidenceConflict {
  employeeId: string;
  sourceType: string;
  conflictOutcome: string;
  reasonCode: string;
}
export interface PolicyEvidenceExcluded {
  employeeId: string;
  reasonCode: string;
}
export interface PolicyEvidenceCalendarEmployee {
  employeeId: string;
  employeeName: string;
  numerator: string;
  denominator: string;
  clampFrom: string | null;
  clampTo: string | null;
  excludedCount: number;
}
export interface PolicyEvidenceCalendar {
  workCalendarName: string | null;
  workCalendarVersionNo: number | null;
  holidayCalendarName: string | null;
  holidayChecksumShort: string | null;
  resolution: { scope: string | null; assignmentId: string | null };
  periodDenominator: string | null;
  employees: PolicyEvidenceCalendarEmployee[];
}
export interface PolicyEvidence {
  runId: string;
  inputSnapshotId: string;
  checksum: string | null;
  components: PolicyEvidenceComponent[];
  sourceRules: PolicyEvidenceSourceRule[];
  costingRules: PolicyEvidenceCostingRule[];
  statutory: Record<string, unknown>;
  sourceConflicts: PolicyEvidenceConflict[];
  excludedEmployees: PolicyEvidenceExcluded[];
  calendar: PolicyEvidenceCalendar | null;
}

export interface Payslip {
  id: string;
  payslipNo: string;
  runId: string;
  runLineId: string;
  employeeId: string;
  filePath: string | null;
  generatedAt: string;
  generatedBy: string | null;
  metadata: Record<string, unknown>;
}

export interface PayslipDelivery {
  id: string;
  payslipId: string;
  runId: string;
  employeeId: string;
  channel: string;
  recipient: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  passwordProtected: boolean;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface GlPreviewLine {
  mappingKey: string;
  accountCode: string | null;
  accountName: string | null;
  side: 'debit' | 'credit';
  amount: number;
}
export interface GlPreview {
  runId: string;
  lines: GlPreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  missingMappings: string[];
  alreadyPosted: boolean;
  journalId: string | null;
}
export interface GlJournalLine {
  lineNo: number; accountCode: string; debit: number; credit: number;
  description: string | null; costCenterId: string | null;
}
export interface GlJournal {
  id: string; journalNo: string; entryDate: string; memo: string | null;
  status: 'draft' | 'posted' | 'reversed';
  sourceModule: string; sourceRef: string | null;
  postedAt: string | null; postedBy: string | null;
  reversedAt: string | null; reversalOf: string | null; createdAt: string;
  lines: GlJournalLine[]; totalDebit: number; totalCredit: number;
}

export interface PayrollExport {
  id: string;
  exportNo: string;
  runId: string;
  /** The backend export enum — only these two are ever produced (runs/export Zod contract). */
  format: 'csv' | 'json';
  filePath: string;
  checksum: string | null;
  generatedBy: string | null;
  generatedAt: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
}

/** Lightweight template descriptor for pickers — no design payload. */
export interface PayslipTemplateSummary {
  id:        string;
  name:      string;
  isDefault: boolean;
  updatedAt: number; // epoch ms
  status:    string; // 'draft' | 'pending_approval' | 'changes_requested' | 'approved' | 'archived'
}

export interface NisProfileRow {
  id:                    string;
  employeeId?:           string;
  employee_id?:          string;
  nisStatus?:            string;
  nis_status?:           string;
  nisNumber?:            string;
  nis_number?:           string;
  previousEmployerName?: string;
  previous_employer_name?: string;
  verifiedAt?:           string;
  verified_at?:          string;
  isActive?:             boolean;
  isStatutory?:          boolean;
  isTaxable?:            boolean;
  reducesChargeable?:    boolean;
  [key: string]:         unknown;
}

export interface RunAuditLogEntry {
  id:            string;
  action:        string;
  actorId:       string | null;
  previousState: Record<string, unknown> | null;
  newState:      Record<string, unknown> | null;
  reason:        string | null;
  createdAt:     string;
}

export type PayrollRunType = 'scheduled' | 'off_cycle' | 'correction' | 'final_pay';

/**
 * Exact contract for POST /finance/payroll/runs/create (see financePayroll.ts).
 * The route REQUIRES idempotencyKey + runType + periodStart + periodEnd; the
 * caller derives periodStart/End from the chosen period and owns the idempotency
 * key (stable across retries of one submit attempt).
 */
export interface CreateRunArgs {
  idempotencyKey: string;   // caller-owned, stable across retries of one submit
  runType: PayrollRunType;
  periodStart: string;      // YYYY-MM-DD
  periodEnd: string;        // YYYY-MM-DD
  sequenceNo?: number;
  sourceRunId?: string;     // required for correction runs (traceability)
  payFrequency?: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  weeksInPeriod?: number;
  payGroupId?: string;      // scopes the run; drives frequency + population + policy
  payDate?: string;         // YYYY-MM-DD actual payment date
  cutOffDate?: string;      // YYYY-MM-DD cut-off date for changes
  // Slice 1 run metadata (all optional; owner defaults server-side to the creator)
  reasonCode?: string;
  payrollOwnerId?: string;
  otCutoffAt?: string;          // YYYY-MM-DDTHH:MM
  approvalDeadlineAt?: string;  // YYYY-MM-DDTHH:MM
  fundingDate?: string;         // YYYY-MM-DD
  releaseWindow?: string;
  internalDescription?: string;
  /** P0-4: REQUIRED creation governance attestations — all three literally true.
   *  Persisted server-side in the create transaction's event + audit evidence. */
  attestations: PayrollRunCreateAttestations;
}

export interface PayrollReasonCode { code: string; label: string; runType: string | null; sortOrder: number }

export interface PayGroup {
  id: string;
  code: string;
  name: string;
  frequency: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  defaultPayDay: number | null;
  defaultCutoffOffsetDays: number;
  statutoryCountry: string;
  active: boolean;
  memberCount?: number;
  createdAt: string;
}
export interface PayGroupMember { employeeId: string; effectiveFrom: string; effectiveTo: string | null }

export type LoanType = 'loan' | 'advance';
export type LoanStatus = 'draft' | 'pending_approval' | 'active' | 'settled' | 'cancelled' | 'rejected';
export interface EmployeeLoan {
  id: string;
  reference: string;
  employeeId: string;
  loanType: LoanType;
  principal: number;
  interestAmount: number;
  totalRepayable: number;
  installmentAmount: number;
  balance: number;
  startPeriod: string | null;
  status: LoanStatus;
  reason: string | null;
  notes: string | null;
  workflowId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OvertimeEventType =
  | 'regular_overtime' | 'public_holiday' | 'rest_day' | 'callout' | 'night_shift';

export interface OvertimeRule {
  id: string;
  code: string;
  eventType: OvertimeEventType;
  multiplier: number;
  minimumHours: number | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface PayrollOverride {
  id: string;
  runId: string;
  employeeId: string;
  label: string;
  amount: number;
  kind: 'earning' | 'deduction';
  isTaxable: boolean;
  reducesChargeable: boolean;
  reason: string | null;
  createdAt: string;
}

export interface BackPayPeriod {
  runId: string;
  periodMonth: string;
  oldBase: number;
  correctedBase: number;
  delta: number;
}
export interface BackPayBreakdown {
  employeeId: string;
  currentRunId: string;
  fromPeriodMonth: string;
  /** When the correction became effective. */
  effectiveDate: string;
  correctedPeriodBase: number;
  periods: BackPayPeriod[];
  totalDelta: number;
  scope: { payGroupId: string | null; payFrequency: string };
}

export interface PopulationPreview {
  total:                   number;
  salaried:                number;
  hourly:                  number;
  missingPayBasis:         number;
  newHires:                number;
  terminations:            number;
  missingStatutoryProfile: number;
}

// Population reconciliation (create-run wizard step 5, Slice 2) — pay-group-scoped.
export interface PopulationReconciliationRule {
  key:       string;
  label:     string;
  count:     number;
  rule:      string;
  ownerRole: 'hr' | 'finance' | 'payroll';
  state:     'included' | 'review' | 'blocker' | 'warning';
  action:    string | null;
}
export interface PopulationReconciliationDept {
  departmentId: string | null;
  name:         string;
  count:        number;
}
export interface PopulationReconciliationPriorRun {
  runId:              string | null;
  releasedPopulation: number;
  added:              number;
  removed:            number;
  proposed:           number;
}
export interface PopulationReconciliation {
  rules:       PopulationReconciliationRule[];
  departments: PopulationReconciliationDept[];
  priorRun:    PopulationReconciliationPriorRun;
}

// Input-source readiness (create-run wizard step 6, Slice 3) — pay-group-scoped.
export interface InputSourceReadiness {
  key:         string;
  label:       string;
  records:     number;
  freshnessAt: string | null;
  ownerRole:   'hr' | 'finance' | 'payroll';
  state:       'ready' | 'pending' | 'review';
}
export interface InputReadiness {
  sources: InputSourceReadiness[];
  /** B-02: the paid population the readiness was computed over — 0 is never "ready". */
  populationCount: number;
}

export interface ExportDownload {
  exportId:  string;
  exportNo:  string;
  runId:     string;
  format:    string;
  content:   string;
  mimeType:  string;
  filename:  string;
}

export interface ResolveWarningResult {
  id:         string;
  resolved:   boolean;
  resolvedBy: string;
  resolvedAt: string;
}

// ── Run workspace / release preflight / calculation versions (full-page run detail) ──
// Thin FE mirrors of the backend DTOs (workspace.ts / releases.ts / execution.ts).

export interface PayrollInputSnapshotInfo {
  id: string; snapshotNo: number; checksum: string;
  employeeCount: number; inputCount: number;
  sourceSummary: Record<string, unknown>;
  lockedBy: string | null; lockedAt: string;
}
export interface PayrollCalculationVersion {
  id: string; runId: string; attemptId: string | null; inputSnapshotId: string;
  versionNo: number; checksum: string; employeeCount: number;
  grossTotal: number; deductionTotal: number; netTotal: number; nisEmployerTotal: number;
  statutoryVersionId: string; publishedBy: string | null; publishedAt: string;
}
export interface PayrollCalculationAttempt {
  id: string; runId: string; inputSnapshotId: string; attemptNo: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'; stage: string; progress: number;
  correlationId: string; errorCode: string | null; errorMessage: string | null;
  createdBy: string | null; startedAt: string; leaseExpiresAt: string; completedAt: string | null;
}
export type PayrollFindingSeverity = 'info' | 'warning' | 'blocker';
export type PayrollFindingState = 'open' | 'in_progress' | 'resolved' | 'waived';
export interface PayrollFindingSummary {
  total: number; actionable: number; blockers: number; warnings: number; info: number;
  byState: Record<string, number>; byDomain: Record<string, number>;
}
export interface PayrollControlFinding {
  id: string; runId: string; calculationVersionId: string;
  sourceType: string; sourceId: string; findingType: string;
  domain: string; severity: PayrollFindingSeverity; state: PayrollFindingState;
  title: string; detail: string; employeeId: string | null; assigneeId: string | null;
  dueAt: string | null; version: number;
  resolutionNote: string | null; resolvedBy: string | null; resolvedAt: string | null;
  waiverReason: string | null; waivedBy: string | null; waivedAt: string | null; waiverExpiresAt: string | null;
  createdAt: string; updatedAt: string;
}
// ── CP8: conditional crew capability (mirrors backend crewRun.ts) ───────────────
export interface CrewEmployeeBlocker { count: number; employeeIds: string[] }
export interface CrewMovementBlocker { count: number; movementIds: string[] }
export interface CrewDayRateAllocation {
  assignmentId: string; contractId: string;
  compensationAmount: number; currency: 'TTD'; period: 'daily';
  effectiveFrom: string; effectiveTo: string | null;
  qualifyingDates: string[]; qualifyingDays: number; earningAmount: number;
}
export interface CrewDayRateEmployee {
  employeeId: string; allocations: CrewDayRateAllocation[];
  totalDays: number; totalAmount: number;
}
export interface CrewRunEvidence {
  policyType: string;
  rotationPatternId: string | null;
  dayBoundary: string | null;
  expectedCrew: number;
  assignmentCount: number;
  movementCount: number;
  movementsByType: Record<string, number>;
  approvedTimeEmployeeCount: number;
  approvedLeaveEmployeeCount: number;
  assignmentIds: string[];
  movementIds: string[];
  excludedUnapprovedOvertime?: { count: number; entries: { id: string; employeeId: string; workDate: string }[] };
  dayRate?: {
    policyComponentId: string; componentId: string; componentCode: string;
    isTaxable: boolean; perEmployee: CrewDayRateEmployee[];
  };
  blockers: {
    rosterWithoutMovement: CrewEmployeeBlocker;
    movementWithoutAssignment: CrewMovementBlocker;
    overlappingAssignments: CrewEmployeeBlocker;
    missingPaymentDestination: CrewEmployeeBlocker;
    incompleteStatutoryProfile?: CrewEmployeeBlocker;
  };
}

export interface PayrollRunWorkspace {
  run: PayrollRun;
  inputSnapshot: PayrollInputSnapshotInfo | null;
  currentCalculationVersion: PayrollCalculationVersion | null;
  calculationAttempts: PayrollCalculationAttempt[];
  findingSummary: PayrollFindingSummary;
  priorityFindings: PayrollControlFinding[];
  audit: RunAuditLogEntry[];
  /** P0-2: server-computed per-actor action capabilities — the UI's only source. */
  actions: PayrollRunActions;
  /** CP8 (§14.7): frozen crew evidence — null on every non-crew run. */
  crew: CrewRunEvidence | null;
  /** Display names for every employee id in `crew`; null exactly when crew is null. */
  crewEmployeeNames: Record<string, string> | null;
}
export interface PayrollReleasePreflight {
  runId: string; runNo: string; status: string; ready: boolean; alreadyReleased: boolean;
  blockers: { code: string; message: string }[];
  calculationVersionId: string | null; certificationId: string | null;
  fundingConfirmationId: string | null; glJournalId: string | null;
  glDebit: number; glCredit: number;
  invalidGlAccountCount: number; invalidNisPeriodCount: number;
  payslipCount: number; renderedPayslipCount: number;
  missingBankAccountCount: number; disbursementId: string | null;
  netPayroll: number; employeeCount: number;
}
/** Processor certification of the current calculation package — the maker-checker
 *  gate the submit RPC requires before a run can enter approval (errcode PR422:
 *  "certify the current calculation before submission" otherwise). */
export interface PayrollCertification {
  id: string; runId: string; calculationVersionId: string; inputSnapshotId: string;
  certificationNo: number; certificationType: 'processor';
  evidence: Record<string, unknown>; stateChecksum: string; checksum: string;
  supersedesId: string | null; certifiedBy: string; certifiedAt: string; createdAt: string;
}
/** The six processor attestations — each MUST be literally `true`; the backend Zod
 *  contract (z.literal(true)) rejects any missing/false attestation. */
export interface PayrollCertifyAttestations {
  populationReconciled: true; inputsReviewed: true; statutoryReviewed: true;
  variancesReviewed: true; paymentReadinessReviewed: true; glReadinessReviewed: true;
}
export interface PayrollCertifyResult {
  certification: PayrollCertification;
  controlState: Record<string, unknown>;
  eventId: string; duplicate: boolean;
}
/** F-08 — issued payroll release certificate (immutable close evidence). */
export interface PayrollReleaseCertificate {
  id: string; runId: string; calculationVersionId: string; certificationId: string;
  fundingConfirmationId: string; glJournalId: string; disbursementId: string;
  controlTotals: Record<string, unknown>; payslipManifest: Record<string, unknown>;
  artifactChecksums: Record<string, unknown>; checksum: string;
  releasedBy: string; releasedAt: string; createdAt: string;
  remittances?: { id: string; authority: string; periodYear: number; periodMonth: number }[];
}
export interface PayrollCalculationComparison {
  runId: string; from: PayrollCalculationVersion; to: PayrollCalculationVersion;
  totals: { grossDelta: number; deductionDelta: number; netDelta: number; nisEmployerDelta: number; employeeCountDelta: number };
  changedEmployees: number; addedEmployees: number; removedEmployees: number;
  changes: { employeeId: string; change: 'added' | 'removed' | 'changed'; grossDelta: number; deductionDelta: number; netDelta: number }[];
}

// ── Typed error + core call helper ──────────────────────────────────────────────

/**
 * P0-5: the typed payroll API error. UI code switches on `code` (and renders
 * `fieldErrors` / shows `correlationId`) — NEVER by matching message substrings.
 * `message` stays the sanitized human summary so existing toasts keep working.
 */
export class PayrollApiError extends Error {
  readonly code: string;
  readonly correlationId: string | null;
  readonly fieldErrors: Record<string, string> | undefined;
  readonly retryable: boolean;
  constructor(body: Partial<PayrollApiErrorBody> & { message: string }) {
    super(body.message);
    this.name = 'PayrollApiError';
    this.code = body.code ?? PAYROLL_ERROR_FALLBACK_CODE;
    this.correlationId = body.correlationId ?? null;
    this.fieldErrors = body.fieldErrors;
    this.retryable = body.retryable ?? false;
  }
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string; error?: PayrollApiErrorBody }>(
    path, args as Record<string, unknown>,
  );
  if (!res.success) {
    const message = res.error?.message ?? res.message ?? `Request to ${path} failed.`;
    throw new PayrollApiError({ ...res.error, message });
  }
  return res.data;
}

// ── API object ──────────────────────────────────────────────────────────────────

export const financePayrollApi = {
  // Runs — the register list (runs/list) moved to the keyset contract in
  // src/api/finance/payrollRunsRegister.ts (runsRegisterApi.list → PayrollRunListResult).
  getRun:      (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/get', a),
  createRun:   (a: CreateRunArgs)                       => call<PayrollRun>('finance/payroll/runs/create', a),
  // idempotencyKey is REQUIRED on every state-advancing run command (the backend Zod
  // contract rejects its absence with 400) and must be stable across retries of ONE
  // attempt — the caller mints it once per attempt and reuses it so a lost response
  // recovers via the receipt; a fresh per-call key can't dedupe. See the
  // PayrollCommandCenter stableAction helper. reopen additionally REQUIRES a reason.
  lockInputs:  (a: { id: string; idempotencyKey: string }) => call<PayrollRun>('finance/payroll/runs/lock-inputs', a),
  calculate:   (a: { id: string; idempotencyKey: string }) => call<PayrollRun>('finance/payroll/runs/calculate', a),
  // Processor certification of the CURRENT calculation package. REQUIRED before
  // submit — the submit RPC guards on a `processor` certification for the run's
  // current calculation version (PR422 otherwise). All six attestations must be
  // literally true; the caller mints one idempotencyKey per certification attempt.
  certifyRun:  (a: { runId: string; idempotencyKey: string; attestations: PayrollCertifyAttestations; note?: string }) =>
                 call<PayrollCertifyResult>('finance/payroll/runs/certify', a),
  submitRun:   (a: { id: string; idempotencyKey: string }) => call<PayrollRun>('finance/payroll/runs/submit', a),
  approveRun:  (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/approve', a),
  rejectRun:   (a: { id: string; reason: string })     => call<PayrollRun>('finance/payroll/runs/reject', a),
  lockRun:     (a: { id: string; idempotencyKey: string }) => call<PayrollRun>('finance/payroll/runs/lock', a),
  reopenRun:   (a: { id: string; reason: string; idempotencyKey: string }) => call<PayrollRun>('finance/payroll/runs/reopen', a),
  exportRun:   (a: { id: string; idempotencyKey: string; format?: 'csv' | 'json' }) => call<PayrollExport>('finance/payroll/runs/export', a),

  // Run detail
  listInputs:   (a: { runId: string })                 => call<PayrollRunInput[]>('finance/payroll/inputs/list', a),
  listRunLines: (a: { runId: string })                 => call<PayrollRunLine[]>('finance/payroll/run-lines/list', a),
  listWarnings: (a: { runId: string })                 => call<PayrollRunWarning[]>('finance/payroll/warnings/list', a),
  // F-02 (API-PPR-005): pinned policy-evidence manifest + calendar block for a run
  // snapshot. Defaults to the run's current snapshot; pass inputSnapshotId for history.
  getPolicyEvidence: (a: { runId: string; inputSnapshotId?: string }) =>
    call<PolicyEvidence>('finance/payroll/runs/policy-evidence', a),
  // Full-page run-detail composite + readiness + calc-version reads.
  getWorkspace:        (a: { id: string })                        => call<PayrollRunWorkspace>('finance/payroll/runs/workspace', a),
  releasePreflight:    (a: { runId: string })                     => call<PayrollReleasePreflight>('finance/payroll/releases/preflight', a),
  // F-08 Close & Release: confirm funding → issue release certificate (atomic; creates downstream drafts).
  confirmFunding:      (a: { runId: string; idempotencyKey: string; confirmedAmount: number; confirmationReference: string; accountReference?: string; note?: string }) =>
                          call<{ id: string }>('finance/payroll/releases/confirm-funding', a),
  releaseRun:          (a: { runId: string; idempotencyKey: string }) => call<{ releaseCertificate: PayrollReleaseCertificate }>('finance/payroll/releases/release', a),
  getReleaseCertificate: (a: { runId: string })                   => call<PayrollReleaseCertificate>('finance/payroll/releases/get-certificate', a),
  listCalcVersions:    (a: { runId: string })                     => call<PayrollCalculationVersion[]>('finance/payroll/calculations/versions/list', a),
  compareCalcVersions: (a: { fromVersionId: string; toVersionId: string }) => call<PayrollCalculationComparison>('finance/payroll/calculations/compare', a),

  // Exports
  listExports:  (a: { runId: string })                 => call<PayrollExport[]>('finance/payroll/exports/list', a),

  // Payslips
  generatePayslips: (a: { runId: string })             => call<{ generated: number }>('finance/payroll/payslips/generate', a),
  renderRunPayslips:(a: { runId: string })             => call<{ rendered: number; failed: number; total: number }>('finance/payroll/payslips/render-run', a),
  renderPayslip:    (a: { payslipId: string })         => call<Payslip>('finance/payroll/payslips/render', a),
  deliverRunPayslips:(a: { runId: string })            => call<{ sent: number; failed: number; skipped: number; total: number }>('finance/payroll/payslips/deliver-run', a),
  deliverPayslip:   (a: { payslipId: string })         => call<PayslipDelivery>('finance/payroll/payslips/deliver', a),
  listDeliveries:   (a: { runId: string })             => call<PayslipDelivery[]>('finance/payroll/payslips/deliveries/list', a),

  // Worksheet overrides
  addOverride:    (a: { runId: string; employeeId: string; label: string; amount: number; kind: 'earning' | 'deduction'; isTaxable?: boolean; reducesChargeable?: boolean; reason: string }) => call<PayrollOverride>('finance/payroll/overrides/add', a),
  addOverridesBulk:(a: { runId: string; employeeIds: string[]; label: string; amount: number; kind: 'earning' | 'deduction'; isTaxable?: boolean; reducesChargeable?: boolean; reason: string }) => call<{ applied: number; skipped: number; overrides: PayrollOverride[] }>('finance/payroll/overrides/add-bulk', a),
  removeOverride: (a: { overrideId: string })          => call<{ id: string; removed: boolean }>('finance/payroll/overrides/remove', a),
  listOverrides:  (a: { runId: string })               => call<PayrollOverride[]>('finance/payroll/overrides/list', a),

  // Back pay (retro adjustment)
  backPayPreview: (a: { currentRunId: string; employeeId: string; fromPeriodMonth: string; correctedPeriodBase: number; effectiveDate?: string }) =>
                    call<BackPayBreakdown>('finance/payroll/back-pay/preview', a),
  backPayAdd:     (a: { currentRunId: string; employeeId: string; fromPeriodMonth: string; correctedPeriodBase: number; reason: string; effectiveDate?: string }) =>
                    call<{ inputId: string; breakdown: BackPayBreakdown }>('finance/payroll/back-pay/add', a),

  // Pay groups
  listPayGroups:  (a: { activeOnly?: boolean } = {})   => call<PayGroup[]>('finance/payroll/pay-groups/list', a),
  listReasonCodes:(a: { runType?: string } = {})       => call<PayrollReasonCode[]>('finance/payroll/reason-codes/list', a),
  createPayGroup: (a: { code: string; name: string; frequency: string; defaultPayDay?: number; defaultCutoffOffsetDays?: number }) => call<PayGroup>('finance/payroll/pay-groups/create', a),
  assignPayGroup: (a: { employeeId: string; payGroupId: string; effectiveFrom: string; effectiveTo?: string | null }) => call<{ employeeId: string; payGroupId: string }>('finance/payroll/pay-groups/assign', a),
  payGroupMembers:(a: { payGroupId: string })          => call<PayGroupMember[]>('finance/payroll/pay-groups/members', a),

  // Employee loans & advances (Wave 5)
  listLoans:   (a: { employeeId?: string; status?: string } = {}) => call<EmployeeLoan[]>('finance/payroll/loans/list', a),
  getLoan:     (a: { id: string })                     => call<EmployeeLoan>('finance/payroll/loans/get', a),
  createLoan:  (a: { employeeId: string; loanType: LoanType; principal: number; interestAmount?: number; installmentAmount: number; startPeriod?: string | null; reason?: string | null; notes?: string | null }) => call<EmployeeLoan>('finance/payroll/loans/create', a),
  submitLoan:  (a: { id: string; idempotencyKey: string }) => call<EmployeeLoan>('finance/payroll/loans/submit', a),
  settleLoan:  (a: { id: string })                     => call<EmployeeLoan>('finance/payroll/loans/settle', a),
  cancelLoan:  (a: { id: string; reason?: string })    => call<EmployeeLoan>('finance/payroll/loans/cancel', a),

  // Overtime rules (Wave 4b) — effective-dated OT multipliers by event type
  listOvertimeRules:   (a: object = {})                => call<OvertimeRule[]>('finance/payroll/overtime-rules/list', a),
  createOvertimeRule:  (a: { code: string; eventType: OvertimeEventType; multiplier: number; minimumHours?: number | null; effectiveFrom: string; effectiveTo?: string | null }) => call<OvertimeRule>('finance/payroll/overtime-rules/create', a),
  setOvertimeRuleActive:(a: { id: string; active: boolean }) => call<OvertimeRule>('finance/payroll/overtime-rules/set-active', a),

  // GL posting
  glPreview:  (a: { runId: string })                   => call<GlPreview>('finance/payroll/gl/preview', a),
  // gl/post + gl/reverse both REQUIRE an idempotencyKey (the backend Zod contract
  // rejects its absence with 400) — mint one per attempt at the call site.
  glPost:     (a: { runId: string; idempotencyKey: string })                 => call<{ journalId: string; journalNo: string; totalDebit: number; totalCredit: number }>('finance/payroll/gl/post', a),
  glReverse:  (a: { runId: string; reason: string; idempotencyKey: string }) => call<{ reversingJournalId: string; reversingJournalNo: string }>('finance/payroll/gl/reverse', a),
  glGet:      (a: { runId: string })                   => call<GlJournal | null>('finance/payroll/gl/get', a),
  listPayslips:     (a: { runId: string })             => call<Payslip[]>('finance/payroll/payslips/list', a),
  myPayslips:       (a: object = {})                   => call<Payslip[]>('finance/payroll/payslips/my', a),
  getPayslip:       (a: { id: string })                => call<Payslip>('finance/payroll/payslips/get', a),
  payslipSignedUrl: (a: { id: string })                => call<{ url: string }>('finance/payroll/payslips/signed-url', a),

  // Reports Center (F-12) — server-owned 9-key catalog. `params.report` is the sole
  // discriminant; the shared zod/DTO contract lives in types/payrollReports.
  reportsCatalog: (a: object = {}) => call<{ reports: ReportCatalogEntry[] }>('finance/payroll/reports/catalog', a),
  reportsSummary: (a: object = {}) => call<ReportKpiTiles>('finance/payroll/reports/summary', a),
  runReport:      (a: { params: ReportParams; format: ReportFormat; idempotencyKey?: string }) =>
                    call<ReportRunResult>('finance/payroll/reports/run', a),
  reportsHistory: (a: { cursor?: string; limit?: number; reportKey?: PayrollReportKey } = {}) =>
                    call<PageResult<ReportArtifactRow>>('finance/payroll/reports/history/list', a),
  reportStatus:   (a: { jobId: string }) => call<ReportJobStatus>('finance/payroll/reports/status', a),
  // Fresh 120-second signed URL for a committed artifact — never cached; requested
  // again for every download action (§6A).
  reportDownload: (a: { artifactId: string }) =>
                    call<ReportDownloadResponse>('finance/payroll/reports/artifacts/download', a),
  // Run Workspace population panel — per-employee net variance vs the prior run.
  runVariation: (a: { runId: string }) =>
                    call<{ report: string; generatedAt: string; rows: Record<string, unknown>[] }>('finance/payroll/runs/variation', a),

  // Warning resolve
  resolveWarning: (a: { warningId: string; note?: string }) =>
    call<ResolveWarningResult>('finance/payroll/warnings/resolve', a),

  // Audit log for a run (drawer Audit tab)
  listRunAuditLog: (a: { runId: string }) =>
    call<RunAuditLogEntry[]>('finance/payroll/runs/audit/list', a),

  // Population preview (wizard step 2) — pay-group-scoped when payGroupId given (B-01)
  populationPreview: (a: { periodMonth?: string; payGroupId?: string } = {}) =>
    call<PopulationPreview>('finance/payroll/runs/population-preview', a),

  // Population reconciliation (wizard step 5) — pay-group-scoped
  populationReconciliation: (a: { payGroupId: string; periodStart: string; periodEnd: string }) =>
    call<PopulationReconciliation>('finance/payroll/runs/population-reconciliation', a),

  // Input-source readiness (wizard step 6) — pay-group-scoped
  inputReadiness: (a: { payGroupId: string; periodStart: string; periodEnd: string }) =>
    call<InputReadiness>('finance/payroll/runs/input-readiness', a),

  // Export download (returns content + metadata for browser download)
  exportDownload: (a: { exportId: string }) =>
    call<ExportDownload>('finance/payroll/exports/download', a),

  // NIS-profile verification (Finance verifies HR-captured continuity)
  listNisProfiles:  (a: { status?: string; limit?: number } = {}) => call<NisProfileRow[]>('finance/payroll/nis/list', a),
  getNisProfile:    (a: { id: string })                => call<NisProfileRow>('finance/payroll/nis/get', a),
  verifyNisProfile: (a: { id: string; verificationNote?: string | null }) => call<NisProfileRow>('finance/payroll/nis/verify', a),
  rejectNisProfile: (a: { id: string; reason?: string })=> call<NisProfileRow>('finance/payroll/nis/reject', a),

  // Payslip Studio template selector (Phase 2)
  /** List available templates for the run template picker (id/name/isDefault only). */
  listPayslipTemplates: (a: object = {}) =>
    call<PayslipTemplateSummary[]>('finance/payroll/payslip-templates/list', a),
  /** Set (or clear) the Payslip Studio template for a pay run. */
  setRunTemplate: (a: { runId: string; templateId: string | null }) =>
    call<PayrollRun>('finance/payroll/runs/set-template', a),
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const financePayrollKeys = {
  runs:     (o: object = {}) => ['finance', 'payroll', 'runs', o] as const,
  run:      (id: string)     => ['finance', 'payroll', 'run', id] as const,
  policyEvidence: (runId: string, snapshotId?: string) =>
    ['finance', 'payroll', 'policy-evidence', runId, snapshotId ?? 'current'] as const,
  inputs:   (id: string)     => ['finance', 'payroll', 'inputs', id] as const,
  runLines: (id: string)     => ['finance', 'payroll', 'run-lines', id] as const,
  warnings: (id: string)     => ['finance', 'payroll', 'warnings', id] as const,
  exports:  (id: string)     => ['finance', 'payroll', 'exports', id] as const,
  payslips: (id: string)     => ['finance', 'payroll', 'payslips', id] as const,
  glPreview:(id: string)     => ['finance', 'payroll', 'gl-preview', id] as const,
  nisProfiles: (o: object = {}) => ['finance', 'payroll', 'nis', o] as const,
};

// ── Query hooks ─────────────────────────────────────────────────────────────────
export function usePayrollRun(id: string | null) {
  return useQuery({ queryKey: financePayrollKeys.run(id ?? ''), queryFn: () => financePayrollApi.getRun({ id: id! }), enabled: !!id });
}
export function useRunLines(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.runLines(runId ?? ''), queryFn: () => financePayrollApi.listRunLines({ runId: runId! }), enabled: !!runId });
}
/** F-02: policy-evidence for a run's snapshot (defaults to current snapshot server-side). */
export function usePolicyEvidence(runId: string | null, inputSnapshotId?: string) {
  return useQuery({
    queryKey: financePayrollKeys.policyEvidence(runId ?? '', inputSnapshotId),
    queryFn:  () => financePayrollApi.getPolicyEvidence(
      inputSnapshotId ? { runId: runId!, inputSnapshotId } : { runId: runId! }),
    enabled:  !!runId,
  });
}
/** Composite run-detail read (run + snapshot + calc version + attempts + findings + audit). */
export function useRunWorkspace(runId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'workspace', runId ?? ''],
    queryFn:  () => financePayrollApi.getWorkspace({ id: runId! }),
    enabled:  !!runId,
  });
}
/** Release readiness gates + blockers + downstream (funding/cert/GL/payslip/bank) flags. */
export function useReleasePreflight(runId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'preflight', runId ?? ''],
    queryFn:  () => financePayrollApi.releasePreflight({ runId: runId! }),
    enabled:  !!runId,
  });
}
/** F-08 — the issued release certificate for a run (present once released). `enabled`
 *  should be gated by the caller to released/locked runs to avoid 404 noise. */
export function useReleaseCertificate(runId: string | null, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'release-certificate', runId ?? ''],
    queryFn:  () => financePayrollApi.getReleaseCertificate({ runId: runId! }),
    enabled:  !!runId && (opts.enabled ?? true),
    retry:    false,   // a not-yet-released run 404s; don't churn
  });
}
/** Published calculation versions for a run (reconciliation history). */
export function useCalculationVersions(runId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'calc-versions', runId ?? ''],
    queryFn:  () => financePayrollApi.listCalcVersions({ runId: runId! }),
    enabled:  !!runId,
  });
}
/** Within-run per-employee delta between two calculation versions. */
export function useCalculationComparison(fromVersionId: string | null, toVersionId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'calc-compare', fromVersionId ?? '', toVersionId ?? ''],
    queryFn:  () => financePayrollApi.compareCalcVersions({ fromVersionId: fromVersionId!, toVersionId: toVersionId! }),
    enabled:  !!fromVersionId && !!toVersionId,
  });
}
export function useRunWarnings(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.warnings(runId ?? ''), queryFn: () => financePayrollApi.listWarnings({ runId: runId! }), enabled: !!runId });
}
export function useRunPayslips(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.payslips(runId ?? ''), queryFn: () => financePayrollApi.listPayslips({ runId: runId! }), enabled: !!runId });
}
export function useRunGlPreview(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.glPreview(runId ?? ''), queryFn: () => financePayrollApi.glPreview({ runId: runId! }), enabled: !!runId });
}
export function usePayGroups(activeOnly = true) {
  return useQuery({ queryKey: ['finance', 'payroll', 'pay-groups', activeOnly], queryFn: () => financePayrollApi.listPayGroups({ activeOnly }) });
}

export function useReasonCodes(runType?: string) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'reason-codes', runType ?? 'all'],
    queryFn:  () => financePayrollApi.listReasonCodes(runType ? { runType } : {}),
  });
}
export function usePayGroupMembers(payGroupId: string | null) {
  return useQuery({ queryKey: ['finance', 'payroll', 'pay-group-members', payGroupId ?? ''], queryFn: () => financePayrollApi.payGroupMembers({ payGroupId: payGroupId! }), enabled: !!payGroupId });
}
export function useOvertimeRules() {
  return useQuery({ queryKey: ['finance', 'payroll', 'overtime-rules'], queryFn: () => financePayrollApi.listOvertimeRules() });
}
export function useEmployeeLoans(opts: { employeeId?: string; status?: string } = {}) {
  return useQuery({ queryKey: ['finance', 'payroll', 'loans', opts], queryFn: () => financePayrollApi.listLoans(opts) });
}
export function useRunOverrides(runId: string | null) {
  return useQuery({ queryKey: ['finance', 'payroll', 'overrides', runId ?? ''], queryFn: () => financePayrollApi.listOverrides({ runId: runId! }), enabled: !!runId });
}
export function useRunExports(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.exports(runId ?? ''), queryFn: () => financePayrollApi.listExports({ runId: runId! }), enabled: !!runId });
}
export function useRunInputs(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.inputs(runId ?? ''), queryFn: () => financePayrollApi.listInputs({ runId: runId! }), enabled: !!runId });
}
export function useNisProfiles(opts: { status?: string; limit?: number } = {}) {
  return useQuery({ queryKey: financePayrollKeys.nisProfiles(opts), queryFn: () => financePayrollApi.listNisProfiles(opts) });
}
export function useRunAuditLog(runId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'audit', runId ?? ''],
    queryFn:  () => financePayrollApi.listRunAuditLog({ runId: runId! }),
    enabled:  !!runId,
  });
}
export function usePopulationPreview(periodMonth?: string, payGroupId?: string) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'population-preview', periodMonth, payGroupId ?? ''],
    queryFn:  () => financePayrollApi.populationPreview({
      ...(periodMonth ? { periodMonth } : {}),
      ...(payGroupId ? { payGroupId } : {}),
    }),
  });
}
export function usePopulationReconciliation(
  payGroupId: string | undefined, periodStart: string | undefined, periodEnd: string | undefined,
) {
  const enabled = !!payGroupId && !!periodStart && !!periodEnd;
  return useQuery({
    queryKey: ['finance', 'payroll', 'population-reconciliation', payGroupId ?? '', periodStart ?? '', periodEnd ?? ''],
    queryFn:  () => financePayrollApi.populationReconciliation({ payGroupId: payGroupId!, periodStart: periodStart!, periodEnd: periodEnd! }),
    enabled,
  });
}
export function useInputReadiness(
  payGroupId: string | undefined, periodStart: string | undefined, periodEnd: string | undefined,
) {
  const enabled = !!payGroupId && !!periodStart && !!periodEnd;
  return useQuery({
    queryKey: ['finance', 'payroll', 'input-readiness', payGroupId ?? '', periodStart ?? '', periodEnd ?? ''],
    queryFn:  () => financePayrollApi.inputReadiness({ payGroupId: payGroupId!, periodStart: periodStart!, periodEnd: periodEnd! }),
    enabled,
  });
}

// ── Mutation hook (invalidates the whole finance-payroll subtree) ───────────────

export function usePayrollMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] }); },
  });
}

// ── Targeted mutation hooks ─────────────────────────────────────────────────────

/** Resolve a payroll run warning — invalidates the run's warnings cache. */
export function useResolveWarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { warningId: string; note?: string }) => financePayrollApi.resolveWarning(a),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] }); },
  });
}

/** Download export — mutation so it's not cached (content is always fresh). */
export function useExportDownload() {
  return useMutation({
    mutationFn: (a: { exportId: string }) => financePayrollApi.exportDownload(a),
  });
}

// ── Payslip Studio template picker (Phase 2) ────────────────────────────────────

export const payslipTemplateKeys = {
  list: () => ['finance', 'payroll', 'payslip-templates'] as const,
};

/**
 * Fetches approved Payslip Studio templates for the run template picker.
 * The backend returns all non-archived templates; we filter for status='approved'
 * so a draft or pending template can never be assigned to a payroll run from the UI.
 * (The backend setRunTemplate also enforces this on the server side.)
 */
export function usePayslipTemplates() {
  return useQuery({
    queryKey: payslipTemplateKeys.list(),
    queryFn:  async () => {
      const all = await financePayrollApi.listPayslipTemplates();
      return all.filter(t => t.status === 'approved');
    },
  });
}

/** Assign (or clear) the Payslip Studio template on a pay run. */
export function useSetRunTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { runId: string; templateId: string | null }) =>
      financePayrollApi.setRunTemplate(a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] });
    },
  });
}
