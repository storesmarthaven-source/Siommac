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
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { getActiveStatutoryVersion, listNisClasses, assertDifferentApprover } from './statutoryConfig';
import { computeRunLine, payPeriodsForFrequency, weeksInPeriodForFrequency } from './payrollStatutory';
import { getPayGroup, listGroupMemberIds } from './payGroups';
import { loadActiveOvertimeRules, resolveOvertimeMultiplier, type OvertimeRule } from './overtimeRules';
import { loadLoanInstallments, recordLoanDeductionsForRun, reverseLoanDeductionsForRun } from './loans';
import { getStatutoryProfilesByEmployees } from '../hr/statutoryProfileCore';
import { selectAllRows, chunkedInsert, chunk } from '../dbBulk';
import { resolveSettingValue } from '../settings/resolveSetting';

/** Supported scale ceiling for a single run's calc/lock (500–1k target, ~2k headroom).
 *  Beyond this, the pipeline is rejected rather than silently truncating. */
export const MAX_RUN_EMPLOYEES = 2000;
import { startWorkflowForRecord, decideTask } from '../workflow/service';
import { notifyUsersByRole } from './financeEvents';
import { notify } from '../notify';
import { createHandoff } from '../handoffBus';
import type { NisClassRow } from './statutoryConfig';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface PayrollRunDto {
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
  id: string; run_no: string; period_month: string; pay_frequency: string;
  status: string; statutory_version_id: string; weeks_in_period: number;
  pay_group: string | null; pay_group_id: string | null; pay_date: string | null; cut_off_date: string | null;
  employee_count: number; gross_total: number; deduction_total: number;
  net_total: number; nis_employer_total: number;
  workflow_id: string | null;
  input_locked_by: string | null; input_locked_at: string | null;
  created_by: string | null; approved_by: string | null;
  locked_by: string | null; locked_at: string | null;
  reopened_by: string | null; reopened_at: string | null;
  reopen_reason: string | null; exported_at: string | null;
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
    id: r.id, runNo: r.run_no, periodMonth: r.period_month,
    payFrequency: r.pay_frequency, status: r.status,
    statutoryVersionId: r.statutory_version_id,
    weeksInPeriod: Number(r.weeks_in_period),
    payGroup: r.pay_group, payGroupId: r.pay_group_id, payDate: r.pay_date, cutOffDate: r.cut_off_date,
    employeeCount: r.employee_count,
    grossTotal: Number(r.gross_total), deductionTotal: Number(r.deduction_total),
    netTotal: Number(r.net_total), nisEmployerTotal: Number(r.nis_employer_total),
    workflowId: r.workflow_id,
    inputLockedBy: r.input_locked_by, inputLockedAt: r.input_locked_at,
    createdBy: r.created_by, approvedBy: r.approved_by,
    lockedBy: r.locked_by, lockedAt: r.locked_at,
    reopenedBy: r.reopened_by, reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason, exportedAt: r.exported_at,
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

export async function getPayrollRun(id: string): Promise<PayrollRunDto | null> {
  const { data, error } = await sb.from('finance_payroll_runs')
    .select('*').eq('id', id).maybeSingle<DbRunRow>();
  if (error) throw Object.assign(new Error('getPayrollRun: ' + error.message), { status: 500 });
  return data ? toRunDto(data) : null;
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
  /** First day of the pay month (YYYY-MM-DD, e.g. '2026-07-01'). */
  periodMonth: string;
  payFrequency?: string;
  weeksInPeriod?: number;
  payGroup?: string;
  /** When set, the run is scoped to this pay group: frequency comes from the group and
   *  only the group's members are populated. */
  payGroupId?: string;
  payDate?: string;
  cutOffDate?: string;
  actorId: string;
}

/**
 * Create a new payroll run in 'draft' status.
 * Resolves the active statutory version for TT; rejects if none is active.
 * Unique constraint on period_month prevents duplicate runs for the same month.
 */
export async function createPayrollRun(input: CreateRunInput): Promise<PayrollRunDto> {
  // Resolve active statutory version
  const version = await getActiveStatutoryVersion('TT');
  if (!version) {
    throw Object.assign(
      new Error('No active TT statutory version found. Activate a statutory version before creating a payroll run.'),
      { status: 422 },
    );
  }

  const runNo = await nextRef('PAY');
  // A pay group (if given) is authoritative for frequency; otherwise use the caller's.
  // Frequency drives NIS/HS weeks-in-period AND PAYE annualisation (payPeriods).
  let payGroup: { id: string; code: string; frequency: string } | null = null;
  if (input.payGroupId) {
    const g = await getPayGroup(input.payGroupId);
    if (!g) throw Object.assign(new Error('Pay group not found.'), { status: 404 });
    payGroup = { id: g.id, code: g.code, frequency: g.frequency };
  }
  const payFrequency = payGroup?.frequency ?? input.payFrequency ?? 'monthly';

  const { data, error } = await sb.from('finance_payroll_runs').insert({
    run_no:               runNo,
    period_month:         input.periodMonth,
    pay_frequency:        payFrequency,
    status:               'draft',
    statutory_version_id: version.id,
    weeks_in_period:      input.weeksInPeriod ?? weeksInPeriodForFrequency(payFrequency),
    pay_group:            input.payGroup ?? payGroup?.code ?? null,
    pay_group_id:         payGroup?.id ?? null,
    pay_date:             input.payDate ?? null,
    cut_off_date:         input.cutOffDate ?? null,
    created_by:           input.actorId,
  }).select().single<DbRunRow>();

  if (error) {
    if (error.code === '23505') {
      throw Object.assign(
        new Error(`A payroll run for period ${input.periodMonth} already exists.`),
        { status: 409 },
      );
    }
    throw Object.assign(new Error('createPayrollRun: ' + error.message), { status: 500 });
  }

  const run = toRunDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: run.id, actorId: input.actorId,
    action: 'payroll_run.created',
    previousState: null,
    newState: { status: 'draft', periodMonth: run.periodMonth, runNo: run.runNo, statutoryVersionId: run.statutoryVersionId },
  });

  void emitAppEvent({
    eventType: 'finance.payroll.run.created',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: run.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { runNo: run.runNo, periodMonth: run.periodMonth },
  });

  return run;
}

