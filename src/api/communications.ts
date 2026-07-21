/**
 * src/api/communications.ts
 *
 * TanStack Query hooks for the canonical communications backbone:
 *   Summary · Notifications · Messages · Tickets
 *
 * All routes: POST /api/communications/* (auth JWT via apiPost).
 * No direct Supabase reads — backend scopes all queries to the JWT actor.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryFunctionContext,
} from '@tanstack/preact-query';
import { apiPost }            from '@lib/api';
import { communicationKeys, notificationKeys, messageKeys, ticketKeys } from './queryKeys';
import type {
  MessageThread as MessageThreadDTO, MessageParticipant as MessageParticipantDTO,
  MessagePost as MessagePostDTO, MessageAttachment as MessageAttachmentDTO,
  MessageRecipient as MessageRecipientDTO, MessageThreadDetail as MessageThreadDetailDTO,
  MessagePin as MessagePinDTO,
  PresenceStatus,
} from '../../types/messaging';

export type MessagePin = MessagePinDTO;

// ── Messaging contract (shared, camelCase) ──────────────────────────────────────
// These re-exports keep the existing import names stable across the app while the
// single source of truth lives in types/messaging.ts.
export type MessageThreadListItem     = MessageThreadDTO;
export type MessageParticipantProfile = MessageParticipantDTO;
export type MessagePostRow            = MessagePostDTO;
export type MessageAttachment         = MessageAttachmentDTO;
export type MessageRecipient          = MessageRecipientDTO;
export type MessageThreadDetail       = MessageThreadDetailDTO;

// ── Response types ─────────────────────────────────────────────────────────────

export interface CommsSummary {
  notificationsUnread:         number;
  notificationsTotal:          number;
  notificationsActionRequired: number;
  notificationsCritical:       number;
  notificationsArchived:       number;
  messagesUnread:      number;
  ticketsOpen:         number;
  ticketsUnread:       number;
  workflowTasks:       number;
  handoffFailures:     number;
  realtimeChannelKey:  string | null;
  /** Server-issued Supabase Realtime JWT — null until the server is configured
   *  with SUPABASE_JWT_SECRET (see lib/REALTIME_AUTH_CONTRACT.md). */
  realtimeToken:          string | null;
  realtimeTokenExpiresAt: string | null;
}

export interface CanonicalNotification {
  id:              string;
  type:            string;
  module:          string | null;
  severity:        string;
  title:           string;
  body:            string | null;
  source_type:     string | null;
  source_id:       string | null;
  action_route:    string | null;
  metadata:        Record<string, unknown> | null;
  is_read:         boolean;
  action_required: boolean;
  action_status:   string;
  due_at:          string | null;
  created_at:      string;
}

export interface NotificationPreference extends Record<string, unknown> {
  event_type: string;
  in_app:     boolean;
  email:      boolean;
  whatsapp:   boolean;
}

export interface NotificationSnoozeState {
  mutedUntil: string | null; // null = indefinite
}

export interface NotificationPreferencesData {
  defaults:    NotificationPreference;
  preferences: NotificationPreference[];
  snooze:      NotificationSnoozeState | null;
}

export interface MessageThread {
  thread_id:       string;
  role:            string;
  last_read_at:    string | null;
  message_threads: {
    id:               string;
    thread_type:      string;
    subject:          string;
    source_module:    string | null;
    source_entity_id: string | null;
    created_at:       string;
    created_by:       string | null;
  };
}

export interface MessagePost {
  id:             string;
  author_user_id: string | null;
  body:           string;
  is_system:      boolean;
  created_at:     string;
}

export interface CanonicalTicket {
  id:                 string;
  ticketNumber:       string;
  requestTypeCode:    string;
  queueCode:          string;
  category:           string;
  priority:           string;
  status:             string;
  subject:            string;
  responseDueAt:      string | null;
  resolutionDueAt:    string | null;
  lastActivityAt:     string;
  requesterUserId:    string | null;
  assigneeUserId:     string | null;
  activitySequence:   number;
  lastReadSequence:   number;
  unreadCount:        number;
  isConfidential:     boolean;
  canHandle:          boolean;
  tags:               { key: string; label: string; kind: 'system' | 'custom' }[];
  createdAt:          string;
  version:            number;
  requester:          TicketUserProfile | null;
  assignee:           TicketUserProfile | null;
}

