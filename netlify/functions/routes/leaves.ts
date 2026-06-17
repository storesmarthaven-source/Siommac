import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, requirePermission, log_ } from '../lib/auth';
import { today, dateOnly, cap }           from '../lib/helpers';
import { setting }                         from '../lib/settings';
import { zv, SubmitLeaveSchema, GetLeaveByIdSchema, UpdateLeaveSchema, DeleteLeaveSchema, DecideLeaveSchema } from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';
import type { AppUser }                   from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

router.post('/submitLeave', async c => {
  const actor = await requireUser(c);
  const v = zv(c, SubmitLeaveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { type, fromDate, toDate, reason } = v.data;
  if (fromDate > toDate) return c.json({ success: false, message: 'From date must be on or before to date.' });
  const days = Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000) + 1;
  const { data, error } = await sb.from('leave_requests').insert({
    user_id: actor.id, username: actor.username, department_id: actor.department_id,
    type, from_date: fromDate, to_date: toDate, days, reason,
  }).select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'leave', data.id, type);
  return c.json({ success: true, id: data.id });
});

router.post('/getMyLeaves', async c => {
  const actor = await requireUser(c);
  const { data } = await sb.from('leave_requests').select('*').eq('user_id', actor.id).order('applied_at', { ascending: false });
  return c.json({ success: true, data: ((data ?? []) as any[]).map(l => ({ id: l.id, type: l.type, from: l.from_date, to: l.to_date, days: l.days, reason: l.reason, status: l.status, appliedOn: dateOnly(l.applied_at) })) });
});

router.post('/getLeaveById', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetLeaveByIdSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', v.data.leaveId).single<any>();
  if (!l) return c.json({ success: false, message: 'Leave not found' });
  const allowed = actor.role === 'admin' || l.user_id === actor.id || (actor.role === 'manager' && l.department_id === actor.department_id);
  if (!allowed) return c.json({ success: false, message: 'Not allowed' }, 403);

  const [userRow, deptRow, reviewerRow, companyName, companyLogoUrl] = await Promise.all([
    l.user_id       ? sb.from('app_users').select('full_name,position,username').eq('id', l.user_id).maybeSingle<Pick<AppUser, 'full_name' | 'position' | 'username'>>().then(r => r.data)    : Promise.resolve(null),
    l.department_id ? sb.from('departments').select('name').eq('id', l.department_id).maybeSingle<{ name: string }>().then(r => r.data)                  : Promise.resolve(null),
    l.reviewed_by   ? sb.from('app_users').select('full_name').eq('id', l.reviewed_by).maybeSingle<Pick<AppUser, 'full_name'>>().then(r => r.data)        : Promise.resolve(null),
    setting('companyName', 'Company'),
    setting('companyLogoUrl', ''),
  ]);

  return c.json({ success: true, data: {
    id: l.id,
    employee: { username: userRow?.username ?? l.username, fullName: userRow?.full_name ?? l.username, position: userRow?.position ?? '', department: deptRow?.name ?? '' },
    type: l.type, fromDate: l.from_date, toDate: l.to_date, days: l.days, reason: l.reason, status: l.status,
    reviewedBy: reviewerRow?.full_name ?? '', reviewedAt: l.reviewed_at, reviewNotes: l.review_notes ?? '', appliedAt: l.applied_at,
    companyName, companyLogoUrl,
  } });
});

router.post('/updateLeave', async c => {
  const actor = await requireUser(c);
  const v = zv(c, UpdateLeaveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const args = v.data;
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', args.id).single<any>();
  if (!l) return c.json({ success: false, message: 'Leave not found' });
  if (l.status !== 'pending') return c.json({ success: false, message: 'Only pending leaves can be edited' });
  if (actor.role !== 'admin' && l.user_id !== actor.id) return c.json({ success: false, message: 'Only the owner or admin can edit' }, 403);
  const fromDate = args.fromDate ?? l.from_date;
  const toDate   = args.toDate   ?? l.to_date;
  if (fromDate > toDate) return c.json({ success: false, message: 'From date must be on or before to date.' });
  const days = Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000) + 1;
  await sb.from('leave_requests').update({ type: args.type ?? l.type, from_date: fromDate, to_date: toDate, reason: args.reason ?? l.reason, days }).eq('id', args.id);
  await log_(actor, 'update', 'leave', args.id, '');
  return c.json({ success: true });
});