// ── Lock Inputs ───────────────────────────────────────────────────────────────

/**
 * Lock inputs for a payroll run:
 * 1. Verify run is in 'draft' status.
 * 2. Collect all active employees with pay data.
 * 3. Snapshot base pay + active-approved pay items + approved OT into run_inputs.
 * 4. Set status='input_locked'.
 *
 * Idempotency: clears any prior inputs before re-snapshotting (only allowed from 'draft').
 */
export async function lockInputs(runId: string, actorId: string): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status !== 'draft') {
    throw Object.assign(
      new Error(`Cannot lock inputs: run is in status '${run.status}'. Only 'draft' runs can have inputs locked.`),
      { status: 422 },
    );
  }

  // Period boundary: first/last day of the period_month
  const periodStart = run.periodMonth; // already YYYY-MM-01
  const periodEnd = lastDayOfMonth(run.periodMonth);

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

  const EMP_COLS = 'id, pay_basis, monthly_salary, hourly_rate, department_id';
  type EmpRow = { id: string; pay_basis: string | null; monthly_salary: number | null; hourly_rate: number | null; department_id: string | null };
  let empList: EmpRow[];
  if (memberIds) {
    // Grouped run: fetch by member id in chunks (a large IN() list overflows the URL).
    empList = [];
    for (const ids of chunk(memberIds, 300)) {
      const { data, error } = await sb.from('app_users').select(EMP_COLS).eq('status', 'active').not('pay_basis', 'is', null).in('id', ids);
      if (error) throw Object.assign(new Error('lockInputs/employees: ' + error.message), { status: 500 });
      empList.push(...((data ?? []) as EmpRow[]));
    }
  } else {
    // Ungrouped run: all active employees — paginate past the 1000-row cap.
    empList = await selectAllRows<EmpRow>(() =>
      sb.from('app_users').select(EMP_COLS).eq('status', 'active').not('pay_basis', 'is', null).order('id'));
  }

  if (empList.length === 0) {
    throw Object.assign(new Error('No active employees with pay_basis found.'), { status: 422 });
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

  // ── 3c. Active loan/advance installments due this period (Wave 5) ──────────
  // A deduction pay item is emitted per active loan; the balance is decremented from
  // the ledger only when the run is LOCKED (recordLoanDeductionsForRun), so re-lock
  // and recalculate never double-deduct.
  const loanInstallments = await loadLoanInstallments(empList.map(e => e.id), periodStart);

  // ── 4. Build input rows ───────────────────────────────────────────────────
  const now = new Date().toISOString();
  const inputRows: Record<string, unknown>[] = [];

  // Delete any prior inputs (allows re-lock from draft — shouldn't happen but safe)
  await sb.from('finance_payroll_run_inputs').delete().eq('run_id', runId);

  for (const emp of empList) {
    // Base pay
    //  • salaried: monthly salary prorated to the run's pay frequency (annual ÷ pay periods).
    //  • hourly:   approved-timesheet worked hours × hourly rate (0 until a timesheet is approved).
    const isSalary      = emp.pay_basis === 'salary';
    const ts            = tsByEmp.get(emp.id);
    const workedHours   = ts ? round2(ts.minutes / 60) : 0;
    const hasApprovedTs = !!ts;
    const hourlyRate    = emp.hourly_rate ?? 0;
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
    // chargeable income). The ledger is written at lock time (recordLoanDeductionsForRun).
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
  if (inputRows.length > 0) await chunkedInsert('finance_payroll_run_inputs', inputRows);

  // ── 5. Update run status ──────────────────────────────────────────────────
  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({
      status:          'input_locked',
      employee_count:  empList.length,
      input_locked_by: actorId,
      input_locked_at: now,
    })
    .eq('id', runId)
    .select()
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('lockInputs/update: ' + updErr.message), { status: 500 });

  const updatedRun = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.inputs_locked',
    previousState: { status: 'draft' },
    newState: { status: 'input_locked', employeeCount: empList.length, inputCount: inputRows.length },
  });

  void emitAppEvent({
    eventType: 'finance.payroll.run.inputs_locked',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: 'info',
    payload: { runNo: updatedRun.runNo, employeeCount: empList.length },
  });

  return updatedRun;
}