export interface TicketUserProfile {
  id:          string;
  displayName: string;
  email:       string | null;
  role:        string | null;
  photoUrl:    string | null;
}

export interface TicketRequestType {
  code:                    string;
  label:                   string;
  description:             string | null;
  category:                string;
  queueCode:               string;
  queueLabel:              string;
  module:                  string;
  defaultPriority:         'low' | 'medium' | 'high' | 'critical';
  responseTargetMinutes:   number;
  resolutionTargetMinutes: number;
  systemTags:              string[];
  isConfidential:          boolean;
}

export interface TicketAttachment {
  id:          string;
  fileName:    string;
  contentType: string;
  sizeBytes:   number;
  uploadedBy:  string;
  createdAt:   string;
  uploadedAt:  string | null;
}

export interface CanonicalTicketDetail {
  ticket:   CanonicalTicket & Record<string, unknown>;
  canHandle: boolean;
  comments: {
    id:             string;
    authorUserId:   string | null;
    body:           string;
    isInternal:     boolean;
    isSystem:       boolean;
    sequence:       number;
    createdAt:      string;
    author:         TicketUserProfile | null;
  }[];
  tags: { key: string; label: string; kind: 'system' | 'custom'; createdAt: string }[];
  attachments: TicketAttachment[];
  participants: (Record<string, unknown> & { user?: TicketUserProfile | null })[];
  events: (Record<string, unknown> & { actor?: TicketUserProfile | null })[];
  lastReadSequence: number;
  unreadCount: number;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function useCommsSummary() {
  return useQuery({
    queryKey: communicationKeys.summary(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CommsSummary }>(
        'communications/summary', {}, { signal },
      );
      if (!res.success) throw new Error('Failed to load communications summary');
      return res.data;
    },
    staleTime:       30_000,
    refetchInterval: 2 * 60_000,
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface NotificationListArgs extends Record<string, unknown> {
  limit?:              number;
  cursor?:             string | null;
  unreadOnly?:         boolean;
  archivedOnly?:       boolean;
  actionRequiredOnly?: boolean;
  module?:             string | null;
  severity?:           'info' | 'success' | 'warning' | 'critical' | null;
  search?:             string | null;
}

export function useNotifications(args: NotificationListArgs = {}) {
  return useQuery({
    queryKey: notificationKeys.mine(args),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalNotification[]; nextCursor: string | null }>(
        'communications/notifications/list',
        { limit: 30, ...args },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load notifications');
      return res.data;
    },
  });
}

// ── Preferences · mute · broadcast ──────────────────────────────────────────────

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: NotificationPreferencesData }>(
        'communications/notifications/preferences/get', {}, { signal },
      );
      if (!res.success) throw new Error('Failed to load preferences');
      return res.data;
    },
  });
}

export function useSetNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: NotificationPreference & { eventType: string }) =>
      apiPost<{ success: boolean }>('communications/notifications/preferences/set', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.preferences() }),
  });
}

export function useMuteNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { scope: string; mutedUntil?: string | null; clear?: boolean }) =>
      apiPost<{ success: boolean }>('communications/notifications/mute', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export interface BroadcastArgs extends Record<string, unknown> {
  audience: { type: 'all' | 'role' | 'site' | 'department' | 'users'; value?: string; userIds?: string[] };
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  actionRoute?: string | null;
  expiresAt?: string | null;
}

export function useBroadcastNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: BroadcastArgs) =>
      apiPost<{ success: boolean; recipientCount: number }>('communications/notifications/broadcast', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: communicationKeys.summary() }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/markRead',
        { notificationId },
        { retryable: false },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { module?: string } = {}) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/markAllRead',
        args,
        { retryable: false },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export function useArchiveNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { notificationId?: string; all?: boolean }) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/archive',
        args,
        { retryable: false },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function useMessageThreads(limit = 50) {
  return useQuery({
    queryKey: messageKeys.inbox(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessageThread[] }>(
        'communications/messages/threads',
        { limit },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load message threads');
      return res.data;
    },
    placeholderData: previous => previous,
  });
}

