// ============================================================================
// Finance -- Payroll Bank Disbursements (F2)
// ============================================================================
// Lifecycle: draft -> submitted -> approved -> file_generated -> paid
// Permissions: finance.disbursement.{view,manage,approve}

import { createHash } from 'crypto';
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
import {
  resolveBankCode, bankNameForCode, buildDirectCreditFile,
  type DirectCreditLine,
} from './bankFileFormats';

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

/** One generated per-bank direct-credit file within a disbursement (Wave 6). */
export interface DisbursementBankFileDto {
  id: string;
  disbursementId: string;
  bankName: string;
  bankCode: string;
  format: string;
  filePath: string;
  employeeCount: number;
  totalAmount: number;
  checksum: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface DbBankFileRow {
  id: string; disbursement_id: string; bank_name: string; bank_code: string;
  format: string; file_path: string; employee_count: number; total_amount: number;
  checksum: string | null; created_by: string | null; created_at: string;
}
function toBankFileDto(r: DbBankFileRow): DisbursementBankFileDto {
  return {
    id: r.id, disbursementId: r.disbursement_id, bankName: r.bank_name, bankCode: r.bank_code,
    format: r.format, filePath: r.file_path, employeeCount: r.employee_count,
    totalAmount: Number(r.total_amount), checksum: r.checksum, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** Strip a legacy `disbursements/` prefix so the value is a bucket-relative object key.
 *  New rows store clean keys; this keeps old rows signable too. */
function bucketKey(path: string): string {
  return path.replace(/^disbursements\//, '');
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
    // §8.1 — emit finance.disbursement.line.blocked event and notify Payroll + HR Admin
    void emitAppEvent({
      eventType:        'finance.disbursement.line.blocked',
      sourceModule:     'finance_disbursements',
      sourceEntityType: 'payroll_run',
      sourceEntityId:   opts.payrollRunId,
      actorUserId:      opts.actorId,
      severity:         'warning',
      payload: {
        payrollRunId:         opts.payrollRunId,
        missingBankAccounts:  computed.missingBankAccounts,
        missingCount:         computed.missingBankAccounts.length,
      },
    });
    void notifyUsersByRole('payroll_manager', {
      type:          'finance.disbursement.line.blocked',
      title:         'Disbursement blocked: missing bank accounts',
      body:          `Disbursement for payroll run ${opts.payrollRunId} is blocked. ` +
                     `${computed.missingBankAccounts.length} employee(s) have no primary bank account. ` +
                     `Add bank accounts and retry.`,
      module:        'finance_disbursements',
      severity:      'warning',
      sourceType:    'payroll_run',
      sourceId:      opts.payrollRunId,
      actionRoute:   '/finance/disbursements',
      actionRequired: true,
      dedupeKey:     `finance.disbursement.line.blocked:${opts.payrollRunId}`,
    });
    void notifyUsersByRole('hr_admin', {
      type:          'finance.disbursement.line.blocked',
      title:         'Disbursement blocked: missing bank accounts',
      body:          `Disbursement for payroll run ${opts.payrollRunId} is blocked. ` +
                     `${computed.missingBankAccounts.length} employee(s) have no primary bank account. ` +
                     `Update employee bank details.`,
      module:        'finance_disbursements',
      severity:      'warning',
      sourceType:    'payroll_run',
      sourceId:      opts.payrollRunId,
      actionRoute:   '/hr/employees',
      actionRequired: true,
      dedupeKey:     `finance.disbursement.line.blocked:${opts.payrollRunId}:hr_admin`,
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

/** Company legal name for the bank-file header (single-tenant; from the settings catalog). */
async function resolveCompanyName(): Promise<string> {
  const { data } = await sb.from('settings').select('value').eq('key', 'companyName').maybeSingle<{ value: unknown }>();
  const v = data?.value;
  return (typeof v === 'string' && v.trim()) ? v.trim() : 'Siomac';
}

/**
 * Generate PER-BANK direct-credit (ACH) files for an approved disbursement.
 * Net-pay lines are grouped by resolved bank code; one balanced H/D/T file is
 * built + uploaded per bank, one `finance_disbursement_bank_files` row is written
 * per bank, and a manifest listing every file is uploaded + recorded as the
 * disbursement's `bank_file_path`. Any partial failure is compensated (uploaded
 * objects + inserted rows are rolled back) so the disbursement stays 'approved'.
 */
export async function generateBankFile(id: string, actorId: string): Promise<{ filePath: string; disbursement: DisbursementDto; bankFiles: DisbursementBankFileDto[] }> {
  const existing = await getDisbursement(id);
  if (!existing) throw Object.assign(new Error('Disbursement not found.'), { status: 404 });
  if (existing.status !== 'approved') throw Object.assign(new Error('Only approved disbursements can have a bank file generated.'), { status: 422 });

  const { data: lineData, error: lineErr } = await sb.from('finance_disbursement_lines').select('employee_id, bank_account_id, net_amount').eq('disbursement_id', id);
  if (lineErr) throw Object.assign(new Error('generateBankFile/lines: ' + lineErr.message), { status: 500 });
  const allLines = (lineData ?? []) as Array<{ employee_id: string; bank_account_id: string | null; net_amount: number }>;

  // Only positive net-pay lines get a bank credit. Zero/negative lines are not disbursed.
  const payable = allLines.filter(l => Number(l.net_amount) > 0);
  if (payable.length === 0) throw Object.assign(new Error('No payable lines (all net amounts are zero) — nothing to disburse.'), { status: 422 });

  // Every payable line MUST have a bank account (no silent drop).
  const unbanked = payable.filter(l => !l.bank_account_id).map(l => l.employee_id);
  if (unbanked.length > 0) {
    throw Object.assign(new Error(`${unbanked.length} payable employee(s) have no bank account on their disbursement line: ${unbanked.join(', ')}. Recompute the disbursement after adding bank accounts.`), { status: 422 });
  }

  // Load raw bank-account detail (server-side only — account_number never leaves the server).
  const bankAccountIds = [...new Set(payable.map(l => l.bank_account_id as string))];
  const bankMap = new Map<string, { id: string; bank_name: string; branch: string | null; account_type: string; account_number: string; transit_number: string | null }>();
  const { data: baData, error: baErr } = await sb.from('finance_employee_bank_accounts').select('id,bank_name,branch,account_type,account_number,transit_number').in('id', bankAccountIds);
  if (baErr) throw Object.assign(new Error('generateBankFile/bank-accounts: ' + baErr.message), { status: 500 });
  for (const ba of (baData ?? []) as Array<{ id: string; bank_name: string; branch: string | null; account_type: string; account_number: string; transit_number: string | null }>) {
    bankMap.set(ba.id, ba);
  }

  // Group payable lines by resolved bank code.
  interface Group { bankCode: string; names: Set<string>; lines: DirectCreditLine[] }
  const groups = new Map<string, Group>();
  for (const l of payable) {
    const ba = bankMap.get(l.bank_account_id as string);
    if (!ba) throw Object.assign(new Error(`Bank account ${l.bank_account_id} not found while generating the bank file.`), { status: 500 });
    const bankCode = resolveBankCode(ba.bank_name);
    let g = groups.get(bankCode);
    if (!g) { g = { bankCode, names: new Set(), lines: [] }; groups.set(bankCode, g); }
    g.names.add(ba.bank_name);
    g.lines.push({
      transitNumber: ba.transit_number ?? null,
      accountNumber: ba.account_number,
      accountType:   ba.account_type,
      amount:        Number(l.net_amount),
      employeeRef:   l.employee_id,
    });
  }

  const companyName = await resolveCompanyName();
  const generatedAt = new Date().toISOString();
  const stamp = Date.now();
  const fileDate = generatedAt.slice(0, 10);

  // Track uploads + inserts so a mid-way failure can be fully compensated.
  const uploadedKeys: string[] = [];
  const insertedFileIds: string[] = [];
  const bankFiles: DisbursementBankFileDto[] = [];

  const rollback = async (): Promise<void> => {
    try { if (uploadedKeys.length) await sb.storage.from('disbursements').remove(uploadedKeys); } catch { /* best-effort */ }
    try { if (insertedFileIds.length) await sb.from('finance_disbursement_bank_files').delete().in('id', insertedFileIds); } catch { /* best-effort */ }
  };

  let updatedRow: DbDisbursementRow;
  const manifestKey = `${existing.disbursementNo}/manifest-${stamp}.csv`;
  try {
    for (const g of [...groups.values()].sort((a, b) => a.bankCode.localeCompare(b.bankCode))) {
      // Display name: canonical for a known code; the single source name (or 'Various') for OTHER.
      const bankName = g.bankCode !== 'OTHER'
        ? bankNameForCode(g.bankCode)
        : (g.names.size === 1 ? [...g.names][0]! : 'Various (unrecognised banks)');

      const built = buildDirectCreditFile({
        bankName, bankCode: g.bankCode, companyName, currency: existing.currency,
        fileDate, disbursementNo: existing.disbursementNo, lines: g.lines,
      });
      const checksum = createHash('sha256').update(built.content).digest('hex');
      const key = `${existing.disbursementNo}/${g.bankCode}-${stamp}.csv`;
      const { error: upErr } = await sb.storage.from('disbursements').upload(key, new TextEncoder().encode(built.content), { contentType: 'text/csv', upsert: true });
      if (upErr) throw Object.assign(new Error('generateBankFile/upload(' + g.bankCode + '): ' + upErr.message), { status: 500 });
      uploadedKeys.push(key);

      const { data: bfRow, error: bfErr } = await sb.from('finance_disbursement_bank_files').insert({
        disbursement_id: id, bank_name: bankName, bank_code: g.bankCode, format: 'direct_credit_csv',
        file_path: key, employee_count: built.employeeCount, total_amount: built.totalAmount,
        checksum, created_by: actorId,
      }).select().single<DbBankFileRow>();
      if (bfErr) throw Object.assign(new Error('generateBankFile/bank-file-row(' + g.bankCode + '): ' + bfErr.message), { status: 500 });
      insertedFileIds.push(bfRow.id);
      bankFiles.push(toBankFileDto(bfRow));

      void emitAppEvent({ eventType: 'finance.disbursement.bank_file.generated', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { disbursementNo: existing.disbursementNo, bankCode: g.bankCode, bankName, employeeCount: built.employeeCount, totalAmount: built.totalAmount, filePath: key } });
    }

    // Manifest listing every per-bank file (this is the disbursement's bank_file_path).
    const manifestHeader = 'BankCode,BankName,Employees,TotalAmount,Currency,FilePath,Checksum';
    const manifestEsc = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const manifestRows = bankFiles.map(bf => [bf.bankCode, manifestEsc(bf.bankName), String(bf.employeeCount), bf.totalAmount.toFixed(2), existing.currency, bf.filePath, bf.checksum ?? ''].join(','));
    const grandCount = bankFiles.reduce((s, bf) => s + bf.employeeCount, 0);
    const grandTotal = bankFiles.reduce((s, bf) => s + bf.totalAmount, 0);
    const manifestTotal = ['TOTAL', '', String(grandCount), grandTotal.toFixed(2), existing.currency, '', ''].join(',');
    const manifestContent = [manifestHeader, ...manifestRows, manifestTotal].join('\n');
    const { error: mErr } = await sb.storage.from('disbursements').upload(manifestKey, new TextEncoder().encode(manifestContent), { contentType: 'text/csv', upsert: true });
    if (mErr) throw Object.assign(new Error('generateBankFile/manifest-upload: ' + mErr.message), { status: 500 });
    uploadedKeys.push(manifestKey);

    const fileMeta = { ...existing.metadata, fileGeneratedAt: generatedAt, fileGeneratedBy: actorId, bankFileCount: bankFiles.length };
    const { data: updData, error: updErr } = await sb.from('finance_disbursements').update({ status: 'file_generated', bank_file_path: manifestKey, metadata: fileMeta }).eq('id', id).select().single<DbDisbursementRow>();
    if (updErr) throw Object.assign(new Error('generateBankFile/update: ' + updErr.message), { status: 500 });
    updatedRow = updData;
  } catch (e) {
    await rollback();
    throw e;
  }

  const filePath = manifestKey;
  const row = toDto(updatedRow);
  void emitAppEvent({ eventType: 'finance.disbursement.file_generated', sourceModule: 'finance_disbursements', sourceEntityType: 'disbursement', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { filePath, disbursementNo: existing.disbursementNo, bankFileCount: bankFiles.length } });
  await writeHrAudit({ submoduleKey: 'finance_disbursements', recordId: id, actorId, action: 'disbursement.file_generated', previousState: { status: 'approved' }, newState: { status: 'file_generated', filePath, bankFileCount: bankFiles.length } });

  // §8.1 — notify Payment Operators (finance_manager) that the bank file is ready
  void notifyUsersByRole('finance_manager', {
    type:          'finance.disbursement.bank_file.ready',
    title:         `Bank file ready: ${existing.disbursementNo}`,
    body:          `Bank file generated for disbursement ${existing.disbursementNo}. ` +
                   `Total: ${existing.currency} ${Number(existing.totalAmount).toFixed(2)} · ` +
                   `${existing.employeeCount} employee(s). Generic direct-credit format — verify your ` +
                   `bank's required layout before submitting.`,
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
                      `Files use the generic direct-credit layout — verify each bank's ` +
                      `required format before submitting for processing.`,
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

  return { filePath, disbursement: row, bankFiles };
}

// ── Per-bank file listing + signed-url download ───────────────────────────────

/** All generated per-bank direct-credit files for a disbursement. */
export async function listDisbursementBankFiles(disbursementId: string): Promise<DisbursementBankFileDto[]> {
  const { data, error } = await sb
    .from('finance_disbursement_bank_files')
    .select('*')
    .eq('disbursement_id', disbursementId)
    .order('bank_code', { ascending: true });
  if (error) throw Object.assign(new Error('listDisbursementBankFiles: ' + error.message), { status: 500 });
  return ((data ?? []) as DbBankFileRow[]).map(toBankFileDto);
}

/**
 * Short-lived signed URL for one per-bank direct-credit file.
 * Emits `finance.disbursement.bank_file.downloaded` + hr_audit_log on every call.
 */
export async function getDisbursementBankFileSignedUrl(
  bankFileId: string,
  actorId: string,
): Promise<{ signedUrl: string; bankFile: DisbursementBankFileDto }> {
  const { data: row, error } = await sb
    .from('finance_disbursement_bank_files')
    .select('*')
    .eq('id', bankFileId)
    .maybeSingle<DbBankFileRow>();
  if (error) throw Object.assign(new Error('getDisbursementBankFileSignedUrl: ' + error.message), { status: 500 });
  if (!row) throw Object.assign(new Error('Bank file not found.'), { status: 404 });

  const { data: signedData, error: signedErr } = await sb.storage
    .from('disbursements')
    .createSignedUrl(bucketKey(row.file_path), 300);
  if (signedErr || !signedData?.signedUrl) {
    throw Object.assign(new Error('getDisbursementBankFileSignedUrl/signed-url: ' + (signedErr?.message ?? 'Unknown error')), { status: 500 });
  }

  void emitAppEvent({
    eventType: 'finance.disbursement.bank_file.downloaded',
    sourceModule: 'finance_disbursements',
    sourceEntityType: 'disbursement',
    sourceEntityId: row.disbursement_id,
    actorUserId: actorId,
    severity: 'info',
    payload: { bankFileId, bankCode: row.bank_code, filePath: row.file_path },
  });
  await writeHrAudit({
    submoduleKey: 'finance_disbursements',
    recordId: row.disbursement_id,
    actorId,
    action: 'disbursement.bank_file.downloaded',
    previousState: null,
    newState: { bankFileId, bankCode: row.bank_code, filePath: row.file_path },
  });

  return { signedUrl: signedData.signedUrl, bankFile: toBankFileDto(row) };
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

  // Create a 5-minute signed URL for the storage object (the per-disbursement manifest)
  const { data: signedData, error: signedErr } = await sb.storage
    .from('disbursements')
    .createSignedUrl(bucketKey(disbursement.bankFilePath), 300);

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

  // Missing bank-account lines (employees with null bank_account_id across all lines)
  const { count: missingBankAccountCount } = await sb
    .from('finance_disbursement_lines')
    .select('id', { count: 'exact', head: true })
    .is('bank_account_id', null);

  // Failed lines: lines in non-paid/non-cancelled disbursements whose referenced
  // bank account has since been deactivated (payment can no longer proceed).
  let failedLineCount = 0;
  {
    const activeDisbIds = all
      .filter(r => !['paid', 'cancelled'].includes(r.status))
      .map(r => r.id);
    if (activeDisbIds.length > 0) {
      // Collect all bank account IDs referenced by active-disbursement lines
      const { data: lineRows } = await sb
        .from('finance_disbursement_lines')
        .select('bank_account_id')
        .in('disbursement_id', activeDisbIds)
        .not('bank_account_id', 'is', null);
      const bankAccountIds = ((lineRows ?? []) as Array<{ bank_account_id: string }>)
        .map(l => l.bank_account_id);
      if (bankAccountIds.length > 0) {
        // Count how many of those accounts are now inactive
        const { count: inactiveCount } = await sb
          .from('finance_employee_bank_accounts')
          .select('id', { count: 'exact', head: true })
          .in('id', bankAccountIds)
          .eq('is_active', false);
        failedLineCount = inactiveCount ?? 0;
      }
    }
  }

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
    failedLineCount,
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