// ── Calculate ─────────────────────────────────────────────────────────────────

/**
 * Calculate payroll lines for an 'input_locked' run.
 * For each employee:
 *   1. Run NIS checks → insert warnings per policy
 *   2. computeRunLine() → write finance_payroll_run_lines (incl. NIS snapshot)
 * 3. Roll up run totals → set status='calculated'
 */
export async function calculateRun(runId: string, actorId: string): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  // Allow recalculation of an already-'calculated' run too, so worksheet overrides can be
  // applied and recomputed before submission. 'returned' (rejected/returned by the approval
  // workflow) is likewise revisable — the preparer corrects and re-calculates.
  if (!['input_locked', 'calculated', 'returned'].includes(run.status)) {
    throw Object.assign(
      new Error(`Cannot calculate: run is in status '${run.status}'. Only 'input_locked', 'calculated' or 'returned' runs can be calculated.`),
      { status: 422 },
    );
  }

  // Load statutory version (must exist — was checked at create time)
  const version = await getActiveStatutoryVersion('TT');
  if (!version) {
    throw Object.assign(new Error('Active statutory version not found.'), { status: 422 });
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

  // Batch-load every statutory profile once (was an N+1: one query per employee).
  const profileMap = await getStatutoryProfilesByEmployees(empIds, 'TT');

  // Clear any prior lines and warnings (allows re-calculate after a fix)
  await sb.from('finance_payroll_run_lines').delete().eq('run_id', runId);
  await sb.from('finance_payroll_run_warnings').delete().eq('run_id', runId);

  const lineRows: Record<string, unknown>[] = [];
  const warningRows: Record<string, unknown>[] = [];

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalNisEmployer = 0;

  for (const empId of empIds) {
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
    const baseMeta = (baseInput?.metadata ?? {}) as { pay_basis?: string; has_approved_timesheet?: boolean };
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
      weeksInPeriod: run.weeksInPeriod,
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
      warningRows.push({
        run_id:       runId,
        employee_id:  empId,
        warning_type: 'nis_class_not_found',
        severity:     'warning',
        message:      `No NIS class found for employee ${empId} (weekly insurable = ${(result.taxableGross / run.weeksInPeriod).toFixed(2)}).`,
        metadata:     { weeklyInsurable: result.taxableGross / run.weeksInPeriod },
      });
    }

    // ── NIS snapshot from profile ────────────────────────────────────────────
    const nisNumberMasked = profile?.nisNumber
      ? maskNisNumber(profile.nisNumber)
      : null;

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
        weeksInPeriod:  run.weeksInPeriod,
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

  // ── Insert warnings + lines (chunked — a large run exceeds one payload) ───
  if (warningRows.length > 0) await chunkedInsert('finance_payroll_run_warnings', warningRows);
  if (lineRows.length > 0)    await chunkedInsert('finance_payroll_run_lines', lineRows);

  // ── Roll up totals and set status ────────────────────────────────────────
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({
      status:            'calculated',
      gross_total:       round2(totalGross),
      deduction_total:   round2(totalDeductions),
      net_total:         round2(totalNet),
      nis_employer_total: round2(totalNisEmployer),
      employee_count:    empIds.length,
    })
    .eq('id', runId)
    .select()
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('calculateRun/update: ' + updErr.message), { status: 500 });

  const updatedRun = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.calculated',
    previousState: { status: 'input_locked' },
    newState: {
      status: 'calculated',
      employeeCount: empIds.length,
      grossTotal: round2(totalGross),
      netTotal: round2(totalNet),
      warningCount: warningRows.length,
    },
  });

  void emitAppEvent({
    eventType: 'finance.payroll.run.calculated',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: warningRows.length > 0 ? 'warning' : 'success',
    payload: {
      runNo: updatedRun.runNo,
      employeeCount: empIds.length,
      grossTotal: round2(totalGross),
      netTotal: round2(totalNet),
      warningCount: warningRows.length,
    },
  });

  return updatedRun;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mask NIS number for display — show last 4 characters only, e.g. ***-1234. */
