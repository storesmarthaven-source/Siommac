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
// Side-effects: ALL mutations call emitFinanceMutationBackbone (app_event +
//   hr_audit_log + optional notifications/threads/tickets/handoffs per §8.1).
//
// Permissions: finance.remittances.{view,manage,approve,markFiled,
//              receipt.upload,reports.view,reports.export}
// ============================================================================

import { sb } from '../db';
import { selectAllRows } from '../dbBulk';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import { emitFinanceMutationBackbone } from './backbone';
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
  filingMethod: string | null;
  receiptReference: string | null;
  filedNotes: string | null;
  workflowId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Resolved from finance_payroll_runs join; null when not fetched via list/get. */
  payrollRunNo: string | null;
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

export interface ReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface DbRemittanceRow {
  id: string; remittance_no: string; period_year: number; period_month: number;
  authority: string; payroll_run_id: string;
  employee_portion: number; employer_portion: number; total_due: number;
  currency: string; status: string;
  due_date: string | null; paid_date: string | null; filed_date: string | null;
  authority_reference: string | null;
  filing_method: string | null;
  receipt_reference: string | null;
  filed_notes: string | null;
  workflow_id: string | null;
  created_by: string | null; approved_by: string | null;
  cancelled_by: string | null; cancel_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string;
  /** Present only when selected with the payroll_runs join (list/get endpoints). */
  finance_payroll_runs?: { run_no: string } | null;
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
    authorityReference: r.authority_reference,
    filingMethod: r.filing_method ?? null,
    receiptReference: r.receipt_reference ?? null,
    filedNotes: r.filed_notes ?? null,
    workflowId: r.workflow_id,
    createdBy: r.created_by, approvedBy: r.approved_by,
    cancelledBy: r.cancelled_by, cancelReason: r.cancel_reason,
    metadata: r.metadata,
    createdAt: r.created_at, updatedAt: r.updated_at,
    payrollRunNo: r.finance_payroll_runs?.run_no ?? null,
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

  const periodDate = new Date(run.period_month);
  const periodYear = periodDate.getUTCFullYear();
  const periodMonth = periodDate.getUTCMonth() + 1;

  // Paginate past 1000-row cap — truncating underpays the remittance for large runs.
  const runLines = await selectAllRows<DbRunLineRow>(
    () => sb.from('finance_payroll_run_lines')
      .select('id, employee_id, nis_employee, nis_employer, health_surcharge, paye')
      .eq('run_id', runId).order('id'),
  );

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

