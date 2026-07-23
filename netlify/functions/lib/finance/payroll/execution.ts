import { sb } from '../../db';
import { selectAllRows } from '../../dbBulk';
import { getActiveStatutoryVersion } from '../statutoryConfig';
import { payrollRpcHttpError } from './rpcError';
import type { PayrollRunCreateAttestations } from '../../../../../types/payrollRuns';

export type PayrollRunType =
  | 'scheduled'
  | 'off_cycle'
  | 'correction'
  | 'final_pay';

export type PayrollRunStatus =
  | 'draft'
  | 'input_locked'
  | 'calculation_failed'
  | 'calculated'
  | 'pending_approval'
  | 'returned'
  | 'approved'
  | 'locked'
  | 'released'
  | 'exported'
  | 'cancelled';

export interface CreatePayrollRunCommand {
  actorId: string;
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
  // Slice 1 run metadata (all optional)
  reasonCode?: string;
  payrollOwnerId?: string;
  otCutoffAt?: string;
  approvalDeadlineAt?: string;
  fundingDate?: string;
  releaseWindow?: string;
  internalDescription?: string;
  /** P0-4: required creation governance attestations (all literally true). */
  attestations: PayrollRunCreateAttestations;
}

export interface CalculationAttemptRow {
  id: string;
  run_id: string;
  input_snapshot_id: string;
  attempt_no: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  correlation_id: string;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  started_at: string;
  lease_expires_at: string;
  completed_at: string | null;
}

export interface PayrollCalculationAttempt {
  id: string;
  runId: string;
  inputSnapshotId: string;
  attemptNo: number;
  status: CalculationAttemptRow['status'];
  stage: string;
  progress: number;
  correlationId: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  startedAt: string;
  leaseExpiresAt: string;
  completedAt: string | null;
}

interface CalculationVersionRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  input_snapshot_id: string;
  version_no: number;
  checksum: string;
  employee_count: number;
  gross_total: number;
  deduction_total: number;
  net_total: number;
  nis_employer_total: number;
  statutory_version_id: string;
  published_by: string | null;
  published_at: string;
}

export interface PayrollCalculationVersion {
  id: string;
  runId: string;
  attemptId: string | null;
  inputSnapshotId: string;
  versionNo: number;
  checksum: string;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  nisEmployerTotal: number;
  statutoryVersionId: string;
  publishedBy: string | null;
  publishedAt: string;
}

function toAttempt(row: CalculationAttemptRow): PayrollCalculationAttempt {
  return {
    id: row.id,
    runId: row.run_id,
    inputSnapshotId: row.input_snapshot_id,
    attemptNo: Number(row.attempt_no),
    status: row.status,
    stage: row.stage,
    progress: Number(row.progress),
    correlationId: row.correlation_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    startedAt: row.started_at,
    leaseExpiresAt: row.lease_expires_at,
    completedAt: row.completed_at,
  };
}

function toVersion(row: CalculationVersionRow): PayrollCalculationVersion {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    inputSnapshotId: row.input_snapshot_id,
    versionNo: Number(row.version_no),
    checksum: row.checksum,
    employeeCount: Number(row.employee_count),
    grossTotal: Number(row.gross_total),
    deductionTotal: Number(row.deduction_total),
    netTotal: Number(row.net_total),
    nisEmployerTotal: Number(row.nis_employer_total),
    statutoryVersionId: row.statutory_version_id,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
  };
}

const ATTEMPT_COLUMNS =
  'id, run_id, input_snapshot_id, attempt_no, status, stage, progress, correlation_id, error_code, error_message, created_by, started_at, lease_expires_at, completed_at';
const VERSION_COLUMNS =
  'id, run_id, attempt_id, input_snapshot_id, version_no, checksum, employee_count, gross_total, deduction_total, net_total, nis_employer_total, statutory_version_id, published_by, published_at';

function rpcData<T>(data: unknown, error: { code?: string | null; message: string } | null): T {
  if (error) throw payrollRpcHttpError(error);
  return data as T;
}