router.post('/deleteLeave', async c => {
  const actor = await requireUser(c);
  const v = zv(c, DeleteLeaveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { leaveId } = v.data;
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', leaveId).single<any>();
  if (!l) return c.json({ success: false, message: 'Leave not found' });
  if (actor.role !== 'admin' && !(l.user_id === actor.id && l.status === 'pending')) return c.json({ success: false, message: 'Cannot delete this leave' }, 403);
  await sb.from('leave_requests').delete().eq('id', leaveId);
  await log_(actor, 'delete', 'leave', leaveId, l.type);
  return c.json({ success: true });
});

async function _decideLeave(c: any, status: string) {
  const actor = await requirePermission(c, 'leaves.approve');
  const v = zv(c, DecideLeaveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { leaveId, notes } = v.data;
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', leaveId).single<any>();
  if (!l) return c.json({ success: false, message: 'Leave not found' });
  if (actor.role === 'manager' && l.department_id !== actor.department_id) return c.json({ success: false, message: 'Forbidden' }, 403);
  const { error } = await sb.from('leave_requests')
    .update({ status, reviewed_by: actor.id, reviewed_at: new Date().toISOString(), review_notes: notes ?? '' })
    .eq('id', leaveId).eq('status', 'pending');
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, status, 'leave', leaveId, l.username);
  return c.json({ success: true });
}

router.post('/approveLeave', c => _decideLeave(c, 'approved'));
router.post('/rejectLeave',  c => _decideLeave(c, 'rejected'));

router.post('/listAllLeaves', async c => {
  await requireRole(c, ['admin']);
  const [{ data: leaves, error: lErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from('leave_requests').select('*').order('applied_at', { ascending: false }),
    sb.from('app_users').select('id, full_name'),
  ]);
  if (lErr) throw new Error('Failed to load leaves: ' + lErr.message);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  const userMap = Object.fromEntries(((users ?? []) as any[]).map(u => [u.id, u.full_name]));
  return c.json({ success: true, data: ((leaves ?? []) as any[]).map(l => ({
    id: l.id,
    employee: (l.user_id && userMap[l.user_id]) || l.username,
    type: cap(l.type) + ' Leave', from: l.from_date, to: l.to_date, days: l.days,
    status: cap(l.status), reason: l.reason,
  })) });
});

router.post('/getPendingLeavesForManager', async c => {
  const actor = await requireRole(c, ['manager', 'admin']);
  let leavesQ = sb.from('leave_requests').select('*').eq('status', 'pending').order('applied_at', { ascending: false });
  if (actor.role === 'manager') leavesQ = leavesQ.eq('department_id', actor.department_id);
  const [{ data: leaves, error: lErr }, { data: users, error: uErr }] = await Promise.all([
    leavesQ,
    sb.from('app_users').select('id, full_name'),
  ]);
  if (lErr) throw new Error('Failed to load leaves: ' + lErr.message);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  const userMap = Object.fromEntries(((users ?? []) as any[]).map(u => [u.id, u.full_name]));
  return c.json({ success: true, data: ((leaves ?? []) as any[]).map(l => ({
    id: l.id,
    employee: (l.user_id && userMap[l.user_id]) || l.username,
    type: l.type, from: l.from_date, to: l.to_date, days: l.days,
    appliedOn: dateOnly(l.applied_at), reason: l.reason,
  })) });
});

export default router;
