import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser }         from '../lib/auth';
import { getProfileSignedUrl } from '../lib/photos';
import type { HonoVariables }  from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

async function _genTicketNumber(): Promise<string> {
  const { data: maxRow } = await sb.from('support_tickets').select('ticket_number').order('ticket_number', { ascending: false }).limit(1).single<{ ticket_number: string }>();
  let next = 1;
  if (maxRow?.ticket_number) {
    const m = String(maxRow.ticket_number).match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return 'TKT-' + String(next).padStart(4, '0');
}

router.post('/createTicket', async c => {
  const actor    = await requireUser(c);
  if (actor.role === 'admin' || actor.role === 'manager') return c.json({ success: false, message: 'Admins and managers cannot create support tickets.' });
  const args     = (c.get('body').args ?? {}) as Record<string, string>;
  const subject  = (args.subject  ?? '').trim();
  const body     = (args.body     ?? '').trim();
  const category = (args.category ?? 'general').trim();
  if (!subject) return c.json({ success: false, message: 'Subject is required.' });
  if (!body)    return c.json({ success: false, message: 'Description is required.' });

  let ticketNumber = await _genTicketNumber();
  let data: { id: string; ticket_number: string } | null = null;
  let error: { message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    ({ data, error } = await sb.from('support_tickets').insert({
      from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name ?? actor.username,
      ticket_number: ticketNumber, category, subject, body, status: 'open',
    }).select('id, ticket_number').single<{ id: string; ticket_number: string }>());
    if (!error) break;
    if (!error.message.includes('unique') && !error.message.includes('duplicate')) break;
    ticketNumber = 'TKT-' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100);
  }
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Failed to create ticket' });
  return c.json({ success: true, id: data.id, ticketNumber: data.ticket_number });
});

router.post('/getTickets', async c => {
  const actor        = await requireUser(c);
  const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';

  let query;
  if (isAdminOrMgr) {
    query = sb.from('support_tickets').select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee').eq('cleared_by_admin', false).order('created_at', { ascending: false }).limit(50);
  } else {
    query = sb.from('support_tickets').select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee').eq('from_user_id', actor.id).eq('cleared_by_employee', false).order('created_at', { ascending: false }).limit(20);
  }

  let { data: tickets, error } = await query;
  if (error && (error.message.includes('cleared_by_admin') || error.message.includes('cleared_by_employee'))) {
    const fallback = sb.from('support_tickets').select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at').order('created_at', { ascending: false }).limit(isAdminOrMgr ? 50 : 20);
    if (!isAdminOrMgr) (fallback as any).eq('from_user_id', actor.id);
    ({ data: tickets, error } = await fallback as any);
  }
  if (error) return c.json({ success: false, message: error.message });

  const ids = ((tickets ?? []) as any[]).map(t => t.id);
  const { data: replies } = ids.length
    ? await sb.from('ticket_replies').select('id, ticket_id, from_username, from_name, body, created_at').in('ticket_id', ids).order('created_at', { ascending: true })
    : { data: [] };

  const ticketUsernames = [...new Set([...((tickets ?? []) as any[]).map(t => t.from_username), ...((replies ?? []) as any[]).map(r => r.from_username)].filter(Boolean))];
  const ticketPhotoMap: Record<string, string> = {};
  if (ticketUsernames.length) {
    const { data: photoUsers } = await sb.from('app_users').select('id, username, profile_image').in('username', ticketUsernames);
    await Promise.all(((photoUsers ?? []) as any[]).map(async u => { ticketPhotoMap[u.username] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => ''); }));
  }

  const replyMap: Record<string, any[]> = {};
  for (const r of (replies ?? []) as any[]) {
    if (!replyMap[r.ticket_id]) replyMap[r.ticket_id] = [];
    replyMap[r.ticket_id].push({ id: r.id, ticketId: r.ticket_id, fromUsername: r.from_username, fromName: r.from_name, fromPhoto: ticketPhotoMap[r.from_username] ?? '', body: r.body, createdAt: r.created_at });
  }

  return c.json({ success: true, openCount: ((tickets ?? []) as any[]).filter(t => t.status === 'open').length, data: ((tickets ?? []) as any[]).map(t => ({
    id: t.id, fromUsername: t.from_username, fromName: t.from_name, fromPhoto: ticketPhotoMap[t.from_username] ?? '',
    ticketNumber: t.ticket_number, category: t.category, subject: t.subject, body: t.body, status: t.status,
    createdAt: t.created_at, updatedAt: t.updated_at, replies: replyMap[t.id] ?? [],
  })) });
});

