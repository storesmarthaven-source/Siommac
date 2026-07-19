import { sb } from '../../db';
import { selectAllRows } from '../../dbBulk';
import { notify } from '../../notify';
import { payrollRpcHttpError } from './rpcError';

export type PayrollFindingDomain =
  | 'population'
  | 'input'
  | 'statutory'
  | 'payment'
  | 'accounting'
  | 'variance'
  | 'funding'
  | 'release';

export type PayrollFindingState = 'open' | 'in_progress' | 'resolved' | 'waived';
export type PayrollFindingSeverity = 'info' | 'warning' | 'blocker';

interface DbFindingRow {
  id: string;
  run_id: string;
  calculation_version_id: string;
  source_type: string;
  source_id: string;
  finding_type: string;
  domain: PayrollFindingDomain;
  severity: PayrollFindingSeverity;
  state: PayrollFindingState;
  title: string;
  detail: string;
  employee_id: string | null;
  assignee_id: string | null;
  due_at: string | null;
  version: number;
  resolution_note: string | null;
  resolution_evidence: Record<string, unknown> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  waiver_reason: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waiver_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollControlFinding {
  id: string;
  runId: string;
  calculationVersionId: string;
  sourceType: string;
  sourceId: string;
  findingType: string;
  domain: PayrollFindingDomain;
  severity: PayrollFindingSeverity;
  state: PayrollFindingState;
  title: string;
  detail: string;
  employeeId: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  version: number;
  resolutionNote: string | null;
  resolutionEvidence: Record<string, unknown> | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  waiverReason: string | null;
  waivedBy: string | null;
  waivedAt: string | null;
  waiverExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toFinding(row: DbFindingRow): PayrollControlFinding {
  return {
    id: row.id,
    runId: row.run_id,
    calculationVersionId: row.calculation_version_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    findingType: row.finding_type,
    domain: row.domain,
    severity: row.severity,
    state: row.state,
    title: row.title,
    detail: row.detail,
    employeeId: row.employee_id,
    assigneeId: row.assignee_id,
    dueAt: row.due_at,
    version: row.version,
    resolutionNote: row.resolution_note,
    resolutionEvidence: row.resolution_evidence,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    waiverReason: row.waiver_reason,
    waivedBy: row.waived_by,
    waivedAt: row.waived_at,
    waiverExpiresAt: row.waiver_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPayrollFindings(options: {
  runId: string;
  calculationVersionId?: string;
  state?: PayrollFindingState;
  severity?: PayrollFindingSeverity;
  limit?: number;
  offset?: number;
}): Promise<PayrollControlFinding[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  let query = sb
    .from('finance_payroll_control_findings')
    .select('*')
    .eq('run_id', options.runId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.calculationVersionId) {
    query = query.eq('calculation_version_id', options.calculationVersionId);
  }
  if (options.state) query = query.eq('state', options.state);
  if (options.severity) query = query.eq('severity', options.severity);

  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error(`listPayrollFindings: ${error.message}`), {
      status: 500,
    });
  }
  return ((data ?? []) as DbFindingRow[]).map(toFinding);
}

export async function listAllPayrollFindings(options: {
  runId: string;
  calculationVersionId?: string;
  state?: PayrollFindingState;
  severity?: PayrollFindingSeverity;
}): Promise<PayrollControlFinding[]> {
  const rows = await selectAllRows<DbFindingRow>(() => {
    let query = sb
      .from('finance_payroll_control_findings')
      .select('*')
      .eq('run_id', options.runId)
      .order('created_at', { ascending: false });
    if (options.calculationVersionId) {
      query = query.eq('calculation_version_id', options.calculationVersionId);
    }
    if (options.state) query = query.eq('state', options.state);
    if (options.severity) query = query.eq('severity', options.severity);
    return query;
  });
  return rows.map(toFinding);
}

export async function getPayrollFinding(id: string): Promise<PayrollControlFinding | null> {
  const { data, error } = await sb
    .from('finance_payroll_control_findings')
    .select('*')
    .eq('id', id)
    .maybeSingle<DbFindingRow>();
  if (error) {
    throw Object.assign(new Error(`getPayrollFinding: ${error.message}`), {
      status: 500,
    });
  }
  return data ? toFinding(data) : null;
}

export async function commandPayrollFinding(command: {
  findingId: string;
  actorId: string;
  expectedVersion: number;
  command: 'assign' | 'escalate' | 'resolve' | 'waive' | 'reopen';
  idempotencyKey: string;
  assigneeId?: string;
  note?: string;
  evidence?: Record<string, unknown>;
  waiverExpiresAt?: string;
}): Promise<PayrollControlFinding> {
  const { data, error } = await sb.rpc('finance_payroll_finding_command_tx', {
    p_finding_id: command.findingId,
    p_actor_id: command.actorId,
    p_expected_version: command.expectedVersion,
    p_command: command.command,
    p_idempotency_key: command.idempotencyKey,
    p_assignee_id: command.assigneeId ?? null,
    p_note: command.note ?? null,
    p_evidence: command.evidence ?? null,
    p_waiver_expires_at: command.waiverExpiresAt ?? null,
  });
  if (error) throw payrollRpcHttpError(error);

  const result = data as {
    finding: DbFindingRow;
    eventId?: string | null;
    duplicate?: boolean;
  };
  const finding = toFinding(result.finding);

  if (!result.duplicate) {
    const recipientId = command.command === 'assign' || command.command === 'escalate'
      ? finding.assigneeId
      : await findRunOwner(finding.runId);
    if (recipientId && recipientId !== command.actorId) {
      void notify({
        userId: recipientId,
        type: `finance.payroll.finding.${command.command}`,
        title: finding.title,
        body: `${finding.state.replace('_', ' ')}: ${finding.detail}`,
        eventId: result.eventId ?? null,
        module: 'finance_payroll',
        severity: finding.severity === 'blocker' ? 'high' : finding.severity,
        sourceType: 'payroll_control_finding',
        sourceId: finding.id,
        actionRoute: 's-finance-payroll',
        actionRequired: finding.state === 'open' || finding.state === 'in_progress',
        dedupeKey: `payroll.finding.${finding.id}.${finding.version}`,
        dueAt: finding.dueAt,
      });
    }
  }

  return finding;
}

async function findRunOwner(runId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('finance_payroll_runs')
    .select('created_by')
    .eq('id', runId)
    .maybeSingle<{ created_by: string | null }>();
  if (error) {
    console.error('[payroll] finding notification owner lookup failed', {
      runId,
      error: error.message,
    });
  }
  return data?.created_by ?? null;
}