function maskNisNumber(nisNumber: string): string {
  if (nisNumber.length <= 4) return '***' + nisNumber;
  return '***-' + nisNumber.slice(-4);
}

/** Return the last day of the month containing the given YYYY-MM-DD date. */
function lastDayOfMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return lastDay.toISOString().slice(0, 10);
}

// ── Resolve Warning ───────────────────────────────────────────────────────────

export interface ResolveWarningResult {
  id: string;
  resolved: boolean;
  resolvedBy: string;
  resolvedAt: string;
}

/**
 * Resolve a payroll run warning.
 * Guards: warning must not already be resolved.
 * Side effects: emitFinanceMutationBackbone → app_event + hr_audit_log + notification to run owner.
 */
export async function resolveRunWarning(
  warningId: string,
  actorId:   string,
  note?:     string,
): Promise<ResolveWarningResult> {
  const { data: warn, error: wErr } = await sb
    .from('finance_payroll_run_warnings')
    .select('id, run_id, employee_id, warning_type, severity, message, resolved')
    .eq('id', warningId)
    .maybeSingle<{
      id: string; run_id: string; employee_id: string | null;
      warning_type: string; severity: string; message: string; resolved: boolean;
    }>();
  if (wErr) throw Object.assign(new Error('resolveRunWarning/get: ' + wErr.message), { status: 500 });
  if (!warn) throw Object.assign(new Error('Warning not found.'), { status: 404 });
  if (warn.resolved) throw Object.assign(new Error('Warning is already resolved.'), { status: 409 });

  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {};
  if (note?.trim()) meta['resolution_note'] = note.trim();

  const { error: updErr } = await sb
    .from('finance_payroll_run_warnings')
    .update({ resolved: true, resolved_by: actorId, resolved_at: now, metadata: meta })
    .eq('id', warningId);
  if (updErr) throw Object.assign(new Error('resolveRunWarning/update: ' + updErr.message), { status: 500 });

  // Backbone — throws on hr_audit_log failure (compensating: re-unresolve warning)
  try {
    const { emitFinanceMutationBackbone } = await import('./backbone.js');
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module:      'finance_payroll',
      entityType:  'payroll_run_warning',
      entityId:    warningId,
      eventType:   'finance.payroll.warning.resolved',
      auditAction: 'payroll_run_warning.resolved',
      previousState: { resolved: false, severity: warn.severity, warningType: warn.warning_type },
      newState:    { resolved: true, resolvedBy: actorId, note: note?.trim() ?? null },
      severity:    'info',
      metadata:    { runId: warn.run_id, warningType: warn.warning_type, note: note?.trim() ?? null },
      notification: {
        title: `Warning resolved: ${warn.warning_type.replace(/_/g, ' ')}`,
        body:  warn.message,
        actionRoute: 's-finance-payroll',
      },
    });
  } catch (bbErr) {
    // Compensating rollback: undo the resolved flag
    await sb.from('finance_payroll_run_warnings')
      .update({ resolved: false, resolved_by: null, resolved_at: null, metadata: {} })
      .eq('id', warningId);
    throw bbErr;
  }

  return { id: warningId, resolved: true, resolvedBy: actorId, resolvedAt: now };
}

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

