import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole } from '../lib/auth';
import { getProfileSignedUrl }      from '../lib/photos';
import type { HonoVariables }       from '../../../types/api';
import type { AppUser }             from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

router.post('/sendMessage', async c => {
  const actor      = await requireUser(c);
  const args       = (c.get('body').args ?? {}) as Record<string, string>;
  const subject    = (args.subject    ?? '').trim();
  const body       = (args.body       ?? '').trim();
  const toUsername = (args.toUsername ?? '').trim();
  if (!subject) return c.json({ success: false, message: 'Subject is required.' });
  if (!body)    return c.json({ success: false, message: 'Message body is required.' });

  const isAdminSending = actor.role === 'admin' || actor.role === 'manager';
  let toUserId = '', toName = '', resolvedToUsername = '';

  if (isAdminSending) {
    if (!toUsername) return c.json({ success: false, message: 'Recipient is required.' });
    const { data: target } = await sb.from('app_users').select('id, full_name, username').eq('username', toUsername).maybeSingle<Pick<AppUser, 'id' | 'full_name' | 'username'>>();
    if (!target) return c.json({ success: false, message: 'Employee not found.' });
    toUserId = target.id; toName = target.full_name ?? target.username; resolvedToUsername = target.username;
  } else {
    const { data: admin } = await sb.from('app_users').select('id, full_name, username').eq('role', 'admin').limit(1).maybeSingle<Pick<AppUser, 'id' | 'full_name' | 'username'>>();
    toUserId = admin?.id ?? ''; toName = admin?.full_name ?? 'Admin'; resolvedToUsername = admin?.username ?? 'admin';
  }

  const { data, error } = await sb.from('messages').insert({
    from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name ?? actor.username,
    to_user_id: toUserId, to_username: resolvedToUsername, to_name: toName,
    subject, body, read_by_recipient: false,
  }).select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });

  try { await sb.from('message_reads').upsert({ message_id: data.id, user_id: actor.id, last_read_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' }); } catch { /* best-effort */ }
  return c.json({ success: true, id: data.id });
});

router.post('/getMessages', async c => {
  const actor       = await requireUser(c);
  const isAdminView = actor.role === 'admin' || actor.role === 'manager';

  let query = sb.from('messages')
    .select('id, from_user_id, from_username, from_name, to_user_id, to_username, to_name, subject, body, read_by_recipient, created_at')
    .order('created_at', { ascending: false })
    .limit(isAdminView ? 100 : 50);
  if (!isAdminView) query = query.or(`from_user_id.eq.${actor.id},to_user_id.eq.${actor.id}`);

  const { data: msgs, error } = await query;
  if (error) return c.json({ success: false, message: error.message });

  const ids = ((msgs ?? []) as any[]).map(m => m.id);
  const [repliesResult, readsResult] = await Promise.all([
    ids.length ? sb.from('message_replies').select('id, message_id, from_user_id, from_username, from_name, body, created_at').in('message_id', ids).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
    ids.length ? sb.from('message_reads').select('message_id, last_read_at').eq('user_id', actor.id).in('message_id', ids)                                                                    : Promise.resolve({ data: [] }),
  ]);

  const replies = (repliesResult.data ?? []) as any[];
  const readMap: Record<string, string> = {};
  ((readsResult.data ?? []) as any[]).forEach(r => { readMap[r.message_id] = r.last_read_at; });

  const allUserIds = [...new Set([...(msgs ?? [] as any[]).flatMap((m: any) => [m.from_user_id, m.to_user_id]), ...replies.map(r => r.from_user_id)].filter(Boolean))];
  const { data: photoUsers } = allUserIds.length ? await sb.from('app_users').select('id, profile_image').in('id', allUserIds) : { data: [] };
  const existingUserIds = new Set(((photoUsers ?? []) as any[]).map(u => u.id));
  const photoMap: Record<string, string> = {};
  await Promise.all(((photoUsers ?? []) as any[]).map(async u => { photoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => ''); }));

  const replyMap: Record<string, any[]> = {};
  for (const r of replies) {
    if (!replyMap[r.message_id]) replyMap[r.message_id] = [];
    replyMap[r.message_id].push({ id: r.id, messageId: r.message_id, fromUserId: r.from_user_id, fromUsername: r.from_username, fromName: r.from_name, fromPhoto: photoMap[r.from_user_id] ?? '', body: r.body, createdAt: r.created_at });
  }

  const mapped = ((msgs ?? []) as any[]).map(m => {
    const threadReplies    = replyMap[m.id] ?? [];
    const otherUserId      = m.from_user_id === actor.id ? m.to_user_id : m.from_user_id;
    const otherPartyDeleted = otherUserId ? !existingUserIds.has(otherUserId) : false;
    const latestAt         = threadReplies.length ? threadReplies[threadReplies.length - 1].createdAt : m.created_at;
    const lastFromOther    = [...threadReplies].reverse().find(r => r.fromUserId !== actor.id) ?? (m.from_user_id !== actor.id ? { createdAt: m.created_at } : null);
    const myLastRead       = readMap[m.id] ?? null;
    const isUnread         = lastFromOther ? (!myLastRead || new Date(lastFromOther.createdAt) > new Date(myLastRead)) : false;
    const unreadReplyCount = threadReplies.filter(r => r.fromUserId !== actor.id && (!myLastRead || new Date(r.createdAt) > new Date(myLastRead))).length;
    return { id: m.id, fromUserId: m.from_user_id, fromUsername: m.from_username, fromName: m.from_name, fromPhoto: photoMap[m.from_user_id] ?? '', toUserId: m.to_user_id, toUsername: m.to_username, toName: m.to_name, toPhoto: photoMap[m.to_user_id] ?? '', subject: m.subject, body: m.body, otherPartyDeleted, isUnread, unreadReplyCount, latestAt, createdAt: m.created_at, replies: threadReplies };
  });

  return c.json({ success: true, data: mapped, unreadCount: mapped.filter(m => !m.otherPartyDeleted && (m.isUnread || m.unreadReplyCount > 0)).length });
});

