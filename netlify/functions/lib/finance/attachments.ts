/**
 * netlify/functions/lib/finance/attachments.ts
 *
 * Shared attachment helpers for Finance Wave 2B modules.
 * Provides presigned-upload URL generation and metadata-row management for:
 *   - Expense claim attachments    (finance_expense_attachments)
 *   - Remittance attachments       (finance_remittance_attachments)
 *   - Disbursement attachments     (finance_disbursement_attachments)
 *   - Budget-line attachments      (finance_budget_attachments)
 *   - Payroll-run attachments      (finance_payroll_attachments)
 *
 * All file bytes go directly from the browser to Supabase Storage via a
 * presigned PUT URL — the Lambda never holds file data. The caller:
 *   1. Calls get*AttachmentUploadUrl() to receive the presigned URL + storage path.
 *   2. PUTs the raw file bytes to `uploadUrl` from the browser.
 *   3. Calls commit*Attachment() with the returned `storagePath` so the DB row is written.
 *   4. Calls getFinanceAttachmentSignedUrl(storagePath) to generate a read URL.
 *
 * All modules share the 'finance-receipts' private bucket (created in
 * supabase/migrations/20260917000040_finance_2b_foundation.sql).
 *
 * Per-entity attachment tables for disbursement/budget/payroll are created in
 * supabase/migrations/20260917000050_finance_2b_attachment_tables.sql.
 *
 * Exported:
 *   FINANCE_ATTACHMENT_BUCKET
 *   getFinanceAttachmentSignedUrl(storagePath, expiresInSeconds?)
 *   --- Expense ---
 *   getExpenseAttachmentUploadUrl(fileName, mimeType)
 *   commitExpenseAttachment(claimId, input, actorId)
 *   listExpenseAttachments(claimId)
 *   deleteExpenseAttachment(id, claimId, actorId)
 *   --- Remittance ---
 *   getRemittanceAttachmentUploadUrl(fileName, mimeType)
 *   commitRemittanceAttachment(remittanceId, input, actorId)
 *   listRemittanceAttachments(remittanceId)
 *   deleteRemittanceAttachment(id, remittanceId, actorId)
 *   --- Disbursement ---
 *   getDisbursementAttachmentUploadUrl(fileName, mimeType)
 *   commitDisbursementAttachment(disbursementId, input, actorId)
 *   listDisbursementAttachments(disbursementId)
 *   deleteDisbursementAttachment(id, disbursementId, actorId)
 *   --- Budget ---
 *   getBudgetAttachmentUploadUrl(fileName, mimeType)
 *   commitBudgetAttachment(budgetLineId, input, actorId)
 *   listBudgetAttachments(budgetLineId)
 *   deleteBudgetAttachment(id, budgetLineId, actorId)
 *   --- Payroll ---
 *   getPayrollAttachmentUploadUrl(fileName, mimeType)
 *   commitPayrollAttachment(runId, input, actorId)
 *   listPayrollAttachments(runId)
 *   deletePayrollAttachment(id, runId, actorId)
 */

import { sb } from '../db';
import { createAttachmentUploadUrl, type UploadUrlResult } from '../upload';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

export const FINANCE_ATTACHMENT_BUCKET = 'finance-receipts';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface AttachmentDto {
  id:          string;
  fileName:    string;
  fileSize:    number | null;
  contentType: string | null;
  storagePath: string;
  uploadedBy:  string | null;
  createdAt:   string;
}

export interface CommitAttachmentInput {
  fileName:    string;
  storagePath: string;
  mimeType?:   string | null;
  fileSize?:   number | null;
}

