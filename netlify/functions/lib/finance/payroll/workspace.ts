import { sb } from '../../db';
import { computeRunActions, type PayrollRunActions } from './runActions';
import {
  getPayrollRun,
  listRunAuditLog,
  type PayrollRunDto,
  type RunAuditLogEntry,
} from '../payrollRuns';
import {
  getCalculationVersion,
  listCalculationAttempts,
  type PayrollCalculationAttempt,
  type PayrollCalculationVersion,
} from './execution';
import {
  listAllPayrollFindings,
  type PayrollControlFinding,
  type PayrollFindingDomain,
  type PayrollFindingSeverity,
  type PayrollFindingState,
} from './findings';
import type { CrewRunEvidence } from './crewRun';

interface InputSnapshotRow {
  id: string;
  snapshot_no: number;
  checksum: string;
  employee_count: number;
  input_count: number;
  source_summary: Record<string, unknown>;
  locked_by: string | null;
  locked_at: string;
}

export interface PayrollInputSnapshot {
  id: string;
  snapshotNo: number;
  checksum: string;
  employeeCount: number;
  inputCount: number;
  sourceSummary: Record<string, unknown>;
  lockedBy: string | null;
  lockedAt: string;
}

export interface PayrollFindingSummary {
  total: number;
  actionable: number;
  blockers: number;
  warnings: number;
  info: number;
  byState: Record<PayrollFindingState, number>;
  byDomain: Record<PayrollFindingDomain, number>;
}

export interface PayrollRunWorkspace {
  run: PayrollRunDto;
  inputSnapshot: PayrollInputSnapshot | null;
  currentCalculationVersion: PayrollCalculationVersion | null;
  calculationAttempts: PayrollCalculationAttempt[];
  findingSummary: PayrollFindingSummary;
  priorityFindings: PayrollControlFinding[];
  audit: RunAuditLogEntry[];
  /**
   * P0-2: authoritative per-actor action capabilities (state + userCan() + SoD),
   * computed server-side. The UI renders lifecycle actions exclusively from this.
   */
  actions: PayrollRunActions;
  /** CP6 (§14.7): frozen crew evidence from the current input snapshot — null for
   *  every run whose pinned policy version does not enable the crew capability. */
  crew: CrewRunEvidence | null;
}

const findingStates: PayrollFindingState[] = [
  'open',
  'in_progress',
  'resolved',
  'waived',
];
const findingDomains: PayrollFindingDomain[] = [
  'population',
  'input',
  'statutory',
  'payment',
  'accounting',
  'variance',
  'funding',
  'release',
];

function countBy<T extends string>(values: readonly T[], initial: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(initial.map(value => [value, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function summarizeFindings(findings: PayrollControlFinding[]): PayrollFindingSummary {
  const severityCounts = countBy(
    findings.map(finding => finding.severity),
    ['info', 'warning', 'blocker'] satisfies PayrollFindingSeverity[],
  );
  return {
    total: findings.length,
    actionable: findings.filter(finding =>
      finding.state === 'open' || finding.state === 'in_progress').length,
    blockers: severityCounts.blocker,
    warnings: severityCounts.warning,
    info: severityCounts.info,
    byState: countBy(findings.map(finding => finding.state), findingStates),
    byDomain: countBy(findings.map(finding => finding.domain), findingDomains),
  };
}

export async function getPayrollRunWorkspace(
  runId: string,
  actor: { id: string; role?: string | null },
): Promise<PayrollRunWorkspace> {
  const run = await getPayrollRun(runId);
  if (!run) {
    throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  }

  const [inputSnapshot, currentCalculationVersion, calculationAttempts, findings, audit, actions] =
    await Promise.all([
      getInputSnapshot(run.currentInputSnapshotId),
      run.currentCalculationVersionId
        ? getCalculationVersion(run.currentCalculationVersionId)
        : Promise.resolve(null),
      listCalculationAttempts({ runId, limit: 20 }),
      run.currentCalculationVersionId
        ? listAllPayrollFindings({
            runId,
            calculationVersionId: run.currentCalculationVersionId,
          })
        : Promise.resolve([]),
      listRunAuditLog(runId),
      computeRunActions(actor, {
        status: run.status,
        createdBy: run.createdBy,
        hasCurrentCalculationVersion: run.currentCalculationVersionId != null,
      }),
    ]);

  const severityRank: Record<PayrollFindingSeverity, number> = {
    blocker: 0,
    warning: 1,
    info: 2,
  };
  const priorityFindings = findings
    .filter(finding => finding.state === 'open' || finding.state === 'in_progress')
    .sort((a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      Number(Boolean(b.dueAt)) - Number(Boolean(a.dueAt)) ||
      (a.dueAt ?? '').localeCompare(b.dueAt ?? '') ||
      a.createdAt.localeCompare(b.createdAt))
    .slice(0, 20);

  return {
    run,
    inputSnapshot,
    currentCalculationVersion,
    calculationAttempts,
    findingSummary: summarizeFindings(findings),
    priorityFindings,
    audit,
    actions,
    crew: (inputSnapshot?.sourceSummary as { crew?: CrewRunEvidence } | undefined)?.crew ?? null,
  };
}

async function getInputSnapshot(id: string | null): Promise<PayrollInputSnapshot | null> {
  if (!id) return null;
  const { data, error } = await sb
    .from('finance_payroll_input_snapshots')
    .select(
      'id, snapshot_no, checksum, employee_count, input_count, source_summary, locked_by, locked_at',
    )
    .eq('id', id)
    .maybeSingle<InputSnapshotRow>();
  if (error) {
    throw Object.assign(new Error(`getPayrollInputSnapshot: ${error.message}`), {
      status: 500,
    });
  }
  if (!data) return null;
  return {
    id: data.id,
    snapshotNo: data.snapshot_no,
    checksum: data.checksum,
    employeeCount: data.employee_count,
    inputCount: data.input_count,
    sourceSummary: data.source_summary,
    lockedBy: data.locked_by,
    lockedAt: data.locked_at,
  };
}