export function useMessagePosts(threadId: string) {
  return useQuery({
    queryKey: messageKeys.thread(threadId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessagePost[] }>(
        'communications/messages/posts',
        { threadId, limit: 50 },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load posts');
      return res.data;
    },
    enabled: !!threadId,
  });
}

export interface PostMessageArgs extends Record<string, unknown> {
  threadId:      string;
  body:          string;
  attachmentIds?: string[];
  replyToPostId?: string | null;
  priority?:      'normal' | 'important' | 'urgent' | 'action_required';
}

export function usePostMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PostMessageArgs) =>
      apiPost<{ success: boolean; postId: string }>(
        'communications/messages/post', args, { retryable: false },
      ),
    onSuccess: (_r: unknown, vars: PostMessageArgs) => {
      void qc.invalidateQueries({ queryKey: messageKeys.thread(vars.threadId) });
      void qc.invalidateQueries({ queryKey: messageKeys.posts(vars.threadId) });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

// ── Attachment upload hooks ───────────────────────────────────────────────────

export interface AttachmentUploadUrlResult {
  uploadUrl: string;
  token:     string;
  path:      string;
  bucket:    string;
  ext:       string;
}

/** Step 1: get a presigned PUT URL from the backend. */
export function useMessageAttachmentUploadUrl() {
  return useMutation({
    mutationFn: (args: { fileName: string; mimeType: string }) =>
      apiPost<{ success: boolean; data: AttachmentUploadUrlResult }>(
        'communications/messages/attachments/upload-url', args, { retryable: false },
      ).then(r => {
        if (!r.success) throw new Error('Failed to get upload URL');
        return r.data;
      }),
  });
}

/** Step 3: persist the attachment metadata row (post_id NULL until send). */
export function useCreateMessageAttachment() {
  return useMutation({
    mutationFn: (args: { fileName: string; filePath: string; contentType: string | null; sizeBytes: number | null }) =>
      apiPost<{ success: boolean; id: string }>(
        'communications/messages/attachments/create', args, { retryable: false },
      ).then(r => {
        if (!r.success) throw new Error('Failed to create attachment record');
        return r.id;
      }),
  });
}

export interface CreateThreadArgs extends Record<string, unknown> {
  threadType?:        'direct' | 'group' | 'record' | 'system';
  subject?:           string;
  sourceModule?:      string | null;
  sourceEntityType?:  string | null;
  sourceEntityId?:    string | null;
  participantUserIds: string[];
  body:               string;
  attachmentIds?:     string[];
}

export function useCreateMessageThread() {
  const qc = useQueryClient();
  return useMutation({
    // apiPost never rejects, so we must throw on a non-success body — otherwise
    // TanStack treats a failed create as a success: onSuccess fires with an
    // undefined threadId (opening a broken thread) and isError never flips, so
    // the dialog's error banner never shows.
    mutationFn: async (args: CreateThreadArgs) => {
      const res = await apiPost<{ success: boolean; threadId: string; message?: string }>(
        'communications/messages/createThread', args, { retryable: false },
      );
      if (!res.success || !res.threadId) throw new Error(res.message ?? 'Failed to create thread');
      return res;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

// ── Messages — extended API (canonical backend, shared camelCase contract) ──────
// Thread / participant / post / attachment / recipient shapes are the shared DTOs
// re-exported at the top of this file (single source: types/messaging.ts).

export interface ThreadFilters extends Record<string, unknown> {
  tab?:    'inbox' | 'sent' | 'archived' | 'all';
  search?: string;
  limit?:  number;
  cursor?: string | null;
}

/** Full thread list with richer typing — replaces the legacy useMessageThreads. */
export function useMessageThreadsFull(filters: ThreadFilters = {}) {
  return useQuery({
    queryKey: messageKeys.threads(filters),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessageThreadListItem[]; nextCursor: string | null }>(
        'communications/messages/threads',
        { limit: 50, ...filters },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load message threads');
      return res.data;
    },
  });
}

/** Single thread detail (subject + participants). */
export function useThread(threadId: string) {
  return useQuery({
    queryKey: messageKeys.thread(threadId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessageThreadDetail }>(
        'communications/messages/thread',
        { threadId },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load thread');
      return res.data;
    },
    enabled: !!threadId,
  });
}

/** A thread-access error carrying the backend's access code (compliance_required / forbidden). */
export class ThreadAccessError extends Error {
  code: 'compliance_required' | 'forbidden' | undefined;
  constructor(message: string, code?: 'compliance_required' | 'forbidden') {
    super(message);
    this.name = 'ThreadAccessError';
    this.code = code;
  }
}

/** Posts for a thread — richer than useMessagePosts (author profiles, edit/delete states). */
export function useThreadPosts(threadId: string) {
  return useQuery({
    queryKey: messageKeys.posts(threadId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessagePostRow[]; code?: 'compliance_required' | 'forbidden'; message?: string }>(
        'communications/messages/posts',
        { threadId, limit: 100 },
        { signal },
      );
      if (!res.success) throw new ThreadAccessError(res.message ?? 'Failed to load posts', res.code);
      return res.data;
    },
    enabled: !!threadId,
    // Don't burn retries on an access denial — it won't change without a grant.
    retry: (count: number, err: unknown) => !(err instanceof ThreadAccessError && err.code) && count < 2,
  });
}

/** Fire-and-forget mark-read (called when thread opens). */
export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      apiPost<{ success: boolean }>(
        'communications/messages/markRead', { threadId }, { retryable: false },
      ),
    onSuccess: (_r: unknown, _threadId: string) => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

// ── Rich Message Center: pins · drafts · presence · attachments ─────────────────

export interface OnlineUser { userId: string; displayName: string | null; initials: string; status: PresenceStatus; profileImage: string | null }
export interface PinnedThreadRow { threadId: string; subject: string | null; note: string | null; pinnedAt: string }

/** Pinned-conversations summary for the sidebar. */
export function usePinnedSummary() {
  return useQuery({
    queryKey: messageKeys.pinnedSummary(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: PinnedThreadRow[] }>('communications/messages/pins/pinned-summary', {}, { signal });
      return res.success ? res.data : [];
    },
    staleTime: 30_000,
  });
}

/** Active pins (thread + own personal) for a thread. */
export function usePins(threadId: string) {
  return useQuery({
    queryKey: messageKeys.pins(threadId),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessagePin[] }>('communications/messages/pins/list', { threadId }, { signal });
      return res.success ? res.data : [];
    },
    enabled: !!threadId,
  });
}

