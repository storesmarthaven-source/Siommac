// ============================================================================
// Finance -- Payroll Bank Disbursements (F2)
// ============================================================================
// Lifecycle: draft -> submitted -> approved -> file_generated -> paid
// Permissions: finance.disbursement.{view,manage,approve}

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import { notifyUsersByRole, createFinanceRecordThread } from './financeEvents';
import { createHandoff } from '../handoffBus';
import { createTicket } from '../communications';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

export type DisbursementStatus =
  | 'draft' | 'submitted' | 'approved' | 'file_generated' | 'paid' | 'cancelled';

export interface DisbursementDto {
  id: string;
  disbursementNo: string;
  payrollRunId: string;
  status: DisbursementStatus;
  totalAmount: number;
  employeeCount: number;
  bankFilePath: string | null;
  currency: string;
  approvedBy: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  workflowId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DisbursementLineDto {
  id: string;
  disbursementId: string;
  employeeId: string;
  bankAccountId: string | null;
  netAmount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ComputedDisbursement {
  payrollRunId: string;
  totalAmount: number;
  employeeCount: number;
  lines: Array<{
    employeeId: string;
    bankAccountId: string | null;
    accountNumberMasked: string | null;
    bankName: string | null;
    netAmount: number;
    hasBankAccount: boolean;
  }>;
  missingBankAccounts: string[];
}

interface DbDisbursementRow {
  id: string; disbursement_no: string; payroll_run_id: string; status: string;
  total_amount: number; employee_count: number; bank_file_path: string | null;
  currency: string; approved_by: string | null; created_by: string | null;
  cancelled_by: string | null; cancel_reason: string | null; workflow_id: string | null;
  metadata: Record<string, unknown>; created_at: string; updated_at: string;
}
interface DbLineRow {
  id: string; disbursement_id: string; employee_id: string;
  bank_account_id: string | null; net_amount: number;
  metadata: Record<string, unknown>; created_at: string;
}
function toDto(r: DbDisbursementRow): DisbursementDto {
  return { id: r.id, disbursementNo: r.disbursement_no, payrollRunId: r.payroll_run_id, status: r.status as DisbursementStatus, totalAmount: Number(r.total_amount), employeeCount: r.employee_count, bankFilePath: r.bank_file_path, currency: r.currency, approvedBy: r.approved_by, createdBy: r.created_by, cancelledBy: r.cancelled_by, cancelReason: r.cancel_reason, workflowId: r.workflow_id, metadata: r.metadata, createdAt: r.created_at, updatedAt: r.updated_at };
}
function toLineDto(r: DbLineRow): DisbursementLineDto {
  return { id: r.id, disbursementId: r.disbursement_id, employeeId: r.employee_id, bankAccountId: r.bank_account_id, netAmount: Number(r.net_amount), metadata: r.metadata, createdAt: r.created_at };
}

export async function computeFromRun(runId: string): Promise<ComputedDisbursement> {
  const { data: run, error: runErr } = await sb.from('finance_payroll_runs').select('id, run_no, status').eq('id', runId).maybeSingle<{ id: string; run_no: string; status: string }>();
  if (runErr) throw Object.assign(new Error('computeFromRun/run: ' + runErr.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  const ALLOWED = ['approved', 'locked', 'exported'];
  if (!ALLOWED.includes(run.status)) throw Object.assign(new Error('Payroll run must be approved or locked to compute a disbursement (current: ' + run.status + ').'), { status: 422 });
  const { data: payslips, error: pErr } = await sb.from('finance_payslips').select('employee_id, run_line_id').eq('run_id', runId);
  if (pErr) throw Object.assign(new Error('computeFromRun/payslips: ' + pErr.message), { status: 500 });
  const payslipList = (payslips ?? []) as Array<{ employee_id: string; run_line_id: string }>;
  if (payslipList.length === 0) throw Object.assign(new Error('No payslips found for this run. Generate payslips first.'), { status: 422 });
  const lineIds = payslipList.map(p => p.run_line_id).filter(Boolean);
  const { data: runLines, error: rlErr } = await sb.from('finance_payroll_run_lines').select('id, employee_id, net').in('id', lineIds);
  if (rlErr) throw Object.assign(new Error('computeFromRun/run-lines: ' + rlErr.message), { status: 500 });
  const netByEmpId = new Map<string, number>();
  for (const rl of (runLines ?? []) as Array<{ id: string; employee_id: string; net: number }>) {
    netByEmpId.set(rl.employee_id, Number(rl.net));
  }
  const employeeIds = payslipList.map(p => p.employee_id);
  const { data: bankAccts, error: baErr } = await sb.from('finance_employee_bank_accounts').select('employee_id, id, account_number_masked, bank_name').in('employee_id', employeeIds).eq('is_primary', true).eq('is_active', true);
  if (baErr) throw Object.assign(new Error('computeFromRun/bank-accounts: ' + baErr.message), { status: 500 });
  const bankByEmp = new Map<string, { id: string; employee_id: string; account_number_masked: string; bank_name: string }>();
  for (const ba of (bankAccts ?? []) as Array<{ id: string; employee_id: string; account_number_masked: string; bank_name: string }>) {
    bankByEmp.set(ba.employee_id, ba);
  }
  const lines = payslipList.map(p => {
    const net = netByEmpId.get(p.employee_id) ?? 0;
    const ba = bankByEmp.get(p.employee_id);
    return { employeeId: p.employee_id, bankAccountId: ba?.id ?? null, accountNumberMasked: ba?.account_number_masked ?? null, bankName: ba?.bank_name ?? null, netAmount: net, hasBankAccount: !!ba };
  });
  const missingBankAccounts = lines.filter(l => !l.hasBankAccount).map(l => l.employeeId);
  const totalAmount = lines.reduce((s, l) => s + l.netAmount, 0);
  return { payrollRunId: runId, totalAmount, employeeCount: lines.length, lines, missingBankAccounts };
}

export async function listDisbursements(opts: { payrollRunId?: string; status?: DisbursementStatus; } = {}): Promise<DisbursementDto[]> {
  let q = sb.from('finance_disbursements').select('*').order('created_at', { ascending: false });
  if (opts.payrollRunId) q = q.eq('payroll_run_id', opts.payrollRunId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listDisbursements: ' + error.message), { status: 500 });
  return ((data ?? []) as DbDisbursementRow[]).map(toDto);
}
export async function getDisbursement(id: string): Promise<DisbursementDto | null> {
  const { data, error } = await sb.from('finance_disbursements').select('*').eq('id', id).maybeSingle<DbDisbursementRow>();
  if (error) throw Object.assign(new Error('getDisbursement: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}
export async function listDisbursementLines(disbursementId: string): Promise<DisbursementLineDto[]> {
  const { data, error } = await sb.from('finance_disbursement_lines').select('*').eq('disbursement_id', disbursementId).order('created_at');
  if (error) throw Object.assign(new Error('listDisbursementLines: ' + error.message), { status: 500 });
  return ((data ?? []) as DbLineRow[]).map(toLineDto);
}

export async function createDisbursement(opts: { payrollRunId: string; actorId: string; currency?: string; metadata?: Record<string, unknown>; }): Promise<DisbursementDto> {
  const computed = await computeFromRun(opts.payrollRunId);
  if (computed.missingBankAccounts.length > 0) {
    // §8.1 — raise a ticket + thread so Finance is alerted to add missing bank accounts
    void createTicket({
      category:          'finance_admin',
      priority:          'high',
      subject:           'Missing bank accounts blocking disbursement',
      description:       `Disbursement compute for payroll run ${opts.payrollRunId} blocked: ` +
                         `${computed.missingBankAccounts.length} employee(s) have no active primary bank account. ` +
                         `Employee IDs: ${computed.missingBankAccounts.join(', ')}. ` +
                         `Please add primary bank accounts for these employees before retrying.`,
      requesterUserId:   opts.actorId,
      sourceModule:      'finance_disbursements',
      sourceEntityType:  'payroll_run',
      sourceEntityId:    opts.payrollRunId,
    });
    void createFinanceRecordThread({
      threadType:        'record',
      subject:           'Bank accounts missing — disbursement blocked',
      sourceModule:      'finance_disbursements',
      sourceEntityType:  'payroll_run',
      sourceEntityId:    opts.payrollRunId,
      createdBy:         opts.actorId,
      body:              `Disbursement compute blocked for payroll run ${opts.payrollRunId}. ` +
                         `${computed.missingBankAccounts.length} employee(s) have no primary bank account: ` +
                         `${computed.missingBankAccounts.join(', ')}. ` +
                         `Please add bank accounts and retry.`,
      notifyRole:        'finance_manager',
    });
    throw Object.assign(new Error(computed.missingBankAccounts.length + ' employee(s) have no primary bank account. All employees must have a primary bank account before creating a disbursement.'), { status: 422 });
  }
  const disbursementNo = await nextRef('DSB');
  const { data, error } = await sb.from('finance_disbursements').insert({ disbursement_no: disbursementNo, payroll_run_id: opts.payrollRunId, status: 'draft', total_amount: computed.totalAmount, employee_count: computed.employeeCount, currency: opts.currency ?? 'TTD', created_by: opts.actorId, metadata: opts.metadata ?? {} }).select().single<DbDisbursementRow>();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error('A disbursement for this payroll run already exists.'), { status: 409 });
    throw Object.assign(new Error('createDisbursement: ' + error.message), { status: 500 });
  }
  const row = toDto(data);
  const lineRows = computed.lines.map(l => ({ disbursement_id: row.id, employee_id: l.employeeId, bank_account_id: l.bankAccountId ?? null, net_amount: l.netAmount, metadata: {} }));
  if (lineRows.length > 0) {
    const { error: lineErr } = await sb.from('finance_disbursement_lines').insert(lineRows);
    if (lineErr) {
      await sb.from('finance_disbursements').delete().eq('id', row.id);
      throw Object.assign(new Error('createDisbursement/lines: ' + lineErr.message + ' -- disbursement rolled back.'), { status: 500 });
    }
  }
  void emitAppEvent({ eventType: 'finance.disbursement.created', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: row.id, actorUserId: opts.actorId, severity: 'info', payload: { disbursementNo: row.disbursementNo, totalAmount: row.totalAmount, employeeCount: row.employeeCount } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: row.id, actorId: opts.actorId, action: 'disbursement.created', previousState: null, newState: { status: 'draft', disbursementNo: row.disbursementNo, totalAmount: row.totalAmount } });
  return row;
}

export async function submitDisbursement(id: string, actorId: string): Promise<DisbursementDto> {
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (existing.status !== 'draft') throw Object.assign(new Error('Only draft disbursements can be submitted for approval.'), { status: 422 });
  const submittedMeta = { ...existing.metadata, submittedAt: new Date().toISOString() };
  const { data, error } = await sb.from('finance_disbursements').update({ status: 'submitted', metadata: submittedMeta }).eq('id', id).select().single<DbDisbursementRow>();
  if (error) throw Object.assign(new Error('submitDisbursement: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.disbursement.submitted', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { totalAmount: existing.totalAmount, employeeCount: existing.employeeCount } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.submitted', previousState: { status: 'draft' }, newState: { status: 'submitted' } });
  const ctx: ModuleWorkflowContext = { moduleKey: 'finance_disbursements', workflowType: 'finance_disbursement_approval', triggerEvent: 'finance.disbursement.submitted', sourceRecordId: id, sourceRecordRef: existing.disbursementNo, requestedBy: actorId, priority: 'normal', recordData: { disbursementNo: existing.disbursementNo, totalAmount: existing.totalAmount, employeeCount: existing.employeeCount } };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) await sb.from('finance_disbursements').update({ workflow_id: wf.id }).eq('id', id);
  } catch (wfErr) {
    await sb.from('finance_disbursements').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(new Error('Workflow start failed -- disbursement rolled back to draft: ' + String(wfErr)), { status: 500 });
  }
  return row;
}

export async function approveDisbursement(id: string, actorId: string): Promise<DisbursementDto> {
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (existing.status !== 'submitted') throw Object.assign(new Error('Only submitted disbursements can be approved.'), { status: 422 });
  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'approve a disbursement they created' });
  const approvedMeta = { ...existing.metadata, approvedAt: new Date().toISOString() };
  const { data, error } = await sb.from('finance_disbursements').update({ status: 'approved', approved_by: actorId, metadata: approvedMeta }).eq('id', id).select().single<DbDisbursementRow>();
  if (error) throw Object.assign(new Error('approveDisbursement: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.disbursement.approved', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { totalAmount: existing.totalAmount } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.approved', previousState: { status: 'submitted' }, newState: { status: 'approved' } });
  return row;
}

export async function generateBankFile(id: string, actorId: string): Promise<{ filePath: string; disbursement: DisbursementDto }> {
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (existing.status !== 'approved') throw Object.assign(new Error('Only approved disbursements can have a bank file generated.'), { status: 422 });
  const { data: lineData, error: lineErr } = await sb.from('finance_disbursement_lines').select('employee_id, bank_account_id, net_amount').eq('disbursement_id', id);
  if (lineErr) throw Object.assign(new Error('generateBankFile/lines: ' + lineErr.message), { status: 500 });
  const lines = (lineData ?? []) as Array<{ employee_id: string; bank_account_id: string | null; net_amount: number }>;
  const bankAccountIds = lines.map(l => l.bank_account_id).filter((v): v is string => !!v);
  const bankMap = new Map<string, { id: string; bank_name: string; branch: string | null; account_type: string; account_number: string }>();
  if (bankAccountIds.length > 0) {
    const { data: baData, error: baErr } = await sb.from('finance_employee_bank_accounts').select('id,bank_name,branch,account_type,account_number').in('id', bankAccountIds);
    if (baErr) throw Object.assign(new Error('generateBankFile/bank-accounts: ' + baErr.message), { status: 500 });
    for (const ba of (baData ?? []) as Array<{ id: string; bank_name: string; branch: string | null; account_type: string; account_number: string }>) {
      bankMap.set(ba.id, ba);
    }
  }
  const csvHeader = 'DisbursementNo,EmployeeId,BankName,Branch,AccountType,AccountNumber,NetAmount,Currency';
  const esc = (s: string) => s.includes(',') ? '"' + s + '"' : s;
  const csvRows = lines.map(l => {
    const ba = l.bank_account_id ? bankMap.get(l.bank_account_id) : undefined;
    return [existing.disbursementNo, l.employee_id, esc(ba?.bank_name ?? ''), esc(ba?.branch ?? ''), ba?.account_type ?? '', ba?.account_number ?? '', Number(l.net_amount).toFixed(2), existing.currency].join(',');
  });
  const csvContent = [csvHeader, ...csvRows].join('\n');
  const fileName = existing.disbursementNo + '-' + Date.now() + '.csv';
  const filePath = 'disbursements/' + fileName;
  const fileBytes = new TextEncoder().encode(csvContent);
  const { error: uploadErr } = await sb.storage.from('disbursements').upload(filePath, fileBytes, { contentType: 'text/csv', upsert: false });
  if (uploadErr) throw Object.assign(new Error('generateBankFile/upload: ' + uploadErr.message), { status: 500 });
  const generatedAt = new Date().toISOString();
  const fileMeta = { ...existing.metadata, fileGeneratedAt: generatedAt, fileGeneratedBy: actorId };
  const { data, error: updErr } = await sb.from('finance_disbursements').update({ status: 'file_generated', bank_file_path: filePath, metadata: fileMeta }).eq('id', id).select().single<DbDisbursementRow>();
  if (updErr) throw Object.assign(new Error('generateBankFile/update: ' + updErr.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.disbursement.file_generated', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { filePath, disbursementNo: existing.disbursementNo } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.file_generated', previousState: { status: 'approved' }, newState: { status: 'file_generated', filePath } });

  // §8.1 — notify Payment Operators (finance_manager) that the bank file is ready
  void notifyUsersByRole('finance_manager', {
    type:          'finance.disbursement.bank_file.ready',
    title:         `Bank file ready: ${existing.disbursementNo}`,
    body:          `Bank file generated for disbursement ${existing.disbursementNo}. ` +
                   `Total: ${existing.currency} ${Number(existing.totalAmount).toFixed(2)} · ` +
                   `${existing.employeeCount} employee(s). Download and submit to bank.`,
    module:        'finance_disbursements',
    severity:      'info',
    sourceType:    'disbursement',
    sourceId:      id,
    actionRoute:   '/finance/disbursements',
    actionRequired: true,
    dedupeKey:     `finance.disbursement.bank_file.ready:${id}`,
  });

  // §8.1 — execution thread so Payment Operators can discuss and track the file
  void createFinanceRecordThread({
    threadType:       'record',
    subject:          `Bank file ready: ${existing.disbursementNo}`,
    sourceModule:     'finance_disbursements',
    sourceEntityType: 'disbursement',
    sourceEntityId:   id,
    createdBy:        actorId,
    body:             `Bank file has been generated for disbursement ${existing.disbursementNo}. ` +
                      `Total: ${existing.currency} ${Number(existing.totalAmount).toFixed(2)} for ` +
                      `${existing.employeeCount} employee(s). File: ${filePath}. ` +
                      `Please download and submit to the bank for processing.`,
    notifyRole:       'finance_manager',
  });

  // §8.1 — handoff row signalling that bank file action is required
  void createHandoff({
    sourceModule:     'finance_disbursements',
    targetModule:     'finance_disbursements',
    sourceEntityType: 'disbursement',
    sourceEntityId:   id,
    targetEntityType: 'bank_file_action',
    payload:          {
      disbursementId:  id,
      disbursementNo:  existing.disbursementNo,
      bankFilePath:    filePath,
      totalAmount:     existing.totalAmount,
      employeeCount:   existing.employeeCount,
      currency:        existing.currency,
      generatedAt,
      generatedBy:     actorId,
    },
    createdBy:        actorId,
  });

  return { filePath, disbursement: row };
}

export async function markDisbursementPaid(id: string, actorId: string): Promise<DisbursementDto> {
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (existing.status !== 'file_generated') throw Object.assign(new Error('Only disbursements with a generated bank file can be marked paid.'), { status: 422 });
  const paidMeta = { ...existing.metadata, paidAt: new Date().toISOString() };
  const { data, error } = await sb.from('finance_disbursements').update({ status: 'paid', metadata: paidMeta }).eq('id', id).select().single<DbDisbursementRow>();
  if (error) throw Object.assign(new Error('markDisbursementPaid: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.disbursement.paid', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { totalAmount: existing.totalAmount, employeeCount: existing.employeeCount } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.paid', previousState: { status: 'file_generated' }, newState: { status: 'paid' } });
  return row;
}

export async function cancelDisbursement(id: string, actorId: string, reason: string): Promise<DisbursementDto> {
  if (!reason?.trim()) throw Object.assign(new Error('A reason is required to cancel a disbursement.'), { status: 422 });
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (!['draft', 'submitted'].includes(existing.status)) throw Object.assign(new Error('Only draft or submitted disbursements can be cancelled.'), { status: 422 });
  const { data, error } = await sb.from('finance_disbursements').update({ status: 'cancelled', cancelled_by: actorId, cancel_reason: reason }).eq('id', id).select().single<DbDisbursementRow>();
  if (error) throw Object.assign(new Error('cancelDisbursement: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.disbursement.cancelled', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { reason } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.cancelled', previousState: { status: existing.status }, newState: { status: 'cancelled' }, reason });
  return row;
}

// ── Bank-file signed URL ──────────────────────────────────────────────────────

/**
 * Generate a short-lived signed URL for downloading a disbursement bank file.
 * Emits `finance.disbursement.bank_file.downloaded` + hr_audit_log on every call.
 */
export async function getBankFileSignedUrl(
  disbursementId: string,
  actorId: string,
): Promise<{ signedUrl: string; disbursement: DisbursementDto }> {
  const disbursement = await getDisbursement(disbursementId);
  if (!disbursement) {
    throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  }
  if (!disbursement.bankFilePath) {
    throw Object.assign(new Error('No bank file has been generated for this disbursement.'), { status: 422 });
  }

  // Create a 5-minute signed URL for the storage object
  const { data: signedData, error: signedErr } = await sb.storage
    .from('disbursements')
    .createSignedUrl(disbursement.bankFilePath.replace(/^disbursements\//, ''), 300);

  if (signedErr || !signedData?.signedUrl) {
    throw Object.assign(
      new Error('getBankFileSignedUrl/signed-url: ' + (signedErr?.message ?? 'Unknown error')),
      { status: 500 },
    );
  }

  void emitAppEvent({
    eventType: 'finance.disbursement.bank_file.downloaded',
    sourceModule: 'finance_disbursements',
    sourceEntityType: 'disbursement',
    sourceEntityId: disbursementId,
    actorUserId: actorId,
    severity: 'info',
    payload: { disbursementNo: disbursement.disbursementNo, bankFilePath: disbursement.bankFilePath },
  });
  await writeHrAudit({
    submoduleKey: 'finance_disbursements',
    recordId: disbursementId,
    actorId,
    action: 'disbursement.bank_file.downloaded',
    previousState: null,
    newState: { bankFilePath: disbursement.bankFilePath },
  });

  return { signedUrl: signedData.signedUrl, disbursement };
}

// ── KPI aggregates for the Aurora page header ────────────────────────────────

export interface DisbursementKpis {
  pending: number;
  approved: number;
  fileGenerated: number;
  paidMtd: number;
  totalMtdAmount: number;
  missingBankAccountCount: number;
  failedLineCount: number;
  trend: Array<{ month: string; total: number; count: number }>;
}

export async function getDisbursementKpis(): Promise<DisbursementKpis> {
  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: rows, error } = await sb
    .from('finance_disbursements')
    .select('id,status,total_amount,created_at');
  if (error) throw Object.assign(new Error('getDisbursementKpis: ' + error.message), { status: 500 });

  const all = (rows ?? []) as Array<{ id: string; status: string; total_amount: number; created_at: string }>;

  const pending = all.filter(r => r.status === 'submitted').length;
  const approved = all.filter(r => r.status === 'approved').length;
  const fileGenerated = all.filter(r => r.status === 'file_generated').length;
  const paidMtd = all.filter(r => r.status === 'paid' && r.created_at >= mtdStart).length;
  const totalMtdAmount = all
    .filter(r => r.status === 'paid' && r.created_at >= mtdStart)
    .reduce((s, r) => s + Number(r.total_amount), 0);

  // Missing bank-account lines (employees with null bank_account_id)
  const { count: missingBankAccountCount } = await sb
    .from('finance_disbursement_lines')
    .select('id', { count: 'exact', head: true })
    .is('bank_account_id', null);

  // Build 6-month trend
  const trend: Array<{ month: string; total: number; count: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const monthStart = d.toISOString().slice(0, 7);
    const inMonth = all.filter(r => r.created_at.slice(0, 7) === monthStart && !['cancelled'].includes(r.status));
    trend.push({ month: label, total: inMonth.reduce((s, r) => s + Number(r.total_amount), 0), count: inMonth.length });
  }

  return {
    pending,
    approved,
    fileGenerated,
    paidMtd,
    totalMtdAmount,
    missingBankAccountCount: missingBankAccountCount ?? 0,
    failedLineCount: 0, // future: track line-level failures
    trend,
  };
}

// ── Disbursement lines with bank-account detail ──────────────────────────────

export interface DisbursementLineDetailDto extends DisbursementLineDto {
  accountNumberMasked: string | null;
  bankName: string | null;
}

export async function listDisbursementLinesDetail(
  disbursementId: string,
): Promise<DisbursementLineDetailDto[]> {
  const lines = await listDisbursementLines(disbursementId);
  if (lines.length === 0) return [];

  const bankIds = lines.map(l => l.bankAccountId).filter((v): v is string => v !== null);
  const bankMap = new Map<string, { account_number_masked: string; bank_name: string }>();
  if (bankIds.length > 0) {
    const { data: baRows, error: baErr } = await sb
      .from('finance_employee_bank_accounts')
      .select('id,account_number_masked,bank_name')
      .in('id', bankIds);
    if (baErr) throw Object.assign(new Error('listDisbursementLinesDetail/bank-accounts: ' + baErr.message), { status: 500 });
    for (const ba of (baRows ?? []) as Array<{ id: string; account_number_masked: string; bank_name: string }>) {
      bankMap.set(ba.id, ba);
    }
  }

  return lines.map(l => ({
    ...l,
    accountNumberMasked: l.bankAccountId ? (bankMap.get(l.bankAccountId)?.account_number_masked ?? null) : null,
    bankName: l.bankAccountId ? (bankMap.get(l.bankAccountId)?.bank_name ?? null) : null,
  }));
}

export interface DisbursementReportRow { id: string; disbursementNo: string; payrollRunId: string; status: string; totalAmount: number; employeeCount: number; currency: string; createdAt: string; }

export async function listDisbursementsReport(opts: { status?: DisbursementStatus; } = {}): Promise<DisbursementReportRow[]> {
  let q = sb.from('finance_disbursements').select('id,disbursement_no,payroll_run_id,status,total_amount,employee_count,currency,created_at').order('created_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listDisbursementsReport: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{ id: string; disbursement_no: string; payroll_run_id: string; status: string; total_amount: number; employee_count: number; currency: string; created_at: string; }>).map(r => ({ id: r.id, disbursementNo: r.disbursement_no, payrollRunId: r.payroll_run_id, status: r.status, totalAmount: Number(r.total_amount), employeeCount: r.employee_count, currency: r.currency, createdAt: r.created_at }));
}

// ── Audit log query ──────────────────────────────────────────────────────────

export interface DisbursementAuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export async function listDisbursementAuditLog(
  disbursementId: string,
): Promise<DisbursementAuditEntry[]> {
  return listFinanceAuditLog('finance_disbursements', disbursementId);
}

/**
 * General finance audit log query by submodule + record.
 * Used by all finance sub-tabs that show inline audit trails (disbursements, bank accounts, etc.).
 */
export async function listFinanceAuditLog(
  submoduleKey: string,
  recordId: string,
): Promise<DisbursementAuditEntry[]> {
  const { data, error } = await sb
    .from('hr_audit_log')
    .select('id,actor_id,action,previous_state,new_state,reason,created_at')
    .eq('submodule_key', submoduleKey)
    .eq('record_id', recordId)
    .order('created_at', { ascending: true });
  if (error) throw Object.assign(new Error(`listFinanceAuditLog(${submoduleKey}/${recordId}): ` + error.message), { status: 500 });
  return ((data ?? []) as Array<{
    id: string; actor_id: string | null; action: string;
    previous_state: Record<string, unknown> | null;
    new_state: Record<string, unknown> | null;
    reason: string | null; created_at: string;
  }>).map(r => ({
    id:            r.id,
    actorId:       r.actor_id,
    action:        r.action,
    previousState: r.previous_state,
    newState:      r.new_state,
    reason:        r.reason,
    createdAt:     r.created_at,
  }));
}

// ── Bank-file status report ──────────────────────────────────────────────────

export interface BankFileStatusRow {
  id: string;
  disbursementNo: string;
  status: string;
  totalAmount: number;
  employeeCount: number;
  currency: string;
  bankFilePath: string;
  fileGeneratedAt: string | null;
  fileGeneratedBy: string | null;
  createdAt: string;
}

/**
 * Disbursements that have a bank file (status = file_generated | paid).
 * Includes generated-by and generated-at from the metadata JSONB.
 */
export async function listBankFileStatusReport(): Promise<BankFileStatusRow[]> {
  const { data, error } = await sb
    .from('finance_disbursements')
    .select('id,disbursement_no,status,total_amount,employee_count,currency,bank_file_path,metadata,created_at')
    .not('bank_file_path', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw Object.assign(new Error('listBankFileStatusReport: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{
    id: string; disbursement_no: string; status: string; total_amount: number;
    employee_count: number; currency: string; bank_file_path: string;
    metadata: Record<string, unknown>; created_at: string;
  }>).map(r => ({
    id:              r.id,
    disbursementNo:  r.disbursement_no,
    status:          r.status,
    totalAmount:     Number(r.total_amount),
    employeeCount:   r.employee_count,
    currency:        r.currency,
    bankFilePath:    r.bank_file_path,
    fileGeneratedAt: (r.metadata?.fileGeneratedAt as string) ?? null,
    fileGeneratedBy: (r.metadata?.fileGeneratedBy as string) ?? null,
    createdAt:       r.created_at,
  }));
}

// ── Bank-account readiness report ────────────────────────────────────────────

export interface BankAccountReadinessRow {
  employeeId: string;
  fullName: string | null;
  email: string;
  hasPrimaryBankAccount: boolean;
}

/**
 * All active employees with a flag indicating whether they have an active
 * primary bank account. Rows where hasPrimaryBankAccount = false block disbursement.
 */
export async function listBankAccountReadinessReport(): Promise<BankAccountReadinessRow[]> {
  const [empRes, baRes] = await Promise.all([
    sb.from('app_users')
      .select('id,full_name,email')
      .eq('role', 'employee')
      .eq('status', 'active'),
    sb.from('finance_employee_bank_accounts')
      .select('employee_id')
      .eq('is_primary', true)
      .eq('is_active', true),
  ]);
  if (empRes.error) throw Object.assign(new Error('listBankAccountReadinessReport/emp: ' + empRes.error.message), { status: 500 });
  if (baRes.error)  throw Object.assign(new Error('listBankAccountReadinessReport/ba: '  + baRes.error.message),  { status: 500 });

  const empList = (empRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>;
  const baSet   = new Set((baRes.data  ?? []).map((r: { employee_id: string }) => r.employee_id));

  return empList.map(e => ({
    employeeId:           e.id,
    fullName:             e.full_name,
    email:                e.email,
    hasPrimaryBankAccount: baSet.has(e.id),
  }));
}
