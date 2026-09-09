/**
 * types/meetings.ts
 *
 * Canonical, camelCase Meetings API contract shared by the authenticated
 * Netlify routes and the Preact client. Database rows are mapped to these DTOs
 * at the backend boundary; storage paths, provider secrets and authorization
 * internals must never be exposed through this contract.
 *
 * Calendar remains the source of truth for scheduling, recurrence, reminders
 * and invitation responses. Communications remains the source of truth for the
 * meeting discussion thread. Meetings owns sessions, attendance facts, media,
 * transcripts, summaries, agenda and action-item promotion.
 */

import type {
  CalendarAttendeeResponse,
  CalendarVisibility,
  RecurrenceScope,
} from './calendar';

// ── Lifecycle and policy vocabulary ─────────────────────────────────────────

export type MeetingStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'archived';

export type MeetingSessionStatus =
  | 'scheduled'
  | 'ready'
  | 'live'
  | 'processing'
  | 'completed'
  | 'processing_failed'
  | 'cancelled';

export type MeetingConfidentiality = 'internal' | 'restricted' | 'confidential';
export type MeetingProvider = 'none' | 'external' | 'microsoft_teams' | 'zoom' | 'google_meet';
export type MeetingRecordingPolicy = 'off' | 'optional' | 'required';
export type MeetingTranscriptPolicy = 'off' | 'manual' | 'automatic';
export type MeetingConsentStatus = 'not_required' | 'pending' | 'granted' | 'declined' | 'revoked';
export type MeetingRetentionStatus = 'active' | 'legal_hold' | 'pending_purge' | 'purged';

export type MeetingParticipantRole = 'organizer' | 'presenter' | 'attendee' | 'observer';

export type MeetingArtifactKind =
  | 'recording'
  | 'audio'
  | 'captions'
  | 'transcript_source'
  | 'minutes'
  | 'supporting_file';

export type MeetingArtifactStatus =
  | 'reserved'
  | 'uploading'
  | 'scanning'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'failed'
  | 'deleted';

export type MeetingScanStatus = 'pending' | 'clean' | 'blocked' | 'failed';
export type MeetingTranscriptStatus = 'queued' | 'processing' | 'ready' | 'reviewed' | 'failed';
export type MeetingSummaryStatus = 'queued' | 'generating' | 'generated' | 'reviewed' | 'published' | 'rejected' | 'failed';
export type MeetingSummarySource = 'manual' | 'generated' | 'hybrid';
export type MeetingAgendaItemStatus = 'open' | 'covered' | 'deferred' | 'cancelled';
export type MeetingActionStatus = 'proposed' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled';
export type MeetingActionDestination = 'meeting' | 'calendar_task' | 'workflow_task' | 'module_handoff';
export type MeetingRecordRelationship = 'related_to' | 'evidence_for' | 'reviews' | 'blocks' | 'follow_up_for';

/** Stable permission catalogue keys used by both permission registries. */
export type MeetingPermission =
  | 'meetings.view'
  | 'meetings.create'
  | 'meetings.manage_own'
  | 'meetings.manage_team'
  | 'meetings.participants.manage'
  | 'meetings.recording.manage'
  | 'meetings.recording.view'
  | 'meetings.transcript.view'
  | 'meetings.transcript.export'
  | 'meetings.summary.generate'
  | 'meetings.summary.review'
  | 'meetings.summary.publish'
  | 'meetings.actions.publish'
  | 'meetings.comments.post'
  | 'meetings.metrics.view'
  | 'meetings.retention.manage'
  | 'meetings.compliance_read';

// ── Reusable value objects ───────────────────────────────────────────────────

export interface MeetingPersonDTO {
  userId: string;
  displayName: string;
  email: string | null;
  profileImage: string | null;
  profileImageVersion: number | null;
}

/** Calendar-owned schedule projection carried by meeting responses. */
export interface MeetingScheduleDTO {
  calendarEntryId: string;
  allDay: boolean;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recurrenceRule: string | null;
  recurrenceSeriesId: string | null;
  occurrenceDate: string | null;
  visibility: CalendarVisibility;
  departmentId: string | null;
}

