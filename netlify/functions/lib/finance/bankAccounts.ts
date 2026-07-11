// ============================================================================
// Finance -- Employee Bank Accounts (F2 prerequisite)
// ============================================================================
// CRUD for finance_employee_bank_accounts.
//
// Self-scope rule:
//   - An employee can only read/write their OWN bank accounts.
//   - finance_staff can VIEW any employee accounts (masked).
//   - finance_manager can view and manage any employee accounts.
// Masking: caller supplies the full number; we derive the masked form
// as '****' + last 4 chars and store both.
// Permissions: finance.bank_accounts.{view,manage}

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

export interface BankAccountDto {
  id: string;
  employeeId: string;
  bankName: string;
  branch: string | null;
  accountType: 'savings' | 'chequing';
  accountNumberMasked: string;
  transitNumber: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DbBankAccountRow {
  id: string;
  employee_id: string;
  bank_name: string;
  branch: string | null;
  account_type: string;
  account_number: string;
  account_number_masked: string;
  transit_number: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type SafeRow = Omit<DbBankAccountRow, 'account_number'>;

const SAFE_SELECT =
  'id,employee_id,bank_name,branch,account_type,account_number_masked,transit_number,' +
  'is_primary,is_active,created_by,metadata,created_at,updated_at';

function maskAccountNumber(full: string): string {
  const trimmed = full.replace(/\s/g, '');
  return '****' + trimmed.slice(-4);
}

function safeRowToDto(r: SafeRow): BankAccountDto {
  return {
    id:                  r.id,
    employeeId:          r.employee_id,
    bankName:            r.bank_name,
    branch:              r.branch,
    accountType:         r.account_type as 'savings' | 'chequing',
    accountNumberMasked: r.account_number_masked,
    transitNumber:       r.transit_number,
    isPrimary:           r.is_primary,
    isActive:            r.is_active,
    createdBy:           r.created_by,
    metadata:            r.metadata,
    createdAt:           r.created_at,
    updatedAt:           r.updated_at,
  };
}

export async function listBankAccounts(opts: {
  employeeId: string;
  includeInactive?: boolean;
}): Promise<BankAccountDto[]> {
  let q = sb
    .from('finance_employee_bank_accounts')
    .select(SAFE_SELECT)
    .eq('employee_id', opts.employeeId)
    .order('is_primary', { ascending: false })
    .order('created_at');
  if (!opts.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listBankAccounts: ' + error.message), { status: 500 });
  return ((data ?? []) as unknown as SafeRow[]).map(safeRowToDto);
}

export async function getBankAccount(
  id: string,
  ownerFilter?: string,
):  Promise<BankAccountDto | null> {
  const { data, error } = await sb
    .from('finance_employee_bank_accounts')
    .select(SAFE_SELECT)
    .eq('id', id)
    .maybeSingle<SafeRow>();
  if (error) throw Object.assign(new Error('getBankAccount: ' + error.message), { status: 500 });
  if (!data) return null;
  if (ownerFilter && data.employee_id !== ownerFilter) {
    throw Object.assign(
      new Error('Forbidden: you may only view your own bank accounts.'),
      { status: 403 },
    );
  }
  return safeRowToDto(data);
}

export async function getPrimaryBankAccountRaw(employeeId: string): Promise<{
  id: string;
  accountNumber: string;
  accountNumberMasked: string;
  bankName: string;
  branch: string | null;
  accountType: string;
} | null> {
  const { data, error } = await sb
    .from('finance_employee_bank_accounts')
    .select('id,bank_name,branch,account_type,account_number,account_number_masked')
    .eq('employee_id', employeeId)
    .eq('is_primary', true)
    .eq('is_active', true)
    .maybeSingle<Pick<DbBankAccountRow,
      'id'|'bank_name'|'branch'|'account_type'|'account_number'|'account_number_masked'>>();
  if (error) throw Object.assign(new Error('getPrimaryBankAccountRaw: ' + error.message), { status: 500 });
  if (!data) return null;
  return {
    id:                  data.id,
    accountNumber:       data.account_number,
    accountNumberMasked: data.account_number_masked,
    bankName:            data.bank_name,
    branch:              data.branch,
    accountType:         data.account_type,
  };
}

export interface UpsertBankAccountInput {
  id?: string;
  employeeId: string;
  bankName: string;
  branch?: string | null;
  accountType: 'savings' | 'chequing';
  accountNumber: string;
  transitNumber?: string | null;
  isPrimary?: boolean;
  metadata?: Record<string, unknown>;
  actorId: string;
}

export async function upsertBankAccount(
  input: UpsertBankAccountInput,
): Promise<BankAccountDto> {
  const masked = maskAccountNumber(input.accountNumber);
  const isPrimary = input.isPrimary !== false;
  const transitNumber = input.transitNumber?.trim() ? input.transitNumber.trim() : null;

  if (input.id) {
    const existing = await getBankAccount(input.id);
    if (!existing) throw Object.assign(new Error('Bank account not found.'), { status: 404 });
    if (existing.employeeId !== input.employeeId) {
      throw Object.assign(new Error('Forbidden: you may only update your own bank accounts.'), { status: 403 });
    }
    if (isPrimary) {
      const { error: clrErr } = await sb
        .from('finance_employee_bank_accounts')
        .update({ is_primary: false })
        .eq('employee_id', input.employeeId)
        .eq('is_primary', true)
        .neq('id', input.id);
      if (clrErr) throw Object.assign(new Error('upsertBankAccount/clear-primary: ' + clrErr.message), { status: 500 });
    }
    const { data, error } = await sb
      .from('finance_employee_bank_accounts')
      .update({
        bank_name: input.bankName, branch: input.branch ?? null,
        account_type: input.accountType, account_number: input.accountNumber,
        account_number_masked: masked, transit_number: transitNumber,
        is_primary: isPrimary, metadata: input.metadata ?? {},
      })
      .eq('id', input.id).select(SAFE_SELECT).single<SafeRow>();
    if (error) throw Object.assign(new Error('upsertBankAccount/update: ' + error.message), { status: 500 });
    void emitAppEvent({ eventType: 'finance.bank_account.updated', sourceModule: 'finance_bank_accounts', sourceEntityType: 'bank_account', sourceEntityId: input.id, actorUserId: input.actorId, severity: 'info', payload: { employeeId: input.employeeId, masked } });
    await writeHrAudit({ submoduleKey: 'finance_bank_accounts', recordId: input.id, actorId: input.actorId, action: 'bank_account.updated', previousState: { bankName: existing.bankName, masked: existing.accountNumberMasked }, newState: { bankName: input.bankName, masked } });
    return safeRowToDto(data);
  }

  if (isPrimary) {
    const { error: clrErr } = await sb.from('finance_employee_bank_accounts').update({ is_primary: false }).eq('employee_id', input.employeeId).eq('is_primary', true);
    if (clrErr) throw Object.assign(new Error('upsertBankAccount/clear-primary-new: ' + clrErr.message), { status: 500 });
  }
  const { data, error } = await sb.from('finance_employee_bank_accounts')
    .insert({ employee_id: input.employeeId, bank_name: input.bankName, branch: input.branch ?? null, account_type: input.accountType, account_number: input.accountNumber, account_number_masked: masked, transit_number: transitNumber, is_primary: isPrimary, is_active: true, created_by: input.actorId, metadata: input.metadata ?? {} })
    .select(SAFE_SELECT).single<SafeRow>();
  if (error) throw Object.assign(new Error('upsertBankAccount/insert: ' + error.message), { status: 500 });
  void emitAppEvent({ eventType: 'finance.bank_account.created', sourceModule: 'finance_bank_accounts', sourceEntityType: 'bank_account', sourceEntityId: data.id, actorUserId: input.actorId, severity: 'info', payload: { employeeId: input.employeeId, masked } });
  await writeHrAudit({ submoduleKey: 'finance_bank_accounts', recordId: data.id, actorId: input.actorId, action: 'bank_account.created', previousState: null, newState: { bankName: input.bankName, masked, accountType: input.accountType } });
  return safeRowToDto(data);
}

export async function deactivateBankAccount(
  id: string,
  actorId: string,
  callerEmployeeId?: string,
): Promise<BankAccountDto> {
  const existing = await getBankAccount(id);
  if (!existing) throw Object.assign(new Error('Bank account not found.'), { status: 404 });
  if (callerEmployeeId && existing.employeeId !== callerEmployeeId) {
    throw Object.assign(new Error('Forbidden: you may only deactivate your own bank accounts.'), { status: 403 });
  }
  if (!existing.isActive) {
    throw Object.assign(new Error('Bank account is already inactive.'), { status: 422 });
  }
  const { data, error } = await sb
    .from('finance_employee_bank_accounts')
    .update({ is_active: false, is_primary: false })
    .eq('id', id).select(SAFE_SELECT).single<SafeRow>();
  if (error) throw Object.assign(new Error('deactivateBankAccount: ' + error.message), { status: 500 });
  void emitAppEvent({ eventType: 'finance.bank_account.deactivated', sourceModule: 'finance_bank_accounts', sourceEntityType: 'bank_account', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { employeeId: existing.employeeId } });
  await writeHrAudit({ submoduleKey: 'finance_bank_accounts', recordId: id, actorId, action: 'bank_account.deactivated', previousState: { isActive: true }, newState: { isActive: false } });
  return safeRowToDto(data);
}