export function usePinMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; postId?: string | null; pinType: 'thread' | 'post'; visibility?: 'thread' | 'personal'; note?: string | null }) =>
      apiPost<{ success: boolean; message?: string }>('communications/messages/pins/pin', input, { retryable: false })
        .then(r => { if (!r.success) throw new Error(r.message ?? 'Failed to pin'); return r; }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: messageKeys.pins(v.threadId) });
      void qc.invalidateQueries({ queryKey: messageKeys.pinnedSummary() });
    },
  });
}

export function useUnpinMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pinId }: { pinId: string; threadId: string }) =>
      apiPost<{ success: boolean; message?: string }>('communications/messages/pins/unpin', { pinId }, { retryable: false })
        .then(r => { if (!r.success) throw new Error(r.message ?? 'Failed to unpin'); return r; }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: messageKeys.pins(v.threadId) });
      void qc.invalidateQueries({ queryKey: messageKeys.pinnedSummary() });
    },
  });
}

// Soft-delete a message (own within 15 min, or moderation with a reason via delete_any).
export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, reason }: { postId: string; threadId: string; reason?: string | null }) =>
      apiPost<{ success: boolean; message?: string; postId?: string; deletedAt?: string }>(
        'communications/messages/delete', { postId, reason: reason ?? null }, { retryable: false })
        .then(r => { if (!r.success) throw new Error(r.message ?? 'Failed to delete message'); return r; }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: messageKeys.posts(v.threadId) });
      void qc.invalidateQueries({ queryKey: messageKeys.thread(v.threadId) });
    },
  });
}