// ── Export content download ───────────────────────────────────────────────────

export interface ExportDownloadResult {
  exportId:  string;
  exportNo:  string;
  runId:     string;
  format:    string;
  content:   string;
  mimeType:  string;
  filename:  string;
}

/**
 * Regenerate and return the export content for download.
 * The export file_path is a logical path (not a storage bucket URL), so we
 * rebuild the CSV/JSON content from the current run lines.
 * Side-effects: emits finance.payroll.export.downloaded + hr_audit_log.
 */
export async function downloadRunExport(
  exportId: string,
  actorId:  string,
): Promise<ExportDownloadResult> {
  interface DbExRow {
    id: string; export_no: string; run_id: string;
    format: string; file_path: string; generated_by: string | null;
    generated_at: string; metadata: Record<string, unknown>;
  }

  const { data: exp, error: eErr } = await sb
    .from('finance_payroll_exports')
    .select('id, export_no, run_id, format, file_path, generated_by, generated_at, metadata')
    .eq('id', exportId)
    .maybeSingle<DbExRow>();
  if (eErr) throw Object.assign(new Error('downloadExport/get: ' + eErr.message), { status: 500 });
  if (!exp) throw Object.assign(new Error('Export not found.'), { status: 404 });

  // Rebuild content from current run lines
  const lines = await listRunLines(exp.run_id);

  let content: string;
  let mimeType: string;

  if (exp.format === 'json') {
    content  = JSON.stringify({
      runId: exp.run_id, exportNo: exp.export_no,
      exportedAt: exp.generated_at,
      lines: lines.map(l => ({
        employeeId: l.employeeId, gross: l.gross, nisEmployee: l.nisEmployee,
        nisEmployer: l.nisEmployer, healthSurcharge: l.healthSurcharge,
        paye: l.paye, voluntaryDeductions: l.voluntaryDeductions, net: l.net,
        nisNumberMasked: l.nisNumberMasked, nisStatus: l.nisStatus, nisClassNo: l.nisClassNo,
      })),
    }, null, 2);
    mimeType = 'application/json';
  } else {
    const headers = [
      'employee_id','base','taxable_gross','gross','nis_employee','nis_employer',
      'health_surcharge','chargeable_income','paye','voluntary_deductions','net',
      'nis_number_masked','nis_status','nis_class_no',
    ].join(',');
    const rows = lines.map(l =>
      [l.employeeId,l.base,l.taxableGross,l.gross,l.nisEmployee,l.nisEmployer,
       l.healthSurcharge,l.chargeableIncome,l.paye,l.voluntaryDeductions,l.net,
       l.nisNumberMasked??'',l.nisStatus??'',l.nisClassNo??''].join(','),
    );
    content  = [headers, ...rows].join('\n');
    mimeType = 'text/csv';
  }

  const filename = exp.file_path.split('/').pop() ?? `${exp.export_no}.${exp.format}`;

  // Audit download
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: exp.run_id, actorId,
    action:       'payroll_export.downloaded',
    previousState: null,
    newState:     { exportId, exportNo: exp.export_no, format: exp.format },
  });

  void emitAppEvent({
    eventType:        'finance.payroll.export.downloaded',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_export',
    sourceEntityId:   exportId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { exportNo: exp.export_no, format: exp.format, runId: exp.run_id },
  });

  return { exportId, exportNo: exp.export_no, runId: exp.run_id, format: exp.format, content, mimeType, filename };
}

