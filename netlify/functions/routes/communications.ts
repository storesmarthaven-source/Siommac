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
import { getCommsSummary, createMessageThread, createTicket, emitSignal } from '../lib/communications';
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
  limit:      z.number().int().min(1).max(100).default(30),
  cursor:     z.string().nullable().optional(),
  unreadOnly: z.boolean().default(false),
});

router.post('/communications/notifications/list', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, NotifListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('notifications')
    .select('id, type, module, severity, title, body, source_type, source_id, action_route, is_read, created_at')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.unreadOnly) q = q.eq('is_read', false);
  if (v.data.cursor) q = q.lt('created_at', v.data.cursor);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
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

  await sb.from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false);

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

// ── Messages ──────────────────────────────────────────────────────────────────

const CreateThreadSchema = z.object({
  threadType:         z.enum(['direct','group','record','system']).default('direct'),
  subject:            z.string().min(1).max(200),
  sourceModule:       z.string().nullable().optional(),
  sourceEntityType:   z.string().nullable().optional(),
  sourceEntityId:     z.string().nullable().optional(),
  participantUserIds: z.array(z.string().min(1)).min(1),
  body:               z.string().min(1).max(10000),
});

router.post('/communications/messages/createThread', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateThreadSchema, body.args);
  if (!v.ok) return v.response;

  const result = await createMessageThread({ ...v.data, createdBy: user.id });
  if (!result.ok) return c.json({ success: false, message: 'Failed to create thread' }, 500 as 200);
  return c.json({ success: true, threadId: result.threadId });
});

router.post('/communications/messages/threads', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { limit?: number } | undefined;

  const { data, error } = await sb
    .from('message_participants')
    .select('thread_id, role, last_read_at, message_threads(id, thread_type, subject, source_module, source_entity_id, created_at, created_by)')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('thread_id', { ascending: false })
    .limit(args?.limit ?? 50);

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

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

  // Verify user is a participant
  const { data: part } = await sb
    .from('message_participants')
    .select('thread_id')
    .eq('thread_id', v.data.threadId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!part) return c.json({ success: false, message: 'Not a participant in this thread' }, 403 as 200);

  let q = sb
    .from('message_posts')
    .select('id, author_user_id, body, is_system, created_at')
    .eq('thread_id', v.data.threadId)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.cursor) q = q.lt('created_at', v.data.cursor);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Mark thread as read
  await sb.from('message_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', v.data.threadId)
    .eq('user_id', user.id);

  return c.json({ success: true, data: data ?? [] });
});

const PostMessageSchema = z.object({
  threadId: z.string().uuid(),
  body:     z.string().min(1).max(10000),
});

router.post('/communications/messages/post', async c => {
  const user = await requirePermission(c, 'communications.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PostMessageSchema, body.args);
  if (!v.ok) return v.response;

  // Verify participant
  const { data: part } = await sb
    .from('message_participants')
    .select('thread_id')
    .eq('thread_id', v.data.threadId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!part) return c.json({ success: false, message: 'Not a participant' }, 403 as 200);

  const { data: post, error } = await sb
    .from('message_posts')
    .insert({ thread_id: v.data.threadId, author_user_id: user.id, body: v.data.body })
    .select('id')
    .single<{ id: string }>();

  if (error || !post) return c.json({ success: false, message: error?.message ?? 'Failed' }, 500 as 200);

  // Notify other participants
  const { data: others } = await sb
    .from('message_participants')
    .select('user_id')
    .eq('thread_id', v.data.threadId)
    .neq('user_id', user.id)
    .is('archived_at', null) as { data: Array<{ user_id: string }> | null };

  if (others && others.length > 0) {
    void emitSignal(others.map(o => o.user_id), 'messages');
  }

  return c.json({ success: true, postId: post.id });
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