/** Online-now users (also a presence heartbeat for the caller). */
export function useOnlineUsers() {
  return useQuery({
    queryKey: messageKeys.online(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: OnlineUser[] }>('communications/messages/online', {}, { signal });
      return res.success ? res.data : [];
    },
    refetchInterval: 60_000,   // also keeps the caller's presence fresh
    staleTime: 30_000,
  });
}

/** Get the caller's draft for a thread. */
export function useDraft(threadId: string) {
  return useQuery({
    queryKey: messageKeys.draft(threadId),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: { body: string | null; replyToPostId: string | null } | null }>('communications/messages/draft/get', { threadId }, { signal });
      return res.success ? res.data : null;
    },
    enabled: !!threadId,
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; body: string | null; replyToPostId?: string | null }) =>
      apiPost<{ success: boolean }>('communications/messages/draft/save', input, { retryable: false }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: messageKeys.draft(v.threadId) }); },
  });
}

/** Fetch a permission-checked signed URL for an attachment, by purpose. */
export function useAttachmentUrl() {
  return useMutation({
    mutationFn: (input: { attachmentId: string; purpose?: 'thumbnail' | 'preview' | 'download' }) =>
      apiPost<{ success: boolean; data?: { url: string | null }; message?: string }>('communications/messages/attachments/get-url', input, { retryable: false })
        .then(r => { if (!r.success) throw new Error(r.message ?? 'Failed'); return r.data?.url ?? null; }),
  });
}

/** Archive / unarchive a thread. */
export function useArchiveThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, archived }: { threadId: string; archived: boolean }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/archive', { threadId, archived }, { retryable: false },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

/** Mute / unmute thread notifications (per-user). */
export function useMuteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, muted }: { threadId: string; muted: boolean }) =>
      apiPost<{ success: boolean }>('communications/messages/mute', { threadId, muted }, { retryable: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

/** Add participants to a thread. */
export function useAddThreadParticipants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, userIds }: { threadId: string; userIds: string[] }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/participants/add', { threadId, userIds }, { retryable: false },
      ),
    onSuccess: (_r: unknown, { threadId }: { threadId: string; userIds: string[] }) => {
      void qc.invalidateQueries({ queryKey: messageKeys.thread(threadId) });
    },
  });
}

/** Remove a participant from a thread. */
export function useRemoveThreadParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, userId }: { threadId: string; userId: string }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/participants/remove', { threadId, userId }, { retryable: false },
      ),
    onSuccess: (_r: unknown, { threadId }: { threadId: string; userId: string }) => {
      void qc.invalidateQueries({ queryKey: messageKeys.thread(threadId) });
    },
  });
}

// Compliance access is no longer a self-service flow from the Messenger. Audited,
// case-scoped, time-limited compliance reads/exports now live entirely in the
// Compliance workspace (src/api/communicationsCompliance.ts + the compliance/*
// components). The old self-grant request + all-thread search hooks were removed
// at cutover; there is no inline "request access" dialog. A user who needs to
// read another party's thread opens the Compliance workspace and files a case.

/**
 * Find-or-create the discussion thread for a business record, joining the caller.
 * Requires communications.thread_create + view access to the record.
 */
export function useResolveRecordThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sourceModule: string; sourceEntityType: string; sourceEntityId: string; recordRef?: string | null; subject?: string | null }) =>
      apiPost<{ success: boolean; data?: { threadId: string; created: boolean }; message?: string }>(
        'communications/messages/recordThread', args, { retryable: false },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

/** Full-text search across messages. */
export function useMessageSearch(query: string) {
  return useQuery({
    queryKey: messageKeys.search(query),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessageThreadListItem[] }>(
        'communications/messages/search',
        { query, limit: 20 },
        { signal },
      );
      if (!res.success) throw new Error('Search failed');
      return res.data;
    },
    enabled: query.trim().length >= 2,
  });
}

