import { createHash } from 'node:crypto';
import { deliverEventNotifications } from '../appEvents';
import { sb } from '../db';
import type {
  ComplianceExportCreateRequest,
  ComplianceExportDownloadResponse,
} from '../../../../types/messagingCompliance';
import {
  renderMessagingComplianceExport,
} from './complianceExportRenderer';
import type { ComplianceEvidenceContext } from './complianceRpc';
import {
  failComplianceExportTx,
  finalizeComplianceExportTx,
  loadComplianceExportSnapshot,
  prepareComplianceExportUploadTx,
  prepareComplianceExportDownload,
  recordComplianceExportDownloadTx,
  requestComplianceExportTx,
  type ComplianceExportFinalizeResult,
  type ComplianceExportRequestResult,
} from './complianceRpc';

const BUCKET = 'message-compliance-exports';
const SERIALIZER_VERSION = 'messaging-compliance-v1';
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TTL_SECONDS = 300 as const;

interface ExportStateRow {
  id: string;
  status: 'requested' | 'uploading' | 'ready' | 'failed';
  message_count: number | null;
  storage_path: string | null;
  file_size: number | null;
  sha256: string | null;
  serializer_version: string | null;
  snapshot_at: string | null;
  upload_started_at: string | null;
  generated_at: string | null;
  failure_code: string | null;
}

interface ExportDownloadRow {
  id: string;
  export_no: string;
  case_id: string;
  grant_id: string;
  thread_id: string;
  requested_by: string;
  format: 'pdf' | 'json';
  range_from: string | null;
  range_to: string | null;
  purpose: string;
  status: 'ready';
  message_count: number;
  file_size: number;
  sha256: string;
  serializer_version: string;
  requested_at: string;
  generated_at: string;
  failure_code: null;
}

interface DbResult<T> {
  data: T;
  error: { message: string } | null;
}

export interface ComplianceExportBuildResult {
  request: ComplianceExportRequestResult;
  ready: ComplianceExportFinalizeResult;
}