export async function createPayrollRunCommand(
  command: CreatePayrollRunCommand,
): Promise<Record<string, unknown>> {
  const statutoryVersion = await getActiveStatutoryVersion('TT');
  if (!statutoryVersion) {
    throw Object.assign(
      new Error(
        'No active TT statutory version found. Activate a statutory version before creating a payroll run.',
      ),
      { status: 422 },
    );
  }

  const { data, error } = await sb.rpc('finance_payroll_create_run_tx', {
    p_actor_id: command.actorId,
    p_request_key: command.idempotencyKey,
    p_run_type: command.runType,
    p_period_start: command.periodStart,
    p_period_end: command.periodEnd,
    p_statutory_version_id: statutoryVersion.id,
    p_sequence_no: command.sequenceNo ?? 1,
    p_source_run_id: command.sourceRunId ?? null,
    p_pay_frequency: command.payFrequency ?? null,
    p_weeks_in_period: command.weeksInPeriod ?? null,
    p_pay_group_id: command.payGroupId ?? null,
    p_pay_date: command.payDate ?? command.periodEnd,
    p_cut_off_date: command.cutOffDate ?? null,
    // Slice 1 run metadata
    p_reason_code: command.reasonCode ?? null,
    p_payroll_owner_id: command.payrollOwnerId ?? null,
    p_ot_cutoff_at: command.otCutoffAt ?? null,
    p_approval_deadline_at: command.approvalDeadlineAt ?? null,
    p_funding_date: command.fundingDate ?? null,
    p_release_window: command.releaseWindow ?? null,
    p_internal_description: command.internalDescription ?? null,
    // P0-4: governance attestations — validated + hashed + persisted in the tx.
    p_attestations: command.attestations,
  });

  return rpcData<Record<string, unknown>>(data, error);
}

export async function publishInputSnapshot(command: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
  inputs: Record<string, unknown>[];
  employeeCount: number;
  sourceSummary: Record<string, unknown>;
}): Promise<{ run: Record<string, unknown>; snapshotId: string; duplicate: boolean }> {
  const normalizedInputs = [...command.inputs].sort((a, b) => {
    const ak = [
      a['employee_id'],
      a['source_type'],
      a['source_id'],
      a['component_code'],
    ].map(String).join('|');
    const bk = [
      b['employee_id'],
      b['source_type'],
      b['source_id'],
      b['component_code'],
    ].map(String).join('|');
    return ak.localeCompare(bk);
  });
  const { data, error } = await sb.rpc('finance_payroll_lock_inputs_tx', {
    p_run_id: command.runId,
    p_actor_id: command.actorId,
    p_idempotency_key: command.idempotencyKey,
    p_inputs: normalizedInputs,
    p_employee_count: command.employeeCount,
    p_source_summary: command.sourceSummary,
  });

  return rpcData<{
    run: Record<string, unknown>;
    snapshotId: string;
    duplicate: boolean;
  }>(data, error);
}

export async function replayInputSnapshot(command: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{ run: Record<string, unknown>; snapshotId: string; duplicate: boolean }> {
  const { data, error } = await sb.rpc('finance_payroll_lock_inputs_tx', {
    p_run_id: command.runId,
    p_actor_id: command.actorId,
    p_idempotency_key: command.idempotencyKey,
    p_inputs: null,
    p_employee_count: null,
    p_source_summary: null,
  });

  return rpcData<{
    run: Record<string, unknown>;
    snapshotId: string;
    duplicate: boolean;
  }>(data, error);
}

export async function startCalculationAttempt(command: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{
  attempt: CalculationAttemptRow;
  duplicate: boolean;
  resumed: boolean;
}> {
  const { data, error } = await sb.rpc('finance_payroll_calculation_start_tx', {
    p_run_id: command.runId,
    p_actor_id: command.actorId,
    p_idempotency_key: command.idempotencyKey,
  });

  return rpcData<{
    attempt: CalculationAttemptRow;
    duplicate: boolean;
    resumed: boolean;
  }>(data, error);
}

export async function listCalculationAttempts(options: {
  runId: string;
  limit?: number;
  offset?: number;
}): Promise<PayrollCalculationAttempt[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const { data, error } = await sb
    .from('finance_payroll_calculation_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('run_id', options.runId)
    .order('attempt_no', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    throw Object.assign(new Error(`listCalculationAttempts: ${error.message}`), {
      status: 500,
    });
  }
  return ((data ?? []) as unknown as CalculationAttemptRow[]).map(toAttempt);
}

export async function getCalculationAttempt(
  id: string,
): Promise<PayrollCalculationAttempt | null> {
  const { data, error } = await sb
    .from('finance_payroll_calculation_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(`getCalculationAttempt: ${error.message}`), {
      status: 500,
    });
  }
  return data ? toAttempt(data as unknown as CalculationAttemptRow) : null;
}

export async function listCalculationVersions(
  runId: string,
): Promise<PayrollCalculationVersion[]> {
  const { data, error } = await sb
    .from('finance_payroll_calculation_versions')
    .select(VERSION_COLUMNS)
    .eq('run_id', runId)
    .order('version_no', { ascending: false });
  if (error) {
    throw Object.assign(new Error(`listCalculationVersions: ${error.message}`), {
      status: 500,
    });
  }
  return ((data ?? []) as unknown as CalculationVersionRow[]).map(toVersion);
}

export async function getCalculationVersion(
  id: string,
): Promise<PayrollCalculationVersion | null> {
  const { data, error } = await sb
    .from('finance_payroll_calculation_versions')
    .select(VERSION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(`getCalculationVersion: ${error.message}`), {
      status: 500,
    });
  }
  return data ? toVersion(data as unknown as CalculationVersionRow) : null;
}

