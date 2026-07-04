// ============================================================================
// Finance — Statutory Remittances & Filing (F1)
// ============================================================================
// Manages finance_remittances + finance_remittance_lines.
//
// Lifecycle: draft → submitted → approved → paid → filed
//   (also: draft → cancelled, submitted → cancelled)
//   - finance_staff or finance_manager can create/submit remittances.
//   - CREATOR ≠ FINAL APPROVER (assertDifferentApprover enforced on approve).
//   - Remittances are computed from locked/approved payroll run lines.
//   - computeRemittanceFromRun: derives PAYE, NIS employee+employer, and
//     Health Surcharge totals from finance_payroll_run_lines.
//
// Permissions: finance.remittances.{view,manage,approve,reports.view,reports.export}
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type RemittanceAuthority = 'paye_bir' | 'nis_nibtt' | 'health_surcharge';
export type RemittanceStatus = 'draft' | 'submitted' | 'approved' | 'paid' | 'filed' | 'cancelled';

export interface RemittanceDto {
  id: string;
  remittanceNo: string;
  periodYear: number;
  periodMonth: number;
  authority: RemittanceAuthority;
  payrollRunId: string;
  employeePortion: number;
  employerPortion: number;
  totalDue: number;
  currency: string;
  status: RemittanceStatus;
  dueDate: string | null;
  paidDate: string | null;
  filedDate: string | null;
  authorityReference: string | null;
  workflowId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RemittanceLineDto {
  id: string;
  remittanceId: string;
  employeeId: string;
  employeePortion: number;
  employerPortion: number;
  lineTotal: number;
  sourceLineId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Computed totals derived from a payroll run for a given authority. */
export interface ComputedRemittance {
  payrollRunId: string;
  periodYear: number;
  periodMonth: number;
  authority: RemittanceAuthority;
  employeePortion: number;
  employerPortion: number;
  totalDue: number;
  lineCount: number;
  lines: Array<{
    employeeId: string;
    sourceLineId: string;
    employeePortion: number;
    employerPortion: number;
    lineTotal: number;
  }>;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface DbRemittanceRow {
  id: string; remittance_no: string; period_year: number; period_month: number;
  authority: string; payroll_run_id: string;
  employee_portion: number; employer_portion: number; total_due: number;
  currency: string; status: string;
  due_date: string | null; paid_date: string | null; filed_date: string | null;
  authority_reference: string | null; workflow_id: string | null;
  created_by: string | null; approved_by: string | null;
  cancelled_by: string | null; cancel_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string;
}

interface DbLineRow {
  id: string; remittance_id: string; employee_id: string;
  employee_portion: number; employer_portion: number; line_total: number;
  source_line_id: string | null; metadata: Record<string, unknown>;
  created_at: string;
}

interface DbRunRow {
  id: string; period_month: string; status: string;
}

interface DbRunLineRow {
  id: string; employee_id: string;
  nis_employee: number; nis_employer: number;
  health_surcharge: number; paye: number;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function toDto(r: DbRemittanceRow): RemittanceDto {
  return {
    id: r.id, remittanceNo: r.remittance_no,
    periodYear: r.period_year, periodMonth: r.period_month,
    authority: r.authority as RemittanceAuthority,
    payrollRunId: r.payroll_run_id,
    employeePortion: Number(r.employee_portion),
    employerPortion: Number(r.employer_portion),
    totalDue: Number(r.total_due),
    currency: r.currency, status: r.status as RemittanceStatus,
    dueDate: r.due_date, paidDate: r.paid_date, filedDate: r.filed_date,
    authorityReference: r.authority_reference, workflowId: r.workflow_id,
    createdBy: r.created_by, approvedBy: r.approved_by,
    cancelledBy: r.cancelled_by, cancelReason: r.cancel_reason,
    metadata: r.metadata,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toLineDto(r: DbLineRow): RemittanceLineDto {
  return {
    id: r.id, remittanceId: r.remittance_id, employeeId: r.employee_id,
    employeePortion: Number(r.employee_portion),
    employerPortion: Number(r.employer_portion),
    lineTotal: Number(r.line_total),
    sourceLineId: r.source_line_id, metadata: r.metadata,
    createdAt: r.created_at,
  };
}

// ── Compute: derive remittance totals from a payroll run ──────────────────────

/**
 * Reads finance_payroll_run_lines for the given run and maps each authority's
 * deduction columns to employee/employer portions.
 *
 * Column mapping (from finance_payroll_run_lines):
 *   paye_bir       → paye (employee only; no employer PAYE)
 *   nis_nibtt      → nis_employee (employee) + nis_employer (employer)
 *   health_surcharge → health_surcharge (employee only; employer does not contribute)
 *
 * The run must be in status 'approved' or 'locked' (immutable lines).
 */
export async function computeRemittanceFromRun(
  runId: string,
  authority: RemittanceAuthority,
): Promise<ComputedRemittance> {
  // Load the run to get period and validate status
  const { data: run, error: runErr } = await sb
    .from('finance_payroll_runs')
    .select('id, period_month, status')
    .eq('id', runId)
    .maybeSingle<DbRunRow>();
  if (runErr) throw Object.assign(new Error('computeRemittanceFromRun: ' + runErr.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  const APPROVED_STATUSES = ['approved', 'locked', 'exported'];
  if (!APPROVED_STATUSES.includes(run.status)) {
    throw Object.assign(
      new Error(`Payroll run must be approved or locked to compute a remittance (current status: ${run.status}).`),
      { status: 422 },
    );
  }

  // period_month is a date stored as YYYY-MM-DD; extract year and month
  const periodDate = new Date(run.period_month);
  const periodYear = periodDate.getUTCFullYear();
  const periodMonth = periodDate.getUTCMonth() + 1;

  // Load run lines
  const { data: lines, error: linesErr } = await sb
    .from('finance_payroll_run_lines')
    .select('id, employee_id, nis_employee, nis_employer, health_surcharge, paye')
    .eq('run_id', runId);
  if (linesErr) throw Object.assign(new Error('computeRemittanceFromRun lines: ' + linesErr.message), { status: 500 });

  const runLines = (lines ?? []) as DbRunLineRow[];

  // Map columns by authority
  let totalEmployee = 0;
  let totalEmployer = 0;

  const computedLines = runLines.map(l => {
    let empPortion = 0;
    let erPortion = 0;

    if (authority === 'paye_bir') {
      empPortion = Number(l.paye);
      erPortion = 0;
    } else if (authority === 'nis_nibtt') {
      empPortion = Number(l.nis_employee);
      erPortion = Number(l.nis_employer);
    } else if (authority === 'health_surcharge') {
      empPortion = Number(l.health_surcharge);
      erPortion = 0;
    }

    totalEmployee += empPortion;
    totalEmployer += erPortion;

    return {
      employeeId: l.employee_id,
      sourceLineId: l.id,
      employeePortion: empPortion,
      employerPortion: erPortion,
      lineTotal: empPortion + erPortion,
    };
  });

  const totalDue = totalEmployee + totalEmployer;

  return {
    payrollRunId: runId, periodYear, periodMonth, authority,
    employeePortion: totalEmployee,
    employerPortion: totalEmployer,
    totalDue,
    lineCount: computedLines.length,
    lines: computedLines,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listRemittances(opts: {
  payrollRunId?: string;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
  periodYear?: number;
  periodMonth?: number;
} = {}): Promise<RemittanceDto[]> {
  let q = sb.from('finance_remittances').select('*')
    .order('created_at', { ascending: false });
  if (opts.payrollRunId) q = q.eq('payroll_run_id', opts.payrollRunId);
  if (opts.authority)    q = q.eq('authority', opts.authority);
  if (opts.status)       q = q.eq('status', opts.status);
  if (opts.periodYear)   q = q.eq('period_year', opts.periodYear);
  if (opts.periodMonth)  q = q.eq('period_month', opts.periodMonth);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listRemittances: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRemittanceRow[]).map(toDto);
}

// ── Get single ────────────────────────────────────────────────────────────────

export async function getRemittance(id: string): Promise<RemittanceDto | null> {
  const { data, error } = await sb.from('finance_remittances')
    .select('*').eq('id', id).maybeSingle<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('getRemittance: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

// ── Get lines ─────────────────────────────────────────────────────────────────

export async function listRemittanceLines(remittanceId: string): Promise<RemittanceLineDto[]> {
  const { data, error } = await sb.from('finance_remittance_lines')
    .select('*').eq('remittance_id', remittanceId).order('created_at');
  if (error) throw Object.assign(new Error('listRemittanceLines: ' + error.message), { status: 500 });
  return ((data ?? []) as DbLineRow[]).map(toLineDto);
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateRemittanceInput {
  payrollRunId: string;
  authority: RemittanceAuthority;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
  actorId: string;
}

export async function createRemittance(
  input: CreateRemittanceInput,
): Promise<RemittanceDto> {
  // Compute totals from the run lines
  const computed = await computeRemittanceFromRun(input.payrollRunId, input.authority);

  const remittanceNo = await nextRef('REM');

  const patch = {
    remittance_no:    remittanceNo,
    period_year:      computed.periodYear,
    period_month:     computed.periodMonth,
    authority:        input.authority,
    payroll_run_id:   input.payrollRunId,
    employee_portion: computed.employeePortion,
    employer_portion: computed.employerPortion,
    total_due:        computed.totalDue,
    currency:         'TTD',
    status:           'draft' as const,
    due_date:         input.dueDate ?? null,
    metadata:         input.metadata ?? {},
    created_by:       input.actorId,
  };

  const { data, error } = await sb.from('finance_remittances')
    .insert(patch).select().single<DbRemittanceRow>();
  if (error) {
    if (error.code === '23505') {
      throw Object.assign(
        new Error(`A remittance for this payroll run and authority (${input.authority}) already exists.`),
        { status: 409 },
      );
    }
    throw Object.assign(new Error('createRemittance: ' + error.message), { status: 500 });
  }
  const row = toDto(data);

  // Insert per-employee lines — compensate on failure (delete the header)
  if (computed.lines.length > 0) {
    const lineRows = computed.lines.map(l => ({
      remittance_id:    row.id,
      employee_id:      l.employeeId,
      employee_portion: l.employeePortion,
      employer_portion: l.employerPortion,
      line_total:       l.lineTotal,
      source_line_id:   l.sourceLineId,
    }));
    const { error: lineErr } = await sb.from('finance_remittance_lines').insert(lineRows);
    if (lineErr) {
      // Compensating rollback: remove the header so we don't leave partial state
      await sb.from('finance_remittances').delete().eq('id', row.id);
      throw Object.assign(
        new Error('createRemittance lines: ' + lineErr.message + ' — remittance rolled back.'),
        { status: 500 },
      );
    }
  }

  // Emit event then audit (§2 order: event → audit)
  void emitAppEvent({
    eventType:        'finance.remittance.created',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   row.id,
    actorUserId:      input.actorId,
    severity:         'info',
    payload: {
      remittanceNo: row.remittanceNo,
      authority:    row.authority,
      totalDue:     row.totalDue,
      periodYear:   row.periodYear,
      periodMonth:  row.periodMonth,
    },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: row.id, actorId: input.actorId,
    action:       'remittance.created',
    previousState: null,
    newState: { status: 'draft', remittanceNo: row.remittanceNo, authority: row.authority },
  });

  return row;
}

// ── Submit (draft → submitted, starts workflow) ───────────────────────────────

export async function submitRemittance(
  id: string,
  actorId: string,
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Only draft remittances can be submitted for approval.'), { status: 422 });
  }

  const { data, error } = await sb.from('finance_remittances')
    .update({ status: 'submitted' })
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('submitRemittance: ' + error.message), { status: 500 });
  const row = toDto(data);

  // Emit event then audit
  void emitAppEvent({
    eventType:        'finance.remittance.submitted',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'info',
    payload: { authority: existing.authority, totalDue: existing.totalDue },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: id, actorId,
    action:       'remittance.submitted',
    previousState: { status: 'draft' }, newState: { status: 'submitted' },
  });

  // Start workflow via central engine
  const ctx: ModuleWorkflowContext = {
    moduleKey:        'finance_remittances',
    workflowType:     'finance_remittance_approval',
    triggerEvent:     'finance.remittance.submitted',
    sourceRecordId:   id,
    sourceRecordRef:  existing.remittanceNo,
    requestedBy:      actorId,
    priority:         'normal',
    recordData: {
      authority:   existing.authority,
      totalDue:    existing.totalDue,
      periodYear:  existing.periodYear,
      periodMonth: existing.periodMonth,
    },
  };

  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) {
      await sb.from('finance_remittances').update({ workflow_id: wf.id }).eq('id', id);
    }
  } catch (wfErr) {
    // Workflow start failed — roll back to draft
    await sb.from('finance_remittances').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(
      new Error('Workflow start failed — remittance rolled back to draft: ' + String(wfErr)),
      { status: 500 },
    );
  }

  return row;
}

// ── Approve (workflow adapter calls this; also accessible via direct route for maker-checker) ──

export async function approveRemittance(
  id: string,
  actorId: string,
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted remittances can be approved.'), { status: 422 });
  }

  // Segregation of duties: creator cannot approve
  assertDifferentApprover({
    actorId,
    createdBy: existing.createdBy,
    action:    'approve a remittance they created',
  });

  const { data, error } = await sb.from('finance_remittances')
    .update({ status: 'approved', approved_by: actorId })
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('approveRemittance: ' + error.message), { status: 500 });
  const row = toDto(data);

  void emitAppEvent({
    eventType:        'finance.remittance.approved',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'success',
    payload: { authority: existing.authority, totalDue: existing.totalDue },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: id, actorId,
    action:       'remittance.approved',
    previousState: { status: 'submitted' }, newState: { status: 'approved' },
  });

  return row;
}

// ── Mark Paid ─────────────────────────────────────────────────────────────────

export async function markRemittancePaid(
  id: string,
  actorId: string,
  opts: { paidDate?: string; authorityReference?: string } = {},
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'approved') {
    throw Object.assign(new Error('Only approved remittances can be marked paid.'), { status: 422 });
  }

  const paidDate = opts.paidDate ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await sb.from('finance_remittances')
    .update({
      status:              'paid',
      paid_date:           paidDate,
      authority_reference: opts.authorityReference ?? existing.authorityReference,
    })
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('markRemittancePaid: ' + error.message), { status: 500 });
  const row = toDto(data);

  void emitAppEvent({
    eventType:        'finance.remittance.paid',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'success',
    payload: { authority: existing.authority, paidDate, totalDue: existing.totalDue },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: id, actorId,
    action:       'remittance.paid',
    previousState: { status: 'approved' }, newState: { status: 'paid', paidDate },
  });

  return row;
}

// ── Mark Filed ────────────────────────────────────────────────────────────────

export async function markRemittanceFiled(
  id: string,
  actorId: string,
  opts: { filedDate?: string; authorityReference?: string } = {},
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'paid') {
    throw Object.assign(new Error('Only paid remittances can be marked filed.'), { status: 422 });
  }

  const filedDate = opts.filedDate ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await sb.from('finance_remittances')
    .update({
      status:              'filed',
      filed_date:          filedDate,
      authority_reference: opts.authorityReference ?? existing.authorityReference,
    })
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('markRemittanceFiled: ' + error.message), { status: 500 });
  const row = toDto(data);

  void emitAppEvent({
    eventType:        'finance.remittance.filed',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'success',
    payload: { authority: existing.authority, filedDate },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: id, actorId,
    action:       'remittance.filed',
    previousState: { status: 'paid' }, newState: { status: 'filed', filedDate },
  });

  return row;
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelRemittance(
  id: string,
  actorId: string,
  reason: string,
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (!['draft', 'submitted'].includes(existing.status)) {
    throw Object.assign(
      new Error('Only draft or submitted remittances can be cancelled.'),
      { status: 422 },
    );
  }

  const { data, error } = await sb.from('finance_remittances')
    .update({ status: 'cancelled', cancelled_by: actorId, cancel_reason: reason })
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('cancelRemittance: ' + error.message), { status: 500 });
  const row = toDto(data);

  void emitAppEvent({
    eventType:        'finance.remittance.cancelled',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'warning',
    payload: { reason },
  });

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId: id, actorId,
    action:       'remittance.cancelled',
    previousState: { status: existing.status }, newState: { status: 'cancelled' },
    reason,
  });