  return {
    payrollRunId: runId, periodYear, periodMonth, authority,
    employeePortion: totalEmployee,
    employerPortion: totalEmployer,
    totalDue: totalEmployee + totalEmployer,
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
  search?: string;
} = {}): Promise<RemittanceDto[]> {
  let q = sb.from('finance_remittances')
    .select('*, finance_payroll_runs!payroll_run_id(run_no)')
    .order('created_at', { ascending: false });
  if (opts.payrollRunId) q = q.eq('payroll_run_id', opts.payrollRunId);
  if (opts.authority)    q = q.eq('authority', opts.authority);
  if (opts.status)       q = q.eq('status', opts.status);
  if (opts.periodYear)   q = q.eq('period_year', opts.periodYear);
  if (opts.periodMonth)  q = q.eq('period_month', opts.periodMonth);
  if (opts.search)       q = q.ilike('remittance_no', `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listRemittances: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRemittanceRow[]).map(toDto);
}

// ── Get single ────────────────────────────────────────────────────────────────

export async function getRemittance(id: string): Promise<RemittanceDto | null> {
  const { data, error } = await sb.from('finance_remittances')
    .select('*, finance_payroll_runs!payroll_run_id(run_no)').eq('id', id).maybeSingle<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('getRemittance: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

// ── Get lines (for single remittance) ────────────────────────────────────────

export async function listRemittanceLines(remittanceId: string): Promise<RemittanceLineDto[]> {
  const { data, error } = await sb.from('finance_remittance_lines')
    .select('*').eq('remittance_id', remittanceId).order('created_at');
  if (error) throw Object.assign(new Error('listRemittanceLines: ' + error.message), { status: 500 });
  return ((data ?? []) as DbLineRow[]).map(toLineDto);
}

// ── List all lines (cross-remittance; for Lines tab in the Aurora page) ───────

export async function listAllRemittanceLines(opts: {
  authority?: RemittanceAuthority;
  periodYear?: number;
  periodMonth?: number;
  limit?: number;
} = {}): Promise<Array<RemittanceLineDto & { authority: RemittanceAuthority; periodYear: number; periodMonth: number; remittanceNo: string }>> {
  // Join lines → remittances to get authority and period context
  let q = sb.from('finance_remittance_lines')
    .select(`
      id, remittance_id, employee_id,
      employee_portion, employer_portion, line_total,
      source_line_id, metadata, created_at,
      finance_remittances!inner(
        remittance_no, authority, period_year, period_month
      )
    `)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 500);

  if (opts.authority)   q = q.eq('finance_remittances.authority', opts.authority);
  if (opts.periodYear)  q = q.eq('finance_remittances.period_year', opts.periodYear);
  if (opts.periodMonth) q = q.eq('finance_remittances.period_month', opts.periodMonth);

  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listAllRemittanceLines: ' + error.message), { status: 500 });

  type JoinedRemittance = {
    remittance_no: string;
    authority: string;
    period_year: number;
    period_month: number;
  };
  // Supabase JS returns joined rows as objects (many→one FK) but infers array type.
  // Use double-cast to apply our known shape.
  type JoinedRow = DbLineRow & { finance_remittances: JoinedRemittance };

  return ((data ?? []) as unknown as JoinedRow[]).map(r => ({
    ...toLineDto(r),
    authority: r.finance_remittances.authority as RemittanceAuthority,
    periodYear: r.finance_remittances.period_year,
    periodMonth: r.finance_remittances.period_month,
    remittanceNo: r.finance_remittances.remittance_no,
  }));
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
      await sb.from('finance_remittances').delete().eq('id', row.id);
      throw Object.assign(
        new Error('createRemittance lines: ' + lineErr.message + ' — remittance rolled back.'),
        { status: 500 },
      );
    }
  }

  // Backbone: app_event + hr_audit_log (compensate on failure)
  try {
    await emitFinanceMutationBackbone({
      actorUserId: input.actorId,
      module:      'finance_remittances',
      entityType:  'remittance',
      entityId:    row.id,
      eventType:   'finance.remittance.created',
      auditAction: 'remittance.created',
      severity:    'info',
      newState:    { status: 'draft', remittanceNo: row.remittanceNo, authority: row.authority },
      metadata: {
        remittanceNo: row.remittanceNo,
        authority:    row.authority,
        totalDue:     row.totalDue,
        periodYear:   row.periodYear,
        periodMonth:  row.periodMonth,
      },
    });
  } catch (bbErr) {
    // Compensating rollback: remove lines + header if backbone mandatory step failed
    await sb.from('finance_remittance_lines').delete().eq('remittance_id', row.id);
    await sb.from('finance_remittances').delete().eq('id', row.id);
    throw bbErr;
  }

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

  // Backbone: app_event + hr_audit_log; if it throws, roll back to draft
  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_remittances',
      entityType:    'remittance',
      entityId:      id,
      eventType:     'finance.remittance.submitted',
      auditAction:   'remittance.submitted',
      severity:      'info',
      previousState: { status: 'draft' },
      newState:      { status: 'submitted' },
      metadata: { authority: existing.authority, totalDue: existing.totalDue },
    });
  } catch (bbErr) {
    await sb.from('finance_remittances').update({ status: 'draft' }).eq('id', id);
    throw bbErr;
  }

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
    // Workflow start failed — roll back to draft (backbone already written; that's OK)
    await sb.from('finance_remittances').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(
      new Error('Workflow start failed — remittance rolled back to draft: ' + String(wfErr)),
      { status: 500 },
    );
  }

  return row;
}

// ── Approve (submitted → approved; SoD: creator ≠ approver) ──────────────────

export async function approveRemittance(
  id: string,
  actorId: string,
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted remittances can be approved.'), { status: 422 });
  }

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

  // Backbone; if it throws (audit failure), roll back
  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_remittances',
      entityType:    'remittance',
      entityId:      id,
      eventType:     'finance.remittance.approved',
      auditAction:   'remittance.approved',
      severity:      'success',
      previousState: { status: 'submitted' },
      newState:      { status: 'approved' },
      metadata:      { authority: existing.authority, totalDue: existing.totalDue },
      notification: {
        title:  `Remittance ${existing.remittanceNo} approved`,
        body:   `${existing.remittanceNo} (${existing.authority}) approved — ready for payment.`,
        type:   'finance.remittance.approved',
        actionRoute: `/finance/remittances/${id}`,
      },
    });
  } catch (bbErr) {
    await sb.from('finance_remittances').update({ status: 'submitted', approved_by: null }).eq('id', id);
    throw bbErr;
  }

  return row;
}

// ── Mark Paid (approved → paid) ───────────────────────────────────────────────

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

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_remittances',
      entityType:    'remittance',
      entityId:      id,
      eventType:     'finance.remittance.paid',
      auditAction:   'remittance.paid',
      severity:      'success',
      previousState: { status: 'approved' },
      newState:      { status: 'paid', paidDate },
      metadata:      { authority: existing.authority, paidDate, totalDue: existing.totalDue },
      notification: {
        title:  `Remittance ${existing.remittanceNo} paid`,
        body:   `${existing.remittanceNo} paid on ${paidDate} — ready for filing with the authority.`,
        type:   'finance.remittance.paid',
        actionRoute: `/finance/remittances/${id}`,
      },
    });
  } catch (bbErr) {
    await sb.from('finance_remittances')
      .update({ status: 'approved', paid_date: null, authority_reference: existing.authorityReference })
      .eq('id', id);
    throw bbErr;
  }

  return row;
}

// ── Mark Filed (paid → filed; full dialog fields per §12) ────────────────────

export interface MarkFiledInput {
  filedDate?: string;
  authorityReference?: string;
  filingMethod?: string;
  receiptReference?: string;
  filedNotes?: string;
}

export async function markRemittanceFiled(
  id: string,
  actorId: string,
  opts: MarkFiledInput = {},
): Promise<RemittanceDto> {
  const existing = await getRemittance(id);
  if (!existing) throw Object.assign(new Error('Remittance not found.'), { status: 404 });
  if (existing.status !== 'paid') {
    throw Object.assign(new Error('Only paid remittances can be marked filed.'), { status: 422 });
  }

  const filedDate = opts.filedDate ?? new Date().toISOString().slice(0, 10);

  // §12: raise a ticket when the filing is overdue OR has no receipt reference.
  const isOverdue      = !!(existing.dueDate && filedDate > existing.dueDate);
  const missingReceipt = !opts.receiptReference;
  const needsTicket    = isOverdue || missingReceipt;

  const patch: Record<string, unknown> = {
    status:              'filed',
    filed_date:          filedDate,
    authority_reference: opts.authorityReference ?? existing.authorityReference,
  };
  if (opts.filingMethod !== undefined)    patch['filing_method']     = opts.filingMethod;
  if (opts.receiptReference !== undefined) patch['receipt_reference'] = opts.receiptReference;
  if (opts.filedNotes !== undefined)      patch['filed_notes']        = opts.filedNotes;

  const { data, error } = await sb.from('finance_remittances')
    .update(patch)
    .eq('id', id).select().single<DbRemittanceRow>();
  if (error) throw Object.assign(new Error('markRemittanceFiled: ' + error.message), { status: 500 });
  const row = toDto(data);

  // Filed → notification to compliance + filing thread (§8.1)
  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_remittances',
      entityType:    'remittance',
      entityId:      id,
      eventType:     'finance.remittance.filed',
      auditAction:   'remittance.filed',
      severity:      'success',
      previousState: { status: 'paid' },
      newState:      { status: 'filed', filedDate, filingMethod: opts.filingMethod },
      metadata: {
        authority:        existing.authority,
        filedDate,
        filingMethod:     opts.filingMethod ?? null,
        receiptReference: opts.receiptReference ?? null,
        authorityReference: opts.authorityReference ?? existing.authorityReference,
      },
      notification: {
        title:      `${existing.remittanceNo} filed with authority`,
        body:       `${existing.authority.replace('_', '/')} remittance for ${existing.periodYear}-${String(existing.periodMonth).padStart(2,'0')} filed on ${filedDate}.`,
        type:       'finance.remittance.filed',
        actionRoute: `/finance/remittances/${id}`,
        severity:   'info',
        // Always notify the remittance creator (filing confirmation) so a
        // notifications row is written even when no event_rule matches this
        // event type. The creator gets confirmation their submission was filed.
        recipientUserIds: existing.createdBy ? [existing.createdBy] : [],
      },
      messageThread: {
        subject:            `${existing.remittanceNo} — Authority Filing`,
        participantUserIds: [actorId],
        body:               `Remittance ${existing.remittanceNo} (${existing.authority}) filed on ${filedDate}.${opts.receiptReference ? ` Receipt ref: ${opts.receiptReference}.` : ''}${opts.filedNotes ? ` Notes: ${opts.filedNotes}` : ''}`,
      },
      // §12: ticket only if filing is overdue or receipt reference is missing.
      ticket: needsTicket ? {
        category:        'finance_compliance',
        priority:        isOverdue ? 'high' as const : 'medium' as const,
        subject:         `${existing.remittanceNo} — ${isOverdue ? 'Overdue filing' : 'Missing receipt reference'}`,
        description:     [
          `Remittance ${existing.remittanceNo} (${existing.authority.replace(/_/g, '/')}) filed on ${filedDate}.`,
          isOverdue ? `Filing was overdue — due date was ${existing.dueDate}.` : '',
          missingReceipt ? 'No receipt reference was provided with this filing.' : '',
        ].filter(Boolean).join(' '),
        requesterUserId: actorId,
      } : undefined,
    });
  } catch (bbErr) {
    // Compensating rollback (audit failure = mandatory)
    await sb.from('finance_remittances')
      .update({ status: 'paid', filed_date: null, filing_method: null, receipt_reference: null, filed_notes: null })
      .eq('id', id);
    throw bbErr;
  }

  return row;
}

// ── Cancel (draft/submitted → cancelled) ─────────────────────────────────────

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

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_remittances',
      entityType:    'remittance',
      entityId:      id,
      eventType:     'finance.remittance.cancelled',
      auditAction:   'remittance.cancelled',
      severity:      'warning',
      previousState: { status: existing.status },
      newState:      { status: 'cancelled' },
      reason,
      metadata:      { reason },
    });
  } catch (bbErr) {
    // Compensating rollback
    await sb.from('finance_remittances')
      .update({ status: existing.status, cancelled_by: null, cancel_reason: null })
      .eq('id', id);
    throw bbErr;
  }

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
  employeePortion: number;
  employerPortion: number;
  dueDate: string | null;
  paidDate: string | null;
  filedDate: string | null;
  filingMethod: string | null;
  receiptReference: string | null;
  authorityReference: string | null;
  createdAt: string;
}

/** Internal list of all remittance rows in report format (used by all report types). */
async function fetchReportRows(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
}): Promise<RemittanceReportRow[]> {
  let q = sb.from('finance_remittances')
    .select(`
      id, remittance_no, period_year, period_month,
      authority, status, total_due, employee_portion, employer_portion,
      due_date, paid_date, filed_date,
      filing_method, receipt_reference, authority_reference,
      created_at
    `)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (opts.periodYear) q = q.eq('period_year', opts.periodYear);
  if (opts.authority)  q = q.eq('authority', opts.authority);
  if (opts.status)     q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('fetchReportRows: ' + error.message), { status: 500 });

  type Row = {
    id: string; remittance_no: string; period_year: number; period_month: number;
    authority: string; status: string;
    total_due: number; employee_portion: number; employer_portion: number;
    due_date: string | null; paid_date: string | null; filed_date: string | null;
    filing_method: string | null; receipt_reference: string | null; authority_reference: string | null;
    created_at: string;
  };

  return ((data ?? []) as Row[]).map(r => ({
    id: r.id, remittanceNo: r.remittance_no,
    periodYear: r.period_year, periodMonth: r.period_month,
    authority: r.authority, status: r.status,
    totalDue: Number(r.total_due),
    employeePortion: Number(r.employee_portion),
    employerPortion: Number(r.employer_portion),
    dueDate: r.due_date, paidDate: r.paid_date, filedDate: r.filed_date,
    filingMethod: r.filing_method ?? null,
    receiptReference: r.receipt_reference ?? null,
    authorityReference: r.authority_reference,
    createdAt: r.created_at,
  }));
}

/** remittance_summary — overall summary per authority + period */
export async function getRemittanceSummaryReport(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
} = {}): Promise<ReportResult> {
  const rows = await fetchReportRows(opts);
  return {
    report:      'remittance_summary',
    generatedAt: new Date().toISOString(),
    rows:        rows.map(r => ({
      remittanceNo:       r.remittanceNo,
      authority:          r.authority,
      period:             `${r.periodYear}-${String(r.periodMonth).padStart(2,'0')}`,
      status:             r.status,
      employeePortion:    r.employeePortion,
      employerPortion:    r.employerPortion,
      totalDue:           r.totalDue,
      dueDate:            r.dueDate ?? '—',
      paidDate:           r.paidDate ?? '—',
      filedDate:          r.filedDate ?? '—',
      authorityReference: r.authorityReference ?? '—',
    })),
  };
}

/** remittance_lines — per-employee breakdown across selected remittances */
export async function getRemittanceLinesReport(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
} = {}): Promise<ReportResult> {
  const linesData = await listAllRemittanceLines({
    authority:   opts.authority,
    periodYear:  opts.periodYear,
    limit:       2000,
  });
  return {
    report:      'remittance_lines',
    generatedAt: new Date().toISOString(),
    rows:        linesData.map(l => ({
      remittanceNo:    l.remittanceNo,
      authority:       l.authority,
      period:          `${l.periodYear}-${String(l.periodMonth).padStart(2,'0')}`,
      employeeId:      l.employeeId,
      employeePortion: l.employeePortion,
      employerPortion: l.employerPortion,
      lineTotal:       l.lineTotal,
    })),
  };
}

/** authority_filing_status — overview of each authority's filing status per period */
export async function getAuthorityFilingStatusReport(opts: {
  periodYear?: number;
} = {}): Promise<ReportResult> {
  const rows = await fetchReportRows({ periodYear: opts.periodYear });
  return {
    report:      'authority_filing_status',
    generatedAt: new Date().toISOString(),
    rows:        rows.map(r => ({
      remittanceNo:     r.remittanceNo,
      authority:        r.authority,
      period:           `${r.periodYear}-${String(r.periodMonth).padStart(2,'0')}`,
      status:           r.status,
      dueDate:          r.dueDate ?? '—',
      filedDate:        r.filedDate ?? '—',
      filingMethod:     r.filingMethod ?? '—',
      receiptReference: r.receiptReference ?? '—',
      overdue:          r.dueDate && !r.filedDate && r.dueDate < new Date().toISOString().slice(0, 10) ? 'YES' : 'NO',
    })),
  };
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export interface RemittanceAuditRow {
  id: string;
  actorId: string | null;
  action: string;
  previousState: unknown;
  newState: unknown;
  reason: string | null;
  createdAt: string;
}

export async function listRemittanceAudit(remittanceId: string): Promise<RemittanceAuditRow[]> {
  const { data, error } = await sb
    .from('hr_audit_log')
    .select('id, actor_id, action, previous_state, new_state, reason, created_at')
    .eq('submodule_key', 'finance_remittances')
    .eq('record_id', remittanceId)
    .order('created_at', { ascending: true });
  if (error) throw Object.assign(new Error('listRemittanceAudit: ' + error.message), { status: 500 });
  type Row = { id: string; actor_id: string | null; action: string; previous_state: unknown; new_state: unknown; reason: string | null; created_at: string };
  return ((data ?? []) as Row[]).map(r => ({
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    previousState: r.previous_state,
    newState: r.new_state,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** Legacy list format (kept for backwards-compat; Aurora FE uses the ReportResult variants above) */
export async function listRemittancesReport(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
} = {}): Promise<RemittanceReportRow[]> {
  return fetchReportRows(opts);
}