// ── Submit Run ────────────────────────────────────────────────────────────────

/**
 * Submit a calculated run for approval via the central workflow engine.
 * Transitions: calculated → pending_approval.
 * On success: sets workflow_id on the run and starts the approval workflow.
 * Compensating rollback: if startWorkflowForRecord fails, status is reverted to 'calculated'.
 */
export async function submitRun(runId: string, actorId: string): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  // 'returned' = rejected/returned by the approval workflow; the preparer may
  // resubmit (a fresh workflow instance is started and stamped below).
  if (!['calculated', 'returned'].includes(run.status)) {
    throw Object.assign(
      new Error(`Cannot submit: run is in status '${run.status}'. Only 'calculated' or 'returned' runs can be submitted.`),
      { status: 422 },
    );
  }

  // Set to pending_approval first (workflow will manage the status from here)
  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({ status: 'pending_approval' })
    .eq('id', runId)
    .select()
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('submitRun/update: ' + updErr.message), { status: 500 });

  let workflowInstance: { id: string } | null = null;
  try {
    workflowInstance = await startWorkflowForRecord({
      context: {
        moduleKey:      'finance_payroll',
        workflowType:   'finance_payroll_approval',
        triggerEvent:   'finance.payroll.run.submitted',
        sourceRecordId: runId,
        requestedBy:    actorId,
        recordData:     {
          runNo:       run.runNo,
          periodMonth: run.periodMonth,
          sourceType:  'payroll_run',
          submittedBy: actorId,
        },
      },
      actor: { id: actorId },
    });
  } catch (wfErr) {
    // Compensating rollback: revert to the pre-submit status ('calculated' or 'returned')
    await sb.from('finance_payroll_runs')
      .update({ status: run.status })
      .eq('id', runId);
    throw Object.assign(
      new Error('submitRun/workflow: ' + (wfErr as Error).message),
      { status: 500 },
    );
  }

  // Stamp workflow_id if one was created
  if (workflowInstance) {
    await sb.from('finance_payroll_runs')
      .update({ workflow_id: workflowInstance.id })
      .eq('id', runId);
  }

  const updatedRun = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.submitted',
    previousState: { status: 'calculated' },
    newState: { status: 'pending_approval', workflowId: workflowInstance?.id ?? null },
  });

  void emitAppEvent({
    eventType:        'finance.payroll.run.submitted',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { runNo: updatedRun.runNo, workflowId: workflowInstance?.id ?? null },
  });

  // §8.1 — notify Finance Managers that a run is awaiting approval
  void notifyUsersByRole('finance_manager', {
    type:           'finance.payroll.run.pending_approval',
    title:          `Payroll run ${updatedRun.runNo} submitted for approval`,
    body:           `Period ${updatedRun.periodMonth.slice(0, 7)} payroll run is awaiting your approval.`,
    module:         'finance_payroll',
    severity:       'warning',
    sourceType:     'payroll_run',
    sourceId:       runId,
    actionRequired: true,
    dedupeKey:      `payroll_run.pending_approval.${runId}`,
  });

  // §8.1 — handoff to approval workflow
  void createHandoff({
    sourceModule:     'finance_payroll',
    targetModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    targetEntityType: 'payroll_approval',
    payload: {
      runNo:       updatedRun.runNo,
      periodMonth: updatedRun.periodMonth,
      workflowId:  workflowInstance?.id ?? null,
      submittedBy: actorId,
    },
    createdBy: actorId,
  });

  return { ...updatedRun, status: 'pending_approval', workflowId: workflowInstance?.id ?? null };
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
export async function lockRun(runId: string, actorId: string): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status !== 'approved') {
    throw Object.assign(
      new Error(`Cannot lock: run is in status '${run.status}'. Only 'approved' runs can be locked.`),
      { status: 422 },
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({ status: 'locked', locked_by: actorId, locked_at: now })
    .eq('id', runId)
    .select()
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('lockRun/update: ' + updErr.message), { status: 500 });

  const updatedRun = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.locked',
    previousState: { status: 'approved' },
    newState: { status: 'locked', lockedAt: now },
  });

  void emitAppEvent({
    eventType:        'finance.payroll.run.locked',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    actorUserId:      actorId,
    severity:         'success',
    payload:          { runNo: updatedRun.runNo, lockedAt: now },
  });

  // Wave 5 — the run is now final: record loan installment deductions into the ledger
  // and decrement loan balances (idempotent per loan+run; reversed if the run is reopened).
  await recordLoanDeductionsForRun(runId, actorId);

  // §8.1 — notify Finance Managers that the run is locked and payslips can be generated
  void notifyUsersByRole('finance_manager', {
    type:           'finance.payroll.run.locked',
    title:          `Payroll run ${updatedRun.runNo} locked`,
    body:           `Period ${updatedRun.periodMonth.slice(0, 7)} payroll run is now locked. Generate payslips from the run drawer.`,
    module:         'finance_payroll',
    severity:       'success',
    sourceType:     'payroll_run',
    sourceId:       runId,
    actionRequired: true,
    dedupeKey:      `payroll_run.locked.${runId}`,
  });

  // §8.1 — handoff to payslip generation
  void createHandoff({
    sourceModule:     'finance_payroll',
    targetModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    targetEntityType: 'payslip_generation',
    payload: {
      runNo:          updatedRun.runNo,
      periodMonth:    updatedRun.periodMonth,
      employeeCount:  updatedRun.employeeCount,
      lockedAt:       now,
    },
    createdBy: actorId,
  });

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
): Promise<PayrollRunDto> {
  const run = await getPayrollRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status === 'exported') {
    throw Object.assign(
      new Error('Cannot reopen an exported run. Create a new run for the next period.'),
      { status: 422 },
    );
  }
  if (run.status !== 'locked') {
    throw Object.assign(
      new Error(`Cannot reopen: run is in status '${run.status}'. Only 'locked' runs can be reopened.`),
      { status: 422 },
    );
  }
  if (!reason || reason.trim() === '') {
    throw Object.assign(new Error('A reason is required to reopen a locked payroll run.'), { status: 422 });
  }

  const now = new Date().toISOString();

  // Clear lines + inputs so the run must be fully re-locked and re-calculated
  await sb.from('finance_payroll_run_lines').delete().eq('run_id', runId);
  await sb.from('finance_payroll_run_inputs').delete().eq('run_id', runId);
  await sb.from('finance_payroll_run_warnings').delete().eq('run_id', runId);

  // Wave 5 — reverse this run's loan deductions (restore balances) so the re-lock
  // that follows records them afresh and the loan isn't double-decremented.
  await reverseLoanDeductionsForRun(runId);

  const { data: updated, error: updErr } = await sb.from('finance_payroll_runs')
    .update({
      status:         'draft',
      workflow_id:    null,
      reopened_by:    actorId,
      reopened_at:    now,
      reopen_reason:  reason.trim(),
      // Reset totals since lines are cleared
      gross_total:         0,
      deduction_total:     0,
      net_total:           0,
      nis_employer_total:  0,
      employee_count:      0,
    })
    .eq('id', runId)
    .select()
    .single<DbRunRow>();
  if (updErr) throw Object.assign(new Error('reopenRun/update: ' + updErr.message), { status: 500 });

  const updatedRun = toRunDto(updated);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.reopened',
    previousState: { status: 'locked' },
    newState: { status: 'draft', reopenReason: reason.trim() },
    reason: reason.trim(),
  });

  void emitAppEvent({
    eventType:        'finance.payroll.run.reopened',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    actorUserId:      actorId,
    severity:         'warning',
    payload:          { runNo: updatedRun.runNo, reason: reason.trim() },
  });

  return updatedRun;
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
