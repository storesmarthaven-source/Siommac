/**
 * netlify/functions/lib/communications.ts
 *
 * Communications backbone — summary, signals, thread management, tickets.
 *
 * The three communication channels:
 *   Notifications — system-generated alerts (readonly for recipient)
 *   Messages      — human/record conversations (threads + posts)
 *   Tickets       — service/escalation cases with SLA
 *
 * Supabase Realtime is triggered by inserting into communication_signals
 * (which has no business payload — safe to expose). The browser client
 * subscribes filtered by its session channel_key and calls
 * /api/communications/summary on any signal.
 */

import { sb }          from './db';
import { emitAppEvent } from './appEvents';

// ── Realtime signal emission ───────────────────────────────────────────────────

/**
 * Emit one signal per unique user so their browser invalidates badge counts.
 * Best-effort — never throws.
 */
export async function emitSignal(
  userIds: string[],
  domain:  'summary' | 'notifications' | 'messages' | 'tickets' | 'workflow' | 'handoffs',
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    // Fetch channel_keys for these users
    const { data: channels } = await sb
      .from('user_realtime_channels')
      .select('user_id, channel_key')
      .in('user_id', userIds)
      .gt('expires_at', new Date().toISOString()) as {
        data: Array<{ user_id: string; channel_key: string }> | null
      };

    if (!channels || channels.length === 0) return;

    const signals = channels.map(c => ({ channel_key: c.channel_key, domain }));
    await sb.from('communication_signals').insert(signals).then(({ error }) => {
      if (error) console.warn('[communications] signal insert failed:', error.message);
    });
  } catch (e) {
    console.warn('[communications] emitSignal failed:', e);
  }
}

// ── Communications summary ─────────────────────────────────────────────────────

export interface CommsSummary {
  notificationsUnread:         number;
  notificationsTotal:          number; // active (not archived)
  notificationsActionRequired: number; // action_required & pending, active
  notificationsCritical:       number; // unread critical, active
  notificationsArchived:       number;
  messagesUnread:      number;
  ticketsOpen:         number;
  ticketsUnread:       number;
  workflowTasks:       number;
  handoffFailures:     number;
  realtimeChannelKey:  string;
}

/**
 * Aggregate badge counts for the authenticated user.
 * Called by POST /api/communications/summary.
 */
export async function getCommsSummary(userId: string, role: string): Promise<CommsSummary> {
  const channelKey = await _ensureRealtimeChannel(userId);

  const nowIso = new Date().toISOString();
  // Active = not archived and not expired. `sb` is the untyped service client,
  // so the chained filter builder is typed as `any` here by design.
  const notActive = <T>(q: T): T =>
    (q as { is: (c: string, v: null) => { or: (f: string) => T } })
      .is('archived_at', null).or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  const [
    notifRes, notifTotalRes, notifActionRes, notifCritRes, notifArchRes,
    msgRes, ticketRes, workflowRes, handoffRes,
  ] = await Promise.allSettled([
    notActive(sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)),

    notActive(sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)),

    notActive(sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_required', true)
      .eq('action_status', 'pending')),

    notActive(sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('severity', 'critical')
      .eq('is_read', false)),

    sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('archived_at', 'is', null),

    // Canonical unread: threads where user is active participant and at least
    // one post by another author exists after last_read_at.
    _countUnreadThreads(userId),

    sb.from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('requester_user_id', userId)
      .in('status', ['open','assigned','in_progress','waiting_requester','reopened']),

    // Workflow tasks assigned to this user or their role
    _countWorkflowTasks(userId, role),

    // Handoff failures visible to admin/manager
    ['admin','manager','superadmin'].includes(role)
      ? sb.from('handoff_outbox')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'manual_review')
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    notificationsUnread:         _countFromSettled(notifRes),
    notificationsTotal:          _countFromSettled(notifTotalRes),
    notificationsActionRequired: _countFromSettled(notifActionRes),
    notificationsCritical:       _countFromSettled(notifCritRes),
    notificationsArchived:       _countFromSettled(notifArchRes),
    messagesUnread:      _countFromSettled(msgRes),
    ticketsOpen:         _countFromSettled(ticketRes),
    ticketsUnread:       0, // TODO: per-ticket unread tracking
    workflowTasks:       typeof workflowRes === 'object' && workflowRes.status === 'fulfilled'
                           ? (workflowRes.value as number) : 0,
    handoffFailures:     _countFromSettled(handoffRes),
    realtimeChannelKey:  channelKey,
  };
}

function _countFromSettled(result: PromiseSettledResult<unknown>): number {
  if (result.status !== 'fulfilled') return 0;
  const r = result.value as { count?: number | null } | null;
  return r?.count ?? 0;
}