/** Recipient picker — autocomplete from the backend. */
export function useMessageRecipients(query = '') {
  return useQuery({
    queryKey: messageKeys.recipients(query),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessageRecipient[] }>(
        'communications/messages/recipients',
        { query: query || undefined },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load recipients');
      return res.data;
    },
    staleTime: 60_000,
  });
}

// ── Tickets ───────────────────────────────────────────────────────────────────

export interface TicketListArgs extends Record<string, unknown> {
  status?:    string | null;
  scope?:     'mine' | 'assigned' | 'queue' | 'all';
  queueCode?: string | null;
  priority?:  'low' | 'medium' | 'high' | 'critical' | null;
  requestTypeCode?: string | null;
  tagKey?:    string | null;
  search?:    string | null;
  limit?:     number;
  cursor?:    string | null;
}

export function useMyTickets(args: TicketListArgs = {}) {
  return useQuery({
    queryKey: ticketKeys.list(args),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalTicket[] }>(
        'communications/tickets/list',
        { scope: 'mine', limit: 50, ...args },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load tickets');
      return res.data;
    },
  });
}

export function useTicketRequestTypes() {
  return useQuery({
    queryKey: ticketKeys.requestTypes(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: TicketRequestType[] }>(
        'communications/tickets/request-types', {}, { signal },
      );
      if (!res.success) throw new Error('Failed to load ticket request types');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: ticketKeys.detail(ticketId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalTicketDetail }>(
        'communications/tickets/get',
        { ticketId },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load ticket');
      return res.data;
    },
    enabled: !!ticketId,
  });
}