router.post('/replyMessage', async c => {
  const actor = await requireUser(c);
  const { messageId, body } = (c.get('body').args ?? {}) as Record<string, string>;
  if (!body?.trim()) return c.json({ success: false, message: 'Reply cannot be empty.' });
  const { data: msg } = await sb.from('messages').select('from_user_id, to_user_id').eq('id', messageId).maybeSingle<{ from_user_id: string; to_user_id: string }>();
  if (!msg) return c.json({ success: false, message: 'Message not found.' });
  const isAdminView    = actor.role === 'admin' || actor.role === 'manager';
  const inConversation = isAdminView || msg.from_user_id === actor.id || msg.to_user_id === actor.id;
  if (!inConversation) return c.json({ success: false, message: 'Forbidden.' });
  if (isAdminView) {
    const otherUserId = msg.from_user_id === actor.id ? msg.to_user_id : msg.from_user_id;
    if (otherUserId) {
      const { data: otherUser } = await sb.from('app_users').select('id').eq('id', otherUserId).maybeSingle();
      if (!otherUser) return c.json({ success: false, message: 'This employee no longer exists. Please delete this conversation.' });
    }
  }
  const { error } = await sb.from('message_replies').insert({ message_id: messageId, from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name ?? actor.username, body: body.trim() });
  if (error) return c.json({ success: false, message: error.message });
  try { await sb.from('message_reads').upsert({ message_id: messageId, user_id: actor.id, last_read_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' }); } catch { /* best-effort */ }
  return c.json({ success: true });
});

router.post('/markMessageRead', async c => {
  const actor = await requireUser(c);
  const { messageId } = (c.get('body').args ?? {}) as Record<string, string>;
  const now = new Date().toISOString();
  try { await sb.from('message_reads').upsert({ message_id: messageId, user_id: actor.id, last_read_at: now }, { onConflict: 'message_id,user_id' }); } catch { /* best-effort */ }
  try { await sb.from('messages').update({ read_by_recipient: true }).eq('id', messageId); } catch { /* best-effort */ }
  return c.json({ success: true });
});

router.post('/deleteMessage', async c => {
  const actor = await requireUser(c);
  if (actor.role !== 'admin' && actor.role !== 'manager') return c.json({ success: false, message: 'Forbidden.' });
  const { messageId } = (c.get('body').args ?? {}) as Record<string, string>;
  if (!messageId) return c.json({ success: false, message: 'messageId is required.' });
  try { await sb.from('message_reads').delete().eq('message_id', messageId); } catch { /* best-effort */ }
  await sb.from('message_replies').delete().eq('message_id', messageId);
  const { error } = await sb.from('messages').delete().eq('id', messageId);
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true });
});

router.post('/getEmployeesForMsg', async c => {
  const actor = await requireUser(c);
  if (actor.role !== 'admin' && actor.role !== 'manager') return c.json({ success: false, message: 'Forbidden.' });
  const { data } = await sb.from('app_users').select('id, username, full_name, role').eq('status', 'active').neq('id', actor.id).order('full_name');
  return c.json({ success: true, data: ((data ?? []) as any[]).map(u => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role })) });
});

export default router;