export interface AttachmentUploadUrlResult extends UploadUrlResult {
  bucket: string;
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface DbExpenseAttachment {
  id: string; claim_id: string; file_name: string; file_size: number | null;
  content_type: string | null; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

interface DbRemittanceAttachment {
  id: string; remittance_id: string; file_name: string; file_size: number | null;
  content_type: string | null; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

// Structural base — the fields all attachment DB rows share.
// Each entity's DB row type extends this implicitly; we accept any matching shape.
type DbAttachmentBase = {
  id: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
};

function toAttachmentDto(r: DbAttachmentBase): AttachmentDto {
  return {
    id:          r.id,
    fileName:    r.file_name,
    fileSize:    r.file_size,
    contentType: r.content_type,
    storagePath: r.storage_path,
    uploadedBy:  r.uploaded_by,
    createdAt:   r.created_at,
  };
}

// ── Shared upload URL helper ──────────────────────────────────────────────────

async function getAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  const result = await createAttachmentUploadUrl(
    FINANCE_ATTACHMENT_BUCKET,
    fileName,
    mimeType,
  );
  return { ...result, bucket: FINANCE_ATTACHMENT_BUCKET };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Expense-claim attachments
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a presigned upload URL for a new expense claim attachment.
 * The client PUTs raw bytes to `uploadUrl` then calls commitExpenseAttachment.
 */
export async function getExpenseAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  return getAttachmentUploadUrl(fileName, mimeType);
}

/**
 * Write the metadata row after the client has successfully uploaded the file.
 * Emits app_event + audit log.
 */
export async function commitExpenseAttachment(
  claimId: string,
  input: CommitAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  const { data, error } = await sb
    .from('finance_expense_attachments')
    .insert({
      claim_id:     claimId,
      file_name:    input.fileName,
      file_size:    input.fileSize ?? null,
      content_type: input.mimeType ?? null,
      storage_path: input.storagePath,
      uploaded_by:  actorId,
    })
    .select()
    .single<DbExpenseAttachment>();

  if (error) {
    throw Object.assign(
      new Error(`commitExpenseAttachment: ${error.message}`),
      { status: 500 },
    );
  }

  const row = toAttachmentDto(data);

  void emitAppEvent({
    eventType:        'finance.expense.attachment_added',
    sourceModule:     'finance_expenses',
    sourceEntityType: 'expense_claim',
    sourceEntityId:   claimId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { attachmentId: row.id, fileName: row.fileName },
  });
  await writeHrAudit({
    submoduleKey:  'finance_expenses',
    recordId:      claimId,
    actorId,
    action:        'expense.attachment_added',
    previousState: null,
    newState:      { attachmentId: row.id, fileName: row.fileName, storagePath: row.storagePath },
  });

  return row;
}

/**
 * List all attachment metadata rows for an expense claim (newest first).
 */
export async function listExpenseAttachments(claimId: string): Promise<AttachmentDto[]> {
  const { data, error } = await sb
    .from('finance_expense_attachments')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: false })
    .returns<DbExpenseAttachment[]>();

  if (error) {
    throw Object.assign(
      new Error(`listExpenseAttachments: ${error.message}`),
      { status: 500 },
    );
  }

  return (data ?? []).map(toAttachmentDto);
}

/**
 * Remove an attachment row and the underlying storage object.
 * Fails if the attachment does not belong to the specified claim (prevents
 * cross-claim deletions).
 */