interface VersionLineRow {
  calculation_version_id: string;
  employee_id: string;
  gross: number;
  deduction_total?: number;
  nis_employee: number;
  health_surcharge: number;
  paye: number;
  voluntary_deductions: number;
  net: number;
}

export interface PayrollCalculationComparison {
  runId: string;
  from: PayrollCalculationVersion;
  to: PayrollCalculationVersion;
  totals: {
    grossDelta: number;
    deductionDelta: number;
    netDelta: number;
    nisEmployerDelta: number;
    employeeCountDelta: number;
  };
  changedEmployees: number;
  addedEmployees: number;
  removedEmployees: number;
  changes: Array<{
    employeeId: string;
    change: 'added' | 'removed' | 'changed';
    grossDelta: number;
    deductionDelta: number;
    netDelta: number;
  }>;
}

export async function compareCalculationVersions(
  fromVersionId: string,
  toVersionId: string,
): Promise<PayrollCalculationComparison> {
  if (fromVersionId === toVersionId) {
    throw Object.assign(new Error('Choose two different calculation versions to compare.'), {
      status: 422,
    });
  }
  const { data: versionRows, error: versionError } = await sb
    .from('finance_payroll_calculation_versions')
    .select(VERSION_COLUMNS)
    .in('id', [fromVersionId, toVersionId]);
  if (versionError) {
    throw Object.assign(new Error(`compareCalculationVersions: ${versionError.message}`), {
      status: 500,
    });
  }
  const versions = (versionRows ?? []) as unknown as CalculationVersionRow[];
  const fromRow = versions.find(row => row.id === fromVersionId);
  const toRow = versions.find(row => row.id === toVersionId);
  if (!fromRow || !toRow) {
    throw Object.assign(new Error('One or both calculation versions were not found.'), {
      status: 404,
    });
  }
  if (fromRow.run_id !== toRow.run_id) {
    throw Object.assign(new Error('Calculation versions must belong to the same payroll run.'), {
      status: 422,
    });
  }

  const lineRows = await selectAllRows<VersionLineRow>(() =>
    sb
      .from('finance_payroll_calculation_version_lines')
      .select(
        'calculation_version_id, employee_id, gross, nis_employee, health_surcharge, paye, voluntary_deductions, net',
      )
      .in('calculation_version_id', [fromVersionId, toVersionId])
      .order('employee_id')
      .order('calculation_version_id'));
  const fromLines = new Map(
    lineRows
      .filter(row => row.calculation_version_id === fromVersionId)
      .map(row => [row.employee_id, row]),
  );
  const toLines = new Map(
    lineRows
      .filter(row => row.calculation_version_id === toVersionId)
      .map(row => [row.employee_id, row]),
  );
  const employeeIds = [...new Set([...fromLines.keys(), ...toLines.keys()])].sort();
  const round2 = (value: number): number => Math.round(value * 100) / 100;
  const deductions = (row: VersionLineRow | undefined): number => row
    ? Number(row.nis_employee) + Number(row.health_surcharge) + Number(row.paye) +
      Number(row.voluntary_deductions)
    : 0;
  const changes: PayrollCalculationComparison['changes'] = [];
  let addedEmployees = 0;
  let removedEmployees = 0;
  for (const employeeId of employeeIds) {
    const fromLine = fromLines.get(employeeId);
    const toLine = toLines.get(employeeId);
    const grossDelta = round2(Number(toLine?.gross ?? 0) - Number(fromLine?.gross ?? 0));
    const deductionDelta = round2(deductions(toLine) - deductions(fromLine));
    const netDelta = round2(Number(toLine?.net ?? 0) - Number(fromLine?.net ?? 0));
    if (!fromLine) addedEmployees += 1;
    if (!toLine) removedEmployees += 1;
    if (!fromLine || !toLine || grossDelta !== 0 || deductionDelta !== 0 || netDelta !== 0) {
      changes.push({
        employeeId,
        change: !fromLine ? 'added' : !toLine ? 'removed' : 'changed',
        grossDelta,
        deductionDelta,
        netDelta,
      });
    }
  }
  changes.sort((a, b) => Math.abs(b.netDelta) - Math.abs(a.netDelta) ||
    a.employeeId.localeCompare(b.employeeId));

  const from = toVersion(fromRow);
  const to = toVersion(toRow);
  return {
    runId: from.runId,
    from,
    to,
    totals: {
      grossDelta: round2(to.grossTotal - from.grossTotal),
      deductionDelta: round2(to.deductionTotal - from.deductionTotal),
      netDelta: round2(to.netTotal - from.netTotal),
      nisEmployerDelta: round2(to.nisEmployerTotal - from.nisEmployerTotal),
      employeeCountDelta: to.employeeCount - from.employeeCount,
    },
    changedEmployees: changes.length,
    addedEmployees,
    removedEmployees,
    changes,
  };
}