export interface MeetingLabelDTO {
  id: string;
  name: string;
  color: string | null;
}

export interface MeetingRecordLinkDTO {
  id: string;
  module: string;
  recordType: string;
  recordId: string;
  recordNo: string | null;
  title: string;
  deepLink: string | null;
  relationship: MeetingRecordRelationship;
  confidentiality: MeetingConfidentiality;
}

export interface MeetingParticipantDTO {
  id: string;
  person: MeetingPersonDTO;
  role: MeetingParticipantRole;
  responseStatus: CalendarAttendeeResponse;
  respondedAt: string | null;
  required: boolean;
  addedAt: string;
  removedAt: string | null;
}

/** Actual participation in one session; RSVP remains Calendar-owned. */
export interface MeetingAttendanceDTO {
  id: string;
  sessionId: string;
  participantId: string | null;
  person: MeetingPersonDTO | null;
  joinedAt: string | null;
  leftAt: string | null;
  durationSeconds: number;
  consentStatus: MeetingConsentStatus;
  consentRecordedAt: string | null;
}

export interface MeetingArtifactDTO {
  id: string;
  sessionId: string;
  kind: MeetingArtifactKind;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  durationSeconds: number | null;
  status: MeetingArtifactStatus;
  scanStatus: MeetingScanStatus;
  createdAt: string;
  readyAt: string | null;
  retentionUntil: string | null;
  downloadable: boolean;
  playable: boolean;
}

export interface MeetingTranscriptSpeakerDTO {
  userId: string | null;
  displayName: string;
  profileImage: string | null;
  profileImageVersion: number | null;
}

export interface MeetingTranscriptSegmentDTO {
  id: string;
  sessionId: string;
  sequence: number;
  startsAtMs: number;
  endsAtMs: number;
  speaker: MeetingTranscriptSpeakerDTO | null;
  text: string;
  confidence: number | null;
  redacted: boolean;
  editedAt: string | null;
}

export interface MeetingChapterDTO {
  id: string;
  sessionId: string;
  sequence: number;
  title: string;
  summary: string | null;
  startsAtMs: number;
  endsAtMs: number | null;
  source: MeetingSummarySource;
  updatedAt: string;
}

export interface MeetingGenerationProvenanceDTO {
  provider: string;
  model: string;
  modelVersion: string | null;
  policyVersion: string;
  generatedAt: string;
  inputArtifactIds: string[];
}

export interface MeetingSummaryContentDTO {
  shortSummary: string;
  decisions: string[];
  keyTakeaways: string[];
}

export interface MeetingSummaryVersionDTO {
  id: string;
  sessionId: string;
  version: number;
  status: MeetingSummaryStatus;
  source: MeetingSummarySource;
  content: MeetingSummaryContentDTO;
  provenance: MeetingGenerationProvenanceDTO | null;
  createdBy: MeetingPersonDTO | null;
  createdAt: string;
  reviewedBy: MeetingPersonDTO | null;
  reviewedAt: string | null;
  publishedBy: MeetingPersonDTO | null;
  publishedAt: string | null;
  rejectionReason: string | null;
}

