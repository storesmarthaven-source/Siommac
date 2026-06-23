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
  realtimeChannelKey:  string;
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

export interface NotificationPreference {
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
  id:                  string;
  ticket_number:       string;
  category:            string;
  priority:            string;
  status:              string;
  subject:             string;
  sla_due_at:          string | null;
  created_at:          string;
  requester_user_id:   string | null;
  assignee_user_id:    string | null;
}

export interface CanonicalTicketDetail {
  ticket:   CanonicalTicket & { description: string; resolved_at: string | null; closed_at: string | null };
  comments: Array<{
    id:             string;
    author_user_id: string | null;
    body:           string;
    is_internal:    boolean;
    is_system:      boolean;
    created_at:     string;
  }>;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function useCommsSummary() {
  return useQuery({
    queryKey: communicationKeys.summary(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CommsSummary }>(
        'communications/summary', { args: {} }, { signal },
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
        { args: { limit: 30, ...args } },
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
        'communications/notifications/preferences/get', { args: {} }, { signal },
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
      apiPost<{ success: boolean }>('communications/notifications/preferences/set', { args }, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.preferences() }),
  });
}

export function useMuteNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { scope: string; mutedUntil?: string | null; clear?: boolean }) =>
      apiPost<{ success: boolean }>('communications/notifications/mute', { args }, { retryable: false }),
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
      apiPost<{ success: boolean; recipientCount: number }>('communications/notifications/broadcast', { args }, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: communicationKeys.summary() }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/markRead',
        { args: { notificationId } },
        { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { module?: string } = {}) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/markAllRead',
        { args },
        { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export function useArchiveNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { notificationId?: string; all?: boolean }) =>
      apiPost<{ success: boolean }>(
        'communications/notifications/archive',
        { args },
        { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
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
        { args: { limit } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load message threads');
      return res.data;
    },
  });
}

export function useMessagePosts(threadId: string) {
  return useQuery({
    queryKey: messageKeys.thread(threadId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessagePost[] }>(
        'communications/messages/posts',
        { args: { threadId, limit: 50 } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load posts');
      return res.data;
    },
    enabled: !!threadId,
  });
}

export interface PostMessageArgs extends Record<string, unknown> {
  threadId: string;
  body:     string;
}

export function usePostMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PostMessageArgs) =>
      apiPost<{ success: boolean; postId: string }>(
        'communications/messages/post', { args }, { retryable: false },
      ),
    onSuccess: (_r: unknown, vars: PostMessageArgs) => {
      qc.invalidateQueries({ queryKey: messageKeys.thread(vars.threadId) });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
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
}

export function useCreateMessageThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateThreadArgs) =>
      apiPost<{ success: boolean; threadId: string }>(
        'communications/messages/createThread', { args }, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messageKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

// ── Messages — extended API (canonical backend Phase 1-4) ───────────────────

/** Full interface returned by communications/messages/threads */
export interface MessageThreadListItem {
  id:                  string;
  thread_type:         'direct' | 'group' | 'record' | 'system';
  subject:             string | null;
  source_module:       string | null;
  source_entity_type:  string | null;
  source_entity_id:    string | null;
  created_by:          string | null;
  created_at:          string;
  unread_count:        number;
  last_post_body:      string | null;
  last_post_at:        string | null;
  last_post_by:        string | null;
  participant_count:   number;
  participants:        MessageParticipantProfile[];
  is_archived:         boolean;
  role:                string;
}

export interface MessageParticipantProfile {
  user_id:     string;
  full_name:   string | null;
  username:    string | null;
  profile_image: string | null;
  role:        string;
}

export interface MessageThreadDetail {
  thread:       MessageThreadListItem;
  participants: MessageParticipantProfile[];
}

export interface MessagePostRow {
  id:             string;
  thread_id:      string;
  author_user_id: string | null;
  author_profile: MessageParticipantProfile | null;
  body:           string;
  is_system:      boolean;
  is_edited:      boolean;
  is_deleted:     boolean;
  created_at:     string;
  edited_at:      string | null;
}

export interface MessageRecipient {
  user_id:       string;
  full_name:     string | null;
  username:      string | null;
  profile_image: string | null;
  role:          string;
  department:    string | null;
}

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
        { args: { limit: 50, ...filters } },
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
        { args: { threadId } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load thread');
      return res.data;
    },
    enabled: !!threadId,
  });
}

