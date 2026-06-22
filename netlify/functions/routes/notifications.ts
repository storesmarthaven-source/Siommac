import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser }         from '../lib/auth';
import { today, cap }          from '../lib/helpers';
import { getProfileSignedUrl } from '../lib/photos';
import type { HonoVariables }  from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

interface Notif {
  id:          string;
  type:        string;
  icon:        string;
  color:       string;
  title:       string;
  sub:         string;
  time:        string;
  priority:    number;
  [key: string]: unknown;
}

router.post('/getNotifications', async c => {
  const actor    = await requireUser(c);
  const todayStr = today();
  const notifs: Notif[] = [];

  if (actor.role === 'admin' || actor.role === 'manager') {
    let leavesQ = sb.from('leave_requests').select('id, type, from_date, to_date, days, applied_at, username, user_id').eq('status', 'pending').order('applied_at', { ascending: false }).limit(20);
    if (actor.role === 'manager') leavesQ = leavesQ.eq('department_id', actor.department_id);
    const { data: leaves } = await leavesQ;

    const leaveUserIds = [...new Set(((leaves ?? []) as any[]).map(l => l.user_id).filter(Boolean))];
    const { data: leaveUsers } = leaveUserIds.length ? await sb.from('app_users').select('id, full_name, profile_image').in('id', leaveUserIds) : { data: [] };
    const leaveNameMap:  Record<string, string> = Object.fromEntries(((leaveUsers ?? []) as any[]).map(u => [u.id, u.full_name]));
    const leavePhotoMap: Record<string, string> = {};
    await Promise.all(((leaveUsers ?? []) as any[]).map(async u => { leavePhotoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => ''); }));

    for (const l of (leaves ?? []) as any[]) {
      const fullName = leaveNameMap[l.user_id] ?? l.username;
      notifs.push({ id: 'leave_' + l.id, type: 'leave', icon: 'fa-calendar-check', color: 'blue', title: 'Leave request pending approval', sub: `${fullName} · ${cap(l.type)} · ${l.days} day${l.days !== 1 ? 's' : ''} · ${l.from_date} – ${l.to_date}`, time: l.applied_at, leaveId: l.id, photoUrl: leavePhotoMap[l.user_id] ?? '', priority: 1 });
    }

    const [{ data: checkins }, { data: checkouts }] = await Promise.all([
      sb.from('attendance').select('user_id, username, check_in_time, status').eq('work_date', todayStr).not('check_in_time', 'is', null).order('check_in_time', { ascending: false }).limit(20),
      sb.from('attendance').select('user_id, username, check_out_time, total_hours').eq('work_date', todayStr).not('check_out_time', 'is', null).order('check_out_time', { ascending: false }).limit(20),
    ]);

    const attUserIds = [...new Set([...((checkins ?? []) as any[]).map(a => a.user_id), ...((checkouts ?? []) as any[]).map(a => a.user_id)].filter(Boolean))];
    const { data: attUsers } = attUserIds.length ? await sb.from('app_users').select('id, full_name, profile_image').in('id', attUserIds) : { data: [] };
    const attNameMap:  Record<string, string> = Object.fromEntries(((attUsers ?? []) as any[]).map(u => [u.id, u.full_name]));
    const attPhotoMap: Record<string, string> = {};
    await Promise.all(((attUsers ?? []) as any[]).map(async u => { attPhotoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => ''); }));

    for (const a of (checkins ?? []) as any[]) {
      const isLate = a.status === 'late';
      const name   = attNameMap[a.user_id] ?? a.username;
      notifs.push({ id: (isLate ? 'late_' : 'checkin_') + a.username + '_' + todayStr, type: isLate ? 'late' : 'checkin', icon: isLate ? 'fa-clock' : 'fa-sign-in-alt', color: isLate ? 'gold' : 'green', title: isLate ? `${name} checked in late` : `${name} checked in`, sub: 'Today', rawTime: a.check_in_time ?? null, time: a.check_in_time ?? todayStr, photoUrl: attPhotoMap[a.user_id] ?? '', priority: isLate ? 2 : 4 });
    }
    for (const a of (checkouts ?? []) as any[]) {
      const name = attNameMap[a.user_id] ?? a.username;
      notifs.push({ id: 'checkout_' + a.username + '_' + todayStr, type: 'checkout', icon: 'fa-sign-out-alt', color: 'navy', title: `${name} checked out`, sub: a.total_hours != null ? `${a.total_hours}h worked` : 'Today', rawTime: a.check_out_time ?? null, time: a.check_out_time ?? todayStr, photoUrl: attPhotoMap[a.user_id] ?? '', priority: 5 });
    }

    let allUsersQ = sb.from('app_users').select('username, full_name').eq('status', 'active').neq('role', 'admin');
    if (actor.role === 'manager') allUsersQ = allUsersQ.eq('department_id', actor.department_id);
    const [{ data: allUsers }, { data: todayAtt }, { data: onLeave }] = await Promise.all([
      allUsersQ,
      sb.from('attendance').select('username').eq('work_date', todayStr),
      sb.from('leave_requests').select('username').eq('status', 'approved').lte('from_date', todayStr).gte('to_date', todayStr),
    ]);
    const checkedInSet = new Set(((todayAtt ?? []) as any[]).map(a => a.username));
    const onLeaveSet   = new Set(((onLeave  ?? []) as any[]).map(l => l.username));
    const absent = ((allUsers ?? []) as any[]).filter(u => !checkedInSet.has(u.username) && !onLeaveSet.has(u.username));
    if (absent.length > 0) {
      const names = absent.map(u => u.full_name ?? u.username);
      const sub   = absent.length <= 3 ? names.join(', ') : names.slice(0, 2).join(', ') + ` and ${absent.length - 2} more`;
      notifs.push({ id: 'absent_' + todayStr, type: 'absent', icon: 'fa-user-times', color: 'red', title: `${absent.length} employee${absent.length !== 1 ? 's' : ''} not checked in today`, sub, time: todayStr + 'T00:00:00Z', priority: 3 });
    }

  } else {
    const in7    = new Date(); in7.setDate(in7.getDate() + 7);
    const in7Str = in7.toISOString().slice(0, 10);

    const [todayRecRes, decidedLeavesRes, pendingLeavesRes, payslipsRes, upcomingLeaveRes, unreadMsgsRes] = await Promise.all([
      sb.from('attendance').select('check_in_time, check_out_time, total_hours, status').eq('username', actor.username).eq('work_date', todayStr).maybeSingle(),
      sb.from('leave_requests').select('id, type, status, from_date, to_date, days, applied_at').eq('user_id', actor.id).in('status', ['approved', 'rejected']).order('applied_at', { ascending: false }).limit(10),
      sb.from('leave_requests').select('id, type, from_date, to_date, days, applied_at').eq('user_id', actor.id).eq('status', 'pending').order('applied_at', { ascending: false }).limit(5),
      sb.from('payroll_approvals').select('id, date_from, date_to, pay_cycle, net_pay, approved_at').eq('user_id', actor.id).eq('status', 'approved').order('approved_at', { ascending: false }).limit(3),
      sb.from('leave_requests').select('id, type, from_date, to_date, days').eq('user_id', actor.id).eq('status', 'approved').gte('from_date', todayStr).lte('from_date', in7Str).order('from_date', { ascending: true }).limit(3),
      sb.from('messages').select('id, subject').or(`from_user_id.eq.${actor.id},to_user_id.eq.${actor.id}`).eq('read_by_recipient', false).order('created_at', { ascending: false }).limit(10),
    ]);

    const todayRec = todayRecRes.data as any;
    if (todayRec?.check_in_time) {
      const isLate = todayRec.status === 'late';
      notifs.push({ id: 'my_checkin_' + todayStr, type: 'my_checkin', icon: isLate ? 'fa-clock' : 'fa-sign-in-alt', color: isLate ? 'gold' : 'green', title: isLate ? 'You checked in late today' : 'You checked in today', sub: isLate ? 'You were past the check-in threshold' : 'Check-in recorded', rawTime: todayRec.check_in_time, time: todayRec.check_in_time, priority: 2 });
    }
    if (todayRec?.check_out_time) {
      const hrs = todayRec.total_hours != null ? `${todayRec.total_hours}h logged` : '';
      notifs.push({ id: 'my_checkout_' + todayStr, type: 'my_checkout', icon: 'fa-sign-out-alt', color: 'navy', title: 'You checked out today', sub: hrs || 'Check-out recorded', rawTime: todayRec.check_out_time, time: todayRec.check_out_time, priority: 3 });
    }
    if (!todayRec && new Date().getHours() >= 9) {
      notifs.push({ id: 'reminder_checkin_' + todayStr, type: 'reminder', icon: 'fa-bell', color: 'gold', title: "You haven't checked in today", sub: 'Remember to check in to log your attendance', time: todayStr + 'T09:00:00Z', priority: 1 });
    }

    for (const l of (decidedLeavesRes.data ?? []) as any[]) {
      const isApproved = l.status === 'approved';
      notifs.push({ id: 'myleave_' + l.id, type: 'myleave', icon: isApproved ? 'fa-check-circle' : 'fa-times-circle', color: isApproved ? 'green' : 'red', title: `Leave ${isApproved ? 'approved ✓' : 'rejected'}`, sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`, time: l.applied_at, priority: isApproved ? 4 : 1 });
    }
    for (const l of (pendingLeavesRes.data ?? []) as any[]) {
      notifs.push({ id: 'mypending_' + l.id, type: 'pending', icon: 'fa-hourglass-half', color: 'gold', title: 'Leave request awaiting approval', sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`, time: l.applied_at, priority: 3 });
    }

    const cycleLabel: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
    const fmt = (n: unknown) => Number(n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    for (const p of (payslipsRes.data ?? []) as any[]) {
      notifs.push({ id: 'payslip_' + p.id, type: 'payslip', icon: 'fa-file-invoice-dollar', color: 'green', title: 'Your payslip is ready', sub: `${cycleLabel[p.pay_cycle] ?? p.pay_cycle} · ${p.date_from} – ${p.date_to} · Net TTD ${fmt(p.net_pay)}`, time: p.approved_at, priority: 1, sectionLink: 's-emp-payroll' });
    }
    for (const l of (upcomingLeaveRes.data ?? []) as any[]) {
      const daysUntil = Math.ceil((new Date(l.from_date).getTime() - new Date(todayStr).getTime()) / 86_400_000);
      notifs.push({ id: 'upcoming_leave_' + l.id, type: 'upcoming', icon: 'fa-calendar-alt', color: 'blue', title: daysUntil === 0 ? 'Your leave starts today' : `Leave starts in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`, sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`, time: l.from_date + 'T00:00:00Z', priority: 2 });
    }

    const myMsgs = (unreadMsgsRes.data ?? []) as any[];
    if (myMsgs.length) {
      const msgIds = myMsgs.map(m => m.id);
      const { data: msgReplies } = await sb.from('message_replies').select('id, message_id, from_name, created_at').in('message_id', msgIds).neq('from_username', actor.username).order('created_at', { ascending: false }).limit(5);
      for (const r of (msgReplies ?? []) as any[]) {
        const subj = (myMsgs.find(m => m.id === r.message_id) ?? {}).subject ?? 'your message';
        notifs.push({ id: 'msgreply_' + r.id, type: 'msgreply', icon: 'fa-envelope', color: 'blue', title: `${r.from_name ?? 'Admin'} replied to "${subj}"`, sub: 'New reply in your message thread', time: r.created_at, priority: 2 });
      }
    }
  }

  notifs.sort((a, b) => (a.priority - b.priority) || new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime());
  return c.json({ success: true, data: notifs });
});

router.post('/markNotificationsRead', async c => {
  await requireUser(c);
  return c.json({ success: true });
});


export default router;