export async function publishCalculationVersion(command: {
  attemptId: string;
  actorId: string;
  lines: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  totals: Record<string, number>;
}): Promise<{
  run: Record<string, unknown>;
  attempt: CalculationAttemptRow;
  version: Record<string, unknown>;
  eventId: string | null;
  findingCount: number;
  duplicate: boolean;
}> {
  const { data, error } = await sb.rpc('finance_payroll_calculation_publish_tx', {
    p_attempt_id: command.attemptId,
    p_actor_id: command.actorId,
    p_lines: command.lines,
    p_warnings: command.warnings,
    p_totals: command.totals,
  });

  return rpcData<{
    run: Record<string, unknown>;
    attempt: CalculationAttemptRow;
    version: Record<string, unknown>;
    eventId: string | null;
    findingCount: number;
    duplicate: boolean;
  }>(data, error);
}

export async function failCalculationAttempt(command: {
  attemptId: string;
  actorId: string;
  errorCode: string;
  errorMessage: string;
  technicalDetail?: string;
}): Promise<void> {
  const { error } = await sb.rpc('finance_payroll_calculation_fail_tx', {
    p_attempt_id: command.attemptId,
    p_actor_id: command.actorId,
    p_error_code: command.errorCode,
    p_error_message: command.errorMessage,
    p_technical_detail: command.technicalDetail ?? null,
  });
  if (error) throw payrollRpcHttpError(error);
}

export function calculationFailure(error: unknown): {
  errorCode: string;
  errorMessage: string;
  technicalDetail: string;
  status: number;
} {
  const source = error as { status?: number; message?: string; stack?: string };
  const expected = source.status !== undefined && source.status >= 400 && source.status < 500;
  return {
    errorCode: expected ? 'PAYROLL_VALIDATION_FAILED' : 'PAYROLL_CALCULATION_FAILED',
    errorMessage: expected
      ? (source.message ?? 'Payroll validation failed.')
      : 'Payroll calculation failed. Use the correlation ID when contacting support.',
    technicalDetail: source.stack ?? source.message ?? String(error),
    status: expected ? source.status! : 500,
  };
}
