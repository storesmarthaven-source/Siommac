/**
 * Shared attachment endpoints for expense claims, remittances,
 * disbursements, and payroll runs. Accounts Payable and Budgeting are
 * intentionally not accepted entity types.
 */

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  // Upload URL
  getExpenseAttachmentUploadUrl,
  getRemittanceAttachmentUploadUrl,
  getDisbursementAttachmentUploadUrl,
  getPayrollAttachmentUploadUrl,
  // Commit
  commitExpenseAttachment,
  commitRemittanceAttachment,
  commitDisbursementAttachment,
  commitPayrollAttachment,
  // List
  listExpenseAttachments,
  listRemittanceAttachments,
  listDisbursementAttachments,
  listPayrollAttachments,
  // Delete
  deleteExpenseAttachment,
  deleteRemittanceAttachment,
  deleteDisbursementAttachment,
  deletePayrollAttachment,
  // Signed URL (shared)
  getFinanceAttachmentSignedUrl,
} from '../lib/finance/attachments';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

function fail(c: { json: (o: unknown, s?: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json(
    { success: false, message: er.message ?? 'Internal error' },
    (er.status ?? 500) as 200,
  );
}

// Zod schemas
const EntityTypeEnum = z.enum(['expense_claim', 'remittance', 'disbursement', 'payroll_run']);

const UploadUrlSchema = z.object({
  entityType: EntityTypeEnum,
  entityId:   z.string().uuid(),
  fileName:   z.string().min(1).max(255),
  mimeType:   z.string().min(1).max(100),
});

const CompleteSchema = z.object({
  entityType:  EntityTypeEnum,
  entityId:    z.string().uuid(),
  fileName:    z.string().min(1).max(255),
  storagePath: z.string().min(1).max(500),
  mimeType:    z.string().max(100).optional(),
  fileSize:    z.number().int().positive().optional(),
});

const ListSchema = z.object({
  entityType: EntityTypeEnum,
  entityId:   z.string().uuid(),
});

const SignedUrlSchema = z.object({
  storagePath: z.string().min(1).max(500),
  entityType:  EntityTypeEnum,
  entityId:    z.string().uuid(),
});

const DeleteSchema = z.object({
  id:         z.string().uuid(),
  entityType: EntityTypeEnum,
  entityId:   z.string().uuid(),
});

// Permission maps — resolve at route-dispatch time
const UPLOAD_PERMS: Record<string, string> = {
  expense_claim: 'finance.expenses.receipt.upload',
  remittance:    'finance.remittances.receipt.upload',
  disbursement:  'finance.disbursement.manage',
  payroll_run:   'finance.payroll.run.manage',
};
const VIEW_PERMS: Record<string, string> = {
  expense_claim: 'finance.expenses.view',
  remittance:    'finance.remittances.view',
  disbursement:  'finance.disbursement.view',
  payroll_run:   'finance.payroll.view_all',
};
const MANAGE_PERMS: Record<string, string> = {
  expense_claim: 'finance.expenses.manage',
  remittance:    'finance.remittances.manage',
  disbursement:  'finance.disbursement.manage',
  payroll_run:   'finance.payroll.run.manage',
};

// ── POST /finance/attachments/upload-url ─────────────────────────────────────
// Returns a presigned PUT URL + storage path. Client uploads directly to Supabase.
router.post('/attachments/upload-url', async c => {
  const v = zv(c, UploadUrlSchema, b(c));
  if (!v.ok) return v.response;
  await requirePermission(c, UPLOAD_PERMS[v.data.entityType]!);
  try {
    let result;
    switch (v.data.entityType) {
      case 'expense_claim':  result = await getExpenseAttachmentUploadUrl(v.data.fileName, v.data.mimeType); break;
      case 'remittance':     result = await getRemittanceAttachmentUploadUrl(v.data.fileName, v.data.mimeType); break;
      case 'disbursement':   result = await getDisbursementAttachmentUploadUrl(v.data.fileName, v.data.mimeType); break;
      case 'payroll_run':    result = await getPayrollAttachmentUploadUrl(v.data.fileName, v.data.mimeType); break;
    }
    return c.json({ success: true, data: result });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/attachments/complete ───────────────────────────────────────
// Commit the attachment metadata row after the client has PUT the file.
router.post('/attachments/complete', async c => {
  const v = zv(c, CompleteSchema, b(c));
  if (!v.ok) return v.response;
  const user = await requirePermission(c, UPLOAD_PERMS[v.data.entityType]!);
  try {
    const input = {
      fileName:    v.data.fileName,
      storagePath: v.data.storagePath,
      mimeType:    v.data.mimeType,
      fileSize:    v.data.fileSize,
    };
    let data;
    switch (v.data.entityType) {
      case 'expense_claim':  data = await commitExpenseAttachment(v.data.entityId, input, user.id); break;
      case 'remittance':     data = await commitRemittanceAttachment(v.data.entityId, input, user.id); break;
      case 'disbursement':   data = await commitDisbursementAttachment(v.data.entityId, input, user.id); break;
      case 'payroll_run':    data = await commitPayrollAttachment(v.data.entityId, input, user.id); break;
    }
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/attachments/list ────────────────────────────────────────────
// List all attachments for a given entity (newest first).
router.post('/attachments/list', async c => {
  const v = zv(c, ListSchema, b(c));
  if (!v.ok) return v.response;
  await requirePermission(c, VIEW_PERMS[v.data.entityType]!);
  try {
    let data;
    switch (v.data.entityType) {
      case 'expense_claim':  data = await listExpenseAttachments(v.data.entityId); break;
      case 'remittance':     data = await listRemittanceAttachments(v.data.entityId); break;
      case 'disbursement':   data = await listDisbursementAttachments(v.data.entityId); break;
      case 'payroll_run':    data = await listPayrollAttachments(v.data.entityId); break;
    }
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/attachments/signed-url ─────────────────────────────────────
// Generate a short-lived signed download URL for a Finance attachment.
router.post('/attachments/signed-url', async c => {
  const v = zv(c, SignedUrlSchema, b(c));
  if (!v.ok) return v.response;
  await requirePermission(c, VIEW_PERMS[v.data.entityType]!);
  try {
    const signedUrl = await getFinanceAttachmentSignedUrl(v.data.storagePath);
    return c.json({ success: true, data: { signedUrl } });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/attachments/delete ─────────────────────────────────────────
// Remove the attachment metadata row and the underlying storage object.
router.post('/attachments/delete', async c => {
  const v = zv(c, DeleteSchema, b(c));
  if (!v.ok) return v.response;
  const user = await requirePermission(c, MANAGE_PERMS[v.data.entityType]!);
  try {
    switch (v.data.entityType) {
      case 'expense_claim':  await deleteExpenseAttachment(v.data.id, v.data.entityId, user.id); break;
      case 'remittance':     await deleteRemittanceAttachment(v.data.id, v.data.entityId, user.id); break;
      case 'disbursement':   await deleteDisbursementAttachment(v.data.id, v.data.entityId, user.id); break;
      case 'payroll_run':    await deletePayrollAttachment(v.data.id, v.data.entityId, user.id); break;
    }
    return c.json({ success: true, data: null });
  } catch (e) { return fail(c, e); }
});

export default router;
