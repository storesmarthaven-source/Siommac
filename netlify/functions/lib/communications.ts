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

import { sb } from './db';

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

    sb.from('message_participants')
      .select('thread_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('archived_at', null)
      // unread = last_read_at < latest post in thread (approximated by IS NULL)
      .is('last_read_at', null),

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
}

export interface CreateThreadResult {
  ok:       boolean;
  threadId?: string;
  postId?:   string;
}

export async function createMessageThread(input: CreateThreadInput): Promise<CreateThreadResult> {
  try {
    const { data: thread, error: threadErr } = await sb
      .from('message_threads')
      .insert({
        thread_type:        input.threadType,
        subject:            input.subject,
        source_module:      input.sourceModule ?? null,
        source_entity_type: input.sourceEntityType ?? null,
        source_entity_id:   input.sourceEntityId ?? null,
        created_by:         input.createdBy,
      })
      .select('id')
      .single<{ id: string }>();

    if (threadErr || !thread) {
      console.error('[communications] createThread failed:', threadErr?.message);
      return { ok: false };
    }

    const threadId = thread.id;

    // Add participants (deduplicate)
    const participantIds = [...new Set([input.createdBy, ...input.participantUserIds])];
    await sb.from('message_participants').insert(
      participantIds.map(uid => ({
        thread_id: threadId,
        user_id:   uid,
        role:      uid === input.createdBy ? 'owner' : 'participant',
      })),
    );

    // Add first post
    const { data: post } = await sb
      .from('message_posts')
      .insert({ thread_id: threadId, author_user_id: input.createdBy, body: input.body })
      .select('id')
      .single<{ id: string }>();

    // Signal other participants
    const others = participantIds.filter(uid => uid !== input.createdBy);
    if (others.length > 0) {
      void emitSignal(others, 'messages');
    }

    return { ok: true, threadId, postId: post?.id };
  } catch (e) {
    console.error('[communications] createMessageThread failed:', e);
    return { ok: false };
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
