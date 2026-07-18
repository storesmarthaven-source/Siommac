/**
 * Shared Messenger Compliance V1 API contract.
 *
 * Message bodies are intentionally confined to ComplianceMessagePage and the
 * generated export artifact. Case, grant, export-list, and access-log DTOs
 * carry metadata only.
 */

export type ComplianceCaseType =
  | 'hr_investigation'
  | 'safety_investigation'
  | 'legal_request'
  | 'security_investigation'
  | 'other_formal_investigation';

export type ComplianceCaseStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'closed';

export type ComplianceAccessEventType =
  | 'case_requested'
  | 'case_approved'
  | 'case_rejected'
  | 'conversation_opened'
  | 'page_read'
  | 'grant_revoked'
  | 'export_requested'
  | 'export_generated'
  | 'export_downloaded'
  | 'case_closed';

export type ComplianceExportFormat = 'pdf' | 'json';
export type ComplianceExportStatus = 'requested' | 'uploading' | 'ready' | 'failed';

export interface ComplianceCapabilities {
  canRequestCase: boolean;
  canApproveCase: boolean;
  canReadConversation: boolean;
  canRevokeGrant: boolean;
  canExport: boolean;
  canViewAccessLog: boolean;
}

export interface ComplianceActorRef {
  id: string;
  displayName: string | null;
}

export interface ComplianceCaseThread {
  id: string;
  caseId: string;
  threadId: string;
  subject: string | null;
  threadType: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  relevanceNote: string;
  addedBy: ComplianceActorRef;
  createdAt: string;
}

export interface ComplianceGrant {
  id: string;
  caseId: string;
  caseThreadId: string;
  threadId: string;
  user: ComplianceActorRef;
  grantedBy: ComplianceActorRef;
  grantedAt: string;
  expiresAt: string;
  revokedBy: ComplianceActorRef | null;
  revokedAt: string | null;
  revokeReason: string | null;
  lastAccessedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  capabilities: Pick<ComplianceCapabilities, 'canReadConversation' | 'canRevokeGrant' | 'canExport'>;
}

export interface ComplianceCaseSummary {
  id: string;
  caseNo: string;
  title: string;
  caseType: ComplianceCaseType;
  status: ComplianceCaseStatus;
  requestedBy: ComplianceActorRef;
  requestedAt: string;
  approvedBy: ComplianceActorRef | null;
  approvedAt: string | null;
  validFrom: string | null;
  validUntil: string;
  conversationCount: number;
  lastActivityAt: string;
  capabilities: ComplianceCapabilities;
}

export interface ComplianceCaseDetail extends ComplianceCaseSummary {
  reason: string;
  rejectedBy: ComplianceActorRef | null;
  rejectedAt: string | null;
  decisionReason: string | null;
  closedBy: ComplianceActorRef | null;
  closedAt: string | null;
  closeReason: string | null;
  threads: ComplianceCaseThread[];
  grants: ComplianceGrant[];
}

export interface ComplianceAttachmentMetadata {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  attachmentType: string | null;
  scanStatus: string | null;
}

export interface ComplianceMessage {
  id: string;
  sequence: number | null;
  author: ComplianceActorRef | null;
  body: string | null;
  isSystem: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments: ComplianceAttachmentMetadata[];
}

export interface ComplianceMessagePage {
  case: Pick<ComplianceCaseSummary, 'id' | 'caseNo' | 'title' | 'status' | 'validUntil'>;
  grant: ComplianceGrant;
  thread: Pick<
    ComplianceCaseThread,
    'id' | 'threadId' | 'subject' | 'threadType' | 'sourceModule' | 'sourceEntityType' | 'sourceEntityId' | 'relevanceNote'
  >;
  messages: ComplianceMessage[];
  nextCursor: string | null;
  capabilities: ComplianceCapabilities;
}

export interface ComplianceAccessEvent {
  id: string;
  caseId: string;
  caseNo: string;
  grantId: string | null;
  threadId: string | null;
  threadSubject: string | null;
  actor: ComplianceActorRef;
  eventType: ComplianceAccessEventType;
  occurredAt: string;
  requestId: string;
  details: Record<string, unknown>;
}

export interface ComplianceExport {
  id: string;
  exportNo: string;
  caseId: string;
  caseNo: string;
  grantId: string;
  threadId: string;
  threadSubject: string | null;
  requestedBy: ComplianceActorRef;
  format: ComplianceExportFormat;
  rangeFrom: string | null;
  rangeTo: string | null;
  purpose: string;
  status: ComplianceExportStatus;
  messageCount: number | null;
  fileSize: number | null;
  sha256: string | null;
  serializerVersion: string | null;
  requestedAt: string;
  generatedAt: string | null;
  failureCode: string | null;
  capabilities: Pick<ComplianceCapabilities, 'canExport'>;
}

export interface ComplianceCaseThreadInput {
  threadId: string;
  relevanceNote: string;
}

export interface ComplianceCasesListRequest {
  status?: ComplianceCaseStatus | 'all';
  search?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ComplianceCasesListResponse {
  items: ComplianceCaseSummary[];
  nextCursor: string | null;
  capabilities: ComplianceCapabilities;
}

export interface ComplianceCaseGetRequest {
  caseId: string;
}

export interface ComplianceCaseRequest {
  title: string;
  caseType: ComplianceCaseType;
  reason: string;
  validUntil: string;
  threads: ComplianceCaseThreadInput[];
  idempotencyKey: string;
}

export interface ComplianceCaseDecisionRequest {
  caseId: string;
  decision: 'approve' | 'reject';
  reason: string;
  idempotencyKey: string;
}

export interface ComplianceCaseCloseRequest {
  caseId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ComplianceConversationSearchRequest {
  search?: string;
  participantUserId?: string;
  sourceModule?: string;
  sourceEntityType?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ComplianceConversationSearchResponse {
  items: Omit<ComplianceCaseThread, 'id' | 'caseId' | 'relevanceNote' | 'addedBy'>[];
  nextCursor: string | null;
}

export interface ComplianceConversationReadRequest {
  caseId: string;
  threadId: string;
  limit?: number;
  cursor?: string | null;
  idempotencyKey: string;
}

export interface ComplianceGrantRevokeRequest {
  grantId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ComplianceAccessEventsListRequest {
  caseId?: string;
  actorUserId?: string;
  eventType?: ComplianceAccessEventType;
  threadId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ComplianceAccessEventsListResponse {
  items: ComplianceAccessEvent[];
  nextCursor: string | null;
}

export interface ComplianceExportsListRequest {
  caseId: string;
  limit?: number;
  cursor?: string | null;
}

export interface ComplianceExportsListResponse {
  items: ComplianceExport[];
  nextCursor: string | null;
}

export interface ComplianceExportCreateRequest {
  caseId: string;
  threadId: string;
  format: ComplianceExportFormat;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  purpose: string;
  acknowledgement: boolean;
  idempotencyKey: string;
}

export interface ComplianceExportDownloadRequest {
  exportId: string;
  idempotencyKey: string;
}

export interface ComplianceExportDownloadResponse {
  export: ComplianceExport;
  signedUrl: string;
  expiresInSeconds: 300;
}