async function _countWorkflowTasks(userId: string, role: string): Promise<number> {
  const { count: byUser } = await sb
    .from('workflow_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_user_id', userId)
    .eq('status', 'open');

  const { count: byRole } = await sb
    .from('workflow_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_role', role)
    .is('assigned_user_id', null)
    .eq('status', 'open');

  return (byUser ?? 0) + (byRole ?? 0);
}

// ── Realtime channel management ────────────────────────────────────────────────

async function _ensureRealtimeChannel(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h

  const { data } = await sb
    .from('user_realtime_channels')
    .upsert({ user_id: userId, expires_at: expiresAt }, { onConflict: 'user_id' })
    .select('channel_key')
    .single<{ channel_key: string }>();

  return data?.channel_key ?? crypto.randomUUID();
}

// ── Canonical unread thread count ─────────────────────────────────────────────

/**
 * Count threads where the user is an active (removed_at null) participant
 * and there is at least one post by another author created after the user's
 * last_read_at (treating null as epoch) that hasn't been soft-deleted.
 *
 * We use a raw RPC / subquery via PostgREST's filter capabilities:
 * For each participant row, compare last_post_at on the thread against last_read_at.
 * This is a close-enough approximation that is fully server-side.
 */
async function _countUnreadThreads(userId: string): Promise<{ count: number | null }> {
  // Join participants → threads and count where last_post_at > coalesce(last_read_at, epoch)
  // and the thread has at least one post not by this user.
  // PostgREST doesn't support cross-column comparisons natively, so we run a
  // manual count via the service client's `rpc` or a raw filter workaround.
  // We use the approach of fetching participant rows with last_post_at embedded
  // via a join and counting in JS — safe because active users typically have < 1000 threads.
  const { data, error } = await sb
    .from('message_participants')
    .select('last_read_at, message_threads!inner(last_post_at)')
    .eq('user_id', userId)
    .is('removed_at', null) as {
      data: Array<{ last_read_at: string | null; message_threads: { last_post_at: string | null } }> | null;
      error: { message: string } | null;
    };

  if (error || !data) return { count: 0 };

  const epoch = new Date(0).toISOString();
  const unread = data.filter(row => {
    const lastPostAt = row.message_threads?.last_post_at;
    if (!lastPostAt) return false;
    const readAt = row.last_read_at ?? epoch;
    return lastPostAt > readAt;
  });

  return { count: unread.length };
}

// ── Message threads ────────────────────────────────────────────────────────────

export interface CreateThreadInput {
  threadType:         'direct' | 'group' | 'record' | 'system';
  subject:            string;
  sourceModule?:      string | null;
  sourceEntityType?:  string | null;
  sourceEntityId?:    string | null;
  createdBy:          string;
  participantUserIds: string[];
  body:               string;
  attachmentIds?:     string[];
}

export interface CreateThreadResult {
  ok:       boolean;
  threadId?: string;
  postId?:   string;
}

export async function createMessageThread(input: CreateThreadInput): Promise<CreateThreadResult> {
  try {
    const now = new Date().toISOString();
    const preview = input.body.slice(0, 140);

    const { data: thread, error: threadErr } = await sb
      .from('message_threads')
      .insert({
        thread_type:        input.threadType,
        subject:            input.subject,
        source_module:      input.sourceModule ?? null,
        source_entity_type: input.sourceEntityType ?? null,
        source_entity_id:   input.sourceEntityId ?? null,
        created_by:         input.createdBy,
        last_post_at:       now,
        last_post_preview:  preview,
      })
      .select('id')
      .single<{ id: string }>();

    if (threadErr || !thread) {
      console.error('[communications] createThread failed:', threadErr?.message);
      return { ok: false };
    }

    const threadId = thread.id;

    // Add participants (deduplicate, creator is owner)
    const participantIds = [...new Set([input.createdBy, ...input.participantUserIds])];
    await sb.from('message_participants').insert(
      participantIds.map(uid => ({
        thread_id:  threadId,
        user_id:    uid,
        role:       uid === input.createdBy ? 'owner' : 'participant',
        joined_at:  now,
      })),
    );

    // Add first post
    const attachmentCount = (input.attachmentIds ?? []).length;
    const { data: post, error: postErr } = await sb
      .from('message_posts')
      .insert({
        thread_id:        threadId,
        author_user_id:   input.createdBy,
        body:             input.body,
        attachment_count: attachmentCount,
      })
      .select('id')
      .single<{ id: string }>();

    if (postErr) console.warn('[communications] createThread first post failed:', postErr.message);

    // Link any pre-uploaded attachments
    if (post && input.attachmentIds && input.attachmentIds.length > 0) {
      await sb.from('message_attachments')
        .update({ post_id: post.id })
        .in('id', input.attachmentIds);
    }

    // Fetch author display name for notification body
    const { data: actor } = await sb
      .from('app_users')
      .select('display_name, email')
      .eq('id', input.createdBy)
      .maybeSingle<{ display_name: string | null; email: string }>();
    const actorName = actor?.display_name ?? actor?.email ?? 'Someone';

    // Signal + notify other participants
    const others = participantIds.filter(uid => uid !== input.createdBy);
    if (others.length > 0) {
      void emitSignal(others, 'messages');
      void emitAppEvent({
        eventType:          'communications.thread.created',
        sourceModule:       'communications',
        sourceEntityType:   'message_thread',
        sourceEntityId:     threadId,
        actorUserId:        input.createdBy,
        severity:           'info',
        explicitRecipients: others.map(uid => ({ userId: uid, reason: 'explicit' as const })),
        notification: {
          title:       'New conversation',
          body:        `${actorName} started a conversation: ${input.subject}`,
          actionRoute: 's-messages',
        },
      });
    }

    return { ok: true, threadId, postId: post?.id };
  } catch (e) {
    console.error('[communications] createMessageThread failed:', e);
    return { ok: false };
  }
}