function httpError(message: string, status = 500, code?: string): Error & {
  status: number;
  code?: string;
} {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function ensureNoError(error: { message: string } | null, operation: string): void {
  if (error) throw httpError(`${operation}: ${error.message}`);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function storagePath(request: ComplianceExportRequestResult): string {
  return `case/${request.caseId}/thread/${request.threadId}/${request.exportId}.${request.format}`;
}

async function loadExportState(exportId: string): Promise<ExportStateRow> {
  const { data, error } = await sb.from('message_compliance_exports')
    .select([
      'id', 'status', 'message_count', 'storage_path', 'file_size',
      'sha256', 'serializer_version', 'snapshot_at', 'upload_started_at',
      'generated_at', 'failure_code',
    ].join(', '))
    .eq('id', exportId)
    .maybeSingle() as unknown as DbResult<ExportStateRow | null>;
  ensureNoError(error, 'load compliance export state');
  if (!data) throw httpError('Compliance export not found.', 404);
  return data;
}

function readyFromState(
  request: ComplianceExportRequestResult,
  state: ExportStateRow,
): ComplianceExportFinalizeResult {
  if (state.status !== 'ready'
      || state.message_count === null
      || state.file_size === null
      || state.sha256 === null
      || state.generated_at === null) {
    throw httpError('Compliance export is not ready.', 409);
  }
  return {
    exportId: request.exportId,
    exportNo: request.exportNo,
    status: 'ready',
    messageCount: state.message_count,
    fileSize: state.file_size,
    sha256: state.sha256,
    generatedAt: state.generated_at,
    eventId: '',
    duplicate: true,
  };
}

async function uploadOrVerifyExisting(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = sb.storage.from(BUCKET);
  const { error } = await bucket.upload(path, buffer, { contentType, upsert: false });
  if (!error) return;

  const { data: existing, error: downloadError } = await bucket.download(path);
  if (downloadError) {
    throw httpError(`Store compliance export: ${error.message}`);
  }
  const existingBuffer = Buffer.from(await existing.arrayBuffer());
  if (existingBuffer.length !== buffer.length
      || sha256(existingBuffer) !== sha256(buffer)) {
    throw httpError(
      'An object already exists at the immutable export path with different bytes.',
      409,
      'export_storage_conflict',
    );
  }
}

async function recordFailure(
  request: ComplianceExportRequestResult,
  actorId: string,
  clientKey: string,
  failureCode: Parameters<typeof failComplianceExportTx>[0]['failureCode'],
): Promise<void> {
  const state = await loadExportState(request.exportId);
  if (state.status !== 'requested' && state.status !== 'uploading') return;
  const failed = await failComplianceExportTx({
    exportId: request.exportId,
    actorId,
    failureCode,
    idempotencyKey: `${clientKey}:fail:${failureCode}`,
  });
  if (!failed.duplicate) {
    void deliverEventNotifications({
      eventType: 'communications.compliance.export_failed',
      sourceModule: 'communications',
      sourceEntityType: 'message_compliance_export',
      sourceEntityId: request.exportId,
      actorUserId: actorId,
      severity: 'high',
      payload: {
        caseNo: request.caseNo,
        exportNo: request.exportNo,
        status: 'failed',
      },
      explicitRecipients: [{ userId: actorId, reason: 'explicit' }],
      notification: {
        title: 'Compliance export failed',
        body: `${request.caseNo}: the requested export could not be generated.`,
        actionRoute: 'messages/compliance',
        type: 'communications.compliance.export_failed',
      },
    }, failed.eventId);
  }
}

function failureStateUnavailable(
  stage: string,
  originalError: unknown,
  stateError: unknown,
): Error & { status: number; code: string; cause: unknown } {
  console.error(`[messagingCompliance] ${stage}: export failure plus failure-state error`, {
    originalError,
    stateError,
  });
  return Object.assign(
    new Error('The compliance export failed and its failure state could not be recorded.'),
    {
      status: 503,
      code: 'export_failure_state_unavailable',
      cause: stateError,
    },
  );
}

async function recordFailureAndRethrow(
  request: ComplianceExportRequestResult,
  actorId: string,
  clientKey: string,
  failureCode: Parameters<typeof failComplianceExportTx>[0]['failureCode'],
  originalError: unknown,
): Promise<never> {
  try {
    await recordFailure(request, actorId, clientKey, failureCode);
  } catch (stateError) {
    throw failureStateUnavailable(failureCode, originalError, stateError);
  }
  throw originalError instanceof Error
    ? originalError
    : httpError('Compliance export failed.', 500, failureCode);
}

export async function createComplianceExport(params: {
  actorId: string;
  input: ComplianceExportCreateRequest;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceExportBuildResult> {
  const request = await requestComplianceExportTx(params.actorId, params.input, params.evidence);
  let priorState: ExportStateRow | null = null;
  if (request.duplicate) {
    priorState = await loadExportState(request.exportId);
    if (priorState.status === 'ready') {
      return { request, ready: readyFromState(request, priorState) };
    }
    if (priorState.status === 'failed') {
      throw httpError(
        `The original export failed (${priorState.failure_code ?? 'unknown'}). Submit a new request key to retry.`,
        409,
        'export_failed',
      );
    }
  }

  let artifact: {
    messageCount: number;
    storagePath: string;
    fileSize: number;
    sha256: string;
    serializerVersion: string;
  };

  if (priorState?.status === 'uploading') {
    const startedAt = priorState.upload_started_at
      ? Date.parse(priorState.upload_started_at)
      : Number.NaN;
    if (!Number.isFinite(startedAt)
        || Date.now() - startedAt < 2 * 60 * 1000) {
      throw httpError(
        'The compliance export is still being generated.',
        409,
        'export_in_progress',
      );
    }
    if (priorState.message_count === null
        || priorState.storage_path === null
        || priorState.file_size === null
        || priorState.sha256 === null
        || priorState.serializer_version === null) {
      throw httpError('Prepared compliance export metadata is incomplete.', 409);
    }

    const { data: existing, error } = await sb.storage.from(BUCKET)
      .download(priorState.storage_path);
    if (error) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'storage_failed',
        httpError('The prepared compliance export object is unavailable.', 503),
      );
    }
    const existingBuffer = Buffer.from(await existing.arrayBuffer());
    if (existingBuffer.length !== priorState.file_size
        || sha256(existingBuffer) !== priorState.sha256) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'integrity_failed',
        httpError('The prepared compliance export failed integrity verification.', 409),
      );
    }
    artifact = {
      messageCount: priorState.message_count,
      storagePath: priorState.storage_path,
      fileSize: priorState.file_size,
      sha256: priorState.sha256,
      serializerVersion: priorState.serializer_version,
    };
  } else {
    let snapshot: Awaited<ReturnType<typeof loadComplianceExportSnapshot>>;
    try {
      snapshot = await loadComplianceExportSnapshot(request.exportId, params.actorId);
    } catch (error) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'snapshot_failed',
        error,
      );
    }

    let rendered: Awaited<ReturnType<typeof renderMessagingComplianceExport>>;
    try {
      rendered = await renderMessagingComplianceExport(snapshot, request.format);
      if (rendered.buffer.length > MAX_ARTIFACT_BYTES) {
        throw httpError('The generated export exceeds the 20 MB limit.', 422, 'export_size_limit');
      }
    } catch (error) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'render_failed',
        error,
      );
    }

    const path = storagePath(request);
    const digest = sha256(rendered.buffer);
    try {
      await prepareComplianceExportUploadTx({
        exportId: request.exportId,
        actorId: params.actorId,
        messageCount: rendered.messageCount,
        storagePath: path,
        fileSize: rendered.buffer.length,
        sha256: digest,
        serializerVersion: SERIALIZER_VERSION,
        snapshotAt: snapshot.generatedAt,
        idempotencyKey: `${params.input.idempotencyKey}:prepare`,
      });
    } catch (error) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'prepare_failed',
        error,
      );
    }

    try {
      await uploadOrVerifyExisting(path, rendered.buffer, rendered.contentType);
    } catch (error) {
      return recordFailureAndRethrow(
        request,
        params.actorId,
        params.input.idempotencyKey,
        'storage_failed',
        error,
      );
    }
    artifact = {
      messageCount: rendered.messageCount,
      storagePath: path,
      fileSize: rendered.buffer.length,
      sha256: digest,
      serializerVersion: SERIALIZER_VERSION,
    };
  }

  const finalizeInput = {
    exportId: request.exportId,
    actorId: params.actorId,
    ...artifact,
    idempotencyKey: `${params.input.idempotencyKey}:finalize`,
    evidence: params.evidence,
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ready = await finalizeComplianceExportTx(finalizeInput);
      if (!ready.duplicate) {
        void deliverEventNotifications({
          eventType: 'communications.compliance.export_generated',
          sourceModule: 'communications',
          sourceEntityType: 'message_compliance_export',
          sourceEntityId: request.exportId,
          actorUserId: params.actorId,
          severity: 'warning',
          payload: {
            caseNo: request.caseNo,
            exportNo: request.exportNo,
            status: 'ready',
          },
          explicitRecipients: [{ userId: params.actorId, reason: 'explicit' }],
          notification: {
            title: 'Compliance export ready',
            body: `${request.caseNo}: the requested export is ready.`,
            actionRoute: 'messages/compliance',
            type: 'communications.compliance.export_generated',
          },
        }, ready.eventId);
      }
      return {
        request,
        ready,
      };
    } catch (error) {
      lastError = error;
    }
  }

  let state: ExportStateRow;
  try {
    state = await loadExportState(request.exportId);
  } catch (stateError) {
    throw failureStateUnavailable('finalize_state_lookup', lastError, stateError);
  }
  if (state.status === 'ready') {
    return { request, ready: readyFromState(request, state) };
  }
  if (state.status === 'uploading') {
    throw httpError(
      'Export finalization is uncertain; the tracked immutable object was retained for safe retry.',
      503,
      'export_finalize_uncertain',
    );
  }
  throw lastError instanceof Error ? lastError : httpError('Failed to finalize compliance export.');
}