export interface MeetingAgendaItemDTO {
  id: string;
  meetingId: string;
  sequence: number;
  title: string;
  description: string | null;
  owner: MeetingPersonDTO | null;
  status: MeetingAgendaItemStatus;
  plannedMinutes: number | null;
  chapterId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingActionEvidenceDTO {
  transcriptSegmentId: string | null;
  startsAtMs: number | null;
  endsAtMs: number | null;
  excerpt: string | null;
}

export interface MeetingActionItemDTO {
  id: string;
  meetingId: string;
  sessionId: string;
  title: string;
  description: string | null;
  status: MeetingActionStatus;
  destination: MeetingActionDestination;
  owner: MeetingPersonDTO | null;
  dueAt: string | null;
  evidence: MeetingActionEvidenceDTO | null;
  proposedBy: MeetingPersonDTO | null;
  proposedByGeneration: boolean;
  acceptedBy: MeetingPersonDTO | null;
  acceptedAt: string | null;
  calendarTaskId: string | null;
  workflowTaskId: string | null;
  handoffId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingMetricsDTO {
  sessionId: string;
  invitedCount: number;
  acceptedCount: number;
  declinedCount: number;
  tentativeCount: number;
  attendedCount: number;
  attendanceRate: number | null;
  scheduledDurationSeconds: number | null;
  actualDurationSeconds: number | null;
  actionItemCount: number;
  completedActionItemCount: number;
  actionCompletionRate: number | null;
  /** Present only when speaker attribution met the server confidence policy. */
  speakerTime: Array<{
    userId: string | null;
    displayName: string;
    seconds: number;
    percentage: number;
  }>;
  calculatedAt: string;
}

// ── Aggregate DTOs and authorization capabilities ───────────────────────────

export interface MeetingCapabilitiesDTO {
  edit: boolean;
  cancel: boolean;
  archive: boolean;
  manageParticipants: boolean;
  respond: boolean;
  join: boolean;
  startSession: boolean;
  endSession: boolean;
  manageRecording: boolean;
  viewRecording: boolean;
  viewTranscript: boolean;
  exportTranscript: boolean;
  generateSummary: boolean;
  reviewSummary: boolean;
  publishSummary: boolean;
  manageAgenda: boolean;
  proposeAction: boolean;
  acceptAction: boolean;
  comment: boolean;
  viewMetrics: boolean;
  manageLinks: boolean;
  manageRetention: boolean;
}

export interface MeetingJoinDTO {
  provider: MeetingProvider;
  joinUrl: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface MeetingSessionDTO {
  id: string;
  meetingId: string;
  occurrenceKey: string;
  status: MeetingSessionStatus;
  scheduledStartsAt: string | null;
  scheduledEndsAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  recordingStatus: MeetingArtifactStatus | null;
  transcriptStatus: MeetingTranscriptStatus | null;
  summaryStatus: MeetingSummaryStatus | null;
  recordingArtifactId: string | null;
  publishedSummaryVersionId: string | null;
  failureReason: string | null;
}

export interface MeetingListItemDTO {
  id: string;
  reference: string;
  title: string;
  status: MeetingStatus;
  confidentiality: MeetingConfidentiality;
  organizer: MeetingPersonDTO;
  schedule: MeetingScheduleDTO;
  participantCount: number;
  participantPreview: MeetingPersonDTO[];
  myResponseStatus: CalendarAttendeeResponse | null;
  currentSession: MeetingSessionDTO | null;
  labels: MeetingLabelDTO[];
  linkedRecordCount: number;
  updatedAt: string;
  capabilities: MeetingCapabilitiesDTO;
}

export interface MeetingDetailDTO {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  confidentiality: MeetingConfidentiality;
  recordingPolicy: MeetingRecordingPolicy;
  transcriptPolicy: MeetingTranscriptPolicy;
  retentionStatus: MeetingRetentionStatus;
  retentionUntil: string | null;
  organizer: MeetingPersonDTO;
  schedule: MeetingScheduleDTO;
  provider: MeetingProvider;
  discussionThreadId: string;
  participants: MeetingParticipantDTO[];
  labels: MeetingLabelDTO[];
  recordLinks: MeetingRecordLinkDTO[];
  agendaItems: MeetingAgendaItemDTO[];
  sessions: MeetingSessionDTO[];
  currentSession: MeetingSessionDTO | null;
  publishedSummary: MeetingSummaryVersionDTO | null;
  join: MeetingJoinDTO | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  capabilities: MeetingCapabilitiesDTO;
}

// ── Common envelopes and pagination ─────────────────────────────────────────

export interface MeetingsSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface MeetingsErrorResponse {
  success: false;
  message: string;
  code?: string;
}

export type MeetingsResponse<T = never> = MeetingsSuccessResponse<T> | MeetingsErrorResponse;
export type MeetingsDataResponse<T> = MeetingsResponse<T>;

export interface MeetingCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MeetingCommandResult {
  meetingId: string;
  status: MeetingStatus;
  version: number;
  changed: boolean;
}

// ── List, detail and meeting lifecycle ──────────────────────────────────────

export interface MeetingsListRequest {
  from?: string;
  to?: string;
  statuses?: MeetingStatus[];
  ownerUserId?: string;
  participantUserId?: string;
  departmentId?: string;
  sourceModule?: string;
  labelIds?: string[];
  query?: string;
  cursor?: string;
  limit?: number;
}

export type MeetingsListResponse = MeetingsDataResponse<MeetingCursorPage<MeetingListItemDTO>>;

export interface MeetingGetRequest { meetingId: string; occurrenceKey?: string; }
export type MeetingGetResponse = MeetingsDataResponse<MeetingDetailDTO>;

export interface MeetingScheduleInput {
  allDay: boolean;
  startsOn?: string | null;
  endsOn?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  recurrenceRule?: string | null;
  visibility: CalendarVisibility;
  departmentId?: string | null;
}

export interface MeetingParticipantInput {
  userId: string;
  role?: Exclude<MeetingParticipantRole, 'organizer'>;
  required?: boolean;
}

export interface MeetingRecordLinkInput {
  module: string;
  recordType: string;
  recordId: string;
  relationship?: MeetingRecordRelationship;
}

export interface MeetingAgendaCreateInput {
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  plannedMinutes?: number | null;
}

export interface MeetingCreateRequest {
  idempotencyKey: string;
  /** Optional for API callers; the server resolves the actor's default SIOMAC calendar when omitted. */
  calendarId?: string;
  categoryId?: string;
  title: string;
  titleIconType?: import('./calendar').CalendarTitleIconType | null;
  titleIconValue?: string | null;
  description?: string | null;
  schedule: MeetingScheduleInput;
  participants: MeetingParticipantInput[];
  labelIds?: string[];
  recordLinks?: MeetingRecordLinkInput[];
  agendaItems?: MeetingAgendaCreateInput[];
  provider?: MeetingProvider;
  joinUrl?: string | null;
  confidentiality?: MeetingConfidentiality;
  recordingPolicy?: MeetingRecordingPolicy;
  transcriptPolicy?: MeetingTranscriptPolicy;
  retentionUntil?: string | null;
  reminderOffsets?: number[];
}

export type MeetingCreateResponse = MeetingsDataResponse<MeetingDetailDTO>;

export interface MeetingUpdateRequest {
  meetingId: string;
  idempotencyKey: string;
  expectedVersion: number;
  scope?: RecurrenceScope;
  occurrenceDate?: string;
  patch: {
    title?: string;
    description?: string | null;
    schedule?: MeetingScheduleInput;
    labelIds?: string[];
    provider?: MeetingProvider;
    joinUrl?: string | null;
    confidentiality?: MeetingConfidentiality;
    recordingPolicy?: MeetingRecordingPolicy;
    transcriptPolicy?: MeetingTranscriptPolicy;
    retentionUntil?: string | null;
  };
}

export type MeetingUpdateResponse = MeetingsDataResponse<MeetingCommandResult>;

export interface MeetingCancelRequest {
  meetingId: string;
  idempotencyKey: string;
  expectedVersion: number;
  reason: string;
  scope?: RecurrenceScope;
  occurrenceDate?: string;
}

export type MeetingCancelResponse = MeetingsDataResponse<MeetingCommandResult>;

export interface MeetingArchiveRequest { meetingId: string; expectedVersion: number; idempotencyKey: string; }
export type MeetingArchiveResponse = MeetingsDataResponse<MeetingCommandResult>;

// ── Participants ─────────────────────────────────────────────────────────────

export interface MeetingParticipantsInviteRequest {
  meetingId: string;
  idempotencyKey: string;
  expectedVersion: number;
  participants: MeetingParticipantInput[];
}

export interface MeetingParticipantsRemoveRequest {
  meetingId: string;
  idempotencyKey: string;
  expectedVersion: number;
  userId: string;
  reason?: string | null;
}

export type MeetingParticipantsResponse = MeetingsDataResponse<{
  meetingId: string;
  participants: MeetingParticipantDTO[];
  version: number;
}>;

export interface MeetingRsvpRequest {
  meetingId: string;
  expectedVersion: number;
  idempotencyKey: string;
  responseStatus: Exclude<CalendarAttendeeResponse, 'invited'>;
}
export type MeetingRsvpResponse = MeetingsDataResponse<{ meetingId: string; responseStatus: CalendarAttendeeResponse; respondedAt: string; version: number; }>;

// ── Session controls ─────────────────────────────────────────────────────────

export interface MeetingSessionStartRequest { meetingId: string; occurrenceKey: string; idempotencyKey: string; }
export interface MeetingSessionEndRequest { meetingId: string; sessionId: string; expectedStatus: 'ready' | 'live'; idempotencyKey: string; }
export type MeetingSessionCommandResponse = MeetingsDataResponse<MeetingSessionDTO>;

// ── Recording and artifact handling ─────────────────────────────────────────

export interface MeetingRecordingUploadUrlRequest {
  meetingId: string;
  sessionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export type MeetingRecordingUploadUrlResponse = MeetingsDataResponse<{
  artifact: MeetingArtifactDTO;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}>;

export interface MeetingRecordingCompleteRequest {
  meetingId: string;
  sessionId: string;
  artifactId: string;
  checksumSha256: string;
}

export type MeetingRecordingCompleteResponse = MeetingsDataResponse<MeetingArtifactDTO>;

export interface MeetingRecordingGetUrlRequest {
  meetingId: string;
  sessionId: string;
  artifactId: string;
  purpose: 'playback' | 'download';
}

export type MeetingRecordingGetUrlResponse = MeetingsDataResponse<{
  artifactId: string;
  url: string;
  expiresAt: string;
}>;

export interface MeetingRecordingDeleteRequest {
  meetingId: string;
  sessionId: string;
  artifactId: string;
  reason: string;
}

export type MeetingRecordingDeleteResponse = MeetingsDataResponse<{ artifactId: string; status: 'deleted'; }>;

// ── Transcript ───────────────────────────────────────────────────────────────

export interface MeetingTranscriptImportSegmentInput {
  sequence: number;
  startsAtMs: number;
  endsAtMs: number;
  speakerUserId?: string | null;
  speakerName?: string | null;
  text: string;
  confidence?: number | null;
}

export interface MeetingTranscriptImportRequest {
  meetingId: string;
  sessionId: string;
  idempotencyKey: string;
  language: string;
  sourceArtifactId?: string | null;
  segments: MeetingTranscriptImportSegmentInput[];
}

export type MeetingTranscriptImportResponse = MeetingsDataResponse<{
  sessionId: string;
  status: MeetingTranscriptStatus;
  segmentCount: number;
}>;

export interface MeetingTranscriptProcessRequest {
  meetingId: string;
  sessionId: string;
  sourceArtifactId: string;
  idempotencyKey: string;
  language?: string;
}

export type MeetingTranscriptProcessResponse = MeetingsDataResponse<{
  sessionId: string;
  status: Extract<MeetingTranscriptStatus, 'queued' | 'processing'>;
}>;

export interface MeetingTranscriptGetRequest {
  meetingId: string;
  sessionId: string;
  afterSequence?: number;
  limit?: number;
}

export type MeetingTranscriptGetResponse = MeetingsDataResponse<{
  sessionId: string;
  status: MeetingTranscriptStatus;
  language: string;
  segments: MeetingTranscriptSegmentDTO[];
  nextSequence: number | null;
}>;

export interface MeetingTranscriptSearchRequest {
  meetingId: string;
  sessionId: string;
  query: string;
  cursor?: string;
  limit?: number;
}

export type MeetingTranscriptSearchResponse = MeetingsDataResponse<MeetingCursorPage<MeetingTranscriptSegmentDTO>>;

export interface MeetingTranscriptExportRequest {
  meetingId: string;
  sessionId: string;
  format: 'txt' | 'vtt' | 'json';
}

export type MeetingTranscriptExportResponse = MeetingsDataResponse<{
  url: string;
  expiresAt: string;
  fileName: string;
}>;

// ── Summaries and chapters ───────────────────────────────────────────────────

export interface MeetingSummaryGenerateRequest {
  meetingId: string;
  sessionId: string;
  idempotencyKey: string;
  language: string;
  includeActionProposals?: boolean;
}

export type MeetingSummaryGenerateResponse = MeetingsDataResponse<MeetingSummaryVersionDTO>;

export interface MeetingSummaryGetRequest { meetingId: string; sessionId: string; version?: number; }
export type MeetingSummaryGetResponse = MeetingsDataResponse<{ versions: MeetingSummaryVersionDTO[]; }>;

export interface MeetingSummaryReviewRequest {
  meetingId: string;
  sessionId: string;
  summaryVersionId: string;
  expectedStatus: 'generated';
  content: MeetingSummaryContentDTO;
}

export interface MeetingSummaryPublishRequest {
  meetingId: string;
  sessionId: string;
  summaryVersionId: string;
  expectedStatus: 'reviewed';
}

export interface MeetingSummaryRejectRequest {
  meetingId: string;
  sessionId: string;
  summaryVersionId: string;
  expectedStatus: 'generated';
  reason: string;
}

export type MeetingSummaryCommandResponse = MeetingsDataResponse<MeetingSummaryVersionDTO>;

export interface MeetingChaptersListRequest { meetingId: string; sessionId: string; }
export type MeetingChaptersListResponse = MeetingsDataResponse<{ chapters: MeetingChapterDTO[]; }>;

export interface MeetingChapterUpdateInput {
  id?: string;
  sequence: number;
  title: string;
  summary?: string | null;
  startsAtMs: number;
  endsAtMs?: number | null;
}

export interface MeetingChaptersUpdateRequest {
  meetingId: string;
  sessionId: string;
  chapters: MeetingChapterUpdateInput[];
}

export type MeetingChaptersUpdateResponse = MeetingsDataResponse<{ chapters: MeetingChapterDTO[]; }>;

// ── Agenda and action items ──────────────────────────────────────────────────

export interface MeetingAgendaUpdateRequest {
  meetingId: string;
  idempotencyKey: string;
  expectedVersion: number;
  items: Array<{
    id?: string;
    sequence: number;
    title: string;
    description?: string | null;
    ownerUserId?: string | null;
    status?: MeetingAgendaItemStatus;
    plannedMinutes?: number | null;
  }>;
}

export type MeetingAgendaUpdateResponse = MeetingsDataResponse<{
  items: MeetingAgendaItemDTO[];
  version: number;
}>;

export interface MeetingActionItemsListRequest {
  meetingId: string;
  sessionId?: string;
  statuses?: MeetingActionStatus[];
}

export type MeetingActionItemsListResponse = MeetingsDataResponse<{ items: MeetingActionItemDTO[]; }>;

export interface MeetingActionItemAcceptRequest {
  meetingId: string;
  actionItemId: string;
  ownerUserId: string;
  dueAt?: string | null;
  destination: MeetingActionDestination;
  targetModule?: string | null;
  targetRecordType?: string | null;
  targetRecordId?: string | null;
}

export interface MeetingActionItemRejectRequest {
  meetingId: string;
  actionItemId: string;
  reason: string;
}

export interface MeetingActionItemUpdateRequest {
  meetingId: string;
  actionItemId: string;
  patch: {
    title?: string;
    description?: string | null;
    ownerUserId?: string | null;
    dueAt?: string | null;
    status?: Extract<MeetingActionStatus, 'in_progress' | 'completed' | 'cancelled'>;
  };
}

export type MeetingActionItemCommandResponse = MeetingsDataResponse<MeetingActionItemDTO>;

// ── Metrics and record links ─────────────────────────────────────────────────

export interface MeetingMetricsGetRequest { meetingId: string; sessionId: string; }
export type MeetingMetricsGetResponse = MeetingsDataResponse<MeetingMetricsDTO>;

export interface MeetingRecordLinksListRequest { meetingId: string; }
export type MeetingRecordLinksListResponse = MeetingsDataResponse<{ links: MeetingRecordLinkDTO[]; }>;

export interface MeetingRecordLinkAddRequest {
  meetingId: string;
  expectedVersion: number;
  link: MeetingRecordLinkInput;
}

export interface MeetingRecordLinkRemoveRequest {
  meetingId: string;
  expectedVersion: number;
  linkId: string;
}

export type MeetingRecordLinkCommandResponse = MeetingsDataResponse<{
  links: MeetingRecordLinkDTO[];
  version: number;
}>;