export interface CreateTicketArgs extends Record<string, unknown> {
  requestTypeCode:  string;
  priority?:        'low' | 'medium' | 'high' | 'critical';
  subject:          string;
  description:      string;
  creationMode?:    'self' | 'team' | 'on_behalf' | 'internal';
  requesterId?:     string | null;
  creationReason?:  string | null;
  sourceModule?:    string | null;
  sourceEntityType?: string | null;
  sourceEntityId?:  string | null;
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateTicketArgs) => {
      const res = await apiPost<{ success: boolean; data: { ticketId: string; ticketNumber: string }; message?: string }>(
        'communications/tickets/create',
        { ...args, idempotencyKey: crypto.randomUUID() },
        { retryable: false },
      );
      if (!res.success) throw new Error(res.message ?? 'Failed to create ticket');
      return res;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export interface CommentTicketArgs extends Record<string, unknown> {
  ticketId:   string;
  body:       string;
  isInternal?: boolean;
}

export function useCommentTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CommentTicketArgs) => {
      const res = await apiPost<{ success: boolean; data: Record<string, unknown>; message?: string }>(
        'communications/tickets/comment',
        { ...args, idempotencyKey: crypto.randomUUID() },
        { retryable: false },
      );
      if (!res.success) throw new Error(res.message ?? 'Failed to add ticket comment');
      return res;
    },
    onSuccess: (_r: unknown, vars: CommentTicketArgs) => {
      void qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export interface UpdateTicketArgs extends Record<string, unknown> {
  ticketId: string;
  action:
    | 'assign' | 'start' | 'wait_requester' | 'resolve' | 'close'
    | 'reopen' | 'cancel' | 'set_priority' | 'add_tag' | 'remove_tag'
    | 'watch' | 'unwatch';
  payload?: Record<string, unknown>;
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UpdateTicketArgs) => {
      const res = await apiPost<{ success: boolean; data: Record<string, unknown>; message?: string }>(
        'communications/tickets/command',
        { ...args, idempotencyKey: crypto.randomUUID() },
        { retryable: false },
      );
      if (!res.success) throw new Error(res.message ?? 'Failed to update ticket');
      return res;
    },
    onSuccess: (_r: unknown, vars: UpdateTicketArgs) => {
      void qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

export function useMarkTicketRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { ticketId: string; sequence?: number | null }) =>
      apiPost<{ success: boolean; data: Record<string, unknown> }>(
        'communications/tickets/mark-read', args, { retryable: false },
      ).then(res => {
        if (!res.success) throw new Error('Failed to mark ticket as read');
        return res.data;
      }),
    // Optimistic: clear the ticket's unread indicator in every list cache and the
    // detail, and drop the top-bar unread count by one — so the row and the badge
    // update instantly. Snapshots are returned for rollback on failure.
    onMutate: async (args: { ticketId: string; sequence?: number | null }) => {
      await qc.cancelQueries({ queryKey: ticketKeys.all });
      await qc.cancelQueries({ queryKey: communicationKeys.summary() });
      const listSnapshots = qc.getQueriesData<CanonicalTicket[]>({ queryKey: [...ticketKeys.all, 'list'] });
      const summarySnapshot = qc.getQueryData<CommsSummary>(communicationKeys.summary());
      const detailSnapshot = qc.getQueryData<CanonicalTicketDetail>(ticketKeys.detail(args.ticketId));
      const wasUnread =
        listSnapshots.some(([, data]) => data?.some(t => t.id === args.ticketId && t.unreadCount > 0))
        || (detailSnapshot?.unreadCount ?? 0) > 0;
      qc.setQueriesData<CanonicalTicket[]>({ queryKey: [...ticketKeys.all, 'list'] }, old =>
        old?.map(t => (t.id === args.ticketId ? { ...t, unreadCount: 0, lastReadSequence: t.activitySequence } : t)));
      if (detailSnapshot) {
        qc.setQueryData<CanonicalTicketDetail>(ticketKeys.detail(args.ticketId), { ...detailSnapshot, unreadCount: 0 });
      }
      if (wasUnread && summarySnapshot) {
        qc.setQueryData<CommsSummary>(communicationKeys.summary(), {
          ...summarySnapshot, ticketsUnread: Math.max(0, summarySnapshot.ticketsUnread - 1),
        });
      }
      return { listSnapshots, summarySnapshot, detailSnapshot };
    },
    onError: (_err, args, ctx) => {
      ctx?.listSnapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.summarySnapshot) qc.setQueryData(communicationKeys.summary(), ctx.summarySnapshot);
      if (ctx?.detailSnapshot) qc.setQueryData(ticketKeys.detail(args.ticketId), ctx.detailSnapshot);
    },
    // Reconcile with the server whatever the outcome — the spec requires invalidating
    // ticketKeys.all, the selected detail, and the summary even on rollback.
    onSettled: (_result, _err, args) => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
      void qc.invalidateQueries({ queryKey: ticketKeys.detail(args.ticketId) });
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export async function uploadTicketAttachment(ticketId: string, file: File): Promise<string> {
  const reserved = await apiPost<{
    success: boolean;
    data: { attachmentId: string; uploadUrl: string };
    message?: string;
  }>('communications/tickets/attachments/upload-url', {
    ticketId,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  }, { retryable: false });
  if (!reserved.success) throw new Error(reserved.message ?? 'Could not reserve attachment upload');
  const uploaded = await fetch(reserved.data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!uploaded.ok) throw new Error('Attachment upload failed');
  const completed = await apiPost<{ success: boolean; message?: string }>(
    'communications/tickets/attachments/complete',
    { attachmentId: reserved.data.attachmentId, idempotencyKey: crypto.randomUUID() },
    { retryable: false },
  );
  if (!completed.success) throw new Error(completed.message ?? 'Could not complete attachment upload');
  return reserved.data.attachmentId;
}

export async function getTicketAttachmentUrl(attachmentId: string): Promise<string> {
  const res = await apiPost<{ success: boolean; data: { url: string }; message?: string }>(
    'communications/tickets/attachments/get-url', { attachmentId },
  );
  if (!res.success) throw new Error(res.message ?? 'Could not open attachment');
  return res.data.url;
}