export async function downloadComplianceExport(params: {
  actorId: string;
  exportId: string;
  idempotencyKey: string;
  evidence: ComplianceEvidenceContext;
}): Promise<ComplianceExportDownloadResponse> {
  const metadata = await prepareComplianceExportDownload(params.exportId, params.actorId);
  const exportQuery = (sb.from('message_compliance_exports')
    .select([
      'id', 'export_no', 'case_id', 'grant_id', 'thread_id', 'requested_by',
      'format', 'range_from', 'range_to', 'purpose', 'status', 'message_count',
      'file_size', 'sha256', 'serializer_version', 'requested_at',
      'generated_at', 'failure_code',
    ].join(', '))
    .eq('id', metadata.exportId)
    .maybeSingle()) as unknown as Promise<DbResult<ExportDownloadRow | null>>;
  const threadQuery = (sb.from('message_threads')
    .select('id, subject')
    .eq('id', metadata.threadId)
    .maybeSingle<{ id: string; subject: string | null }>()) as unknown as Promise<
      DbResult<{ id: string; subject: string | null } | null>
    >;
  const requesterQuery = (sb.from('app_users')
    .select('id, username, full_name')
    .eq('id', params.actorId)
    .maybeSingle<{ id: string; username: string; full_name: string | null }>()) as unknown as Promise<
      DbResult<{ id: string; username: string; full_name: string | null } | null>
    >;
  const [exportResult, threadResult, requesterResult] = await Promise.all([
    exportQuery,
    threadQuery,
    requesterQuery,
  ]);
  ensureNoError(exportResult.error, 'load compliance export download metadata');
  ensureNoError(threadResult.error, 'load compliance export conversation');
  ensureNoError(requesterResult.error, 'load compliance export requester');
  const row = exportResult.data;
  if (!row || !threadResult.data || !requesterResult.data) {
    throw httpError('Compliance export metadata is incomplete.', 409);
  }
  const requesterFullName = requesterResult.data.full_name?.trim() ?? '';

  const bucket = sb.storage.from(BUCKET);
  const { data: object, error: downloadError } = await bucket.download(metadata.storagePath);
  if (downloadError) {
    throw httpError('The compliance export artifact is unavailable.', 503, 'export_artifact_unavailable');
  }
  const buffer = Buffer.from(await object.arrayBuffer());
  if (buffer.length !== metadata.fileSize || sha256(buffer) !== metadata.sha256) {
    throw httpError('Compliance export integrity verification failed.', 409, 'export_integrity_failed');
  }

  // Generate the short-lived token, but do not disclose it until the final
  // authorization re-check and immutable download evidence commit below.
  const { data: signed, error: signedError } = await bucket.createSignedUrl(
    metadata.storagePath,
    DOWNLOAD_TTL_SECONDS,
    { download: `${metadata.exportNo}.${metadata.format}` },
  );
  if (signedError || !signed.signedUrl) {
    throw httpError('Could not create the compliance export download URL.', 503);
  }

  await recordComplianceExportDownloadTx({
    exportId: params.exportId,
    actorId: params.actorId,
    idempotencyKey: params.idempotencyKey,
    evidence: params.evidence,
  });

  return {
    export: {
      id: row.id,
      exportNo: row.export_no,
      caseId: row.case_id,
      caseNo: metadata.caseNo,
      grantId: row.grant_id,
      threadId: row.thread_id,
      threadSubject: threadResult.data.subject,
      requestedBy: {
        id: requesterResult.data.id,
        displayName: requesterFullName.length > 0
          ? requesterFullName
          : requesterResult.data.username,
      },
      format: row.format,
      rangeFrom: row.range_from,
      rangeTo: row.range_to,
      purpose: row.purpose,
      status: row.status,
      messageCount: row.message_count,
      fileSize: row.file_size,
      sha256: row.sha256,
      serializerVersion: row.serializer_version,
      requestedAt: row.requested_at,
      generatedAt: row.generated_at,
      failureCode: row.failure_code,
      capabilities: { canExport: true },
    },
    signedUrl: signed.signedUrl,
    expiresInSeconds: DOWNLOAD_TTL_SECONDS,
  };
}