router.post('/replyTicket', async c => {
  const actor = await requireUser(c);
  const { ticketId, body } = (c.get('body').args ?? {}) as Record<string, string>;
  if (!body?.trim()) return c.json({ success: false, message: 'Reply cannot be empty.' });
  const { data: ticket } = await sb.from('support_tickets').select('status, from_user_id').eq('id', ticketId).maybeSingle<{ status: string; from_user_id: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });
  if (ticket.status === 'closed' || ticket.status === 'resolved') return c.json({ success: false, message: 'This ticket is closed and can no longer be replied to.' });
  const { error } = await sb.from('ticket_replies').insert({ ticket_id: ticketId, from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name ?? actor.username, body: body.trim() });
  if (error) return c.json({ success: false, message: error.message });
  if (actor.role === 'admin' || actor.role === 'manager') {
    await sb.from('support_tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticketId);
  }
  return c.json({ success: true });
});

router.post('/updateTicketStatus', async c => {
  const actor = await requireUser(c);
  if (actor.role !== 'admin' && actor.role !== 'manager') return c.json({ success: false, message: 'Forbidden.' });
  const { ticketId, status } = (c.get('body').args ?? {}) as Record<string, string>;
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) return c.json({ success: false, message: 'Invalid status.' });
  const { data: ticket } = await sb.from('support_tickets').select('status').eq('id', ticketId).maybeSingle<{ status: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });
  const { error } = await sb.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', ticketId);
  if (error) return c.json({ success: false, message: error.message });
  const wasOpen = ticket.status !== 'closed' && ticket.status !== 'resolved';
  if (wasOpen && (status === 'closed' || status === 'resolved')) {
    const systemMsg = status === 'closed'
      ? `This ticket has been closed by ${actor.full_name ?? actor.username}. No further replies are possible.`
      : `This ticket has been marked as resolved by ${actor.full_name ?? actor.username}. If your issue persists, please open a new ticket.`;
    await sb.from('ticket_replies').insert({ ticket_id: ticketId, from_user_id: actor.id, from_username: '__system__', from_name: 'System', body: systemMsg });
  }
  return c.json({ success: true });
});

router.post('/deleteTicket', async c => {
  const actor = await requireUser(c);
  const { ticketId } = (c.get('body').args ?? {}) as Record<string, string>;
  if (actor.role === 'admin' || actor.role === 'manager') return c.json({ success: false, message: 'Admins cannot delete tickets. Use the status controls instead.' });
  const { data: ticket } = await sb.from('support_tickets').select('id, from_user_id, status, subject').eq('id', ticketId).maybeSingle<{ id: string; from_user_id: string; status: string; subject: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });
  if (ticket.from_user_id !== actor.id) return c.json({ success: false, message: 'You can only delete your own tickets.' });
  if (ticket.status === 'closed' || ticket.status === 'resolved') return c.json({ success: false, message: 'This ticket is already closed and cannot be deleted.' });
  const { error } = await sb.from('support_tickets').update({ status: 'deleted', updated_at: new Date().toISOString() }).eq('id', ticketId);
  if (error) return c.json({ success: false, message: error.message });
  if (ticket.status === 'open' || ticket.status === 'in_progress') {
    await sb.from('ticket_replies').insert({ ticket_id: ticketId, from_user_id: actor.id, from_username: '__system__', from_name: 'System', body: `This ticket was deleted by the employee (${actor.full_name ?? actor.username}) before it was resolved.` });
  }
  return c.json({ success: true });
});

router.post('/clearClosedTickets', async c => {
  const actor        = await requireUser(c);
  const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';
  let query = sb.from('support_tickets').select('id').in('status', ['closed', 'resolved', 'deleted']);
  if (!isAdminOrMgr) query = query.eq('from_user_id', actor.id);
  const { data: toHide, error: fetchErr } = await query;
  if (fetchErr) return c.json({ success: false, message: fetchErr.message });
  if (!toHide || !toHide.length) return c.json({ success: true, count: 0 });
  const ids  = (toHide as any[]).map(t => t.id);
  const flag = isAdminOrMgr ? { cleared_by_admin: true } : { cleared_by_employee: true };
  const { error } = await sb.from('support_tickets').update(flag).in('id', ids);
  if (error) {
    await sb.from('ticket_replies').delete().in('ticket_id', ids);
    const { error: delErr } = await sb.from('support_tickets').delete().in('id', ids);
    if (delErr) return c.json({ success: false, message: delErr.message });
  }
  return c.json({ success: true, count: ids.length });
});

export default router;
