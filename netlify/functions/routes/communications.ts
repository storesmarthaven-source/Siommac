/**
 * netlify/functions/routes/communications.ts
 *
 * Unified communications API.
 *
 * POST /api/communications/summary   → badge counts + realtime channel key
 * POST /api/communications/signal    → internal: emit signal for users (auth required)
 *
 * Notifications (extended)
 * POST /api/communications/notifications/list
 * POST /api/communications/notifications/markRead
 * POST /api/communications/notifications/markAllRead
 * POST /api/communications/notifications/archive
 * POST /api/communications/notifications/preferences/get
 * POST /api/communications/notifications/preferences/set
 * POST /api/communications/notifications/mute
 * POST /api/communications/notifications/broadcast      (communications.admin)
 *
 * Messages
 * POST /api/communications/messages/createThread
 * POST /api/communications/messages/threads
 * POST /api/communications/messages/posts
 * POST /api/communications/messages/post
 * POST /api/communications/messages/markRead
 *
 * Tickets
 * POST /api/communications/tickets/create
 * POST /api/communications/tickets/list
 * POST /api/communications/tickets/get
 * POST /api/communications/tickets/comment
 * POST /api/communications/tickets/update
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission, requireUser } from '../lib/auth';
import { sb }                from '../lib/db';
import {
  getCommsSummary,
  createMessageThread,
  createTicket,
  emitSignal,
  postMessage,
  listThreadsForUser,
  getThread,
  getThreadPosts,
  markThreadRead,
  archiveThread,
  addThreadParticipants,
  removeThreadParticipant,
  searchMessages,
  getMessageRecipients,
} from '../lib/communications';
import { emitAppEvent } from '../lib/appEvents';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Summary ───────────────────────────────────────────────────────────────────

router.post('/communications/summary', async c => {
  const user = await requirePermission(c, 'communications.view');
  const summary = await getCommsSummary(user.id, user.role);
  return c.json({ success: true, data: summary });
});

// ── Notifications ─────────────────────────────────────────────────────────────

const NotifListSchema = z.object({
  limit:              z.number().int().min(1).max(100).default(30),
  cursor:             z.string().nullable().optional(),
  unreadOnly:         z.boolean().default(false),
  archivedOnly:       z.boolean().default(false),
  actionRequiredOnly: z.boolean().default(false),
  module:             z.string().nullable().optional(),
  severity:           z.enum(['info','success','warning','critical']).nullable().optional(),
  search:             z.string().nullable().optional(),
});

router.post('/communications/notifications/list', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, NotifListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('notifications')
    .select('id, type, module, severity, title, body, source_type, source_id, action_route, metadata, is_read, action_required, action_status, due_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  // Archived view vs active (default exclude archived + expired).
  if (v.data.archivedOnly) {
    q = q.not('archived_at', 'is', null);
  } else {
    q = q.is('archived_at', null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  }
  if (v.data.unreadOnly)         q = q.eq('is_read', false);
  if (v.data.actionRequiredOnly) q = q.eq('action_required', true).eq('action_status', 'pending');
  if (v.data.module)             q = q.eq('module', v.data.module);
  if (v.data.severity)           q = q.eq('severity', v.data.severity);
  if (v.data.search)             q = q.ilike('title', `%${v.data.search}%`);
  if (v.data.cursor)             q = q.lt('created_at', v.data.cursor);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const rows = data ?? [];
  const nextCursor = rows.length === v.data.limit ? (rows[rows.length - 1]!.created_at as string) : null;
  return c.json({ success: true, data: rows, nextCursor });
});

router.post('/communications/notifications/markRead', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { notificationId: string } | undefined;
  if (!args?.notificationId) return c.json({ success: false, message: 'notificationId required' }, 400 as 200);

  await sb.from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', args.notificationId)
    .eq('user_id', user.id);

  return c.json({ success: true });
});

router.post('/communications/notifications/markAllRead', async c => {
  const user = await requirePermission(c, 'communications.view');
  const args = (c.get('body') as Record<string, unknown>).args as { module?: string } | undefined;

  let q = sb.from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (args?.module) q = q.eq('module', args.module);
  await q;

  return c.json({ success: true });
});

router.post('/communications/notifications/archive', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { notificationId?: string; all?: boolean } | undefined;

  if (args?.notificationId) {
    await sb.from('notifications')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', args.notificationId)
      .eq('user_id', user.id);
  } else if (args?.all) {
    await sb.from('notifications')
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('archived_at', null);
  }

  return c.json({ success: true });
});

// ── Notification preferences ──────────────────────────────────────────────────

router.post('/communications/notifications/preferences/get', async c => {
  const user = await requirePermission(c, 'communications.view');
  const [prefsRes, muteRes] = await Promise.all([
    sb.from('notification_preferences')
      .select('event_type, in_app, email, whatsapp')
      .eq('user_id', user.id),
    sb.from('notification_mutes')
      .select('muted_until')
      .eq('user_id', user.id)
      .eq('scope', 'all')
      .maybeSingle(),
  ]) as [
    { error: { message: string } | null; data: Array<{ event_type: string; in_app: boolean; email: boolean; whatsapp: boolean }> | null },
    { data: { muted_until: string | null } | null },
  ];
  if (prefsRes.error) return c.json({ success: false, message: prefsRes.error.message }, 500 as 200);

  const all = prefsRes.data ?? [];
  const defaults = all.find(p => p.event_type === '*') ?? { event_type: '*', in_app: true, email: false, whatsapp: false };
  const preferences = all.filter(p => p.event_type !== '*');

  // Snooze is active when a mute row exists and is either indefinite (null) or in the future.
  const mute = muteRes.data;
  const snooze = mute && (mute.muted_until == null || new Date(mute.muted_until).getTime() > Date.now())
    ? { mutedUntil: mute.muted_until }
    : null;

  return c.json({ success: true, data: { defaults, preferences, snooze } });
});

const PrefSetSchema = z.object({
  eventType: z.string().min(1),
  in_app:    z.boolean(),
  email:     z.boolean(),
  whatsapp:  z.boolean(),
});

router.post('/communications/notifications/preferences/set', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PrefSetSchema, body.args);
  if (!v.ok) return v.response;

  const { error } = await sb.from('notification_preferences').upsert({
    user_id:    user.id,
    event_type: v.data.eventType,
    in_app:     v.data.in_app,
    email:      v.data.email,
    whatsapp:   v.data.whatsapp,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,event_type' });
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

// ── Mute / snooze ─────────────────────────────────────────────────────────────

const MuteSchema = z.object({
  scope:      z.string().min(1),               // 'all' | 'module:<m>' | 'event:<type>'
  mutedUntil: z.string().nullable().optional(), // null = indefinite
  clear:      z.boolean().default(false),
});

router.post('/communications/notifications/mute', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, MuteSchema, body.args);
  if (!v.ok) return v.response;

  if (v.data.clear) {
    await sb.from('notification_mutes').delete().eq('user_id', user.id).eq('scope', v.data.scope);
    return c.json({ success: true });
  }
  const { error } = await sb.from('notification_mutes').upsert({
    user_id:     user.id,
    scope:       v.data.scope,
    muted_until: v.data.mutedUntil ?? null,
  }, { onConflict: 'user_id,scope' });
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

// ── Admin broadcast ───────────────────────────────────────────────────────────

const BroadcastSchema = z.object({
  audience: z.object({
    type:    z.enum(['all','role','site','department','users']),
    value:   z.string().nullable().optional(),
    userIds: z.array(z.string()).optional(),
  }),
  severity:    z.enum(['info','success','warning','critical']).default('info'),
  title:       z.string().min(1).max(200),
  body:        z.string().min(1).max(2000),
  actionRoute: z.string().nullable().optional(),
  expiresAt:   z.string().nullable().optional(),
});

router.post('/communications/notifications/broadcast', async c => {
  const user = await requirePermission(c, 'communications.admin');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, BroadcastSchema, body.args);
  if (!v.ok) return v.response;

  // Resolve the audience to a concrete user-id list.
  const a = v.data.audience;
  let userIds: string[] = [];
  if (a.type === 'users') {
    userIds = a.userIds ?? [];
  } else if (a.type === 'site') {
    const { data } = await sb.from('project_site_employees').select('user_id').eq('site_id', a.value ?? '');
    userIds = (data ?? []).map(r => r.user_id as string);
  } else {
    let q = sb.from('app_users').select('id').eq('status', 'active');
    if (a.type === 'role')       q = q.eq('role', a.value ?? '');
    if (a.type === 'department')  q = q.eq('department_id', a.value ?? '');
    const { data } = await q;
    userIds = (data ?? []).map(r => r.id as string);
  }
  userIds = [...new Set(userIds)].filter(Boolean);
  if (userIds.length === 0) return c.json({ success: true, recipientCount: 0 });

  const res = await emitAppEvent({
    eventType:         'communications.broadcast',
    sourceModule:      'communications',
    sourceEntityType:  'broadcast',
    sourceEntityId:    `bcast-${Date.now()}`,
    actorUserId:       user.id,
    severity:          v.data.severity,
    payload:           { audience: a.type, expiresAt: v.data.expiresAt ?? null },
    explicitRecipients: userIds.map(uid => ({ userId: uid, reason: 'explicit' as const })),
    notification: {
      title:       v.data.title,
      body:        v.data.body,
      actionRoute: v.data.actionRoute ?? undefined,
    },
  });

  return c.json({ success: true, recipientCount: res.recipientCount ?? userIds.length });
});

// ── Messages ──────────────────────────────────────────────────────────────────

// POST /api/communications/messages/threads
const ThreadsListSchema = z.object({
  tab:    z.enum(['inbox','sent','archived','all']).default('inbox'),
  search: z.string().nullable().optional(),
  limit:  z.number().int().min(1).max(100).default(30),
  cursor: z.string().nullable().optional(),
});

router.post('/communications/messages/threads', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ThreadsListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  const result = await listThreadsForUser({
    userId: user.id,
    tab:    v.data.tab,
    search: v.data.search,
    limit:  v.data.limit,
    cursor: v.data.cursor,
  });
  return c.json({ success: true, data: result.rows, nextCursor: result.nextCursor });
});

// POST /api/communications/messages/thread
const ThreadGetSchema = z.object({
  threadId: z.string().uuid(),
});

router.post('/communications/messages/thread', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ThreadGetSchema, body.args);
  if (!v.ok) return v.response;

  const result = await getThread(v.data.threadId, user.id, user.role);
  if (!result.ok) return c.json({ success: false, message: result.message ?? 'Not found' }, 404 as 200);
  return c.json({ success: true, data: result });
});

// POST /api/communications/messages/posts  (no auto mark-read)
const PostsSchema = z.object({
  threadId: z.string().uuid(),
  limit:    z.number().int().min(1).max(100).default(50),
  cursor:   z.string().nullable().optional(),
});

router.post('/communications/messages/posts', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PostsSchema, body.args);
  if (!v.ok) return v.response;

  const result = await getThreadPosts(v.data.threadId, user.id, { limit: v.data.limit, cursor: v.data.cursor }, user.role);
  if (!result.ok) return c.json({ success: false, message: result.message ?? 'Error' }, result.message === 'Not a participant in this thread' ? 403 as 200 : 500 as 200);
  return c.json({ success: true, data: result.posts ?? [], nextCursor: result.nextCursor });
});

// POST /api/communications/messages/createThread
const CreateThreadSchema = z.object({
  threadType:         z.enum(['direct','group','record','system']).default('direct'),
  subject:            z.string().min(1).max(200),
  sourceModule:       z.string().nullable().optional(),
  sourceEntityType:   z.string().nullable().optional(),
  sourceEntityId:     z.string().nullable().optional(),
  participantUserIds: z.array(z.string().min(1)).min(1),
  body:               z.string().min(1).max(10000),
  attachmentIds:      z.array(z.string().uuid()).optional(),
});

router.post('/communications/messages/createThread', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateThreadSchema, body.args);
  if (!v.ok) return v.response;

  // For direct/group threads, require at least one OTHER participant
  if (['direct','group'].includes(v.data.threadType) && v.data.participantUserIds.every(id => id === user.id)) {
    return c.json({ success: false, message: 'A conversation must include at least one other participant' }, 400 as 200);
  }
  // For record threads, require source_*
  if (v.data.threadType === 'record' && (!v.data.sourceModule || !v.data.sourceEntityType || !v.data.sourceEntityId)) {
    return c.json({ success: false, message: 'Record threads require sourceModule, sourceEntityType, and sourceEntityId' }, 400 as 200);
  }

  const result = await createMessageThread({ ...v.data, createdBy: user.id });
  if (!result.ok) return c.json({ success: false, message: 'Failed to create thread' }, 500 as 200);
  return c.json({ success: true, threadId: result.threadId, postId: result.postId });
});

// POST /api/communications/messages/post
const PostMessageSchema = z.object({
  threadId:      z.string().uuid(),
  body:          z.string().min(1).max(10000),
  attachmentIds: z.array(z.string().uuid()).optional(),
});

router.post('/communications/messages/post', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PostMessageSchema, body.args);
  if (!v.ok) return v.response;

  const result = await postMessage({
    currentUserId: user.id,
    threadId:      v.data.threadId,
    body:          v.data.body,
    attachmentIds: v.data.attachmentIds,
  });
  if (!result.ok) {
    const status = result.message === 'Not an active participant in this thread' ? 403 as 200 : 500 as 200;
    return c.json({ success: false, message: result.message ?? 'Failed' }, status);
  }
  return c.json({ success: true, postId: result.postId, threadId: result.threadId, createdAt: result.createdAt });
});

// POST /api/communications/messages/markRead
const MarkReadSchema = z.object({
  threadId: z.string().uuid(),
});

router.post('/communications/messages/markRead', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, MarkReadSchema, body.args);
  if (!v.ok) return v.response;

  await markThreadRead(v.data.threadId, user.id);
  return c.json({ success: true });
});

// POST /api/communications/messages/archive
const ArchiveSchema = z.object({
  threadId: z.string().uuid(),
  archived: z.boolean(),
});

router.post('/communications/messages/archive', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ArchiveSchema, body.args);
  if (!v.ok) return v.response;

  const result = await archiveThread(v.data.threadId, user.id, v.data.archived);
  if (!result.ok) return c.json({ success: false, message: result.message ?? 'Error' }, 500 as 200);
  return c.json({ success: true });
});

// POST /api/communications/messages/participants/add
const ParticipantsAddSchema = z.object({
  threadId: z.string().uuid(),
  userIds:  z.array(z.string().min(1)).min(1),
});

router.post('/communications/messages/participants/add', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ParticipantsAddSchema, body.args);
  if (!v.ok) return v.response;

  const result = await addThreadParticipants(v.data.threadId, user.id, v.data.userIds, user.role);
  if (!result.ok) {
    const status = result.message?.includes('Only thread owner') ? 403 as 200 : 500 as 200;
    return c.json({ success: false, message: result.message ?? 'Error' }, status);
  }
  return c.json({ success: true });
});

// POST /api/communications/messages/participants/remove
const ParticipantsRemoveSchema = z.object({
  threadId: z.string().uuid(),
  userId:   z.string().min(1),
});

router.post('/communications/messages/participants/remove', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ParticipantsRemoveSchema, body.args);
  if (!v.ok) return v.response;

  const result = await removeThreadParticipant(v.data.threadId, user.id, v.data.userId, user.role);
  if (!result.ok) {
    const status = result.message?.includes('Only thread owner') ? 403 as 200 : 500 as 200;
    return c.json({ success: false, message: result.message ?? 'Error' }, status);
  }
  return c.json({ success: true });
});

// POST /api/communications/messages/search
const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20),
});

router.post('/communications/messages/search', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, SearchSchema, body.args);
  if (!v.ok) return v.response;

  const results = await searchMessages(user.id, v.data.query, v.data.limit);
  return c.json({ success: true, data: results });
});

// POST /api/communications/messages/recipients
const RecipientsSchema = z.object({
  query: z.string().nullable().optional(),
});

router.post('/communications/messages/recipients', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, RecipientsSchema, body.args ?? {});
  if (!v.ok) return v.response;

  const results = await getMessageRecipients(user.id, v.data.query);
  return c.json({ success: true, data: results });
});

// ── Tickets ───────────────────────────────────────────────────────────────────

const CreateTicketSchema = z.object({
  category:         z.string().min(1).max(100),
  priority:         z.enum(['low','medium','high','critical']).default('medium'),
  subject:          z.string().min(1).max(200),
  description:      z.string().min(1).max(5000),
  sourceModule:     z.string().nullable().optional(),
  sourceEntityType: z.string().nullable().optional(),
  sourceEntityId:   z.string().nullable().optional(),
});

router.post('/communications/tickets/create', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateTicketSchema, body.args);
  if (!v.ok) return v.response;

  const result = await createTicket({ ...v.data, requesterUserId: user.id });
  if (!result.ok) return c.json({ success: false, message: 'Failed to create ticket' }, 500 as 200);
  return c.json({ success: true, ticketId: result.ticketId, ticketNumber: result.ticketNumber });
});

const TicketListSchema = z.object({
  status:     z.string().optional(),
  mine:       z.boolean().default(true),
  limit:      z.number().int().min(1).max(100).default(50),
  cursor:     z.string().nullable().optional(),
});

router.post('/communications/tickets/list', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TicketListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('tickets')
    .select('id, ticket_number, category, priority, status, subject, sla_due_at, created_at, requester_user_id, assignee_user_id')
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status) q = q.eq('status', v.data.status);
  if (v.data.mine) q = q.eq('requester_user_id', user.id);
  if (v.data.cursor) q = q.lt('created_at', v.data.cursor);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

router.post('/communications/tickets/get', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { ticketId: string } | undefined;
  if (!args?.ticketId) return c.json({ success: false, message: 'ticketId required' }, 400 as 200);

  const [ticketRes, commentsRes] = await Promise.all([
    sb.from('tickets').select('*').eq('id', args.ticketId).maybeSingle(),
    sb.from('ticket_comments').select('*').eq('ticket_id', args.ticketId).order('created_at'),
  ]);

  if (!ticketRes.data) return c.json({ success: false, message: 'Ticket not found' }, 404 as 200);

  // Requester or admin/manager can view
  if (ticketRes.data.requester_user_id !== user.id && !['admin','superadmin','manager'].includes(user.role)) {
    return c.json({ success: false, message: 'Forbidden' }, 403 as 200);
  }

  return c.json({ success: true, data: { ticket: ticketRes.data, comments: commentsRes.data ?? [] } });
});

const CommentSchema = z.object({
  ticketId:   z.string().uuid(),
  body:       z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
});

router.post('/communications/tickets/comment', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CommentSchema, body.args);
  if (!v.ok) return v.response;

  const { data: ticket } = await sb
    .from('tickets')
    .select('id, requester_user_id, assignee_user_id, status')
    .eq('id', v.data.ticketId)
    .maybeSingle<{ id: string; requester_user_id: string; assignee_user_id: string | null; status: string }>();

  if (!ticket) return c.json({ success: false, message: 'Ticket not found' }, 404 as 200);

  // Internal notes: admin/manager only
  if (v.data.isInternal && !['admin','superadmin','manager'].includes(user.role)) {
    return c.json({ success: false, message: 'Forbidden' }, 403 as 200);
  }

  await sb.from('ticket_comments').insert({
    ticket_id:      v.data.ticketId,
    author_user_id: user.id,
    body:           v.data.body,
    is_internal:    v.data.isInternal,
  });

  await sb.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', v.data.ticketId);

  // Signal requester (if not the commenter) and assignee
  const toNotify = [ticket.requester_user_id, ticket.assignee_user_id]
    .filter((id): id is string => !!id && id !== user.id);
  if (toNotify.length > 0) void emitSignal(toNotify, 'tickets');

  return c.json({ success: true });
});

const UpdateTicketSchema = z.object({
  ticketId:   z.string().uuid(),
  status:     z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  priority:   z.string().optional(),
});

router.post('/communications/tickets/update', async c => {
  const user = await requirePermission(c, 'tickets.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, UpdateTicketSchema, body.args);
  if (!v.ok) return v.response;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.status !== undefined) {
    updates.status = v.data.status;
    if (v.data.status === 'resolved') updates.resolved_at = new Date().toISOString();
    if (v.data.status === 'closed')   updates.closed_at   = new Date().toISOString();
    if (v.data.status === 'assigned' && !updates.first_response_at) {
      const { data: t } = await sb.from('tickets').select('first_response_at').eq('id', v.data.ticketId).maybeSingle<{ first_response_at: string | null }>();
      if (!t?.first_response_at) updates.first_response_at = new Date().toISOString();
    }
  }
  if (v.data.assigneeId !== undefined) updates.assignee_user_id = v.data.assigneeId;
  if (v.data.priority)   updates.priority = v.data.priority;

  await sb.from('tickets').update(updates).eq('id', v.data.ticketId);

  return c.json({ success: true });
});

export default router;