/** Posts for a thread — richer than useMessagePosts (author profiles, edit/delete states). */
export function useThreadPosts(threadId: string) {
  return useQuery({
    queryKey: messageKeys.posts(threadId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: MessagePostRow[] }>(
        'communications/messages/posts',
        { args: { threadId, limit: 100 } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load posts');
      return res.data;
    },
    enabled: !!threadId,
  });
}

/** Fire-and-forget mark-read (called when thread opens). */
export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      apiPost<{ success: boolean }>(
        'communications/messages/markRead', { args: { threadId } }, { retryable: false },
      ),
    onSuccess: (_r: unknown, threadId: string) => {
      qc.invalidateQueries({ queryKey: messageKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

/** Archive / unarchive a thread. */
export function useArchiveThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, archived }: { threadId: string; archived: boolean }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/archive', { args: { threadId, archived } }, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messageKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

/** Add participants to a thread. */
export function useAddThreadParticipants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, userIds }: { threadId: string; userIds: string[] }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/participants/add', { args: { threadId, userIds } }, { retryable: false },
      ),
    onSuccess: (_r: unknown, { threadId }: { threadId: string; userIds: string[] }) => {
      qc.invalidateQueries({ queryKey: messageKeys.thread(threadId) });
    },
  });
}

/** Remove a participant from a thread. */
export function useRemoveThreadParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, userId }: { threadId: string; userId: string }) =>
      apiPost<{ success: boolean }>(
        'communications/messages/participants/remove', { args: { threadId, userId } }, { retryable: false },
      ),
    onSuccess: (_r: unknown, { threadId }: { threadId: string; userId: string }) => {
      qc.invalidateQueries({ queryKey: messageKeys.thread(threadId) });
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
        { args: { query, limit: 20 } },
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
        { args: { query: query || undefined } },
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
  status?: string;
  mine?:   boolean;
  limit?:  number;
}

export function useMyTickets(args: TicketListArgs = {}) {
  return useQuery({
    queryKey: ticketKeys.mine(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalTicket[] }>(
        'communications/tickets/list',
        { args: { mine: true, limit: 50, ...args } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load tickets');
      return res.data;
    },
  });
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: ticketKeys.detail(ticketId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalTicketDetail }>(
        'communications/tickets/get',
        { args: { ticketId } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load ticket');
      return res.data;
    },
    enabled: !!ticketId,
  });
}

export interface CreateTicketArgs extends Record<string, unknown> {
  category:         string;
  priority?:        'low' | 'medium' | 'high' | 'critical';
  subject:          string;
  description:      string;
  sourceModule?:    string | null;
  sourceEntityType?: string | null;
  sourceEntityId?:  string | null;
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateTicketArgs) =>
      apiPost<{ success: boolean; ticketId: string; ticketNumber: string }>(
        'communications/tickets/create', { args }, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
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
    mutationFn: (args: CommentTicketArgs) =>
      apiPost<{ success: boolean }>(
        'communications/tickets/comment', { args }, { retryable: false },
      ),
    onSuccess: (_r: unknown, vars: CommentTicketArgs) => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export interface UpdateTicketArgs extends Record<string, unknown> {
  ticketId:    string;
  status?:     string;
  assigneeId?: string | null;
  priority?:   string;
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateTicketArgs) =>
      apiPost<{ success: boolean }>(
        'communications/tickets/update', { args }, { retryable: false },
      ),
    onSuccess: (_r: unknown, vars: UpdateTicketArgs) => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}
