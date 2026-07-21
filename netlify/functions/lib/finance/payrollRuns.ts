// ============================================================================
// Finance — Payroll Runs (Phase 3 Stage 2)
// ============================================================================
// Implements the create → lock-inputs → calculate flow.
// Stage 3 (submit → approve → lock → payslips → export) is NOT here.
//
// Flow:
//   createRun       → resolves active statutory version; creates a 'draft' run
//   lockInputs      → snapshots base pay + active-approved pay items + approved OT
//                     → finance_payroll_run_inputs; sets status='input_locked'
//   calculate       → reads inputs + statutory tables; computeRunLine per employee;
//                     writes finance_payroll_run_lines incl. NIS snapshot;
//                     rolls up run totals; sets status='calculated'
//                     Before each line: emit NIS warnings per policy settings
//
// Spec §8.1 / §8.2 / §8.3 / §8.6 / §12 / §13
// ============================================================================

import { sb } from '../db';
import { emitAppEvent, deliverEventNotifications } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { getStatutoryVersion, listNisClasses, assertDifferentApprover } from './statutoryConfig';
import { computeRunLine, payPeriodsForFrequency } from './payrollStatutory';
import { listGroupMemberIds, getPayGroup } from './payGroups';
import { loadActiveOvertimeRules, resolveOvertimeMultiplier, type OvertimeRule } from './overtimeRules';
import { loadLoanInstallments } from './loans';
import { getStatutoryProfilesByEmployees } from '../hr/statutoryProfileCore';
import { selectAllRows, chunk } from '../dbBulk';
import { resolveSettingValue } from '../settings/resolveSetting';
import {
  calculationFailure,
  createPayrollRunCommand,
  failCalculationAttempt,
  getCalculationAttempt,
  publishCalculationVersion,
  publishInputSnapshot,
  replayInputSnapshot,
  startCalculationAttempt,
  type PayrollRunStatus,
  type PayrollRunType,
} from './payroll/execution';
import { payrollExportChecksum } from './payroll/exportContent';
import { payrollRpcHttpError } from './payroll/rpcError';

/** Supported scale ceiling for a single run's calc/lock (500–1k target, ~2k headroom).
 *  Beyond this, the pipeline is rejected rather than silently truncating. */
export const MAX_RUN_EMPLOYEES = 2000;
import { decideTask, rpcHttpError } from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole } from './financeEvents';
import { notify } from '../notify';
import { createHandoff } from '../handoffBus';
import type { NisClassRow } from './statutoryConfig';

interface NisContributionPeriod {
  periodMonth: string;
  weeks: number;
  employeeAmount: number;
  employerAmount: number;
}

interface NisContributionWeeks {
  periodMonth: string;
  weeks: number;
}

function parseUtcDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`Invalid payroll date '${value}'.`), { status: 422 });
  }
  return parsed;
}

function isoMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function mondayOnOrBefore(value: Date): Date {
  const monday = new Date(value);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
}

function buildEmployeeContributionWeeks(input: {
  periodStart: string;
  periodEnd: string;
  payBasis: string | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  workedDates: string[];
}): NisContributionWeeks[] {
  const runStart = parseUtcDate(input.periodStart);
  const runEnd = parseUtcDate(input.periodEnd);
  const employmentStart = input.employmentStart
    ? parseUtcDate(input.employmentStart)
    : runStart;
  const employmentEnd = input.employmentEnd
    ? parseUtcDate(input.employmentEnd)
    : runEnd;
  const effectiveStart = new Date(Math.max(runStart.getTime(), employmentStart.getTime()));
  const effectiveEnd = new Date(Math.min(runEnd.getTime(), employmentEnd.getTime()));
  if (effectiveEnd < effectiveStart) return [];

  const contributionMondays = new Set<string>();
  if (input.payBasis === 'hourly') {
    for (const value of input.workedDates) {
      const worked = parseUtcDate(value);
      if (worked < effectiveStart || worked > effectiveEnd) continue;
      contributionMondays.add(mondayOnOrBefore(worked).toISOString().slice(0, 10));
    }
  } else {
    const coversWholeRun =
      effectiveStart.getTime() === runStart.getTime()
      && effectiveEnd.getTime() === runEnd.getTime();
    if (coversWholeRun) {
      const cursor = new Date(runStart);
      while (cursor <= runEnd) {
        if (cursor.getUTCDay() === 1) {
          contributionMondays.add(cursor.toISOString().slice(0, 10));
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      if (contributionMondays.size === 0) {
        contributionMondays.add(
          mondayOnOrBefore(runStart).toISOString().slice(0, 10),
        );
      }
    } else {
      const cursor = mondayOnOrBefore(effectiveStart);
      while (cursor <= effectiveEnd) {
        contributionMondays.add(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
    }
  }

  const weeksByMonth = new Map<string, number>();
  for (const monday of [...contributionMondays].sort()) {
    const month = isoMonth(parseUtcDate(monday));
    weeksByMonth.set(month, (weeksByMonth.get(month) ?? 0) + 1);
  }
  return [...weeksByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodMonth, weeks]) => ({ periodMonth, weeks }));
}

function readFrozenContributionWeeks(value: unknown): NisContributionWeeks[] {
  if (!Array.isArray(value)) {
    throw Object.assign(
      new Error(
        'The frozen payroll input does not contain employee-specific NIS contribution weeks. Reopen and lock inputs again.',
      ),
      { status: 409 },
    );
  }
  const periods = value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw Object.assign(
        new Error(`Frozen NIS contribution week ${index + 1} is malformed.`),
        { status: 409 },
      );
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row['periodMonth'] !== 'string'
      || !/^\d{4}-\d{2}-01$/.test(row['periodMonth'])
      || typeof row['weeks'] !== 'number'
      || !Number.isInteger(row['weeks'])
      || row['weeks'] <= 0
    ) {
      throw Object.assign(
        new Error(`Frozen NIS contribution week ${index + 1} is malformed.`),
        { status: 409 },
      );
    }
    return {
      periodMonth: row['periodMonth'],
      weeks: Number(row['weeks']),
    };
  });
  if (new Set(periods.map(period => period.periodMonth)).size !== periods.length) {
    throw Object.assign(
      new Error('Frozen NIS contribution periods contain duplicate months.'),
      { status: 409 },
    );
  }
  return periods;
}

/**
 * NIBTT contribution weeks start on Monday. Freeze the contribution-month
 * allocation into each calculation line so release never has to infer it from
 * mutable run dates or current statutory configuration.
 */