export async function deleteExpenseAttachment(
  id: string,
  claimId: string,
  actorId: string,
): Promise<void> {
  // Fetch first so we know the storage path and can verify ownership
  const { data: existing, error: fetchErr } = await sb
    .from('finance_expense_attachments')
    .select('id, storage_path, file_name')
    .eq('id', id)
    .eq('claim_id', claimId)
    .maybeSingle<Pick<DbExpenseAttachment, 'id' | 'storage_path' | 'file_name'>>();

  if (fetchErr) {
    throw Object.assign(new Error(`deleteExpenseAttachment: ${fetchErr.message}`), { status: 500 });
  }
  if (!existing) {
    throw Object.assign(new Error('Attachment not found on this claim.'), { status: 404 });
  }

  // Delete storage object first (compensating: if this fails the DB row stays, retry possible)
  const { error: storageErr } = await sb.storage
    .from(FINANCE_ATTACHMENT_BUCKET)
    .remove([existing.storage_path]);
  if (storageErr) {
    throw Object.assign(
      new Error(`Failed to remove file from storage: ${storageErr.message}`),
      { status: 500 },
    );
  }

  // Delete DB row
  const { error: delErr } = await sb
    .from('finance_expense_attachments')
    .delete()
    .eq('id', id)
    .eq('claim_id', claimId);

  if (delErr) {
    throw Object.assign(new Error(`deleteExpenseAttachment DB: ${delErr.message}`), { status: 500 });
  }

  void emitAppEvent({
    eventType:        'finance.expense.attachment_removed',
    sourceModule:     'finance_expenses',
    sourceEntityType: 'expense_claim',
    sourceEntityId:   claimId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { attachmentId: id, fileName: existing.file_name },
  });
  await writeHrAudit({
    submoduleKey:  'finance_expenses',
    recordId:      claimId,
    actorId,
    action:        'expense.attachment_removed',
    previousState: { attachmentId: id, storagePath: existing.storage_path },
    newState:      null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Remittance attachments
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a presigned upload URL for a new remittance attachment.
 */
export async function getRemittanceAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  return getAttachmentUploadUrl(fileName, mimeType);
}

/**
 * Write the metadata row after the client uploads a remittance document.
 */
export async function commitRemittanceAttachment(
  remittanceId: string,
  input: CommitAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  const { data, error } = await sb
    .from('finance_remittance_attachments')
    .insert({
      remittance_id: remittanceId,
      file_name:     input.fileName,
      file_size:     input.fileSize ?? null,
      content_type:  input.mimeType ?? null,
      storage_path:  input.storagePath,
      uploaded_by:   actorId,
    })
    .select()
    .single<DbRemittanceAttachment>();

  if (error) {
    throw Object.assign(
      new Error(`commitRemittanceAttachment: ${error.message}`),
      { status: 500 },
    );
  }

  const row = toAttachmentDto(data);

  void emitAppEvent({
    eventType:        'finance.remittance.attachment_added',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   remittanceId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { attachmentId: row.id, fileName: row.fileName },
  });
  await writeHrAudit({
    submoduleKey:  'finance_remittances',
    recordId:      remittanceId,
    actorId,
    action:        'remittance.attachment_added',
    previousState: null,
    newState:      { attachmentId: row.id, fileName: row.fileName, storagePath: row.storagePath },
  });

  return row;
}

/**
 * List attachment metadata rows for a remittance (newest first).
 */
export async function listRemittanceAttachments(remittanceId: string): Promise<AttachmentDto[]> {
  const { data, error } = await sb
    .from('finance_remittance_attachments')
    .select('*')
    .eq('remittance_id', remittanceId)
    .order('created_at', { ascending: false })
    .returns<DbRemittanceAttachment[]>();

  if (error) {
    throw Object.assign(
      new Error(`listRemittanceAttachments: ${error.message}`),
      { status: 500 },
    );
  }

  return (data ?? []).map(toAttachmentDto);
}

/**
 * Remove a remittance attachment row and storage object.
 */
export async function deleteRemittanceAttachment(
  id: string,
  remittanceId: string,
  actorId: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await sb
    .from('finance_remittance_attachments')
    .select('id, storage_path, file_name')
    .eq('id', id)
    .eq('remittance_id', remittanceId)
    .maybeSingle<Pick<DbRemittanceAttachment, 'id' | 'storage_path' | 'file_name'>>();

  if (fetchErr) {
    throw Object.assign(new Error(`deleteRemittanceAttachment: ${fetchErr.message}`), { status: 500 });
  }
  if (!existing) {
    throw Object.assign(new Error('Attachment not found on this remittance.'), { status: 404 });
  }

  const { error: storageErr } = await sb.storage
    .from(FINANCE_ATTACHMENT_BUCKET)
    .remove([existing.storage_path]);
  if (storageErr) {
    throw Object.assign(
      new Error(`Failed to remove file from storage: ${storageErr.message}`),
      { status: 500 },
    );
  }

  const { error: delErr } = await sb
    .from('finance_remittance_attachments')
    .delete()
    .eq('id', id)
    .eq('remittance_id', remittanceId);

  if (delErr) {
    throw Object.assign(new Error(`deleteRemittanceAttachment DB: ${delErr.message}`), { status: 500 });
  }

  void emitAppEvent({
    eventType:        'finance.remittance.attachment_removed',
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   remittanceId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { attachmentId: id, fileName: existing.file_name },
  });
  await writeHrAudit({
    submoduleKey:  'finance_remittances',
    recordId:      remittanceId,
    actorId,
    action:        'remittance.attachment_removed',
    previousState: { attachmentId: id, storagePath: existing.storage_path },
    newState:      null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared signed-URL helper (read access for all entity types)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a short-lived signed URL for downloading a Finance attachment.
 * The route enforces the appropriate view permission before calling this.
 *
 * @param storagePath  storage_path column value from the attachment row
 * @param expiresIn    TTL in seconds (default: 300 = 5 minutes)
 */
export async function getFinanceAttachmentSignedUrl(
  storagePath:  string,
  expiresIn:    number = 300,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(FINANCE_ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) {
    throw Object.assign(
      new Error(`getFinanceAttachmentSignedUrl: ${error?.message ?? 'unknown'}`),
      { status: 500 },
    );
  }
  return data.signedUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Disbursement attachments — finance_disbursement_attachments
// (table created by 20260917000050_finance_2b_attachment_tables.sql)
// ═══════════════════════════════════════════════════════════════════════════════

interface DbDisbursementAttachment {
  id: string; disbursement_id: string; file_name: string; file_size: number | null;
  content_type: string | null; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

export async function getDisbursementAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  return getAttachmentUploadUrl(fileName, mimeType);
}

export async function commitDisbursementAttachment(
  disbursementId: string,
  input: CommitAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  const { data, error } = await sb
    .from('finance_disbursement_attachments')
    .insert({
      disbursement_id: disbursementId,
      file_name:       input.fileName,
      file_size:       input.fileSize ?? null,
      content_type:    input.mimeType ?? null,
      storage_path:    input.storagePath,
      uploaded_by:     actorId,
    })
    .select()
    .single<DbDisbursementAttachment>();

  if (error) {
    throw Object.assign(
      new Error(`commitDisbursementAttachment: ${error.message}`),
      { status: 500 },
    );
  }

  const row = toAttachmentDto(data);

  void emitAppEvent({
    eventType:        'finance.disbursement.attachment_added',
    sourceModule:     'finance_disbursements',
    sourceEntityType: 'disbursement',
    sourceEntityId:   disbursementId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { attachmentId: row.id, fileName: row.fileName },
  });
  await writeHrAudit({
    submoduleKey:  'finance_disbursements',
    recordId:      disbursementId,
    actorId,
    action:        'disbursement.attachment_added',
    previousState: null,
    newState:      { attachmentId: row.id, fileName: row.fileName, storagePath: row.storagePath },
  });

  return row;
}

export async function listDisbursementAttachments(disbursementId: string): Promise<AttachmentDto[]> {
  const { data, error } = await sb
    .from('finance_disbursement_attachments')
    .select('*')
    .eq('disbursement_id', disbursementId)
    .order('created_at', { ascending: false })
    .returns<DbDisbursementAttachment[]>();

  if (error) {
    throw Object.assign(new Error(`listDisbursementAttachments: ${error.message}`), { status: 500 });
  }
  return (data ?? []).map(toAttachmentDto);
}

export async function deleteDisbursementAttachment(
  id: string,
  disbursementId: string,
  actorId: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await sb
    .from('finance_disbursement_attachments')
    .select('id, storage_path, file_name')
    .eq('id', id)
    .eq('disbursement_id', disbursementId)
    .maybeSingle<Pick<DbDisbursementAttachment, 'id' | 'storage_path' | 'file_name'>>();

  if (fetchErr) throw Object.assign(new Error(`deleteDisbursementAttachment: ${fetchErr.message}`), { status: 500 });
  if (!existing) throw Object.assign(new Error('Attachment not found on this disbursement.'), { status: 404 });

  const { error: storageErr } = await sb.storage.from(FINANCE_ATTACHMENT_BUCKET).remove([existing.storage_path]);
  if (storageErr) throw Object.assign(new Error(`Failed to remove file from storage: ${storageErr.message}`), { status: 500 });

  const { error: delErr } = await sb
    .from('finance_disbursement_attachments').delete()
    .eq('id', id).eq('disbursement_id', disbursementId);
  if (delErr) throw Object.assign(new Error(`deleteDisbursementAttachment DB: ${delErr.message}`), { status: 500 });

  void emitAppEvent({
    eventType: 'finance.disbursement.attachment_removed', sourceModule: 'finance_disbursements',
    sourceEntityType: 'disbursement', sourceEntityId: disbursementId,
    actorUserId: actorId, severity: 'info',
    payload: { attachmentId: id, fileName: existing.file_name },
  });
  await writeHrAudit({
    submoduleKey: 'finance_disbursements', recordId: disbursementId, actorId,
    action: 'disbursement.attachment_removed',
    previousState: { attachmentId: id, storagePath: existing.storage_path }, newState: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Budget-line attachments — finance_budget_attachments
// (table created by 20260917000050_finance_2b_attachment_tables.sql)
// ═══════════════════════════════════════════════════════════════════════════════

interface DbBudgetAttachment {
  id: string; budget_line_id: string; file_name: string; file_size: number | null;
  content_type: string | null; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

export async function getBudgetAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  return getAttachmentUploadUrl(fileName, mimeType);
}

export async function commitBudgetAttachment(
  budgetLineId: string,
  input: CommitAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  const { data, error } = await sb
    .from('finance_budget_attachments')
    .insert({
      budget_line_id: budgetLineId,
      file_name:      input.fileName,
      file_size:      input.fileSize ?? null,
      content_type:   input.mimeType ?? null,
      storage_path:   input.storagePath,
      uploaded_by:    actorId,
    })
    .select()
    .single<DbBudgetAttachment>();

  if (error) {
    throw Object.assign(new Error(`commitBudgetAttachment: ${error.message}`), { status: 500 });
  }

  const row = toAttachmentDto(data);

  void emitAppEvent({
    eventType: 'finance.budget.attachment_added', sourceModule: 'finance_budgets',
    sourceEntityType: 'budget_line', sourceEntityId: budgetLineId,
    actorUserId: actorId, severity: 'info',
    payload: { attachmentId: row.id, fileName: row.fileName },
  });
  await writeHrAudit({
    submoduleKey: 'finance_budgets', recordId: budgetLineId, actorId,
    action: 'budget.attachment_added',
    previousState: null,
    newState: { attachmentId: row.id, fileName: row.fileName, storagePath: row.storagePath },
  });

  return row;
}

export async function listBudgetAttachments(budgetLineId: string): Promise<AttachmentDto[]> {
  const { data, error } = await sb
    .from('finance_budget_attachments')
    .select('*')
    .eq('budget_line_id', budgetLineId)
    .order('created_at', { ascending: false })
    .returns<DbBudgetAttachment[]>();

  if (error) throw Object.assign(new Error(`listBudgetAttachments: ${error.message}`), { status: 500 });
  return (data ?? []).map(toAttachmentDto);
}

export async function deleteBudgetAttachment(
  id: string,
  budgetLineId: string,
  actorId: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await sb
    .from('finance_budget_attachments')
    .select('id, storage_path, file_name')
    .eq('id', id).eq('budget_line_id', budgetLineId)
    .maybeSingle<Pick<DbBudgetAttachment, 'id' | 'storage_path' | 'file_name'>>();

  if (fetchErr) throw Object.assign(new Error(`deleteBudgetAttachment: ${fetchErr.message}`), { status: 500 });
  if (!existing) throw Object.assign(new Error('Attachment not found on this budget line.'), { status: 404 });

  const { error: storageErr } = await sb.storage.from(FINANCE_ATTACHMENT_BUCKET).remove([existing.storage_path]);
  if (storageErr) throw Object.assign(new Error(`Failed to remove file from storage: ${storageErr.message}`), { status: 500 });

  const { error: delErr } = await sb
    .from('finance_budget_attachments').delete()
    .eq('id', id).eq('budget_line_id', budgetLineId);
  if (delErr) throw Object.assign(new Error(`deleteBudgetAttachment DB: ${delErr.message}`), { status: 500 });

  void emitAppEvent({
    eventType: 'finance.budget.attachment_removed', sourceModule: 'finance_budgets',
    sourceEntityType: 'budget_line', sourceEntityId: budgetLineId,
    actorUserId: actorId, severity: 'info',
    payload: { attachmentId: id, fileName: existing.file_name },
  });
  await writeHrAudit({
    submoduleKey: 'finance_budgets', recordId: budgetLineId, actorId,
    action: 'budget.attachment_removed',
    previousState: { attachmentId: id, storagePath: existing.storage_path }, newState: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Payroll-run attachments — finance_payroll_attachments
// (table created by 20260917000050_finance_2b_attachment_tables.sql)
// ═══════════════════════════════════════════════════════════════════════════════

interface DbPayrollAttachment {
  id: string; run_id: string; file_name: string; file_size: number | null;
  content_type: string | null; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

export async function getPayrollAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<AttachmentUploadUrlResult> {
  return getAttachmentUploadUrl(fileName, mimeType);
}

export async function commitPayrollAttachment(
  runId: string,
  input: CommitAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  const { data, error } = await sb
    .from('finance_payroll_attachments')
    .insert({
      run_id:       runId,
      file_name:    input.fileName,
      file_size:    input.fileSize ?? null,
      content_type: input.mimeType ?? null,
      storage_path: input.storagePath,
      uploaded_by:  actorId,
    })
    .select()
    .single<DbPayrollAttachment>();

  if (error) throw Object.assign(new Error(`commitPayrollAttachment: ${error.message}`), { status: 500 });

  const row = toAttachmentDto(data);

  void emitAppEvent({
    eventType: 'finance.payroll.attachment_added', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: 'info',
    payload: { attachmentId: row.id, fileName: row.fileName },
  });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll.attachment_added',
    previousState: null,
    newState: { attachmentId: row.id, fileName: row.fileName, storagePath: row.storagePath },
  });

  return row;
}

export async function listPayrollAttachments(runId: string): Promise<AttachmentDto[]> {
  const { data, error } = await sb
    .from('finance_payroll_attachments')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .returns<DbPayrollAttachment[]>();

  if (error) throw Object.assign(new Error(`listPayrollAttachments: ${error.message}`), { status: 500 });
  return (data ?? []).map(toAttachmentDto);
}

export async function deletePayrollAttachment(
  id: string,
  runId: string,
  actorId: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await sb
    .from('finance_payroll_attachments')
    .select('id, storage_path, file_name')
    .eq('id', id).eq('run_id', runId)
    .maybeSingle<Pick<DbPayrollAttachment, 'id' | 'storage_path' | 'file_name'>>();

  if (fetchErr) throw Object.assign(new Error(`deletePayrollAttachment: ${fetchErr.message}`), { status: 500 });
  if (!existing) throw Object.assign(new Error('Attachment not found on this payroll run.'), { status: 404 });

  const { error: storageErr } = await sb.storage.from(FINANCE_ATTACHMENT_BUCKET).remove([existing.storage_path]);
  if (storageErr) throw Object.assign(new Error(`Failed to remove file from storage: ${storageErr.message}`), { status: 500 });

  const { error: delErr } = await sb
    .from('finance_payroll_attachments').delete()
    .eq('id', id).eq('run_id', runId);
  if (delErr) throw Object.assign(new Error(`deletePayrollAttachment DB: ${delErr.message}`), { status: 500 });

  void emitAppEvent({
    eventType: 'finance.payroll.attachment_removed', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: 'info',
    payload: { attachmentId: id, fileName: existing.file_name },
  });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll.attachment_removed',
    previousState: { attachmentId: id, storagePath: existing.storage_path }, newState: null,
  });
}
