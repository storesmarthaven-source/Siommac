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
  notificationsUnread: number;
  messagesUnread:      number;
  ticketsOpen:         number;
  ticketsUnread:       number;
  workflowTasks:       number;
  handoffFailures:     number;
  realtimeChannelKey:  string;
}

export interface CanonicalNotification {
  id:           string;
  type:         string;
  module:       string | null;
  severity:     string;
  title:        string;
  body:         string | null;
  source_type:  string | null;
  source_id:    string | null;
  action_route: string | null;
  is_read:      boolean;
  created_at:   string;
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
  limit?:      number;
  cursor?:     string | null;
  unreadOnly?: boolean;
}

export function useNotifications(args: NotificationListArgs = {}) {
  return useQuery({
    queryKey: notificationKeys.mine(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: CanonicalNotification[] }>(
        'communications/notifications/list',
        { args: { limit: 30, ...args } },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load notifications');
      return res.data;
    },
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
    mutationFn: () =>
      apiPost<{ success: boolean }>(
        'communications/notifications/markAllRead',
        { args: {} },
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
  subject:            string;
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
