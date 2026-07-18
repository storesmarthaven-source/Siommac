/**
 * Typed service-role callers for Messenger Compliance V1 transactional RPCs.
 * State changes, access evidence, app_events, audit rows, and idempotency
 * receipts remain owned by the database functions.
 */

import { sb } from '../db';
import { msgRpcHttpError } from './messagingRpc';
import type {
  ComplianceCaseDecisionRequest,
  ComplianceCaseRequest,
  ComplianceCaseThreadInput,
  ComplianceExportCreateRequest,
  ComplianceMessage,
} from '../../../../types/messagingCompliance';
import type { ComplianceExportSnapshot } from './complianceExportRenderer';

interface RpcError {
  code?: string | null;
  message: string;
}

interface RpcResponse {
  data: unknown;
  error: RpcError | null;
}

function unwrap(value: unknown): unknown {
  const result = value as RpcResponse;
  if (result.error) throw msgRpcHttpError(result.error);
  if (result.data === null) {
    throw Object.assign(new Error('Compliance transaction returned no result.'), { status: 500 });
  }
  return result.data;
}

export interface ComplianceEvidenceContext {
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface ComplianceCaseMutationResult {
  caseId: string;
  caseNo: string;
  status: string;
  eventId: string;
  duplicate?: boolean;
  grantCount?: number;
  revokedGrantCount?: number;
}

export interface ComplianceReadRpcResult {
  caseId: string;
  caseNo: string;
  caseTitle: string;
  caseStatus: 'approved';
  caseValidUntil: string;
  grantId: string;
  grantExpiresAt: string;
  threadId: string;
  threadSubject: string | null;
  threadType: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  messages: ComplianceMessage[];
  nextCursor: string | null;
  eventId: string;
  duplicate: boolean;
}

export interface ComplianceGrantRevokeResult {
  grantId: string;
  caseId: string;
  caseNo: string;
  threadId: string;
  granteeUserId: string;
  revokedAt: string;
  eventId: string;
  duplicate: boolean;
}

export interface ComplianceExportRequestResult {
  exportId: string;
  exportNo: string;
  caseId: string;
  caseNo: string;
  grantId: string;
  threadId: string;
  format: 'pdf' | 'json';
  rangeFrom: string | null;
  rangeTo: string | null;
  requestedAt: string;
  status: 'requested';
  eventId: string;
  duplicate: boolean;
}

export interface ComplianceExportFinalizeResult {
  exportId: string;
  exportNo: string;
  status: 'ready';
  messageCount: number;
  fileSize: number;
  sha256: string;
  generatedAt: string;
  eventId: string;
  duplicate: boolean;
}

export interface ComplianceExportPreparedResult {
  exportId: string;
  exportNo: string;
  status: 'uploading';
  messageCount: number;
  storagePath: string;
  fileSize: number;
  sha256: string;
  serializerVersion: string;
  snapshotAt: string;
  uploadStartedAt: string;
  duplicate: boolean;
}

export interface ComplianceExportFailureResult {
  exportId: string;
  exportNo: string;
  status: 'failed';
  failureCode: string;
  failedAt: string;
  eventId: string;
  duplicate: boolean;
}

export interface ComplianceExportDownloadMetadata {
  exportId: string;
  exportNo: string;
  caseId: string;
  caseNo: string;
  grantId: string;
  threadId: string;
  format: 'pdf' | 'json';
  storagePath: string;
  fileSize: number;
  sha256: string;
  serializerVersion: string;
  generatedAt: string;
}

export async function requestComplianceCaseTx(
  actorId: string,
  input: ComplianceCaseRequest,
  evidence: ComplianceEvidenceContext,
): Promise<ComplianceCaseMutationResult> {
  return unwrap(await sb.rpc('message_compliance_case_request_tx', {
    p_actor_id: actorId,
    p_title: input.title,
    p_case_type: input.caseType,
    p_reason: input.reason,
    p_valid_until: input.validUntil,
    p_threads: input.threads satisfies ComplianceCaseThreadInput[],
    p_idempotency_key: input.idempotencyKey,
    p_ip_hash: evidence.ipHash,
    p_user_agent_hash: evidence.userAgentHash,
  }) as unknown) as ComplianceCaseMutationResult;
}

export async function decideComplianceCaseTx(
  actorId: string,
  input: ComplianceCaseDecisionRequest,
  evidence: ComplianceEvidenceContext,
): Promise<ComplianceCaseMutationResult> {
  return unwrap(await sb.rpc('message_compliance_case_decide_tx', {
    p_case_id: input.caseId,
    p_actor_id: actorId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_ip_hash: evidence.ipHash,
    p_user_agent_hash: evidence.userAgentHash,
  }) as unknown) as ComplianceCaseMutationResult;
}

export async function readComplianceConversationTx(params: {
  actorId: string;
  caseId: string;
  threadId: string;
  limit: number;
  cursor: string | null;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceReadRpcResult> {
  return unwrap(await sb.rpc('message_compliance_thread_read_tx', {
    p_case_id: params.caseId,
    p_thread_id: params.threadId,
    p_actor_id: params.actorId,
    p_limit: params.limit,
    p_cursor: params.cursor,
    p_idempotency_key: params.idempotencyKey,
    p_ip_hash: params.evidence.ipHash,
    p_user_agent_hash: params.evidence.userAgentHash,
  }) as unknown) as ComplianceReadRpcResult;
}

export async function revokeComplianceGrantTx(params: {
  actorId: string;
  grantId: string;
  reason: string;
  stepUpVerified: boolean;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceGrantRevokeResult> {
  return unwrap(await sb.rpc('message_compliance_grant_revoke_tx', {
    p_grant_id: params.grantId,
    p_actor_id: params.actorId,
    p_reason: params.reason,
    p_step_up_verified: params.stepUpVerified,
    p_idempotency_key: params.idempotencyKey,
    p_ip_hash: params.evidence.ipHash,
    p_user_agent_hash: params.evidence.userAgentHash,
  }) as unknown) as ComplianceGrantRevokeResult;
}

export async function closeComplianceCaseTx(params: {
  actorId: string;
  caseId: string;
  reason: string;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceCaseMutationResult> {
  return unwrap(await sb.rpc('message_compliance_case_close_tx', {
    p_case_id: params.caseId,
    p_actor_id: params.actorId,
    p_reason: params.reason,
    p_idempotency_key: params.idempotencyKey,
    p_ip_hash: params.evidence.ipHash,
    p_user_agent_hash: params.evidence.userAgentHash,
  }) as unknown) as ComplianceCaseMutationResult;
}

export async function requestComplianceExportTx(
  actorId: string,
  input: ComplianceExportCreateRequest,
  evidence: ComplianceEvidenceContext,
): Promise<ComplianceExportRequestResult> {
  return unwrap(await sb.rpc('message_compliance_export_request_tx', {
    p_case_id: input.caseId,
    p_thread_id: input.threadId,
    p_actor_id: actorId,
    p_format: input.format,
    p_range_from: input.rangeFrom ?? null,
    p_range_to: input.rangeTo ?? null,
    p_purpose: input.purpose,
    p_acknowledgement: input.acknowledgement,
    p_idempotency_key: input.idempotencyKey,
    p_ip_hash: evidence.ipHash,
    p_user_agent_hash: evidence.userAgentHash,
  }) as unknown) as ComplianceExportRequestResult;
}

export async function loadComplianceExportSnapshot(
  exportId: string,
  actorId: string,
): Promise<ComplianceExportSnapshot> {
  return unwrap(
    await sb.rpc('message_compliance_export_snapshot', {
      p_export_id: exportId,
      p_actor_id: actorId,
    }) as unknown,
  ) as ComplianceExportSnapshot;
}

export async function prepareComplianceExportUploadTx(params: {
  exportId: string;
  actorId: string;
  messageCount: number;
  storagePath: string;
  fileSize: number;
  sha256: string;
  serializerVersion: string;
  snapshotAt: string;
  idempotencyKey: string;
}): Promise<ComplianceExportPreparedResult> {
  return unwrap(
    await sb.rpc('message_compliance_export_prepare_upload_tx', {
      p_export_id: params.exportId,
      p_actor_id: params.actorId,
      p_message_count: params.messageCount,
      p_storage_path: params.storagePath,
      p_file_size: params.fileSize,
      p_sha256: params.sha256,
      p_serializer_version: params.serializerVersion,
      p_snapshot_at: params.snapshotAt,
      p_idempotency_key: params.idempotencyKey,
    }) as unknown,
  ) as ComplianceExportPreparedResult;
}

export async function finalizeComplianceExportTx(params: {
  exportId: string;
  actorId: string;
  messageCount: number;
  storagePath: string;
  fileSize: number;
  sha256: string;
  serializerVersion: string;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceExportFinalizeResult> {
  return unwrap(await sb.rpc('message_compliance_export_finalize_tx', {
    p_export_id: params.exportId,
    p_actor_id: params.actorId,
    p_message_count: params.messageCount,
    p_storage_path: params.storagePath,
    p_file_size: params.fileSize,
    p_sha256: params.sha256,
    p_serializer_version: params.serializerVersion,
    p_idempotency_key: params.idempotencyKey,
    p_ip_hash: params.evidence.ipHash,
    p_user_agent_hash: params.evidence.userAgentHash,
  }) as unknown) as ComplianceExportFinalizeResult;
}

export async function failComplianceExportTx(params: {
  exportId: string;
  actorId: string;
  failureCode:
    | 'snapshot_failed'
    | 'render_failed'
    | 'prepare_failed'
    | 'storage_failed'
    | 'finalize_failed'
    | 'integrity_failed';
  idempotencyKey: string;
}): Promise<ComplianceExportFailureResult> {
  return unwrap(await sb.rpc('message_compliance_export_fail_tx', {
    p_export_id: params.exportId,
    p_actor_id: params.actorId,
    p_failure_code: params.failureCode,
    p_idempotency_key: params.idempotencyKey,
  }) as unknown) as ComplianceExportFailureResult;
}

export async function prepareComplianceExportDownload(
  exportId: string,
  actorId: string,
): Promise<ComplianceExportDownloadMetadata> {
  return unwrap(
    await sb.rpc('message_compliance_export_download_prepare', {
      p_export_id: exportId,
      p_actor_id: actorId,
    }) as unknown,
  ) as ComplianceExportDownloadMetadata;
}

export async function recordComplianceExportDownloadTx(params: {
  exportId: string;
  actorId: string;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<{ eventId: string; duplicate: boolean }> {
  return unwrap(
    await sb.rpc('message_compliance_export_download_record_tx', {
      p_export_id: params.exportId,
      p_actor_id: params.actorId,
      p_idempotency_key: params.idempotencyKey,
      p_ip_hash: params.evidence.ipHash,
      p_user_agent_hash: params.evidence.userAgentHash,
    }) as unknown,
  ) as { eventId: string; duplicate: boolean };
}