  return row;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface RemittanceReportRow {
  id: string;
  remittanceNo: string;
  periodYear: number;
  periodMonth: number;
  authority: string;
  status: string;
  totalDue: number;
  paidDate: string | null;
  filedDate: string | null;
  authorityReference: string | null;
  createdAt: string;
}

export async function listRemittancesReport(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
} = {}): Promise<RemittanceReportRow[]> {
  let q = sb.from('finance_remittances')
    .select('id, remittance_no, period_year, period_month, authority, status, total_due, paid_date, filed_date, authority_reference, created_at')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (opts.periodYear) q = q.eq('period_year', opts.periodYear);
  if (opts.authority)  q = q.eq('authority', opts.authority);
  if (opts.status)     q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listRemittancesReport: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{
    id: string; remittance_no: string; period_year: number; period_month: number;
    authority: string; status: string; total_due: number; paid_date: string | null;
    filed_date: string | null; authority_reference: string | null; created_at: string;
  }>).map(r => ({
    id: r.id, remittanceNo: r.remittance_no,
    periodYear: r.period_year, periodMonth: r.period_month,
    authority: r.authority, status: r.status,
    totalDue: Number(r.total_due),
    paidDate: r.paid_date, filedDate: r.filed_date,
    authorityReference: r.authority_reference,
    createdAt: r.created_at,
  }));
}