// ── postMessage ────────────────────────────────────────────────────────────────

export interface PostMessageInput {
  currentUserId: string;
  threadId:      string;
  body:          string;
  attachmentIds?: string[];
}

export interface PostMessageResult {
  ok:         boolean;
  postId?:    string;
  threadId?:  string;
  createdAt?: string;
  message?:   string;
}

export async function postMessage(input: PostMessageInput): Promise<PostMessageResult> {
  try {
    // Validate the user is an active participant (removed_at null)
    const { data: part } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', input.threadId)
      .eq('user_id', input.currentUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    if (!part) return { ok: false, message: 'Not an active participant in this thread' };

    const now = new Date().toISOString();
    const attachmentCount = (input.attachmentIds ?? []).length;

    const { data: post, error: postErr } = await sb
      .from('message_posts')
      .insert({
        thread_id:        input.threadId,
        author_user_id:   input.currentUserId,
        body:             input.body,
        attachment_count: attachmentCount,
      })
      .select('id, created_at')
      .single<{ id: string; created_at: string }>();

    if (postErr || !post) {
      return { ok: false, message: postErr?.message ?? 'Failed to insert post' };
    }

    // Link any pre-uploaded attachments
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await sb.from('message_attachments')
        .update({ post_id: post.id })
        .in('id', input.attachmentIds);
    }

    // Update thread last_post summary
    const preview = input.body.slice(0, 140);
    await sb.from('message_threads')
      .update({ last_post_at: now, last_post_preview: preview })
      .eq('id', input.threadId);

    // Fetch other active participants to notify
    const { data: othersData } = await sb
      .from('message_participants')
      .select('user_id')
      .eq('thread_id', input.threadId)
      .neq('user_id', input.currentUserId)
      .is('removed_at', null) as { data: Array<{ user_id: string }> | null };

    const others = (othersData ?? []).map(o => o.user_id);

    if (others.length > 0) {
      // Fetch author name
      const { data: actor } = await sb
        .from('app_users')
        .select('display_name, email')
        .eq('id', input.currentUserId)
        .maybeSingle<{ display_name: string | null; email: string }>();
      const actorName = actor?.display_name ?? actor?.email ?? 'Someone';

      void emitSignal(others, 'messages');
      void emitAppEvent({
        eventType:          'communications.message.received',
        sourceModule:       'communications',
        sourceEntityType:   'message_post',
        sourceEntityId:     post.id,
        actorUserId:        input.currentUserId,
        severity:           'info',
        dedupeKey:          `msg:${input.threadId}:${post.id}`,
        explicitRecipients: others.map(uid => ({ userId: uid, reason: 'explicit' as const })),
        notification: {
          title:       'New message',
          body:        `${actorName} sent a message…`,
          actionRoute: 's-messages',
        },
      });
    }

    return { ok: true, postId: post.id, threadId: input.threadId, createdAt: post.created_at };
  } catch (e) {
    console.error('[communications] postMessage failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── Thread listing ─────────────────────────────────────────────────────────────

export type ThreadTab = 'inbox' | 'sent' | 'archived' | 'all';

export interface ListThreadsInput {
  userId: string;
  tab?:    ThreadTab;
  search?: string | null;
  limit?:  number;
  cursor?: string | null;
}

export interface ThreadRow {
  threadId:          string;
  threadType:        string;
  subject:           string;
  lastPostAt:        string | null;
  lastPostPreview:   string | null;
  myRole:            string;
  myLastReadAt:      string | null;
  archivedAt:        string | null;
  unreadCount:       number;
  isUnread:          boolean;
  sourceModule:      string | null;
  sourceEntityType:  string | null;
  sourceEntityId:    string | null;
  participants:      ParticipantProfile[];
}

export interface ParticipantProfile {
  userId:      string;
  displayName: string | null;
  email:       string;
  role:        string;
  avatarUrl?:  string | null;
}

export interface ListThreadsResult {
  rows:       ThreadRow[];
  nextCursor: string | null;
}

export async function listThreadsForUser(input: ListThreadsInput): Promise<ListThreadsResult> {
  const { userId, tab = 'inbox', search, limit = 30, cursor } = input;
  const epoch = new Date(0).toISOString();

  try {
    // Fetch participant rows for the user with thread data
    type ParticipantWithThread = {
      thread_id:    string;
      role:         string;
      last_read_at: string | null;
      archived_at:  string | null;
      removed_at:   string | null;
      message_threads: {
        id:                 string;
        thread_type:        string;
        subject:            string;
        last_post_at:       string | null;
        last_post_preview:  string | null;
        source_module:      string | null;
        source_entity_type: string | null;
        source_entity_id:   string | null;
        created_by:         string | null;
      };
    };

    let q = sb
      .from('message_participants')
      .select('thread_id, role, last_read_at, archived_at, removed_at, message_threads!inner(id, thread_type, subject, last_post_at, last_post_preview, source_module, source_entity_type, source_entity_id, created_by)')
      .eq('user_id', userId)
      .is('removed_at', null)
      .order('thread_id', { ascending: false })
      .limit(limit);

    // Tab filters
    if (tab === 'inbox')    q = q.is('archived_at', null);
    if (tab === 'archived') q = q.not('archived_at', 'is', null);
    // 'sent' and 'all' — no extra filter here; 'sent' is filtered post-query

    if (cursor) q = q.lt('thread_id', cursor); // rough cursor; last_post_at cursor applied below

    const { data: rows, error } = await q as {
      data: ParticipantWithThread[] | null;
      error: { message: string } | null;
    };

    if (error || !rows) return { rows: [], nextCursor: null };

    // Filter 'sent': only threads where this user authored ≥1 post
    let filtered = rows;
    if (tab === 'sent') {
      const threadIds = rows.map(r => r.thread_id);
      if (threadIds.length === 0) return { rows: [], nextCursor: null };
      const { data: sentPosts } = await sb
        .from('message_posts')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('author_user_id', userId)
        .is('deleted_at', null) as { data: Array<{ thread_id: string }> | null };
      const sentSet = new Set((sentPosts ?? []).map(p => p.thread_id));
      filtered = rows.filter(r => sentSet.has(r.thread_id));
    }

    // Search filter
    if (search) {
      const needle = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.message_threads.subject.toLowerCase().includes(needle) ||
        (r.message_threads.last_post_preview ?? '').toLowerCase().includes(needle),
      );
    }

    // Sort by last_post_at desc
    filtered.sort((a, b) => {
      const at = a.message_threads.last_post_at ?? a.message_threads.id;
      const bt = b.message_threads.last_post_at ?? b.message_threads.id;
      return bt < at ? -1 : bt > at ? 1 : 0;
    });

    // Apply last_post_at cursor pagination
    if (cursor) {
      filtered = filtered.filter(r => (r.message_threads.last_post_at ?? '') < cursor);
    }

    const page = filtered.slice(0, limit);

    // Batch-fetch all participants for threads in result set
    const threadIdSet = page.map(r => r.thread_id);
    const { data: allParticipants } = threadIdSet.length > 0
      ? await sb
          .from('message_participants')
          .select('thread_id, user_id, role, app_users!inner(display_name, email)')
          .in('thread_id', threadIdSet)
          .is('removed_at', null) as {
            data: Array<{
              thread_id: string;
              user_id:   string;
              role:      string;
              app_users: { display_name: string | null; email: string };
            }> | null;
          }
      : { data: null };

    // Group participants by thread
    const participantMap = new Map<string, ParticipantProfile[]>();
    for (const p of allParticipants ?? []) {
      const list = participantMap.get(p.thread_id) ?? [];
      list.push({
        userId:      p.user_id,
        displayName: p.app_users.display_name,
        email:       p.app_users.email,
        role:        p.role,
      });
      participantMap.set(p.thread_id, list);
    }

    // Compute unread counts per thread
    const { data: unreadPosts } = threadIdSet.length > 0
      ? await sb
          .from('message_participants')
          .select('thread_id, last_read_at')
          .in('thread_id', threadIdSet)
          .eq('user_id', userId)
          .is('removed_at', null) as {
            data: Array<{ thread_id: string; last_read_at: string | null }> | null;
          }
      : { data: null };

    const readAtMap = new Map<string, string>();
    for (const r of unreadPosts ?? []) {
      readAtMap.set(r.thread_id, r.last_read_at ?? epoch);
    }

    // For each thread, count posts after last_read_at not by this user
    const unreadCountMap = new Map<string, number>();
    if (threadIdSet.length > 0) {
      const { data: posts } = await sb
        .from('message_posts')
        .select('thread_id, author_user_id, created_at')
        .in('thread_id', threadIdSet)
        .neq('author_user_id', userId)
        .is('deleted_at', null) as {
          data: Array<{ thread_id: string; author_user_id: string; created_at: string }> | null;
        };

      for (const p of posts ?? []) {
        const readAt = readAtMap.get(p.thread_id) ?? epoch;
        if (p.created_at > readAt) {
          unreadCountMap.set(p.thread_id, (unreadCountMap.get(p.thread_id) ?? 0) + 1);
        }
      }
    }

    const resultRows: ThreadRow[] = page.map(r => {
      const mt       = r.message_threads;
      const unread   = unreadCountMap.get(r.thread_id) ?? 0;
      return {
        threadId:         r.thread_id,
        threadType:       mt.thread_type,
        subject:          mt.subject,
        lastPostAt:       mt.last_post_at,
        lastPostPreview:  mt.last_post_preview,
        myRole:           r.role,
        myLastReadAt:     r.last_read_at,
        archivedAt:       r.archived_at,
        unreadCount:      unread,
        isUnread:         unread > 0,
        sourceModule:     mt.source_module,
        sourceEntityType: mt.source_entity_type,
        sourceEntityId:   mt.source_entity_id,
        participants:     participantMap.get(r.thread_id) ?? [],
      };
    });

    const lastRow    = page[page.length - 1];
    const nextCursor = page.length === limit && lastRow
      ? (lastRow.message_threads.last_post_at ?? null)
      : null;

    return { rows: resultRows, nextCursor };
  } catch (e) {
    console.error('[communications] listThreadsForUser failed:', e);
    return { rows: [], nextCursor: null };
  }
}

// ── getThread ──────────────────────────────────────────────────────────────────

export interface GetThreadResult {
  ok:           boolean;
  message?:     string;
  thread?:      {
    id:                string;
    threadType:        string;
    subject:           string;
    lastPostAt:        string | null;
    lastPostPreview:   string | null;
    sourceModule:      string | null;
    sourceEntityType:  string | null;
    sourceEntityId:    string | null;
    createdBy:         string | null;
    createdAt:         string;
  };
  participants?: ParticipantProfile[];
  myRole?:       string;
  myLastReadAt?: string | null;
  myArchivedAt?: string | null;
}

export async function getThread(threadId: string, userId: string, userRole?: string): Promise<GetThreadResult> {
  try {
    // Check participation first (or admin bypass)
    const { data: part } = await sb
      .from('message_participants')
      .select('role, last_read_at, archived_at')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle<{ role: string; last_read_at: string | null; archived_at: string | null }>();

    const isAdmin = ['admin', 'superadmin', 'manager'].includes(userRole ?? '');
    if (!part && !isAdmin) return { ok: false, message: 'Not a participant in this thread' };

    const { data: thread, error } = await sb
      .from('message_threads')
      .select('id, thread_type, subject, last_post_at, last_post_preview, source_module, source_entity_type, source_entity_id, created_by, created_at')
      .eq('id', threadId)
      .maybeSingle<{
        id:                 string;
        thread_type:        string;
        subject:            string;
        last_post_at:       string | null;
        last_post_preview:  string | null;
        source_module:      string | null;
        source_entity_type: string | null;
        source_entity_id:   string | null;
        created_by:         string | null;
        created_at:         string;
      }>();

    if (error || !thread) return { ok: false, message: 'Thread not found' };

    const { data: participants } = await sb
      .from('message_participants')
      .select('user_id, role, app_users!inner(display_name, email)')
      .eq('thread_id', threadId)
      .is('removed_at', null) as {
        data: Array<{
          user_id:   string;
          role:      string;
          app_users: { display_name: string | null; email: string };
        }> | null;
      };

    const profiledParticipants: ParticipantProfile[] = (participants ?? []).map(p => ({
      userId:      p.user_id,
      displayName: p.app_users.display_name,
      email:       p.app_users.email,
      role:        p.role,
    }));

    return {
      ok: true,
      thread: {
        id:               thread.id,
        threadType:       thread.thread_type,
        subject:          thread.subject,
        lastPostAt:       thread.last_post_at,
        lastPostPreview:  thread.last_post_preview,
        sourceModule:     thread.source_module,
        sourceEntityType: thread.source_entity_type,
        sourceEntityId:   thread.source_entity_id,
        createdBy:        thread.created_by,
        createdAt:        thread.created_at,
      },
      participants:  profiledParticipants,
      myRole:        part?.role,
      myLastReadAt:  part?.last_read_at,
      myArchivedAt:  part?.archived_at,
    };
  } catch (e) {
    console.error('[communications] getThread failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── getThreadPosts ─────────────────────────────────────────────────────────────

export interface PostRow {
  id:              string;
  threadId:        string;
  authorUserId:    string | null;
  authorName:      string | null;
  authorEmail:     string | null;
  body:            string;
  isSystem:        boolean;
  attachmentCount: number;
  editedAt:        string | null;
  deletedAt:       string | null;
  createdAt:       string;
  attachments:     AttachmentRow[];
}

export interface AttachmentRow {
  id:          string;
  fileName:    string;
  filePath:    string;
  contentType: string | null;
  sizeBytes:   number | null;
}

export interface GetThreadPostsResult {
  ok:         boolean;
  message?:   string;
  posts?:     PostRow[];
  nextCursor?: string | null;
}

export async function getThreadPosts(
  threadId: string,
  userId:   string,
  opts: { limit?: number; cursor?: string | null },
  userRole?: string,
): Promise<GetThreadPostsResult> {
  try {
    // Access check
    const { data: part } = await sb
      .from('message_participants')
      .select('thread_id')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle<{ thread_id: string }>();

    const isAdmin = ['admin', 'superadmin', 'manager'].includes(userRole ?? '');
    if (!part && !isAdmin) return { ok: false, message: 'Not a participant in this thread' };

    const limit = opts.limit ?? 50;

    type RawPost = {
      id:              string;
      thread_id:       string;
      author_user_id:  string | null;
      body:            string;
      is_system:       boolean;
      attachment_count: number;
      edited_at:       string | null;
      deleted_at:      string | null;
      created_at:      string;
      app_users:       { display_name: string | null; email: string } | null;
    };

    let q = sb
      .from('message_posts')
      .select('id, thread_id, author_user_id, body, is_system, attachment_count, edited_at, deleted_at, created_at, app_users(display_name, email)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (opts.cursor) q = q.gt('created_at', opts.cursor);

    const { data: posts, error } = await q as { data: RawPost[] | null; error: { message: string } | null };
    if (error) return { ok: false, message: error.message };

    const postIds = (posts ?? []).map(p => p.id);

    // Fetch attachments for all posts in one query
    const { data: attachments } = postIds.length > 0
      ? await sb
          .from('message_attachments')
          .select('id, post_id, file_name, file_path, content_type, size_bytes')
          .in('post_id', postIds) as {
            data: Array<{
              id: string; post_id: string; file_name: string;
              file_path: string; content_type: string | null; size_bytes: number | null;
            }> | null;
          }
      : { data: null };

    const attachMap = new Map<string, AttachmentRow[]>();
    for (const a of attachments ?? []) {
      const list = attachMap.get(a.post_id) ?? [];
      list.push({ id: a.id, fileName: a.file_name, filePath: a.file_path, contentType: a.content_type, sizeBytes: a.size_bytes });
      attachMap.set(a.post_id, list);
    }

    const resultPosts: PostRow[] = (posts ?? []).map(p => ({
      id:              p.id,
      threadId:        p.thread_id,
      authorUserId:    p.author_user_id,
      authorName:      p.app_users?.display_name ?? null,
      authorEmail:     p.app_users?.email ?? null,
      body:            p.body,
      isSystem:        p.is_system,
      attachmentCount: p.attachment_count,
      editedAt:        p.edited_at,
      deletedAt:       p.deleted_at,
      createdAt:       p.created_at,
      attachments:     attachMap.get(p.id) ?? [],
    }));

    const lastPost = resultPosts[resultPosts.length - 1];
    const nextCursor = resultPosts.length === limit && lastPost ? lastPost.createdAt : null;

    return { ok: true, posts: resultPosts, nextCursor };
  } catch (e) {
    console.error('[communications] getThreadPosts failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── markThreadRead ─────────────────────────────────────────────────────────────

export async function markThreadRead(threadId: string, userId: string): Promise<void> {
  await sb.from('message_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null);

  void emitSignal([userId], 'summary');
}

// ── archiveThread ──────────────────────────────────────────────────────────────

export async function archiveThread(threadId: string, userId: string, archived: boolean): Promise<{ ok: boolean; message?: string }> {
  const { error } = await sb.from('message_participants')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ── addThreadParticipants ──────────────────────────────────────────────────────

export async function addThreadParticipants(
  threadId:     string,
  actorUserId:  string,
  userIds:      string[],
  actorRole?:   string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    // Actor must be owner or admin
    const { data: actorPart } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', threadId)
      .eq('user_id', actorUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    const isAdmin = ['admin', 'superadmin', 'manager'].includes(actorRole ?? '');
    if (actorPart?.role !== 'owner' && !isAdmin) {
      return { ok: false, message: 'Only thread owner or admin can add participants' };
    }

    // Deduplicate and skip existing active participants
    const { data: existing } = await sb
      .from('message_participants')
      .select('user_id')
      .eq('thread_id', threadId)
      .in('user_id', userIds)
      .is('removed_at', null) as { data: Array<{ user_id: string }> | null };

    const existingSet = new Set((existing ?? []).map(e => e.user_id));
    const toAdd = [...new Set(userIds)].filter(uid => !existingSet.has(uid));
    if (toAdd.length === 0) return { ok: true };

    const now = new Date().toISOString();
    await sb.from('message_participants').insert(
      toAdd.map(uid => ({ thread_id: threadId, user_id: uid, role: 'participant', joined_at: now })),
    );

    // Fetch actor name for system post
    const { data: actor } = await sb
      .from('app_users')
      .select('display_name, email')
      .eq('id', actorUserId)
      .maybeSingle<{ display_name: string | null; email: string }>();
    const actorName = actor?.display_name ?? actor?.email ?? 'Someone';

    // Fetch added user names
    const { data: addedUsers } = await sb
      .from('app_users')
      .select('id, display_name, email')
      .in('id', toAdd) as { data: Array<{ id: string; display_name: string | null; email: string }> | null };
    const addedNames = (addedUsers ?? []).map(u => u.display_name ?? u.email).join(', ');

    // System post
    await sb.from('message_posts').insert({
      thread_id:       threadId,
      author_user_id:  null,
      body:            `${actorName} added ${addedNames} to the conversation.`,
      is_system:       true,
    });

    // Signal + notify added participants
    void emitSignal(toAdd, 'messages');
    void emitAppEvent({
      eventType:          'communications.thread.created',
      sourceModule:       'communications',
      sourceEntityType:   'message_thread',
      sourceEntityId:     threadId,
      actorUserId:        actorUserId,
      severity:           'info',
      explicitRecipients: toAdd.map(uid => ({ userId: uid, reason: 'explicit' as const })),
      notification: {
        title:       'Added to conversation',
        body:        `${actorName} added you to a conversation.`,
        actionRoute: 's-messages',
      },
    });

    return { ok: true };
  } catch (e) {
    console.error('[communications] addThreadParticipants failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── removeThreadParticipant ────────────────────────────────────────────────────

export async function removeThreadParticipant(
  threadId:    string,
  actorUserId: string,
  userId:      string,
  actorRole?:  string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { data: actorPart } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', threadId)
      .eq('user_id', actorUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    const isAdmin = ['admin', 'superadmin', 'manager'].includes(actorRole ?? '');
    if (actorPart?.role !== 'owner' && !isAdmin) {
      return { ok: false, message: 'Only thread owner or admin can remove participants' };
    }

    await sb.from('message_participants')
      .update({ removed_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('user_id', userId);

    // Fetch names for system post
    const [actorRes, removedRes] = await Promise.all([
      sb.from('app_users').select('display_name, email').eq('id', actorUserId).maybeSingle<{ display_name: string | null; email: string }>(),
      sb.from('app_users').select('display_name, email').eq('id', userId).maybeSingle<{ display_name: string | null; email: string }>(),
    ]);
    const actorName   = actorRes.data?.display_name   ?? actorRes.data?.email   ?? 'Someone';
    const removedName = removedRes.data?.display_name ?? removedRes.data?.email ?? 'a member';

    await sb.from('message_posts').insert({
      thread_id:       threadId,
      author_user_id:  null,
      body:            `${actorName} removed ${removedName} from the conversation.`,
      is_system:       true,
    });

    return { ok: true };
  } catch (e) {
    console.error('[communications] removeThreadParticipant failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── searchMessages ─────────────────────────────────────────────────────────────

export interface SearchMessageResult {
  threadId:      string;
  threadSubject: string;
  postId:        string;
  postPreview:   string;
  authorName:    string | null;
  createdAt:     string;
}

export async function searchMessages(userId: string, query: string, limit = 20): Promise<SearchMessageResult[]> {
  try {
    // Get thread ids the user participates in (active)
    const { data: parts } = await sb
      .from('message_participants')
      .select('thread_id')
      .eq('user_id', userId)
      .is('removed_at', null) as { data: Array<{ thread_id: string }> | null };

    const threadIds = (parts ?? []).map(p => p.thread_id);
    if (threadIds.length === 0) return [];

    type PostWithAuthorAndThread = {
      id:             string;
      thread_id:      string;
      body:           string;
      created_at:     string;
      app_users:      { display_name: string | null; email: string } | null;
      message_threads: { subject: string } | null;
    };

    const { data: posts } = await sb
      .from('message_posts')
      .select('id, thread_id, body, created_at, app_users(display_name, email), message_threads(subject)')
      .in('thread_id', threadIds)
      .is('deleted_at', null)
      .ilike('body', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit) as { data: PostWithAuthorAndThread[] | null };

    return (posts ?? []).map(p => ({
      threadId:      p.thread_id,
      threadSubject: p.message_threads?.subject ?? '',
      postId:        p.id,
      postPreview:   p.body.slice(0, 200),
      authorName:    p.app_users?.display_name ?? p.app_users?.email ?? null,
      createdAt:     p.created_at,
    }));
  } catch (e) {
    console.error('[communications] searchMessages failed:', e);
    return [];
  }
}

// ── getMessageRecipients ───────────────────────────────────────────────────────

export interface RecipientProfile {
  userId:      string;
  displayName: string | null;
  email:       string;
  department?: string | null;
  role?:       string;
  avatarUrl?:  string | null;
}

export async function getMessageRecipients(userId: string, query?: string | null): Promise<RecipientProfile[]> {
  try {
    type UserRow = { id: string; display_name: string | null; email: string; department_id: string | null; role: string };

    // Build query without complex cast — cast only the awaited result.
    const baseQ = sb
      .from('app_users')
      .select('id, display_name, email, department_id, role')
      .eq('status', 'active')
      .neq('id', userId)
      .order('display_name', { ascending: true })
      .limit(50);

    const resultQ = query
      ? baseQ.or(`display_name.ilike.%${query}%,email.ilike.%${query}%`)
      : baseQ;

    const { data, error } = await resultQ as { data: UserRow[] | null; error: { message: string } | null };
    if (error || !data) return [];

    return data.map(u => ({
      userId:      u.id,
      displayName: u.display_name,
      email:       u.email,
      department:  u.department_id,
      role:        u.role,
    }));
  } catch (e) {
    console.error('[communications] getMessageRecipients failed:', e);
    return [];
  }
}

// ── Tickets ────────────────────────────────────────────────────────────────────

export interface CreateTicketInput {
  category:           string;
  priority?:          'low' | 'medium' | 'high' | 'critical';
  subject:            string;
  description:        string;
  requesterUserId:    string;
  sourceModule?:      string | null;
  sourceEntityType?:  string | null;
  sourceEntityId?:    string | null;
}

export interface CreateTicketResult {
  ok:           boolean;
  ticketId?:    string;
  ticketNumber?: string;
}

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  try {
    const year = new Date().getFullYear();
    const { data: counter } = await sb.rpc('increment_ref_counter', { p_prefix: 'TKT', p_year: year });
    const ticketNumber = `TKT-${year}-${String(counter ?? Date.now()).padStart(4, '0')}`;

    // SLA: critical = 4h, high = 8h, medium = 24h, low = 72h
    const slaHours = { critical: 4, high: 8, medium: 24, low: 72 }[input.priority ?? 'medium'];
    const slaDueAt = new Date(Date.now() + slaHours * 3600_000).toISOString();

    const { data: ticket, error } = await sb
      .from('tickets')
      .insert({
        ticket_number:      ticketNumber,
        category:           input.category,
        priority:           input.priority ?? 'medium',
        subject:            input.subject,
        description:        input.description,
        requester_user_id:  input.requesterUserId,
        source_module:      input.sourceModule ?? null,
        source_entity_type: input.sourceEntityType ?? null,
        source_entity_id:   input.sourceEntityId ?? null,
        sla_due_at:         slaDueAt,
        status:             'open',
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !ticket) {
      console.error('[communications] createTicket failed:', error?.message);
      return { ok: false };
    }

    // Notify support queue (admin/manager)
    void emitSignal([], 'tickets'); // TODO: resolve admin user ids

    return { ok: true, ticketId: ticket.id, ticketNumber };
  } catch (e) {
    console.error('[communications] createTicket failed:', e);
    return { ok: false };
  }
}