function buildNisContributionPeriods(input: {
  contributionWeeks: NisContributionWeeks[];
  weeksInPeriod: number;
  employeeWeekly: number;
  employerWeekly: number;
  employeeTotal: number;
  employerTotal: number;
}): NisContributionPeriod[] {
  const countedWeeks = input.contributionWeeks
    .reduce((sum, period) => sum + period.weeks, 0);
  if (!Number.isInteger(input.weeksInPeriod) || input.weeksInPeriod !== countedWeeks) {
    throw Object.assign(
      new Error(
        `Payroll NIS weeks (${input.weeksInPeriod}) do not match the ${countedWeeks} contribution weeks in the run period. Recreate or correct the run before calculating.`,
      ),
      { status: 422 },
    );
  }

  const round2 = (value: number): number => Math.round(value * 100) / 100;
  const periods = input.contributionWeeks
    .map(({ periodMonth, weeks }) => ({
      periodMonth,
      weeks,
      employeeAmount: round2(input.employeeWeekly * weeks),
      employerAmount: round2(input.employerWeekly * weeks),
    }));

  if (periods.length === 0) {
    if (round2(input.employeeTotal) !== 0 || round2(input.employerTotal) !== 0) {
      throw Object.assign(
        new Error('NIS contributions cannot be allocated without a worked contribution week.'),
        { status: 422 },
      );
    }
    return [];
  }

  const employeeAllocated = periods.reduce((sum, period) => sum + period.employeeAmount, 0);
  const employerAllocated = periods.reduce((sum, period) => sum + period.employerAmount, 0);
  const last = periods[periods.length - 1]!;
  last.employeeAmount = round2(last.employeeAmount + input.employeeTotal - employeeAllocated);
  last.employerAmount = round2(last.employerAmount + input.employerTotal - employerAllocated);
  return periods;
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** F-02: pinned pay policy (+ work-calendar pin) for the run-detail chips.
 * Policy name/version are resolved from the F-01 tables (F-02 reads F-01 per §10);
 * the calendar block carries the pinned identity + resolution facts, with the
 * display NAME resolved by the policy-evidence route (§6d) which owns F-CAL display. */
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

export interface PayrollRunDto {
  id: string;
  runNo: string;
  runType: PayrollRunType;
  periodMonth: string;
  periodStart: string;
  periodEnd: string;
  sequenceNo: number;
  sourceRunId: string | null;
  payFrequency: string;
  status: PayrollRunStatus;
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
  currentCalculationVersionId: string | null;
  inputLockedBy: string | null;
  inputLockedAt: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  releasedBy: string | null;
  releasedAt: string | null;
  exportedAt: string | null;
  templateId: string | null;
  /** F-02 (API-PPR-004): pinned policy + calendar, name-resolved; null on legacy/unpinned runs. */
  payPolicy: PayrollRunPayPolicy | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunInputDto {
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

export interface PayrollRunLineDto {
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

export interface PayrollRunWarningDto {
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
  createdAt: string;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface DbRunRow {
  id: string; run_no: string; run_type: PayrollRunType; period_month: string;
  period_start: string; period_end: string; sequence_no: number; source_run_id: string | null;
  pay_frequency: string; status: PayrollRunStatus; statutory_version_id: string; weeks_in_period: number;
  pay_group: string | null; pay_group_id: string | null; pay_date: string | null; cut_off_date: string | null;
  employee_count: number; gross_total: number; deduction_total: number;
  net_total: number; nis_employer_total: number;
  workflow_id: string | null;
  current_input_snapshot_id: string | null;
  current_calculation_version_id: string | null;
  input_locked_by: string | null; input_locked_at: string | null;
  created_by: string | null; approved_by: string | null;
  locked_by: string | null; locked_at: string | null;
  reopened_by: string | null; reopened_at: string | null;
  reopen_reason: string | null; released_by: string | null; released_at: string | null;
  exported_at: string | null;
  template_id: string | null;
  // F-02 policy + calendar pins (mig 710)
  pay_policy_version_id: string | null;
  pay_policy_checksum: string | null;
  pay_policy_required: boolean;
  work_calendar_version_id: string | null;
  holiday_calendar_version_id: string | null;
  work_calendar_checksum: string | null;
  holiday_calendar_checksum: string | null;
  calendar_resolution: { scope?: string; periodDenominator?: string; assignmentId?: string } | null;
  created_at: string; updated_at: string;
}

interface DbInputRow {
  id: string; run_id: string; employee_id: string; source_type: string;
  source_id: string | null; component_code: string | null; label: string | null;
  amount: number | null; quantity: number | null; rate: number | null;
  metadata: Record<string, unknown>; created_at: string;
}

interface DbLineRow {
  id: string; run_id: string; employee_id: string;
  base: number; taxable_gross: number; gross: number;
  nis_employee: number; nis_employer: number; health_surcharge: number;
  chargeable_income: number; paye: number; voluntary_deductions: number; net: number;
  breakdown: Record<string, unknown>; department_id: string | null; cost_center_id: string | null;
  nis_number_masked: string | null; nis_status: string | null; nis_class_no: number | null;
  opening_ytd_nis_employee: number; opening_ytd_nis_employer: number;
  created_at: string; updated_at: string;
}

interface DbWarningRow {
  id: string; run_id: string; employee_id: string | null;
  warning_type: string; severity: string; message: string;
  metadata: Record<string, unknown>; resolved: boolean;
  resolved_by: string | null; resolved_at: string | null; created_at: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function toRunDto(r: DbRunRow): PayrollRunDto {
  return {
    id: r.id, runNo: r.run_no, runType: r.run_type,
    periodMonth: r.period_month, periodStart: r.period_start, periodEnd: r.period_end,
    sequenceNo: Number(r.sequence_no), sourceRunId: r.source_run_id,
    payFrequency: r.pay_frequency, status: r.status,
    statutoryVersionId: r.statutory_version_id,
    weeksInPeriod: Number(r.weeks_in_period),
    payGroup: r.pay_group, payGroupId: r.pay_group_id, payDate: r.pay_date, cutOffDate: r.cut_off_date,
    employeeCount: r.employee_count,
    grossTotal: Number(r.gross_total), deductionTotal: Number(r.deduction_total),
    netTotal: Number(r.net_total), nisEmployerTotal: Number(r.nis_employer_total),
    workflowId: r.workflow_id,
    currentInputSnapshotId: r.current_input_snapshot_id,
    currentCalculationVersionId: r.current_calculation_version_id,
    inputLockedBy: r.input_locked_by, inputLockedAt: r.input_locked_at,
    createdBy: r.created_by, approvedBy: r.approved_by,
    lockedBy: r.locked_by, lockedAt: r.locked_at,
    reopenedBy: r.reopened_by, reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason, releasedBy: r.released_by, releasedAt: r.released_at,
    exportedAt: r.exported_at,
    templateId: r.template_id ?? null,
    payPolicy: null, // enriched by getPayrollRun via resolveRunPayPolicy (async name resolution)
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toInputDto(r: DbInputRow): PayrollRunInputDto {
  return {
    id: r.id, runId: r.run_id, employeeId: r.employee_id,
    sourceType: r.source_type, sourceId: r.source_id,
    componentCode: r.component_code, label: r.label,
    amount: r.amount !== null ? Number(r.amount) : null,
    quantity: r.quantity !== null ? Number(r.quantity) : null,
    rate: r.rate !== null ? Number(r.rate) : null,
    metadata: r.metadata, createdAt: r.created_at,
  };
}

function toLineDto(r: DbLineRow): PayrollRunLineDto {
  return {
    id: r.id, runId: r.run_id, employeeId: r.employee_id,
    base: Number(r.base), taxableGross: Number(r.taxable_gross),
    gross: Number(r.gross), nisEmployee: Number(r.nis_employee),
    nisEmployer: Number(r.nis_employer), healthSurcharge: Number(r.health_surcharge),
    chargeableIncome: Number(r.chargeable_income), paye: Number(r.paye),
    voluntaryDeductions: Number(r.voluntary_deductions), net: Number(r.net),
    breakdown: r.breakdown, departmentId: r.department_id, costCenterId: r.cost_center_id,
    nisNumberMasked: r.nis_number_masked, nisStatus: r.nis_status,
    nisClassNo: r.nis_class_no,
    openingYtdNisEmployee: Number(r.opening_ytd_nis_employee),
    openingYtdNisEmployer: Number(r.opening_ytd_nis_employer),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toWarningDto(r: DbWarningRow): PayrollRunWarningDto {
  return {
    id: r.id, runId: r.run_id, employeeId: r.employee_id,
    warningType: r.warning_type, severity: r.severity, message: r.message,
    metadata: r.metadata, resolved: r.resolved,
    resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, createdAt: r.created_at,
  };
}

// ── Policy settings loader ────────────────────────────────────────────────────

interface PayrollPolicy {
  requireVerifiedNis: boolean;       // finance_payroll.require_verified_nis_for_payroll
  warnMissingNisNumber: boolean;     // finance_payroll.warn_missing_nis_number
  blockMissingNisNewEmployee: boolean; // finance_payroll.block_missing_nis_for_new_employee
  requireApprovedTimesheetForHourly: boolean;
  warnMissingTimesheetForSalary: boolean;
}

async function loadPayrollPolicy(): Promise<PayrollPolicy> {
  const scope = { moduleKey: 'finance_payroll' };
  const [
    requireVerifiedNis,
    warnMissingNisNumber,
    blockMissingNisNewEmployee,
    requireApprovedTimesheetForHourly,
    warnMissingTimesheetForSalary,
  ] = await Promise.all([
    resolveSettingValue<boolean>(sb, 'finance_payroll.require_verified_nis_for_payroll', scope, false),
    resolveSettingValue<boolean>(sb, 'finance_payroll.warn_missing_nis_number', scope, true),
    resolveSettingValue<boolean>(sb, 'finance_payroll.block_missing_nis_for_new_employee', scope, false),
    resolveSettingValue<boolean>(sb, 'finance_payroll.require_approved_timesheet_for_hourly', scope, true),
    resolveSettingValue<boolean>(sb, 'finance_payroll.warn_missing_timesheet_for_salary', scope, true),
  ]);
  return {
    requireVerifiedNis:                    Boolean(requireVerifiedNis),
    warnMissingNisNumber:                  Boolean(warnMissingNisNumber),
    blockMissingNisNewEmployee:            Boolean(blockMissingNisNewEmployee),
    requireApprovedTimesheetForHourly:     Boolean(requireApprovedTimesheetForHourly),
    warnMissingTimesheetForSalary:         Boolean(warnMissingTimesheetForSalary),
  };
}

// ── List / Get ────────────────────────────────────────────────────────────────

export interface ListRunsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listPayrollRuns(opts: ListRunsOptions = {}): Promise<PayrollRunDto[]> {
  let q = sb.from('finance_payroll_runs').select('*')
    .order('period_month', { ascending: false })
    .limit(opts.limit ?? 50)
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayrollRuns: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRunRow[]).map(toRunDto);
}

// F-02 (API-PPR-004): resolve the pinned policy (name/version from F-01) + the
// calendar pin facts. Reads F-01 tables only (§10); the calendar display NAME is
// owned by the policy-evidence route (§6d), so no F-CAL table is read here.
async function resolveRunPayPolicy(r: DbRunRow): Promise<PayrollRunPayPolicy> {
  const ver = (await sb.from('finance_pay_policy_versions')
    .select('version_no, policy_id').eq('id', r.pay_policy_version_id ?? '').maybeSingle())
    .data as { version_no: number; policy_id: string } | null;
  const policyName = ver?.policy_id
    ? ((await sb.from('finance_pay_policies').select('name').eq('id', ver.policy_id).maybeSingle())
        .data as { name: string } | null)?.name ?? null
    : null;
  return {
    versionId: r.pay_policy_version_id ?? '',
    checksum: r.pay_policy_checksum,
    required: r.pay_policy_required,
    policyName,
    versionNo: ver?.version_no ?? null,
    calendar: r.work_calendar_version_id
      ? {
          workCalendarVersionId: r.work_calendar_version_id,
          workCalendarChecksum: r.work_calendar_checksum,
          holidayCalendarChecksum: r.holiday_calendar_checksum,
          scope: r.calendar_resolution?.scope ?? null,
          periodDenominator: r.calendar_resolution?.periodDenominator ?? null,
        }
      : null,
  };
}

export async function getPayrollRun(id: string): Promise<PayrollRunDto | null> {
  const { data, error } = await sb.from('finance_payroll_runs')
    .select('*').eq('id', id).maybeSingle<DbRunRow>();
  if (error) throw Object.assign(new Error('getPayrollRun: ' + error.message), { status: 500 });
  if (!data) return null;
  const dto = toRunDto(data);
  if (data.pay_policy_required && data.pay_policy_version_id) {
    dto.payPolicy = await resolveRunPayPolicy(data);
  }
  return dto;
}

// ── F-02 (API-PPR-005): policy-evidence read (§6d) ──────────────────────────────

/** Resolve app_users display names for a set of ids (batch; avoids an N+1 and
 * keeps raw UUIDs out of the evidence DTO — every employees[] row gets a name). */
async function resolveEmployeeNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (uniq.length === 0) return map;
  const { data } = await sb.from('app_users')
    .select('id, full_name, first_name, last_name')
    .in('id', uniq);
  for (const u of (data ?? []) as
       { id: string; full_name: string | null; first_name: string | null; last_name: string | null }[]) {
    const name = (u.full_name ?? '').trim()
      || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()
      || u.id;
    map.set(u.id, name);
  }
  return map;
}

/** One per-employee working_days evidence row, display-resolved (no raw UUID). */
export interface PolicyEvidenceCalendarEmployee {
  employeeId: string;
  employeeName: string;
  numerator: string;
  denominator: string;
  clampFrom: string | null;
  clampTo: string | null;
  excludedCount: number;
}

/** §6d calendar block — present only when the run is calendar-pinned (working_days). */
export interface PolicyEvidenceCalendar {
  workCalendarName: string | null;
  workCalendarVersionNo: number | null;
  holidayCalendarName: string | null;
  holidayChecksumShort: string | null;
  resolution: { scope: string | null; assignmentId: string | null };
  periodDenominator: string | null;
  employees: PolicyEvidenceCalendarEmployee[];
}

/** §6d policy-evidence DTO — the pinned policy manifest projection + the immutable
 * lock conflict/exclusion evidence + (when calendar-pinned) the working_days block. */
export interface PolicyEvidenceDto {
  runId: string;
  inputSnapshotId: string;
  checksum: string | null;
  components: Record<string, unknown>[];
  sourceRules: Record<string, unknown>[];
  costingRules: Record<string, unknown>[];
  statutory: Record<string, unknown>;
  sourceConflicts: Record<string, unknown>[];
  excludedEmployees: Record<string, unknown>[];
  calendar: PolicyEvidenceCalendar | null;
}

/**
 * F-02 policy-evidence read (contract §6d, finding #10). Returns the pinned
 * policy manifest (components / source rules / costing rules / statutory) + its
 * checksum for a run's input snapshot, PLUS the immutable lock evidence
 * (source conflicts + excluded employees from the snapshot source_summary) and,
 * for a calendar-pinned working_days run, a resolved `calendar` block with the
 * per-employee working_days numerators.
 *
 * Defaults to the run's `current_input_snapshot_id`; an explicit `inputSnapshotId`
 * is validated to belong to THIS run (snapshot history after a relock). Evidence
 * only exists after inputs are locked, so a run with no snapshot 404s.
 */
export async function getRunPolicyEvidence(
  runId: string,
  inputSnapshotId?: string,
): Promise<PolicyEvidenceDto> {
  // Raw run columns — the calendar pin ids/checksum are not all on the run DTO.
  const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id, current_input_snapshot_id, pay_policy_required, work_calendar_version_id, ' +
            'holiday_calendar_version_id, holiday_calendar_checksum, calendar_resolution')
    .eq('id', runId)
    .maybeSingle<{
      id: string;
      current_input_snapshot_id: string | null;
      pay_policy_required: boolean;
      work_calendar_version_id: string | null;
      holiday_calendar_version_id: string | null;
      holiday_calendar_checksum: string | null;
      calendar_resolution: { scope?: string; periodDenominator?: string; assignmentId?: string } | null;
    }>();
  if (runErr) throw Object.assign(new Error('getRunPolicyEvidence/run: ' + runErr.message), { status: 500 });
  if (!run)   throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  // §6d: default to the current snapshot; an explicit id must belong to this run.
  const targetSnapshotId = inputSnapshotId ?? run.current_input_snapshot_id;
  if (!targetSnapshotId) {
    throw Object.assign(
      new Error('This run has no locked input snapshot yet. Lock inputs to generate policy evidence.'),
      { status: 404 });
  }
  const { data: snap, error: snapErr } = await sb.from('finance_payroll_input_snapshots')
    .select('id, run_id, source_summary')
    .eq('id', targetSnapshotId)
    .maybeSingle<{ id: string; run_id: string; source_summary: Record<string, unknown> | null }>();
  if (snapErr) throw Object.assign(new Error('getRunPolicyEvidence/snapshot: ' + snapErr.message), { status: 500 });
  if (!snap || snap.run_id !== runId) {
    throw Object.assign(new Error('Input snapshot does not belong to this run.'), { status: 404 });
  }

  // Policy manifest — exactly one per snapshot; absent for legacy non-pinned runs.
  const { data: ev, error: evErr } = await sb.from('finance_payroll_run_policy_evidence')
    .select('checksum, manifest')
    .eq('input_snapshot_id', targetSnapshotId)
    .maybeSingle<{ checksum: string; manifest: Record<string, unknown> }>();
  if (evErr) throw Object.assign(new Error('getRunPolicyEvidence/evidence: ' + evErr.message), { status: 500 });

  const manifest = (ev?.manifest ?? {}) as {
    components?: Record<string, unknown>[];
    sourceRules?: Record<string, unknown>[];
    costingRules?: Record<string, unknown>[];
    statutory?: Record<string, unknown>;
  };
  const summary = (snap.source_summary ?? {}) as {
    sourceConflicts?: Record<string, unknown>[];
    excludedEmployees?: Record<string, unknown>[];
  };

  // §6d calendar block — resolved DISPLAY names of the PINNED work/holiday
  // calendars + the per-employee working_days evidence. These are READ-ONLY
  // display lookups of F-CAL tables, explicitly required by §6d; N7b forbids
  // WRITES to F-CAL, not display reads (flagged per the contract).
  let calendar: PolicyEvidenceCalendar | null = null;
  if (run.work_calendar_version_id) {
    const [wcVerRes, calEvRes] = await Promise.all([
      sb.from('work_calendar_versions')
        .select('version_no, work_calendar_id')
        .eq('id', run.work_calendar_version_id)
        .maybeSingle<{ version_no: number; work_calendar_id: string }>(),
      sb.from('finance_payroll_run_calendar_evidence')
        .select('employee_id, numerator, period_denominator, clamp_from, clamp_to, excluded')
        .eq('input_snapshot_id', targetSnapshotId)
        .order('employee_id', { ascending: true }),
    ]);
    const wcVer = wcVerRes.data;

    const workCalendarName = wcVer?.work_calendar_id
      ? ((await sb.from('work_calendars').select('name').eq('id', wcVer.work_calendar_id)
          .maybeSingle<{ name: string }>()).data?.name ?? null)
      : null;

    let holidayCalendarName: string | null = null;
    if (run.holiday_calendar_version_id) {
      const hcVer = (await sb.from('holiday_calendar_versions')
        .select('holiday_calendar_id').eq('id', run.holiday_calendar_version_id)
        .maybeSingle<{ holiday_calendar_id: string }>()).data;
      if (hcVer?.holiday_calendar_id) {
        holidayCalendarName = (await sb.from('holiday_calendars').select('name')
          .eq('id', hcVer.holiday_calendar_id).maybeSingle<{ name: string }>()).data?.name ?? null;
      }
    }

    const calRows = (calEvRes.data ?? []) as {
      employee_id: string; numerator: number | string; period_denominator: number | string;
      clamp_from: string | null; clamp_to: string | null; excluded: unknown;
    }[];
    const nameMap = await resolveEmployeeNames(calRows.map(r => r.employee_id));

    calendar = {
      workCalendarName,
      workCalendarVersionNo: wcVer?.version_no ?? null,
      holidayCalendarName,
      holidayChecksumShort: run.holiday_calendar_checksum
        ? run.holiday_calendar_checksum.slice(0, 12)
        : null,
      resolution: {
        scope:        run.calendar_resolution?.scope ?? null,
        assignmentId: run.calendar_resolution?.assignmentId ?? null,
      },
      periodDenominator: run.calendar_resolution?.periodDenominator ?? null,
      employees: calRows.map(r => ({
        employeeId:    r.employee_id,
        employeeName:  nameMap.get(r.employee_id) ?? r.employee_id,
        numerator:     String(r.numerator),
        denominator:   String(r.period_denominator),
        clampFrom:     r.clamp_from,
        clampTo:       r.clamp_to,
        excludedCount: Array.isArray(r.excluded) ? r.excluded.length : 0,
      })),
    };
  }

  return {
    runId,
    inputSnapshotId:   targetSnapshotId,
    checksum:          ev?.checksum ?? null,
    components:        manifest.components ?? [],
    sourceRules:       manifest.sourceRules ?? [],
    costingRules:      manifest.costingRules ?? [],
    statutory:         manifest.statutory ?? {},
    sourceConflicts:   summary.sourceConflicts ?? [],
    excludedEmployees: summary.excludedEmployees ?? [],
    calendar,
  };
}

/**
 * Set (or clear) the Payslip Studio template for a run.
 * templateId = null → use the active default template at render time.
 * The run must exist; the template (if given) must be an active payroll template.
 * Emits app_event + audit_log; no workflow approval needed (cosmetic setting).
 */
export async function setRunTemplate(
  runId: string,
  templateId: string | null,
  actorId: string,
): Promise<PayrollRunDto> {
  // Guard: run must exist
  const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
    .select('*').eq('id', runId).maybeSingle<DbRunRow>();
  if (runErr) throw Object.assign(new Error('setRunTemplate/run: ' + runErr.message), { status: 500 });
  if (!run)   throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  // P3 render gate: template must be APPROVED (not draft/pending/archived).
  // Only approved templates produce reliable payslip output.
  if (templateId) {
    const { data: tmpl, error: tmplErr } = await sb.from('payroll_payslip_templates')
      .select('id, name').eq('id', templateId).eq('status', 'approved').maybeSingle<{ id: string; name: string }>();
    if (tmplErr) throw Object.assign(new Error('setRunTemplate/template: ' + tmplErr.message), { status: 500 });
    if (!tmpl)   throw Object.assign(new Error('Payslip template not found or not approved. Only approved templates can be linked to a payroll run.'), { status: 404 });
  }

  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({ template_id: templateId ?? null })
    .eq('id', runId)
    .select('*')
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('setRunTemplate/update: ' + updErr.message), { status: 500 });

  const dto = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.template_changed',
    previousState: { templateId: run.template_id ?? null },
    newState:      { templateId: dto.templateId },
  });
  // Awaited (not fire-and-forget): the template_changed app_event is a §2
  // side-effect callers/tests rely on being present once set-template returns.
  // emitAppEvent swallows its own errors, so awaiting can't fail the mutation.
  await emitAppEvent({
    eventType:        'finance.payroll.run.template_changed',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { runNo: run.run_no, templateId: dto.templateId },
  });

  return dto;
}

export async function listRunInputs(runId: string): Promise<PayrollRunInputDto[]> {
  // Paginate: a large run's inputs exceed PostgREST's 1000-row cap (which would
  // silently truncate and mis-calculate).
  const rows = await selectAllRows<DbInputRow>(() =>
    sb.from('finance_payroll_run_inputs').select('*').eq('run_id', runId).order('employee_id').order('source_type').order('id'));
  return rows.map(toInputDto);
}

export async function listRunLines(runId: string): Promise<PayrollRunLineDto[]> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('*').eq('run_id', runId).order('employee_id');
  if (error) throw Object.assign(new Error('listRunLines: ' + error.message), { status: 500 });
  return ((data ?? []) as DbLineRow[]).map(toLineDto);
}

export async function listRunWarnings(runId: string): Promise<PayrollRunWarningDto[]> {
  const { data, error } = await sb.from('finance_payroll_run_warnings')
    .select('*').eq('run_id', runId).order('created_at');
  if (error) throw Object.assign(new Error('listRunWarnings: ' + error.message), { status: 500 });
  return ((data ?? []) as DbWarningRow[]).map(toWarningDto);
}

// ── Audit log for a run ────────────────────────────────────────────────────────

export interface RunAuditLogEntry {
  id:            string;
  action:        string;
  actorId:       string | null;
  previousState: Record<string, unknown> | null;
  newState:      Record<string, unknown> | null;
  reason:        string | null;
  createdAt:     string;
}

/**
 * Returns the hr_audit_log entries for a specific payroll run,
 * ordered newest-first. Used by the drawer Audit tab.
 */
export async function listRunAuditLog(runId: string): Promise<RunAuditLogEntry[]> {
  const { data, error } = await sb
    .from('hr_audit_log')
    .select('id, action, actor_id, previous_state, new_state, reason, created_at')
    .eq('submodule_key', 'finance_payroll')
    .eq('record_id', runId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw Object.assign(new Error('listRunAuditLog: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{
    id: string; action: string; actor_id: string | null;
    previous_state: Record<string, unknown> | null;
    new_state: Record<string, unknown> | null;
    reason: string | null; created_at: string;
  }>).map(r => ({
    id:            r.id,
    action:        r.action,
    actorId:       r.actor_id,
    previousState: r.previous_state,
    newState:      r.new_state,
    reason:        r.reason,
    createdAt:     r.created_at,
  }));
}

// ── Create Run ────────────────────────────────────────────────────────────────

export interface CreateRunInput {
  idempotencyKey: string;
  runType: PayrollRunType;
  periodStart: string;
  periodEnd: string;
  sequenceNo?: number;
  sourceRunId?: string;
  payFrequency?: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  weeksInPeriod?: number;
  payGroupId?: string;
  payDate?: string;
  cutOffDate?: string;
  // Slice 1 run metadata
  reasonCode?: string;
  payrollOwnerId?: string;
  otCutoffAt?: string;
  approvalDeadlineAt?: string;
  fundingDate?: string;
  releaseWindow?: string;
  internalDescription?: string;
  actorId: string;
}

/**
 * Create a run through the atomic command primitive. The RPC owns run-number
 * allocation, business-key validation, idempotency, the business event and audit.
 */
export async function createPayrollRun(input: CreateRunInput): Promise<PayrollRunDto> {
  const row = await createPayrollRunCommand({
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    runType: input.runType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    sequenceNo: input.sequenceNo,
    sourceRunId: input.sourceRunId,
    payFrequency: input.payFrequency,
    weeksInPeriod: input.weeksInPeriod,
    payGroupId: input.payGroupId,
    payDate: input.payDate,
    cutOffDate: input.cutOffDate,
    reasonCode: input.reasonCode,
    payrollOwnerId: input.payrollOwnerId,
    otCutoffAt: input.otCutoffAt,
    approvalDeadlineAt: input.approvalDeadlineAt,
    fundingDate: input.fundingDate,
    releaseWindow: input.releaseWindow,
    internalDescription: input.internalDescription,
  });
  return toRunDto(row as unknown as DbRunRow);
}

// ── Lock Inputs ───────────────────────────────────────────────────────────────

/**
 * Lock inputs for a payroll run:
 * 1. Verify run is in 'draft' status.
 * 2. Collect all active employees with pay data.
 * 3. Snapshot base pay + active-approved pay items + approved OT into run_inputs.
 * 4. Set status='input_locked'.
 *
 * Idempotency: an already-committed command replays its durable receipt without
 * recollecting mutable payroll sources.
 */
export async function lockInputs(
  runId: string,
  actorId: string,
  idempotencyKey: string,
): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!['draft', 'input_locked'].includes(run.status)) {
    throw Object.assign(
      new Error(`Cannot lock inputs: run is in status '${run.status}'. Only draft runs or an identical input-lock retry are accepted.`),
      { status: 422 },
    );
  }
  if (run.status === 'input_locked') {
    const replayed = await replayInputSnapshot({
      runId,
      actorId,
      idempotencyKey,
    });
    return toRunDto(replayed.run as unknown as DbRunRow);
  }

  // Period boundary: first/last day of the period_month
  const periodStart = run.periodStart;
  const periodEnd = run.periodEnd;

  // ── 1. Collect active employees (scoped to the run's pay group, if any) ────
  // A pay-group run populates ONLY that group's members effective in the period;
  // an ungrouped run keeps the legacy behaviour (all active employees).
  let memberIds: string[] | null = null;
  if (run.payGroupId) {
    memberIds = await listGroupMemberIds(run.payGroupId, periodStart, periodEnd);
    if (memberIds.length === 0) {
      throw Object.assign(new Error('No employees are assigned to this pay group for the period. Assign members before locking inputs.'), { status: 422 });
    }
  }

  const EMP_COLS =
    'id, pay_basis, monthly_salary, hourly_rate, department_id, cost_center, status, start_date, end_date';
  type EmpRow = {
    id: string;
    pay_basis: string | null;
    monthly_salary: number | null;
    hourly_rate: number | null;
    department_id: string | null;
    cost_center: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
  };
  let empList: EmpRow[];
  if (memberIds) {
    // Grouped run: fetch by member id in chunks (a large IN() list overflows the URL).
    empList = [];
    for (const ids of chunk(memberIds, 300)) {
      const { data, error } = await sb.from('app_users')
        .select(EMP_COLS)
        .in('status', ['active', 'inactive'])
        .not('pay_basis', 'is', null)
        .in('id', ids);
      if (error) throw Object.assign(new Error('lockInputs/employees: ' + error.message), { status: 500 });
      empList.push(...((data ?? []) as EmpRow[]));
    }
  } else {
    // Ungrouped run: all employees active during any part of the period.
    empList = await selectAllRows<EmpRow>(() =>
      sb.from('app_users')
        .select(EMP_COLS)
        .in('status', ['active', 'inactive'])
        .not('pay_basis', 'is', null)
        .order('id'));
  }
  empList = empList.filter(emp =>
    (emp.start_date === null || emp.start_date <= periodEnd)
    && (emp.end_date === null || emp.end_date >= periodStart)
    && (emp.status === 'active' || emp.end_date !== null),
  );

  if (empList.length === 0) {
    throw Object.assign(
      new Error('No employees with pay data were active during this payroll period.'),
      { status: 422 },
    );
  }
  if (empList.length > MAX_RUN_EMPLOYEES) {
    throw Object.assign(new Error(`This run would populate ${empList.length} employees, above the supported single-run ceiling of ${MAX_RUN_EMPLOYEES}. Split it into multiple pay groups.`), { status: 422 });
  }

  // ── 2. Collect approved-active pay items effective in this period ─────────
  // Paginate: at ~1000 employees the run's pay items exceed the 1000-row cap.
  const payItems = await selectAllRows<{ id: string; employee_id: string; component_id: string; amount: number | null; percent: number | null; effective_from: string; effective_to: string | null }>(() =>
    sb.from('hr_employee_pay_items')
      .select('id, employee_id, component_id, amount, percent, effective_from, effective_to')
      .eq('is_active', true)
      .eq('status', 'active')
      .lte('effective_from', periodEnd)
      .or(`effective_to.is.null,effective_to.gte.${periodStart}`)
      .order('id'));

  // Resolve component codes for pay items (need code + is_taxable + reduces_chargeable + kind)
  const componentIds = [...new Set((payItems ?? []).map((p: { component_id: string }) => p.component_id))];
  let componentMap = new Map<string, { code: string; kind: string; isTaxable: boolean; reducesChargeable: boolean }>();
  if (componentIds.length > 0) {
    const { data: comps, error: compErr } = await sb.from('finance_pay_components')
      .select('id, code, kind, is_taxable, reduces_chargeable')
      .in('id', componentIds)
      .eq('is_active', true);
    if (compErr) throw Object.assign(new Error('lockInputs/components: ' + compErr.message), { status: 500 });
    for (const c of (comps ?? []) as { id: string; code: string; kind: string; is_taxable: boolean; reduces_chargeable: boolean }[]) {
      componentMap.set(c.id, { code: c.code, kind: c.kind, isTaxable: c.is_taxable, reducesChargeable: c.reduces_chargeable });
    }
  }

  // ── 3. Collect approved OT in this period (paginated) ────────────────────
  const overtimeEntries = await selectAllRows<{ id: string; employee_id: string; work_date: string; hours: number; multiplier: number | null; ot_type: string | null }>(() =>
    sb.from('hr_overtime_entries')
      .select('id, employee_id, work_date, hours, multiplier, ot_type')
      .eq('status', 'approved')
      .gte('work_date', periodStart)
      .lte('work_date', periodEnd)
      .order('id'));

  // Overtime rule engine: when an entry has an ot_type, the multiplier + minimum billable
  // hours come from the active rule (T&T public-holiday / rest-day / callout, etc.);
  // otherwise the entry's own multiplier is used (legacy behaviour).
  const otRules: OvertimeRule[] = await loadActiveOvertimeRules();

  // ── 3b. Approved timesheets covering this run period ──────────────────────
  // Hourly base pay = approved worked-hours × hourly rate. A timesheet belongs to
  // the run whose month contains its period_start (deterministic — no double-count
  // across adjacent runs). Salaried pay is prorated by the run's pay frequency
  // (annual ÷ pay periods), so a weekly run pays a week's share, not a full month.
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const payPeriods = payPeriodsForFrequency(run.payFrequency);
  // Chunk the employee-id IN() list (1000+ ids overflow the URL).
  const tsRows: { id: string; employee_id: string; total_worked_minutes: number }[] = [];
  for (const ids of chunk(empList.map(e => e.id), 300)) {
    const { data, error: tsErr } = await sb.from('hr_timesheets')
      .select('id, employee_id, total_worked_minutes')
      .eq('status', 'approved')
      .gte('period_start', periodStart)
      .lte('period_start', periodEnd)
      .in('employee_id', ids);
    if (tsErr) throw Object.assign(new Error('lockInputs/timesheets: ' + tsErr.message), { status: 500 });
    tsRows.push(...((data ?? []) as { id: string; employee_id: string; total_worked_minutes: number }[]));
  }
  const tsByEmp = new Map<string, { minutes: number; ids: string[] }>();
  for (const t of (tsRows ?? []) as { id: string; employee_id: string; total_worked_minutes: number }[]) {
    const cur = tsByEmp.get(t.employee_id) ?? { minutes: 0, ids: [] };
    cur.minutes += Number(t.total_worked_minutes ?? 0);
    cur.ids.push(t.id);
    tsByEmp.set(t.employee_id, cur);
  }
  const attendanceRows: {
    employee_id: string;
    work_date: string;
    worked_minutes: number;
  }[] = [];
  for (const ids of chunk(tsRows.map(row => row.id), 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('hr_attendance_records')
      .select('employee_id, work_date, worked_minutes')
      .in('timesheet_id', ids)
      .gt('worked_minutes', 0)
      .order('work_date');
    if (error) {
      throw Object.assign(
        new Error('lockInputs/attendance-records: ' + error.message),
        { status: 500 },
      );
    }
    attendanceRows.push(...((data ?? []) as typeof attendanceRows));
  }
  const workedDatesByEmp = new Map<string, string[]>();
  for (const row of attendanceRows) {
    const dates = workedDatesByEmp.get(row.employee_id) ?? [];
    dates.push(row.work_date);
    workedDatesByEmp.set(row.employee_id, dates);
  }

  // ── 3c. Active loan/advance installments due this period (Wave 5) ──────────
  // A deduction pay item is emitted per active loan; the balance is decremented from
  // the ledger only when the run is locked by finance_payroll_lock_run_tx, so re-lock
  // and recalculate never double-deduct.
  const loanInstallments = await loadLoanInstallments(empList.map(e => e.id), periodStart);

  // ── 3d. F-02 R4: per-employee source presence for the pinned policy's rules ──
  // Derived here, server-side, from the SAME canonical reads that build the inputs
  // and folded into each employee's base_pay line metadata. Because the lock route
  // builds p_inputs (a caller only sends {id, idempotencyKey}), this presence is
  // intrinsic to the locked payload — it cannot be fabricated or drift. Only the
  // sources the pinned policy actually references are read/populated; a policy with
  // no source/costing rules (incl. legacy fixtures) skips this entirely and the RPC
  // enforcement no-ops. lock_inputs_tx then fails-closed on block_input_lock /
  // cost_centre and persists the rest as immutable conflict evidence.
  let sourcePresence: Map<string, Record<string, boolean | string | null>> | null = null;
  {
    const pinRow = (await sb.from('finance_payroll_runs')
      .select('pay_policy_version_id, pay_policy_required')
      .eq('id', runId)
      .single()).data as { pay_policy_version_id: string | null; pay_policy_required: boolean | null } | null;
    const policyVersionId = pinRow?.pay_policy_version_id ?? null;
    if (pinRow?.pay_policy_required && policyVersionId) {
      const [srcRulesRes, costRulesRes] = await Promise.all([
        sb.from('finance_pay_policy_source_rules').select('source_type').eq('policy_version_id', policyVersionId),
        sb.from('finance_pay_policy_costing_rules').select('dimension').eq('policy_version_id', policyVersionId),
      ]);
      const needed = new Set(((srcRulesRes.data ?? []) as { source_type: string }[]).map(r => r.source_type));
      const needsCostCentre = ((costRulesRes.data ?? []) as { dimension: string }[]).some(r => r.dimension === 'cost_centre');
      if (needed.size > 0 || needsCostCentre) {
        const empIds = empList.map(e => e.id);
        const leaveSet = new Set<string>();
        const statSet = new Set<string>();
        const bankSet = new Set<string>();
        for (const ids of chunk(empIds, 300)) {
          if (needed.has('approved_leave')) {
            const { data } = await sb.from('hr_leave_requests')
              .select('employee_id')
              .eq('status', 'approved')
              .lte('from_date', periodEnd)
              .gte('to_date', periodStart)
              .in('employee_id', ids);
            for (const r of (data ?? []) as { employee_id: string }[]) leaveSet.add(r.employee_id);
          }
          if (needed.has('statutory_profile')) {
            const { data } = await sb.from('hr_employee_statutory_profiles')
              .select('employee_id').in('employee_id', ids);
            for (const r of (data ?? []) as { employee_id: string }[]) statSet.add(r.employee_id);
          }
          if (needed.has('payment_destination')) {
            const { data } = await sb.from('finance_employee_bank_accounts')
              .select('employee_id').eq('is_primary', true).eq('is_active', true).in('employee_id', ids);
            for (const r of (data ?? []) as { employee_id: string }[]) bankSet.add(r.employee_id);
          }
        }
        sourcePresence = new Map();
        for (const emp of empList) {
          const hasPayItem = payItems.some((p: { employee_id: string }) => p.employee_id === emp.id);
          const s: Record<string, boolean | string | null> = {};
          if (needed.has('approved_time')) s.approved_time = tsByEmp.has(emp.id);
          if (needed.has('approved_compensation')) s.approved_compensation = hasPayItem || (emp.pay_basis === 'salary' && emp.monthly_salary != null);
          if (needed.has('approved_leave')) s.approved_leave = leaveSet.has(emp.id);
          if (needed.has('statutory_profile')) s.statutory_profile = statSet.has(emp.id);
          if (needed.has('payment_destination')) s.payment_destination = bankSet.has(emp.id);
          if (needsCostCentre) s.cost_centre = emp.cost_center ?? null;
          sourcePresence.set(emp.id, s);
        }
      }
    }
  }

  // ── 4. Build input rows ───────────────────────────────────────────────────
  const inputRows: Record<string, unknown>[] = [];

  // Delete any prior inputs (allows re-lock from draft — shouldn't happen but safe)
  for (const emp of empList) {
    // Base pay
    //  • salaried: monthly salary prorated to the run's pay frequency (annual ÷ pay periods).
    //  • hourly:   approved-timesheet worked hours × hourly rate (0 until a timesheet is approved).
    const isSalary      = emp.pay_basis === 'salary';
    const ts            = tsByEmp.get(emp.id);
    const workedHours   = ts ? round2(ts.minutes / 60) : 0;
    const hasApprovedTs = !!ts;
    const hourlyRate    = emp.hourly_rate ?? 0;
    const nisContributionWeeks = buildEmployeeContributionWeeks({
      periodStart,
      periodEnd,
      payBasis: emp.pay_basis,
      employmentStart: emp.start_date,
      employmentEnd: emp.end_date,
      workedDates: workedDatesByEmp.get(emp.id) ?? [],
    });
    if (!isSalary && workedHours > 0 && nisContributionWeeks.length === 0) {
      throw Object.assign(
        new Error(
          `Approved timesheet evidence for employee ${emp.id} has worked hours but no linked daily attendance records. Rebuild the timesheet before locking payroll inputs.`,
        ),
        { status: 409 },
      );
    }
    const basePay       = isSalary
      ? round2(((emp.monthly_salary ?? 0) * 12) / payPeriods)
      : round2(hourlyRate * workedHours);

    inputRows.push({
      run_id:         runId,
      employee_id:    emp.id,
      source_type:    'base_pay',
      source_id:      emp.id,
      component_code: isSalary ? 'basic' : 'hourly',
      label:          isSalary ? 'Salary (period)' : `Hourly (${workedHours}h)`,
      amount:         basePay,
      quantity:       isSalary ? null : workedHours,
      rate:           isSalary ? null : hourlyRate,
      metadata:       {
        pay_basis:              emp.pay_basis,
        pay_periods:            payPeriods,
        has_approved_timesheet: hasApprovedTs,
        timesheet_ids:          ts?.ids ?? [],
        employment_start:       emp.start_date,
        employment_end:         emp.end_date,
        nis_contribution_weeks: nisContributionWeeks,
        // F-02 R4: pinned-policy source presence (only present when the policy has
        // source/costing rules) — lock_inputs_tx enforces/persists from this.
        ...(sourcePresence ? { sources: sourcePresence.get(emp.id) ?? {} } : {}),
        ...(isSalary
          ? { monthly_salary: emp.monthly_salary ?? 0 }
          : { hourly_rate: hourlyRate, worked_hours: workedHours }),
      },
    });

    // Pay items for this employee
    const empItems = (payItems ?? []).filter((p: { employee_id: string }) => p.employee_id === emp.id);
    for (const item of empItems as {
      id: string; employee_id: string; component_id: string;
      amount: number | null; percent: number | null;
      effective_from: string; effective_to: string | null;
    }[]) {
      const comp = componentMap.get(item.component_id);
      if (!comp) continue; // component was deactivated after approval — skip

      const amount = item.amount !== null
        ? Number(item.amount)
        : (basePay * Number(item.percent ?? 0)) / 100;

      inputRows.push({
        run_id:         runId,
        employee_id:    emp.id,
        source_type:    'pay_item',
        source_id:      item.id,
        component_code: comp.code,
        label:          comp.code,
        amount,
        quantity:       null,
        rate:           null,
        metadata:       {
          kind:               comp.kind,
          is_taxable:         comp.isTaxable,
          reduces_chargeable: comp.reducesChargeable,
          effective_from:     item.effective_from,
          effective_to:       item.effective_to,
        },
      });
    }

    // Approved OT for this employee
    const empOt = (overtimeEntries ?? []).filter((o: { employee_id: string }) => o.employee_id === emp.id);
    for (const ot of empOt as {
      id: string; employee_id: string; work_date: string;
      hours: number; multiplier: number; ot_type: string | null;
    }[]) {
      // Resolve the multiplier + minimum billable hours from the OT rule engine when the entry
      // has an ot_type; otherwise fall back to the entry's own multiplier (legacy).
      let multiplier = Number(ot.multiplier);
      let payableHours = Number(ot.hours);
      if (ot.ot_type) {
        const rule = resolveOvertimeMultiplier(otRules, ot.ot_type, ot.work_date);
        if (rule) {
          multiplier = rule.multiplier;
          if (rule.minimumHours != null) payableHours = Math.max(payableHours, rule.minimumHours);
        }
      }

      // OT pay = payableHours × multiplier × hourly-equivalent.
      // Salaried per-hour = annual ÷ standard annual hours (52 weeks × 40h = 2080).
      const hourlyEquivalent = emp.pay_basis === 'salary'
        ? ((emp.monthly_salary ?? 0) * 12) / 2080
        : (emp.hourly_rate ?? 0);
      const otAmount = payableHours * multiplier * hourlyEquivalent;

      inputRows.push({
        run_id:         runId,
        employee_id:    emp.id,
        source_type:    'overtime',
        source_id:      ot.id,
        component_code: 'overtime',
        label:          `OT ${ot.work_date}${ot.ot_type ? ' (' + ot.ot_type.replace(/_/g, ' ') + ')' : ''}`,
        amount:         Math.round(otAmount * 100) / 100,
        quantity:       payableHours,
        rate:           multiplier,
        metadata:       { work_date: ot.work_date, multiplier, ot_type: ot.ot_type ?? null, entered_hours: Number(ot.hours) },
      });
    }

    // Active-loan installments — a post-tax deduction per active loan (reduces net, NOT
    // chargeable income). The ledger is written atomically by the lock command.
    for (const inst of loanInstallments.get(emp.id) ?? []) {
      inputRows.push({
        run_id:         runId,
        employee_id:    emp.id,
        source_type:    'pay_item',
        source_id:      inst.loanId,
        component_code: 'loan_repayment',
        label:          `Loan repayment (${inst.reference})`,
        amount:         inst.amount,
        quantity:       null,
        rate:           null,
        metadata:       { kind: 'deduction', is_taxable: false, reduces_chargeable: false, loan: true, loan_id: inst.loanId, loan_reference: inst.reference },
      });
    }
  }

  // Batch insert inputs (chunked — a large run's inputs exceed one payload)
  const loanInstallmentCount = [...loanInstallments.values()]
    .reduce((total, rows) => total + rows.length, 0);
  const includedPayItemCount = inputRows
    .filter(row => row['source_type'] === 'pay_item').length - loanInstallmentCount;
  const includedOvertimeCount = inputRows
    .filter(row => row['source_type'] === 'overtime').length;
  const published = await publishInputSnapshot({
    runId,
    actorId,
    idempotencyKey,
    inputs: inputRows,
    employeeCount: empList.length,
    sourceSummary: {
      periodStart,
      periodEnd,
      payGroupId: run.payGroupId,
      employeeCount: empList.length,
      payItemCount: includedPayItemCount,
      overtimeEntryCount: includedOvertimeCount,
      approvedTimesheetCount: tsRows.length,
      attendanceRecordCount: attendanceRows.length,
      loanInstallmentCount,
    },
  });

  // ── 5. Update run status ──────────────────────────────────────────────────
  return toRunDto(published.run as unknown as DbRunRow);
}

// ── Calculate ─────────────────────────────────────────────────────────────────

/**
 * Calculate payroll lines for an 'input_locked' run.
 * For each employee:
 *   1. Run NIS checks → insert warnings per policy
 *   2. computeRunLine() → write finance_payroll_run_lines (incl. NIS snapshot)
 * 3. Roll up run totals → set status='calculated'
 */
export async function calculateRun(
  runId: string,
  actorId: string,
  idempotencyKey: string,
): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  // Allow recalculation of an already-'calculated' run too, so worksheet overrides can be
  // applied and recomputed before submission. 'returned' (rejected/returned by the approval
  // workflow) is likewise revisable — the preparer corrects and re-calculates.
  if (!['input_locked', 'calculation_failed', 'calculated', 'returned'].includes(run.status)) {
    throw Object.assign(
      new Error(
        `Cannot calculate: run is in status '${run.status}'. Only input-locked, failed, calculated or returned runs can be calculated.`,
      ),
      { status: 422 },
    );
  }

  // Load the run's SNAPSHOTTED statutory version (fixed at create time) — NOT the
  // currently-active one. Rates AND NIS classes must both resolve from the version the
  // run was created against, so activating a new version mid-cycle can never retro-change
  // an existing run's figures or split its rate sources (PAYE/HS from one version, NIS
  // classes from another). listNisClasses(run.statutoryVersionId) already uses the
  // snapshot; this aligns the PAYE/HS rate block to the same version.
  const calculation = await startCalculationAttempt({
    runId,
    actorId,
    idempotencyKey,
  });
  const attempt = calculation.attempt;
  if (calculation.duplicate) {
    if (attempt.status === 'succeeded') {
      const current = await getPayrollRun(runId);
      if (!current) {
        throw Object.assign(new Error('Calculated run could not be reloaded.'), { status: 503 });
      }
      return current;
    }
    if (attempt.status === 'failed') {
      throw Object.assign(
        new Error(
          `${attempt.error_message ?? 'The prior calculation attempt failed.'} Correlation ID: ${attempt.correlation_id}. Use a new idempotency key after correcting the cause.`,
        ),
        { status: 422, code: attempt.error_code, correlationId: attempt.correlation_id },
      );
    }
    throw Object.assign(
      new Error(`A calculation is already running. Correlation ID: ${attempt.correlation_id}.`),
      { status: 409, correlationId: attempt.correlation_id },
    );
  }

  try {
  const version = await getStatutoryVersion(run.statutoryVersionId);
  if (!version) {
    throw Object.assign(
      new Error(`Payroll run's statutory version (${run.statutoryVersionId}) not found — it may have been deleted.`),
      { status: 422 },
    );
  }

  const nisClasses: NisClassRow[] = await listNisClasses(run.statutoryVersionId);
  const policy = await loadPayrollPolicy();

  // Load all inputs for this run, grouped by employee
  const allInputs = await listRunInputs(runId);
  const empIds = [...new Set(allInputs.map(i => i.employeeId))];

  if (empIds.length === 0) {
    throw Object.assign(new Error('No inputs found for this run. Lock inputs first.'), { status: 422 });
  }
  if (empIds.length > MAX_RUN_EMPLOYEES) {
    throw Object.assign(new Error(`This run has ${empIds.length} employees, above the supported single-run ceiling of ${MAX_RUN_EMPLOYEES}. Split it into multiple pay groups.`), { status: 422 });
  }

  // ── F-02 R4: consume the persisted block_employee_calculation exclusions from the
  // snapshot's immutable lock evidence. Calculation NEVER re-evaluates live sources —
  // it only honors what was frozen at lock; an excluded employee gets no line. The
  // review/correction conflicts are materialized into findings by the atomic calc
  // publish RPC (finance_payroll_calculation_publish_tx), not here.
  const excludedEmployees = new Set<string>();
  if (run.currentInputSnapshotId) {
    const snapRow = (await sb.from('finance_payroll_input_snapshots')
      .select('source_summary')
      .eq('id', run.currentInputSnapshotId)
      .single()).data;
    const summary = snapRow?.source_summary as { excludedEmployees?: { employeeId?: string }[] } | null | undefined;
    for (const ex of (summary?.excludedEmployees ?? [])) {
      if (ex.employeeId) excludedEmployees.add(ex.employeeId);
    }
  }

  // Batch-load every statutory profile once (was an N+1: one query per employee).
  const profileMap = await getStatutoryProfilesByEmployees(empIds, 'TT');

  // Prior lines/warnings are cleared inside the atomic commit RPC below (delete +
  // insert + totals update in ONE transaction), so a re-calculate rebuilds cleanly
  // without a non-transactional delete window.
  const lineRows: Record<string, unknown>[] = [];
  const warningRows: Record<string, unknown>[] = [];

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalNisEmployer = 0;

  for (const empId of empIds) {
    if (excludedEmployees.has(empId)) continue; // R4: block_employee_calculation (persisted at lock)
    const empInputs = allInputs.filter(i => i.employeeId === empId);

    // ── NIS checks (§13) ────────────────────────────────────────────────────
    const profile = profileMap.get(empId) ?? null;   // batch-loaded (no per-employee query)
    const nisApplicable = profile ? profile.nisApplicable : true; // default: applicable

    if (nisApplicable) {
      // Warning: missing NIS number
      if (policy.warnMissingNisNumber && (!profile || !profile.nisNumber)) {
        warningRows.push({
          run_id:       runId,
          employee_id:  empId,
          warning_type: 'missing_nis_number',
          severity:     policy.blockMissingNisNewEmployee ? 'blocker' : 'warning',
          message:      `Employee ${empId} has no NIS number on record.`,
          metadata:     {},
        });
      }

      // Warning: NIS profile not verified
      if (profile && profile.nisStatus !== 'verified') {
        warningRows.push({
          run_id:       runId,
          employee_id:  empId,
          warning_type: 'nis_pending_verification',
          severity:     policy.requireVerifiedNis ? 'blocker' : 'warning',
          message:      `Employee ${empId} NIS profile status is '${profile.nisStatus}' — Finance verification pending.`,
          metadata:     { nisStatus: profile.nisStatus },
        });
      }

      // Warning: previous employer data missing (for continuity)
      if (profile && (!profile.previousEmployerName && profile.openingYtdNisEmployee > 0)) {
        warningRows.push({
          run_id:       runId,
          employee_id:  empId,
          warning_type: 'previous_employer_data_missing',
          severity:     'info',
          message:      `Employee ${empId} has opening NIS balance but no previous employer name.`,
          metadata:     {},
        });
      }

      // Warning: opening balance missing when previous employer name provided
      if (profile && profile.previousEmployerName && !profile.openingBalanceAsOf) {
        warningRows.push({
          run_id:       runId,
          employee_id:  empId,
          warning_type: 'opening_balance_missing',
          severity:     'info',
          message:      `Employee ${empId} has previous employer but no opening balance date.`,
          metadata:     {},
        });
      }
    }

    // ── Timesheet warnings (base pay depends on approved worked hours) ────────
    // Derived from the base_pay input metadata snapshotted at lock-inputs time.
    const baseInput = empInputs.find(i => i.sourceType === 'base_pay');
    const baseMeta = (baseInput?.metadata ?? {}) as {
      pay_basis?: string;
      has_approved_timesheet?: boolean;
      nis_contribution_weeks?: unknown;
    };
    const employeeContributionWeeks = readFrozenContributionWeeks(
      baseMeta.nis_contribution_weeks,
    );
    const employeeWeeksInPeriod = employeeContributionWeeks
      .reduce((sum, period) => sum + period.weeks, 0);
    if (baseMeta.pay_basis === 'hourly' && !baseMeta.has_approved_timesheet) {
      warningRows.push({
        run_id:       runId,
        employee_id:  empId,
        warning_type: 'missing_approved_timesheet',
        severity:     policy.requireApprovedTimesheetForHourly ? 'blocker' : 'warning',
        message:      `Hourly employee ${empId} has no approved timesheet for the period — base pay is 0 until a timesheet is approved.`,
        metadata:     {},
      });
    } else if (baseMeta.pay_basis === 'salary' && !baseMeta.has_approved_timesheet && policy.warnMissingTimesheetForSalary) {
      warningRows.push({
        run_id:       runId,
        employee_id:  empId,
        warning_type: 'missing_timesheet_salary',
        severity:     'info',
        message:      `Salaried employee ${empId} has no approved timesheet for the period (informational; full salary applied).`,
        metadata:     {},
      });
    }

    // ── Aggregate inputs ────────────────────────────────────────────────────
    let basePay = 0;
    let taxableAllowances = 0;
    let nonTaxableAllowances = 0;
    let approvedOtAmount = 0;
    let preTaxPensionDeductions = 0;
    let voluntaryDeductions = 0;

    for (const input of empInputs) {
      const meta = input.metadata as {
        kind?: string; is_taxable?: boolean; reduces_chargeable?: boolean;
        pay_basis?: string;
      };

      if (input.sourceType === 'base_pay') {
        basePay += Number(input.amount ?? 0);
      } else if (input.sourceType === 'overtime') {
        approvedOtAmount += Number(input.amount ?? 0);
      } else if (input.sourceType === 'pay_item') {
        // Worksheet overrides are also stored as pay_item rows (tagged metadata.override), so
        // they aggregate here into earnings / deductions via their kind/is_taxable metadata.
        const amount = Number(input.amount ?? 0);
        if (meta.kind === 'earning') {
          if (meta.is_taxable !== false) {
            taxableAllowances += amount;
          } else {
            nonTaxableAllowances += amount;
          }
        } else if (meta.kind === 'deduction') {
          if (meta.reduces_chargeable === true) {
            preTaxPensionDeductions += amount;
          } else {
            voluntaryDeductions += amount;
          }
        }
      }
    }

    // ── Compute the line ─────────────────────────────────────────────────────
    const result = computeRunLine({
      basePay,
      taxableAllowances,
      nonTaxableAllowances,
      approvedOtAmount,
      preTaxPensionDeductions,
      voluntaryDeductions,
      nisApplicable,
      nisClasses,
      weeksInPeriod: employeeWeeksInPeriod,
      payPeriods: payPeriodsForFrequency(run.payFrequency),
      statutory: {
        payePersonalAllowance: version.payePersonalAllowance,
        payeBand1Ceiling:      version.payeBand1Ceiling,
        payeBand1Rate:         version.payeBand1Rate,
        payeBand2Rate:         version.payeBand2Rate,
        hsMonthlyThreshold:    version.hsMonthlyThreshold,
        hsWeeklyHigh:          version.hsWeeklyHigh,
        hsWeeklyLow:           version.hsWeeklyLow,
      },
    });

    // Warn if NIS class not found despite being applicable
    if (nisApplicable && result.nisClassNo === null && result.gross > 0) {
      const weeklyInsurable = employeeWeeksInPeriod > 0
        ? result.taxableGross / employeeWeeksInPeriod
        : 0;
      warningRows.push({
        run_id:       runId,
        employee_id:  empId,
        warning_type: 'nis_class_not_found',
        severity:     'warning',
        message:      `No NIS class found for employee ${empId} (weekly insurable = ${weeklyInsurable.toFixed(2)}).`,
        metadata:     { weeklyInsurable },
      });
    }

    // ── NIS snapshot from profile ────────────────────────────────────────────
    const nisNumberMasked = profile?.nisNumber
      ? maskNisNumber(profile.nisNumber)
      : null;
    const nisContributionPeriods = buildNisContributionPeriods({
      contributionWeeks: employeeContributionWeeks,
      weeksInPeriod: employeeWeeksInPeriod,
      employeeWeekly: result.nisEmployeeWeekly,
      employerWeekly: result.nisEmployerWeekly,
      employeeTotal: result.nisEmployee,
      employerTotal: result.nisEmployer,
    });

    lineRows.push({
      run_id:                  runId,
      employee_id:             empId,
      base:                    result.base,
      taxable_gross:           result.taxableGross,
      gross:                   result.gross,
      nis_employee:            result.nisEmployee,
      nis_employer:            result.nisEmployer,
      health_surcharge:        result.healthSurcharge,
      chargeable_income:       result.chargeableIncome,
      paye:                    result.paye,
      voluntary_deductions:    result.voluntaryDeductions,
      net:                     result.net,
      breakdown:               {
        basePay, taxableAllowances, nonTaxableAllowances,
        approvedOtAmount, preTaxPensionDeductions,
        nisClassNo:     result.nisClassNo,
        weeksInPeriod:  employeeWeeksInPeriod,
        nisEmployeeWeekly: result.nisEmployeeWeekly,
        nisEmployerWeekly: result.nisEmployerWeekly,
        nisContributionPeriods,
        statutoryVersionId: run.statutoryVersionId,
      },
      department_id:           null, // resolved from app_users in a later phase
      cost_center_id:          null,
      nis_number_masked:       nisNumberMasked,
      nis_status:              profile?.nisStatus ?? null,
      nis_class_no:            result.nisClassNo,
      opening_ytd_nis_employee: profile?.openingYtdNisEmployee ?? 0,
      opening_ytd_nis_employer: profile?.openingYtdNisEmployer ?? 0,
    });

    // Accumulate totals
    totalGross       += result.gross;
    totalDeductions  += result.nisEmployee + result.healthSurcharge + result.paye + result.voluntaryDeductions;
    totalNet         += result.net;
    totalNisEmployer += result.nisEmployer;
  }

  // ── Atomic commit (P3: includes event + audit in the same transaction) ───
  // ONE transaction (finance_calculate_run_commit): clear prior lines/warnings,
  // insert the freshly-computed rows, roll up totals + set status, and also
  // insert the app_events + hr_audit_log rows so audit trail is atomic with the
  // business commit. supabase-js cannot wrap these as a transaction from the app
  // layer, so this RPC is the single commit path.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const calcTotals = {
    grossTotal:       round2(totalGross),
    deductionTotal:   round2(totalDeductions),
    netTotal:         round2(totalNet),
    nisEmployerTotal: round2(totalNisEmployer),
    // The calculated population = one line per NON-excluded employee (R4
    // block_employee_calculation produces no line); the publish RPC asserts
    // totals.employeeCount === line count, netting out the excluded set.
    employeeCount:    lineRows.length,
  };
  const calcEventInput = {
    eventType: 'finance.payroll.run.calculated',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: (warningRows.length > 0 ? 'warning' : 'success') as 'warning' | 'success',
    payload: {
      runNo:         run.runNo,
      employeeCount: lineRows.length,
      grossTotal:    calcTotals.grossTotal,
      netTotal:      calcTotals.netTotal,
      warningCount:  warningRows.length,
    },
  } as const;

  const published = await publishCalculationVersion({
    attemptId: attempt.id,
    actorId,
    lines: lineRows,
    warnings: warningRows,
    totals: calcTotals,
  });
  const updatedRun = toRunDto(published.run as unknown as DbRunRow);

  // Best-effort notification delivery AFTER the commit (event is in the DB).
  void deliverEventNotifications(calcEventInput, published.eventId);

  return updatedRun;
  } catch (error) {
    const failure = calculationFailure(error);
    try {
      await failCalculationAttempt({
        attemptId: attempt.id,
        actorId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        technicalDetail: failure.technicalDetail,
      });
    } catch (recordError) {
      let persistedAttempt: Awaited<ReturnType<typeof getCalculationAttempt>> = null;
      try {
        persistedAttempt = await getCalculationAttempt(attempt.id);
      } catch (checkError) {
        console.error('[payroll] failed to verify calculation attempt after record failure', {
          attemptId: attempt.id,
          correlationId: attempt.correlation_id,
          error: (checkError as Error).message,
        });
      }
      if (persistedAttempt?.status === 'succeeded') {
        const committedRun = await getPayrollRun(runId);
        if (committedRun) return committedRun;
      }
      if (persistedAttempt?.status === 'failed') {
        throw Object.assign(
          new Error(`${persistedAttempt.errorMessage ?? failure.errorMessage} Correlation ID: ${attempt.correlation_id}.`),
          {
            status: failure.status,
            code: persistedAttempt.errorCode ?? failure.errorCode,
            correlationId: attempt.correlation_id,
          },
        );
      }
      throw Object.assign(
        new Error(
          `Payroll calculation failed and its failure state could not be recorded: ${(recordError as Error).message}`,
        ),
        { status: 500, cause: error, correlationId: attempt.correlation_id },
      );
    }
    throw Object.assign(
      new Error(`${failure.errorMessage} Correlation ID: ${attempt.correlation_id}.`),
      {
        status: failure.status,
        code: failure.errorCode,
        correlationId: attempt.correlation_id,
      },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mask NIS number for display — show last 4 characters only, e.g. ***-1234. */
function maskNisNumber(nisNumber: string): string {
  if (nisNumber.length <= 4) return '***' + nisNumber;
  return '***-' + nisNumber.slice(-4);
}

// ── Resolve Warning ───────────────────────────────────────────────────────────

// ── Employee Population Preview (wizard step) ─────────────────────────────────

export interface PopulationPreviewResult {
  total:                    number;
  salaried:                 number;
  hourly:                   number;
  missingPayBasis:          number;
  newHires:                 number;
  terminations:             number;
  missingStatutoryProfile:  number;
}

/**
 * Returns a count of active employees for the payroll wizard preview (step 2).
 * Accepts an optional periodMonth (YYYY-MM-DD) to scope new-hire / termination counts.
 * Does NOT lock inputs — this is a read-only estimate.
 */
export async function getEmployeePopulationPreview(
  periodMonth?: string,
): Promise<PopulationPreviewResult> {
  // Derive the period start/end from the supplied periodMonth (or default to current month)
  const baseDate = periodMonth ? new Date(periodMonth) : new Date();
  const periodStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
    .toISOString().slice(0, 10);
  const periodEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0)
    .toISOString().slice(0, 10);

  // Fetch all non-system users with scheduling and pay fields
  const { data, error } = await sb
    .from('app_users')
    .select('id, pay_basis, status, start_date, end_date')
    .in('status', ['active', 'inactive'])
    .not('role', 'eq', 'system');
  if (error) throw Object.assign(new Error('populationPreview: ' + error.message), { status: 500 });

  const rows = (data ?? []) as {
    id: string; pay_basis: string | null;
    status: string; start_date: string | null; end_date: string | null;
  }[];

  const active    = rows.filter(r => r.status === 'active');
  const salaried  = active.filter(r => r.pay_basis === 'salary').length;
  const hourly    = active.filter(r => r.pay_basis === 'hourly').length;
  const missing   = active.filter(r => !r.pay_basis).length;

  // New hires: active with start_date inside the period
  const newHires = rows.filter(r =>
    r.start_date && r.start_date >= periodStart && r.start_date <= periodEnd,
  ).length;

  // Terminations: inactive with end_date inside the period
  const terminations = rows.filter(r =>
    r.status === 'inactive' && r.end_date && r.end_date >= periodStart && r.end_date <= periodEnd,
  ).length;

  // Missing statutory profile: active employees with no hr_employee_statutory_profiles row
  const activeIds = active.map(r => r.id);
  let missingStatutoryProfile = 0;
  if (activeIds.length > 0) {
    const profiledIds = new Set<string>();
    for (const ids of chunk(activeIds, 300)) {   // chunk the IN() — 1000+ ids overflow the URL
      const { data: spData, error: spErr } = await sb
        .from('hr_employee_statutory_profiles')
        .select('employee_id')
        .in('employee_id', ids);
      if (spErr) throw Object.assign(new Error('populationPreview/sp: ' + spErr.message), { status: 500 });
      for (const r of (spData ?? []) as { employee_id: string }[]) profiledIds.add(r.employee_id);
    }
    missingStatutoryProfile = activeIds.filter(id => !profiledIds.has(id)).length;
  }

  return {
    total: active.length, salaried, hourly, missingPayBasis: missing,
    newHires, terminations, missingStatutoryProfile,
  };
}

// ── Population reconciliation (create-run wizard step 5, Slice 2) ────────────────
// Pay-group-scoped, read-only. Reuses the population-preview classification logic
// but scopes it to a pay group's period membership, and adds: a per-rule
// breakdown (each defect with its owner + disposition + remediation), the
// department distribution of the active population, and a diff against the last
// RELEASED run for the same pay group. No mutation → cannot affect create.

export interface PopulationReconciliationRule {
  key:       string;
  label:     string;
  count:     number;
  rule:      string;   // the plain-language rule the count is derived from
  ownerRole: 'hr' | 'finance' | 'payroll';
  state:     'included' | 'review' | 'blocker' | 'warning';
  action:    string | null;   // remediation guidance; null when nothing to do
}
export interface PopulationReconciliationDept {
  departmentId: string | null;
  name:         string;
  count:        number;
}
export interface PopulationReconciliationPriorRun {
  runId:              string | null;
  releasedPopulation: number;   // employees paid on the last released run
  added:              number;   // in the proposed population, not in the prior release
  removed:            number;   // in the prior release, not in the proposed population
  proposed:           number;   // employees who would be included on this run
}
export interface PopulationReconciliationResult {
  rules:       PopulationReconciliationRule[];
  departments: PopulationReconciliationDept[];
  priorRun:    PopulationReconciliationPriorRun;
}

/**
 * Reconcile the employee population for a pay-group-scoped run before Lock Inputs.
 * Read-only estimate — final membership still freezes at Lock Inputs.
 */
export async function getPopulationReconciliation(
  payGroupId:  string,
  periodStart: string,
  periodEnd:   string,
): Promise<PopulationReconciliationResult> {
  const group = await getPayGroup(payGroupId);
  if (!group) throw Object.assign(new Error('Pay group not found.'), { status: 404 });

  // Base population = members whose assignment covers the run period.
  const memberIds = await listGroupMemberIds(payGroupId, periodStart, periodEnd);

  type UserRow = {
    id: string; pay_basis: string | null; status: string;
    start_date: string | null; end_date: string | null; department_id: string | null;
  };
  const users: UserRow[] = [];
  for (const ids of chunk(memberIds, 300)) {   // chunk the IN() — 1000+ ids overflow the URL
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('app_users')
      .select('id, pay_basis, status, start_date, end_date, department_id')
      .in('id', ids);
    if (error) throw Object.assign(new Error('populationRecon/users: ' + error.message), { status: 500 });
    users.push(...(data ?? []) as UserRow[]);
  }

  const active   = users.filter(u => u.status === 'active');
  const activeIds = active.map(u => u.id);

  // Missing statutory profile — jurisdiction follows the pay group's country.
  const profiles = await getStatutoryProfilesByEmployees(activeIds, group.statutoryCountry);
  const missingStatutory = active.filter(u => !profiles.has(u.id)).length;

  // Missing primary bank account — active + primary is required to disburse by EFT.
  const bankedIds = new Set<string>();
  for (const ids of chunk(activeIds, 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('finance_employee_bank_accounts')
      .select('employee_id')
      .eq('is_primary', true)
      .eq('is_active', true)
      .in('employee_id', ids);
    if (error) throw Object.assign(new Error('populationRecon/bank: ' + error.message), { status: 500 });
    for (const r of (data ?? []) as { employee_id: string }[]) bankedIds.add(r.employee_id);
  }
  const missingBank = activeIds.filter(id => !bankedIds.has(id)).length;

  const withPayBasis   = active.filter(u => !!u.pay_basis);
  const missingPayBasis = active.length - withPayBasis.length;
  const newHires = active.filter(u =>
    u.start_date && u.start_date >= periodStart && u.start_date <= periodEnd).length;
  // Terminations: non-active members whose employment ended inside the period.
  const terminations = users.filter(u =>
    u.status !== 'active' && u.end_date && u.end_date >= periodStart && u.end_date <= periodEnd).length;

  const rules: PopulationReconciliationRule[] = [
    { key: 'included', label: 'Active — will be included', count: withPayBasis.length,
      rule: 'Active pay-group members with a pay basis set are included at Lock Inputs.',
      ownerRole: 'payroll', state: 'included', action: null },
    { key: 'new_hires', label: 'New hires this period', count: newHires,
      rule: 'Members whose start date falls inside the run period.',
      ownerRole: 'hr', state: 'warning',
      action: newHires ? 'Confirm start dates and proration in HR before Lock Inputs.' : null },
    { key: 'terminations', label: 'Terminations this period', count: terminations,
      rule: 'Members whose employment ended inside the run period.',
      ownerRole: 'hr', state: 'review',
      action: terminations ? 'Confirm final-pay handling before Lock Inputs.' : null },
    { key: 'missing_pay_basis', label: 'Missing pay basis', count: missingPayBasis,
      rule: 'Active members with no pay basis are excluded at Lock Inputs.',
      ownerRole: 'hr', state: 'blocker',
      action: missingPayBasis ? 'Set the pay basis on the HR employee profile.' : null },
    { key: 'missing_statutory_profile', label: 'Missing statutory profile', count: missingStatutory,
      rule: `Active members with no ${group.statutoryCountry} statutory profile — NIS/PAYE cannot be computed.`,
      ownerRole: 'hr', state: 'warning',
      action: missingStatutory ? 'Create the statutory profile in HR.' : null },
    { key: 'missing_primary_bank', label: 'Missing primary bank account', count: missingBank,
      rule: 'Active members with no active primary bank account cannot be paid by EFT.',
      ownerRole: 'finance', state: 'review',
      action: missingBank ? 'Capture a primary bank account before disbursement.' : null },
  ];

  // Department distribution of the active population.
  const deptCounts = new Map<string | null, number>();
  for (const u of active) {
    const key = u.department_id ?? null;
    deptCounts.set(key, (deptCounts.get(key) ?? 0) + 1);
  }
  const deptIds = [...deptCounts.keys()].filter((k): k is string => !!k);
  const deptNames = new Map<string, string>();
  if (deptIds.length > 0) {
    const { data, error } = await sb.from('departments').select('id, name').in('id', deptIds);
    if (error) throw Object.assign(new Error('populationRecon/depts: ' + error.message), { status: 500 });
    for (const r of (data ?? []) as { id: string; name: string }[]) deptNames.set(r.id, r.name);
  }
  const departments: PopulationReconciliationDept[] = [...deptCounts.entries()]
    .map(([id, count]) => ({
      departmentId: id,
      name: id ? (deptNames.get(id) ?? id) : 'Unassigned',
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Diff vs the last RELEASED run for this pay group.
  const { data: priorRows, error: priorErr } = await sb.from('finance_payroll_runs')
    .select('id, released_at, period_end')
    .eq('pay_group_id', payGroupId)
    .eq('status', 'released')
    .order('released_at', { ascending: false, nullsFirst: false })
    .order('period_end', { ascending: false })
    .limit(1);
  if (priorErr) throw Object.assign(new Error('populationRecon/prior: ' + priorErr.message), { status: 500 });
  const prior = (priorRows ?? [])[0] as { id: string } | undefined;

  // Proposed population = who would actually be paid (active + pay basis set).
  const proposedIds = new Set(withPayBasis.map(u => u.id));
  const priorIds = new Set<string>();
  let runId: string | null = null;
  if (prior) {
    runId = prior.id;
    const lineRows = await selectAllRows<{ employee_id: string }>(() =>
      sb.from('finance_payroll_run_lines').select('employee_id').eq('run_id', prior.id).order('employee_id'));
    for (const r of lineRows) priorIds.add(r.employee_id);
  }
  let added = 0, removed = 0;
  for (const id of proposedIds) if (!priorIds.has(id)) added++;
  for (const id of priorIds) if (!proposedIds.has(id)) removed++;

  return {
    rules,
    departments,
    priorRun: {
      runId,
      releasedPopulation: priorIds.size,
      added,
      removed,
      proposed: proposedIds.size,
    },
  };
}

// ── Input-source readiness (create-run wizard step 6, Slice 3) ──────────────────
// Pay-group-scoped, read-only pre-lock readiness across the six input sources
// lockInputs actually consumes: base compensation, overtime, timesheets, leave/
// absences, loans/advances, and one-time adjustments (pay items). Per source it
// reports the in-period record count, freshness (max updated_at), the owner, and
// a state derived from pending-approval (nothing here is snapshotted — final
// inputs still freeze at Lock Inputs). No mutation → cannot affect create.

export interface InputSourceReadiness {
  key:         string;
  label:       string;
  records:     number;
  freshnessAt: string | null;   // most recent updated_at across the source's rows
  ownerRole:   'hr' | 'finance' | 'payroll';
  state:       'ready' | 'pending' | 'review';
}
export interface InputReadinessResult {
  sources: InputSourceReadiness[];
}

/**
 * Pre-lock readiness of the six payroll input sources for a pay-group-scoped run.
 * Read-only estimate — inputs still freeze at Lock Inputs.
 */
export async function getInputSourceReadiness(
  payGroupId:  string,
  periodStart: string,
  periodEnd:   string,
): Promise<InputReadinessResult> {
  const group = await getPayGroup(payGroupId);
  if (!group) throw Object.assign(new Error('Pay group not found.'), { status: 404 });

  const memberIds = await listGroupMemberIds(payGroupId, periodStart, periodEnd);

  type MemberRow = {
    id: string; pay_basis: string | null;
    monthly_salary: number | null; hourly_rate: number | null;
    status: string; start_date: string | null; end_date: string | null;
  };
  const members: MemberRow[] = [];
  for (const ids of chunk(memberIds, 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('app_users')
      .select('id, pay_basis, monthly_salary, hourly_rate, status, start_date, end_date')
      .in('id', ids);
    if (error) throw Object.assign(new Error('inputReadiness/members: ' + error.message), { status: 500 });
    members.push(...(data ?? []) as MemberRow[]);
  }

  // Paid population = the same filter lockInputs applies (active, or terminated
  // inside/after the period so final pay is still processed).
  const paid = members.filter(m =>
    (m.start_date === null || m.start_date <= periodEnd)
    && (m.end_date === null || m.end_date >= periodStart)
    && (m.status === 'active' || m.end_date !== null));
  const scopeIds = paid.map(m => m.id);

  // Fetch a source's rows for the scoped population, paginated over the id IN().
  // The PostgREST builder is typed loosely here — its deep generics otherwise
  // exceed the type-checker's instantiation depth for a shared helper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type PgQuery = any;
  async function pageByEmployee<T>(
    table: string,
    cols: string,
    addFilters: (q: PgQuery) => PgQuery,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const ids of chunk(scopeIds, 300)) {
      if (ids.length === 0) continue;
      const q = addFilters(sb.from(table).select(cols).in('employee_id', ids));
      const { data, error } = await q;
      if (error) throw Object.assign(new Error(`inputReadiness/${table}: ${error.message}`), { status: 500 });
      out.push(...((data ?? []) as T[]));
    }
    return out;
  }
  const maxTs = (rows: Array<Record<string, unknown>>, keys: string[]): string | null => {
    let max: string | null = null;
    for (const r of rows) {
      for (const k of keys) {
        const v = r[k];
        if (typeof v === 'string' && (max === null || v > max)) max = v;
      }
    }
    return max;
  };

  const sources: InputSourceReadiness[] = [];

  // 1. Base compensation — pay basis + a resolvable base amount on each member.
  const baseMissing = paid.filter(m => {
    if (!m.pay_basis) return true;
    if (m.pay_basis === 'salary') return m.monthly_salary == null;
    if (m.pay_basis === 'hourly') return m.hourly_rate == null;
    return true;
  }).length;
  sources.push({
    key: 'base_compensation', label: 'Base compensation',
    records: paid.length - baseMissing, freshnessAt: null, ownerRole: 'hr',
    state: baseMissing > 0 ? 'review' : 'ready',
  });

  // 2. Overtime — approved OT feeds the run; submitted entries await approval.
  type OtRow = { status: string; updated_at: string };
  const ot = await pageByEmployee<OtRow>('hr_overtime_entries', 'status, updated_at',
    q => q.gte('work_date', periodStart).lte('work_date', periodEnd));
  const otRecords = ot.filter(r => ['submitted', 'approved', 'paid'].includes(r.status));
  const otPending = ot.filter(r => r.status === 'submitted').length;
  sources.push({
    key: 'overtime', label: 'Overtime', records: otRecords.length,
    freshnessAt: maxTs(ot, ['updated_at']), ownerRole: 'hr',
    state: otPending > 0 ? 'pending' : 'ready',
  });

  // 3. Timesheets — approved timesheets drive hourly base pay.
  type TsRow = { status: string; updated_at: string | null; created_at: string };
  const ts = await pageByEmployee<TsRow>('hr_timesheets', 'status, updated_at, created_at',
    q => q.gte('period_start', periodStart).lte('period_start', periodEnd));
  const tsPending = ts.filter(r => r.status !== 'approved' && r.status !== 'rejected').length;
  sources.push({
    key: 'timesheets', label: 'Timesheets', records: ts.length,
    freshnessAt: maxTs(ts, ['updated_at', 'created_at']), ownerRole: 'hr',
    state: tsPending > 0 ? 'pending' : 'ready',
  });

  // 4. Leave & absences — requests overlapping the period.
  type LvRow = { status: string; updated_at: string | null; created_at: string };
  const lv = await pageByEmployee<LvRow>('hr_leave_requests', 'status, updated_at, created_at',
    q => q.lte('from_date', periodEnd).gte('to_date', periodStart));
  const lvRecords = lv.filter(r => ['pending_approval', 'approved'].includes(r.status));
  const lvPending = lv.filter(r => r.status === 'pending_approval').length;
  sources.push({
    key: 'leave', label: 'Leave & absences', records: lvRecords.length,
    freshnessAt: maxTs(lv, ['updated_at', 'created_at']), ownerRole: 'hr',
    state: lvPending > 0 ? 'pending' : 'ready',
  });

  // 5. Loans & advances — active loans due this period; pending ones await approval.
  type LnRow = { status: string; updated_at: string; balance: number; start_period: string | null };
  const ln = await pageByEmployee<LnRow>('finance_employee_loans', 'status, updated_at, balance, start_period',
    q => q.in('status', ['active', 'pending_approval']));
  const lnActive = ln.filter(r =>
    r.status === 'active' && Number(r.balance) > 0 && (r.start_period == null || r.start_period <= periodEnd));
  const lnPending = ln.filter(r => r.status === 'pending_approval').length;
  sources.push({
    key: 'loans', label: 'Loans & advances', records: lnActive.length,
    freshnessAt: maxTs(ln, ['updated_at']), ownerRole: 'finance',
    state: lnPending > 0 ? 'pending' : 'ready',
  });

  // 6. One-time adjustments — pay items effective in the period.
  type PiRow = { status: string; updated_at: string };
  const pi = await pageByEmployee<PiRow>('hr_employee_pay_items', 'status, updated_at',
    q => q.lte('effective_from', periodEnd).or(`effective_to.is.null,effective_to.gte.${periodStart}`));
  const piRecords = pi.filter(r => ['active', 'pending_approval'].includes(r.status));
  const piPending = pi.filter(r => r.status === 'pending_approval').length;
  sources.push({
    key: 'adjustments', label: 'One-time adjustments', records: piRecords.length,
    freshnessAt: maxTs(pi, ['updated_at']), ownerRole: 'hr',
    state: piPending > 0 ? 'pending' : 'ready',
  });

  return { sources };
}

// ── Export content download ───────────────────────────────────────────────────

export interface ExportDownloadResult {
  exportId:  string;
  exportNo:  string;
  runId:     string;
  format:    string;
  checksum:  string;
  contentSizeBytes: number;
  content:   string;
  mimeType:  string;
  filename:  string;
  duplicate: boolean;
}

/**
 * Return the immutable export artifact and atomically record its download.
 */
export async function downloadRunExport(
  exportId: string,
  actorId:  string,
  idempotencyKey: string,
): Promise<ExportDownloadResult> {
  const { data, error } = await sb.rpc('finance_payroll_download_export_tx', {
    p_export_id: exportId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw payrollRpcHttpError(error);

  const result = (data ?? {}) as Partial<ExportDownloadResult>;
  if (
    !result.exportId ||
    !result.exportNo ||
    !result.runId ||
    !result.format ||
    !result.checksum ||
    typeof result.contentSizeBytes !== 'number' ||
    typeof result.content !== 'string' ||
    !result.mimeType ||
    !result.filename ||
    typeof result.duplicate !== 'boolean'
  ) {
    throw Object.assign(
      new Error('Payroll export download committed but returned an invalid result.'),
      { status: 500 },
    );
  }
  if (
    Buffer.byteLength(result.content, 'utf8') !== result.contentSizeBytes ||
    payrollExportChecksum(result.content) !== result.checksum
  ) {
    throw Object.assign(
      new Error('Export integrity verification failed. The stored artifact is corrupt.'),
      { status: 409 },
    );
  }
  return result as ExportDownloadResult;
}

// ── Submit Run ────────────────────────────────────────────────────────────────

/**
 * Submit a calculated run for approval via the central workflow engine.
 * Transitions: calculated|returned → pending_approval.
 *
 * ATOMIC (finding #3): the source status flip, the workflow_id link, the whole
 * workflow (instance + tasks + workflow audit/events), the business event, the
 * hr_audit_log row and the approval handoff are ALL committed in ONE transaction by
 * workflow_submit_for_record_tx. A null/failed workflow leaves the run UNCHANGED —
 * no strand, no crash-window, no compensating-rollback dance. The RPC also owns
 * idempotency (request-key receipt), so a retried submit returns the original result.
 * Only the notification fan-out stays here (best-effort, post-commit) — the engine's
 * established delivery model; it must NOT re-emit the events the RPC already wrote.
 */
export async function submitRun(runId: string, actorId: string, idempotencyKey: string): Promise<PayrollRunDto> {
  // REQUIRED, no fallback: a server-generated key can't protect a client retry (it
  // changes after the network boundary). The FE generates one stable key per submit
  // attempt and reuses it on retry so the RPC receipt returns the original result.
  const requestKey = idempotencyKey?.trim();
  if (!requestKey) throw Object.assign(new Error('An idempotency key is required to submit a run.'), { status: 400 });

  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  // Resolve the active binding (the RPC re-selects + re-validates it under lock; this
  // is the existing selection logic, passed in as an id).
  const binding = await selectWorkflowBinding(sb, {
    moduleKey:      'finance_payroll',
    workflowType:   'finance_payroll_approval',
    triggerEvent:   'finance.payroll.run.submitted',
    sourceRecordId: runId,
    requestedBy:    actorId,
    recordData:     {},
  });
  if (!binding) throw Object.assign(new Error('No approval workflow is configured for payroll runs.'), { status: 422 });

  const { data, error } = await sb.rpc('workflow_submit_for_record_tx', {
    p_source_table: 'finance_payroll_runs',
    p_source_id:    runId,
    p_actor_id:     actorId,
    p_binding_id:   binding.id,
    p_request_key:  requestKey,
    p_business:     { runNo: run.runNo, periodMonth: run.periodMonth, sourceType: 'payroll_run', submittedBy: actorId },
  });
  if (error) {
    const rpcError = error as { code?: string | null; message: string };
    throw rpcError.code?.startsWith('PR')
      ? payrollRpcHttpError(rpcError)
      : rpcHttpError(rpcError);
  }

  const result = (data ?? {}) as { workflowId?: string | null; workflowNo?: string | null };

  // Notify Finance Managers (the step's assignees) that a run awaits approval. The
  // workflow id is in the dedupe key so a RESUBMIT (new workflow) notifies afresh
  // instead of being suppressed by the prior submission's notification.
  void notifyUsersByRole('finance_manager', {
    type:           'finance.payroll.run.pending_approval',
    title:          `Payroll run ${run.runNo} submitted for approval`,
    body:           `Period ${run.periodMonth.slice(0, 7)} payroll run is awaiting your approval.`,
    module:         'finance_payroll',
    severity:       'warning',
    sourceType:     'payroll_run',
    sourceId:       runId,
    actionRequired: true,
    dedupeKey:      `payroll_run.pending_approval.${runId}.${result.workflowId ?? ''}`,
  });

  // Refetch to return the canonical PayrollRunDto the FE consumes. Do NOT fabricate a
  // response: if the reload fails after a committed submit, surface it — a same-key
  // retry returns the original result from the RPC's idempotency receipt.
  const updatedRun = await getPayrollRun(runId);
  if (!updatedRun) throw Object.assign(new Error('Run submitted but could not be reloaded — retry to fetch the result.'), { status: 503 });
  return updatedRun;
}

// ── Decide Run Approval (the ONLY approve/reject path — delegates to the engine) ──

/**
 * Approve or reject a pending_approval run by DECIDING its open workflow task.
 * The central workflow engine is the single approval authority: the decision
 * closes the task and the finance_payroll adapter transitions the run
 * (approved → 'approved' + ready-to-lock side-effects; rejected → 'returned').
 * The old direct approve/reject functions flipped the run status while leaving
 * the workflow task dangling open — that dual path is DELETED.
 */
export async function decideRunApproval(opts: {
  runId: string;
  actor: { id: string; role?: string | null };
  decision: 'approved' | 'rejected';
  comment?: string;
}): Promise<PayrollRunDto> {
  const run = await getPayrollRun(opts.runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status !== 'pending_approval') {
    throw Object.assign(
      new Error(`Cannot ${opts.decision === 'approved' ? 'approve' : 'reject'}: run is in status '${run.status}'. Only 'pending_approval' runs can be decided.`),
      { status: 422 },
    );
  }
  if (opts.decision === 'rejected' && !opts.comment?.trim()) {
    throw Object.assign(new Error('A reason is required to reject a payroll run.'), { status: 422 });
  }
  // SoD fast-fail (the adapter re-enforces this at completion time).
  if (opts.decision === 'approved') {
    assertDifferentApprover({ actorId: opts.actor.id, createdBy: run.createdBy, action: 'approve a payroll run' });
  }
  if (!run.workflowId) {
    throw Object.assign(
      new Error('This run has no approval workflow attached. Reopen and resubmit it to start a new approval.'),
      { status: 422 },
    );
  }

  const { data: tasks, error: tErr } = await sb.from('workflow_tasks')
    .select('id, assigned_to, assigned_role, status, created_at')
    .eq('workflow_id', run.workflowId)
    .in('status', ['pending', 'open', 'in_progress'])
    .order('created_at', { ascending: true });
  if (tErr) throw Object.assign(new Error('decideRunApproval/tasks: ' + tErr.message), { status: 500 });
  const open = (tasks ?? []) as Array<{ id: string; assigned_to: string | null; assigned_role: string | null }>;
  if (open.length === 0) {
    throw Object.assign(
      new Error('No open approval task found for this run — the workflow state is inconsistent. Resolve it from the workflow console.'),
      { status: 409 },
    );
  }
  // Engine assignment rule (mirrors /workflow-engine/decide): the actor must be
  // the task's assignee (by user or by role).
  const mine = open.find(t => t.assigned_to === opts.actor.id || (!!t.assigned_role && t.assigned_role === (opts.actor.role ?? '')));
  if (!mine) {
    throw Object.assign(
      new Error('The open approval task is not assigned to you — decide it from your workflow inbox, or have it reassigned.'),
      { status: 403 },
    );
  }

  await decideTask({
    workflowId: run.workflowId,
    taskId:     mine.id,
    actor:      { id: opts.actor.id, role: opts.actor.role ?? undefined },
    decision:   opts.decision,
    comment:    opts.comment?.trim() || undefined,
  });

  // The adapter has transitioned the run (or the next approval step opened) — return the fresh row.
  return (await getPayrollRun(opts.runId))!;
}

/**
 * Side-effects fired when a run becomes approved — the "ready to lock" notifications
 * (submitter + Finance Managers) and the payroll_locking handoff. Called by the
 * workflow adapter's onWorkflowCompleted (the single approval authority).
 */
export async function emitRunApprovedSideEffects(run: PayrollRunDto, actorId: string): Promise<void> {
  // §8.1 — notify the submitter (run.createdBy) that the run was approved
  if (run.createdBy && run.createdBy !== actorId) {
    void notify({
      userId:     run.createdBy,
      type:       'finance.payroll.run.approved',
      title:      `Payroll run ${run.runNo} approved`,
      body:       `Period ${run.periodMonth.slice(0, 7)} payroll run has been approved. It is ready to lock.`,
      module:     'finance_payroll',
      severity:   'success',
      sourceType: 'payroll_run',
      sourceId:   run.id,
      dedupeKey:  `payroll_run.approved.${run.id}`,
    });
  }

  // §8.1 — notify Finance Managers that the run is approved and ready to lock
  void notifyUsersByRole('finance_manager', {
    type:       'finance.payroll.run.approved',
    title:      `Payroll run ${run.runNo} approved — ready to lock`,
    body:       `Period ${run.periodMonth.slice(0, 7)} payroll run is approved. Lock the run to generate payslips.`,
    module:     'finance_payroll',
    severity:   'success',
    sourceType: 'payroll_run',
    sourceId:   run.id,
    dedupeKey:  `payroll_run.approved.mgr.${run.id}`,
  });

  // §8.1 — handoff to payroll locking
  await createHandoff({
    sourceModule:     'finance_payroll',
    targetModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   run.id,
    targetEntityType: 'payroll_locking',
    payload: { runNo: run.runNo, periodMonth: run.periodMonth, approvedBy: actorId },
    createdBy: actorId,
  });
}

// ── Lock Run ──────────────────────────────────────────────────────────────────

/**
 * Lock an approved run: lines become immutable, payslips may be generated.
 * Transitions: approved → locked.
 * Requires finance.payroll.lock permission (gated in route).
 */
export async function lockRun(
  runId: string,
  actorId: string,
  idempotencyKey: string,
): Promise<PayrollRunDto> {
  const { data, error } = await sb.rpc('finance_payroll_lock_run_tx', {
    p_run_id: runId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw payrollRpcHttpError(error);

  const result = data as {
    run: DbRunRow;
    eventId: string;
    loanDeductionCount: number;
    duplicate: boolean;
  };
  const updatedRun = toRunDto(result.run);

  // Notification delivery remains post-commit across the event engine. The
  // calculation version scopes dedupe so a legitimate reopen/recalculate/relock
  // cycle sends a fresh notification without duplicating a command retry.
  if (!result.duplicate) {
    void notifyUsersByRole('finance_manager', {
      type:           'finance.payroll.run.locked',
      title:          `Payroll run ${updatedRun.runNo} locked`,
      body:           `Period ${updatedRun.periodMonth.slice(0, 7)} payroll run is now locked. Generate payslips from the run drawer.`,
      module:         'finance_payroll',
      severity:       'success',
      sourceType:     'payroll_run',
      sourceId:       runId,
      actionRequired: true,
      dedupeKey:      `payroll_run.locked.${runId}.${updatedRun.currentCalculationVersionId ?? 'none'}`,
    });
  }

  return updatedRun;
}

// ── Reopen Run ────────────────────────────────────────────────────────────────

/**
 * Reopen a locked run back to draft (with a mandatory reason).
 * Guard: run must be 'locked' — NOT if already 'exported'.
 * Clears lines + inputs so the run must be recalculated from scratch.
 */
export async function reopenRun(
  runId: string,
  actorId: string,
  reason: string,
  idempotencyKey: string,
): Promise<PayrollRunDto> {
  const { data, error } = await sb.rpc('finance_payroll_reopen_run_tx', {
    p_run_id: runId,
    p_actor_id: actorId,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw payrollRpcHttpError(error);

  const result = data as {
    run: DbRunRow;
    eventId: string;
    reversedLoanCount: number;
    duplicate: boolean;
  };
  return toRunDto(result.run);
}

// ── Reject Run — DELETED ──────────────────────────────────────────────────────
// Rejection flows through decideRunApproval → the workflow engine → the
// finance_payroll adapter's onWorkflowRejected (run status → 'returned').
// The engine notifies the submitter and records the decision + audit trail.

// ── Notify payslip employees ──────────────────────────────────────────────────

/**
 * Send in-app payslip-ready notifications to all employees with payslips
 * in this locked run.
 * Idempotent — the notify() call uses per-payslip dedupe keys.
 */
export async function notifyPayslipEmployees(
  runId:   string,
  actorId: string,
): Promise<{ notified: number }> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status !== 'locked') {
    throw Object.assign(
      new Error('Employees can only be notified for locked runs.'),
      { status: 422 },
    );
  }

  const { data: payslips, error: psErr } = await sb
    .from('finance_payslips')
    .select('id, employee_id, payslip_no')
    .eq('run_id', runId);
  if (psErr) throw Object.assign(new Error('notifyPayslipEmployees: ' + psErr.message), { status: 500 });

  const rows = (payslips ?? []) as Array<{ id: string; employee_id: string | null; payslip_no: string }>;
  let notified = 0;

  for (const ps of rows) {
    if (!ps.employee_id) continue;
    void notify({
      userId:     ps.employee_id,
      type:       'finance.payroll.payslip.available',
      title:      `Your payslip for ${run.periodMonth.slice(0, 7)} is ready`,
      body:       `Payslip ${ps.payslip_no} is now available.`,
      module:     'finance_payroll',
      severity:   'info',
      sourceType: 'payslip',
      sourceId:   ps.id,
      dedupeKey:  `payslip.available.${ps.id}`,
    });
    notified++;
  }

  void writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.payslips_notified',
    newState: { notified, periodMonth: run.periodMonth },
  });

  return { notified };
}
