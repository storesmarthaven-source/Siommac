/**
 * TanStack Query hooks for shared Finance attachment endpoints.
 * Supported parents: expense claims, remittances, disbursements, payroll runs.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryFunctionContext,
} from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

// ── DTOs (mirror netlify/functions/lib/finance/attachments.ts) ───────────────

export type FinanceEntityType =
  | 'expense_claim'
  | 'remittance'
  | 'disbursement'
  | 'payroll_run';

export interface AttachmentDto {
  id:          string;
  fileName:    string;
  fileSize:    number | null;
  contentType: string | null;
  storagePath: string;
  uploadedBy:  string | null;
  createdAt:   string;
}

export interface AttachmentUploadUrlResult {
  uploadUrl:   string;
  token:       string;
  path:        string;
  bucket:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post<T>(
  path: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(
    path,
    args,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

/**
 * Resolve entity type to the correct TanStack Query cache key factory.
 * Page agents use this to invalidate after attachment mutations.
 */
export function attachmentCacheKey(entityType: FinanceEntityType, entityId: string) {
  switch (entityType) {
    case 'expense_claim':  return financeQueryKeys.expenseAttachments(entityId);
    case 'remittance':     return financeQueryKeys.remittanceAttachments(entityId);
    case 'disbursement':   return financeQueryKeys.disbursementAttachments(entityId);
    case 'payroll_run':    return financeQueryKeys.payrollAttachments(entityId);
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * List all attachment metadata rows for an entity (newest first).
 *
 * @param entityType  Entity kind
 * @param entityId    UUID of the parent record
 * @param enabled     Pass false to skip the fetch (e.g. when drawer is closed)
 */
export function useFinanceAttachments(
  entityType: FinanceEntityType,
  entityId:   string,
  enabled = true,
) {
  return useQuery({
    queryKey: attachmentCacheKey(entityType, entityId),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<AttachmentDto[]>(
        'finance/attachments/list',
        { entityType, entityId },
        signal,
      ),
    enabled:   enabled && Boolean(entityId),
    staleTime: 60_000,
  });
}

/**
 * Generate a presigned PUT URL for uploading a file.
 * Returns { uploadUrl, token, path, bucket }.
 *
 * Usage:
 *   const { mutateAsync: getUploadUrl } = useFinanceAttachmentUploadUrl();
 *   const { uploadUrl, path } = await getUploadUrl({ entityType, entityId, fileName, mimeType });
 *   await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': mimeType } });
 *   await completeUpload({ entityType, entityId, fileName, storagePath: path, mimeType, fileSize });
 */
export function useFinanceAttachmentUploadUrl() {
  return useMutation({
    mutationFn: (vars: {
      entityType: FinanceEntityType;
      entityId:   string;
      fileName:   string;
      mimeType:   string;
    }) => post<AttachmentUploadUrlResult>('finance/attachments/upload-url', vars),
  });
}

/**
 * Commit the attachment metadata row after the client PUT succeeds.
 * Invalidates the attachment list cache for the entity.
 */
export function useCompleteFinanceAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      entityType:  FinanceEntityType;
      entityId:    string;
      fileName:    string;
      storagePath: string;
      mimeType?:   string;
      fileSize?:   number;
    }) => post<AttachmentDto>('finance/attachments/complete', vars),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: attachmentCacheKey(vars.entityType, vars.entityId) });
    },
  });
}

/**
 * Generate a short-lived signed download URL for a Finance attachment.
 * The URL is valid for 5 minutes. Do NOT cache signed URLs — regenerate on demand.
 */
export function useFinanceAttachmentSignedUrl() {
  return useMutation({
    mutationFn: (vars: {
      entityType:  FinanceEntityType;
      entityId:    string;
      storagePath: string;
    }) =>
      post<{ signedUrl: string }>('finance/attachments/signed-url', vars).then(
        d => d.signedUrl,
      ),
  });
}

/**
 * Delete an attachment (removes DB row + storage object).
 * Invalidates the attachment list cache for the entity.
 */
export function useDeleteFinanceAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id:         string;
      entityType: FinanceEntityType;
      entityId:   string;
    }) => post<null>('finance/attachments/delete', vars),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: attachmentCacheKey(vars.entityType, vars.entityId) });
    },
  });
}
