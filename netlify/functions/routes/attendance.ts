import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
import { deptScopeFilter, loadRoleScope }   from '../lib/permissions';
import { today, hhmm24, dateOnly, num }   from '../lib/helpers';
import { setting, settingFolded }          from '../lib/settings';
import { getSignedUrl, getProfileSignedUrl, resolveAttendancePhotosBatch } from '../lib/photos';
import { uploadBase64 }                    from '../lib/upload';
import { zv, MarkAttendanceSchema, GetMyStatusSchema, GetMyHistorySchema, GetMyChartSchema, ListAttendanceSchema, ListDailyLogSchema, GetLiveAttendanceSchema, GetRecentAttendanceSchema, GetDeptStatsSchema } from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';
import type { AppUser, ProjectSite }      from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function nearestSite(lat: number, lng: number): Promise<{ site: ProjectSite; distance: number } | null> {
  const { data } = await sb.from('project_sites').select('*');
  let best: { site: ProjectSite; distance: number } | null = null;
  for (const s of (data ?? []) as ProjectSite[]) {
    const d = haversine(lat, lng, Number(s.latitude), Number(s.longitude));
    if (!best || d < best.distance) best = { site: s, distance: d };
  }
  return best;
}

router.post('/markAttendance', async c => {
  const actor = await requireUser(c);
  const v = zv(c, MarkAttendanceSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const args = v.data;
  if (actor.username !== args.username && actor.role !== 'admin')
    return c.json({ success: false, message: 'Forbidden' }, 403);

  const action    = args.action;
  const loc       = args.location;
  const lat       = loc?.latitude ?? null, lng = loc?.longitude ?? null, acc = loc?.accuracy ?? null;
  const isCheckIn = action === 'CheckIn' || action === 'Project';

  if (isCheckIn && !args.siteId)
    return c.json({ success: false, message: 'Please select a project site before checking in.' });

  let near: { site: ProjectSite; distance: number } | null = null;

  if (args.siteId) {
    const { data: chosenSite } = await sb.from('project_sites').select('*').eq('id', String(args.siteId)).maybeSingle<ProjectSite>();
    if (!chosenSite) return c.json({ success: false, message: 'Selected project site not found.' });

    if (isCheckIn && actor.role === 'employee') {
      const { data: assignment } = await sb.from('project_site_employees')
        .select('site_id').eq('site_id', args.siteId).eq('user_id', actor.id).maybeSingle();
      if (!assignment) {
        const { data: anyAssignment } = await sb.from('project_site_employees')
          .select('site_id, project_sites(name)').eq('user_id', actor.id) as { data: any[] | null };
        if (anyAssignment && anyAssignment.length > 0) {
          const assignedNames = (anyAssignment as any[]).map(a => a.project_sites?.name).filter(Boolean).join(', ');
          return c.json({ success: false, message: `You are not assigned to "${chosenSite.name}". Your assigned site(s): ${assignedNames}.` });
        }
        return c.json({ success: false, message: `You are not assigned to "${chosenSite.name}". Contact your administrator to be assigned to a project site.` });
      }
    }

    const dist        = (lat != null && lng != null) ? haversine(lat, lng, Number(chosenSite.latitude), Number(chosenSite.longitude)) : null;
    const siteRadius  = Math.max(Number(chosenSite.radius) || 200, 50);
    const gpsAcc      = acc != null && acc > 0 ? acc : 0;
    const allowedRadius = siteRadius + gpsAcc;

    if (dist == null) return c.json({ success: false, message: 'Your location could not be determined. Please enable GPS and try again.' });
    if (dist > allowedRadius) return c.json({ success: false, message: `You are ${Math.round(dist)}m away from "${chosenSite.name}" (radius: ${siteRadius}m). Move closer and try again.`, outsideRadius: true, distanceM: Math.round(dist), siteName: chosenSite.name });

    near = { site: chosenSite, distance: dist };
  } else if (lat != null && lng != null) {
    near = await nearestSite(lat, lng);
  }

  const work_date = today();
  const now       = new Date();

  if (isCheckIn) {
    const whRaw = await setting('workHours', '{"start":"08:00","end":"17:00"}');
    let wh = { start: '08:00', end: '17:00' };
    try { wh = JSON.parse(whRaw); } catch { /* keep default */ }
    const nowHHMM = hhmm24(now);
    if (nowHHMM < wh.start || nowHHMM >= wh.end)
      return c.json({ success: false, message: `Check-in is only allowed between ${wh.start} and ${wh.end}.` });
  }

  const photo = args.photoBase64 ? await uploadBase64('attendance-photos', args.photoBase64, `${actor.username}_${action}_${work_date}`) : '';
  const { data: rec } = await sb.from('attendance').select('*').eq('user_id', actor.id).eq('work_date', work_date).maybeSingle();
  const lateThreshold = await settingFolded('attendance.late_threshold_time', 'lateThresholdHHMM', { moduleKey: 'attendance', siteId: near?.site.id ?? null }, '09:15');
  const late = hhmm24(now) > lateThreshold;

  if (isCheckIn) {
    if (rec && (rec as any).check_in_time) return c.json({ success: false, message: 'Already checked in today' });
    const row = {
      user_id: actor.id, username: actor.username, work_date,
      check_in_time: now.toISOString(), check_in_lat: lat, check_in_lng: lng, check_in_accuracy: acc,
      check_in_photo_url: photo, check_in_site_id: near?.site.id, check_in_distance_m: near?.distance,
      status: late ? 'late' : 'present',
    };
    const { error } = await sb.from('attendance').upsert(row, { onConflict: 'user_id,work_date' });
    if (error) return c.json({ success: false, message: error.message });
    await log_(actor, 'checkin', 'attendance', '', near?.site.name ?? '');
    return c.json({ success: true, time: now.toISOString(), action, message: 'Checked in', site: near?.site.name ?? '', outsideRadius: false });
  }

  if (!rec || !(rec as any).check_in_time) return c.json({ success: false, message: 'Check in first' });
  if ((rec as any).check_out_time) return c.json({ success: false, message: 'Already checked out today' });

  const hours = Math.round(((now.getTime() - new Date((rec as any).check_in_time).getTime()) / 3_600_000) * 100) / 100;
  const { error } = await sb.from('attendance').update({
    check_out_time: now.toISOString(), check_out_lat: lat, check_out_lng: lng, check_out_accuracy: acc,
    check_out_photo_url: photo, check_out_site_id: near?.site.id, check_out_distance_m: near?.distance,
    total_hours: hours, updated_at: now.toISOString(),
  }).eq('id', (rec as any).id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'checkout', 'attendance', (rec as any).id, `${hours}h`);
  return c.json({ success: true, time: now.toISOString(), action, totalHours: hours, message: 'Checked out', outsideRadius: false });
});

router.post('/getMyStatus', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetMyStatusSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const uname = actor.role === 'admin' && v.data.username ? v.data.username : actor.username;
  const { data: rec } = await sb.from('attendance').select('*').eq('username', uname).eq('work_date', today()).maybeSingle();

  if (!rec) return c.json({ success: true, data: { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, location: '', checkInPhotoUrl: '', checkOutPhotoUrl: '' } });

  const r = rec as any;
  const [checkInPhotoUrl, checkOutPhotoUrl, siteRow] = await Promise.all([
    getSignedUrl('attendance-photos', r.check_in_photo_url  ?? ''),
    getSignedUrl('attendance-photos', r.check_out_photo_url ?? ''),
    r.check_in_site_id ? sb.from('project_sites').select('name').eq('id', r.check_in_site_id).maybeSingle<{ name: string }>().then(res => res.data) : Promise.resolve(null),
  ]);

  return c.json({ success: true, data: {
    hasCheckedIn: !!r.check_in_time, hasCheckedOut: !!r.check_out_time,
    checkInTime:  r.check_in_time  ?? null,
    checkOutTime: r.check_out_time ?? null,
    location: siteRow?.name ?? '',
    checkInPhotoUrl, checkOutPhotoUrl,
  } });
});

router.post('/getMyHistory', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetMyHistorySchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const since = new Date(); since.setDate(since.getDate() - (v.data.days ?? 30));
  const { data } = await sb.from('attendance').select('*').eq('username', actor.username).gte('work_date', since.toISOString().slice(0, 10)).order('work_date', { ascending: false });

  const rows = await resolveAttendancePhotosBatch(((data ?? []) as any[]).map(a => ({
    date: dateOnly(a.work_date), checkIn: a.check_in_time ?? null, checkOut: a.check_out_time ?? null,
    hours: a.total_hours ?? 0, status: a.status,
    check_in_photo_url: a.check_in_photo_url ?? '', check_out_photo_url: a.check_out_photo_url ?? '',
  })));

  return c.json({ success: true, data: rows.map(r => ({ date: (r as any).date, checkIn: (r as any).checkIn, checkOut: (r as any).checkOut, hours: (r as any).hours, status: (r as any).status, checkInPhotoUrl: r.checkInPhotoUrl, checkOutPhotoUrl: r.checkOutPhotoUrl })) });
});

router.post('/getMyChart', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetMyChartSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const y  = v.data.year  ?? new Date().getFullYear();
  const m  = v.data.month ?? new Date().getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const { data } = await sb.from('attendance').select('work_date,check_in_time').eq('user_id', actor.id).gte('work_date', start).lte('work_date', end);
  const present = new Set(((data ?? []) as any[]).filter(a => a.check_in_time).map(a => dateOnly(a.work_date))).size;
  let working = 0, sundays = 0;
  const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const now = new Date();
  for (let d = 1; d <= total; d++) {
    const dt = new Date(Date.UTC(y, m, d));
    if (dt > now) break;
    if (dt.getUTCDay() === 0) sundays++; else working++;
  }
  return c.json({ success: true, data: { present, absent: Math.max(0, working - present), sundays } });
});

router.post('/getAdminStats', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const todayStr = today();
  // Department-scoped actors only count their own department's people.
  let usersQ = sb.from('app_users').select('id,username').eq('status', 'active').neq('role', 'admin');
  if (!scope.all) usersQ = usersQ.eq('department_id', scope.departmentId);
  const [{ data: users }, { data: attAll }, { data: leaves }] = await Promise.all([
    usersQ,
    sb.from('attendance').select('username,check_in_time,check_in_site_id,status').eq('work_date', todayStr),
    sb.from('leave_requests').select('id,department_id').eq('status', 'approved').lte('from_date', todayStr).gte('to_date', todayStr),
  ]);
  const scopedUsernames = new Set(((users ?? []) as any[]).map(u => u.username));
  const att = scope.all ? (attAll ?? []) : ((attAll ?? []) as any[]).filter(a => scopedUsernames.has(a.username));
  const scopedLeaves = scope.all ? (leaves ?? []) : ((leaves ?? []) as any[]).filter(l => l.department_id === scope.departmentId);
  const totalEmployees = (users ?? []).length;
  const presentToday   = (att as any[]).filter(a => a.check_in_time).length;
  const onLeaveToday   = scopedLeaves.length;
  return c.json({ success: true, data: {
    totalEmployees, presentToday,
    absentToday:     Math.max(0, totalEmployees - presentToday - onLeaveToday),
    onLeaveToday,
    activeLocations: new Set(((att ?? []) as any[]).map(a => a.check_in_site_id).filter(Boolean)).size,
    lateToday:       ((att ?? []) as any[]).filter(a => a.status === 'late').length,
  } });
});

router.post('/getRecentAttendance', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const v = zv(c, GetRecentAttendanceSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const limit    = v.data.limit ?? 10;
  const todayStr = today();
  let usersQ = sb.from('app_users').select('id,username,full_name,department_id');
  if (!scope.all) usersQ = usersQ.eq('department_id', scope.departmentId);
  const [{ data: attAll }, { data: users }, { data: depts }] = await Promise.all([
    sb.from('attendance').select('*').eq('work_date', todayStr).order('check_in_time', { ascending: false }),
    usersQ,
    sb.from('departments').select('id,name'),
  ]);
  const userMap = Object.fromEntries(((users ?? []) as any[]).map(u => [u.username, u]));
  const deptMap = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  // Restrict to the scoped user set, then apply the limit.
  const att = (scope.all ? (attAll ?? []) : ((attAll ?? []) as any[]).filter(a => userMap[a.username])).slice(0, limit);
  return c.json({ success: true, data: (att as any[]).map(a => {
    const u = userMap[a.username] ?? {};
    return {
      name:       u.full_name || a.username,
      department: deptMap[u.department_id] || '—',
      checkIn:    a.check_in_time  ?? null,
      checkOut:   a.check_out_time ?? null,
      status:     a.check_out_time ? 'Checked Out' : a.status === 'late' ? 'Late' : a.check_in_time ? 'Present' : 'Absent',
      workDate:   a.work_date,
    };
  }) });
});

router.post('/listAttendance', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const v = zv(c, ListAttendanceSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const now  = new Date();
  const y    = v.data.year  ?? now.getFullYear();
  const mo   = v.data.month ?? now.getMonth();
  const start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  const todayStr = today();

  let usersQ = sb.from('app_users').select('*').eq('status', 'active').neq('role', 'admin').order('full_name');
  if (!scope.all) usersQ = usersQ.eq('department_id', scope.departmentId);
  const [{ data: users }, { data: depts }, { data: att }] = await Promise.all([
    usersQ,
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').gte('work_date', start).lte('work_date', end),
  ]);
  const deptMap   = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const attByUser: Record<string, any[]> = {};
  for (const a of (att ?? []) as any[]) {
    if (!attByUser[a.username]) attByUser[a.username] = [];
    attByUser[a.username].push(a);
  }

  const resolved = await Promise.all(((users ?? []) as AppUser[]).map(async u => {
    const recs   = attByUser[u.username] ?? [];
    const latest = [...recs].sort((a, b) => b.work_date < a.work_date ? -1 : 1)[0];
    const present = recs.filter((r: any) => r.check_in_time).length;
    const [checkInPhotoUrl, checkOutPhotoUrl] = await Promise.all([
      getSignedUrl('attendance-photos', latest?.check_in_photo_url  ?? ''),
      getSignedUrl('attendance-photos', latest?.check_out_photo_url ?? ''),
    ]);
    const todayRec    = ((att ?? []) as any[]).find(a => a.username === u.username && a.work_date === todayStr);
    const statusLabel = !todayRec ? 'Not Checked In' : todayRec.check_out_time ? 'Checked Out' : todayRec.status === 'late' ? 'Late' : 'Present';
    return {
      username: u.username, name: u.full_name, department: deptMap[u.department_id ?? ''] ?? '—',
      todayStatus: statusLabel,
      checkIn:  latest?.check_in_time  ?? null,
      checkOut: latest?.check_out_time ?? null,
      checkInPhotoUrl, checkOutPhotoUrl,
      totalDays: recs.length, present, absent: Math.max(0, recs.length === 0 ? 0 : recs.length - present),
    };
  }));
  return c.json({ success: true, data: resolved });
});

router.post('/listDailyLog', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const v = zv(c, ListDailyLogSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const now  = new Date();
  let start: string, end: string;
  if (v.data.dateFrom) {
    start = v.data.dateFrom;
    end   = v.data.dateTo ?? v.data.dateFrom;
  } else {
    const y  = v.data.year  ?? now.getFullYear();
    const mo = v.data.month ?? now.getMonth();
    start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
    end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  }

  let usersQ = sb.from('app_users').select('id,username,full_name,department_id').eq('status', 'active').neq('role', 'admin').order('full_name');
  if (!scope.all) usersQ = usersQ.eq('department_id', scope.departmentId);
  const [{ data: users }, { data: depts }, { data: attAll }] = await Promise.all([
    usersQ,
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').gte('work_date', start).lte('work_date', end).order('work_date', { ascending: false }),
  ]);
  const deptMap = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const userMap = Object.fromEntries(((users ?? []) as any[]).map(u => [u.username, u]));
  // Restrict log rows to the scoped user set (rows align 1:1 with photoUrls below).
  const att = scope.all ? (attAll ?? []) : ((attAll ?? []) as any[]).filter(a => userMap[a.username]);

  const photoUrls = await Promise.all((att as any[]).map(a => Promise.all([
    getSignedUrl('attendance-photos', a.check_in_photo_url  ?? ''),
    getSignedUrl('attendance-photos', a.check_out_photo_url ?? ''),
  ])));

  const rows = ((att ?? []) as any[]).map((a, i) => {
    const u    = userMap[a.username] ?? {};
    const dept = deptMap[u.department_id ?? ''] ?? '—';
    let hours  = 0;
    if (a.check_in_time && a.check_out_time)
      hours = ((new Date(a.check_out_time).getTime() - new Date(a.check_in_time).getTime()) / 3_600_000);
    const status = !a.check_in_time ? 'Absent' : a.status === 'late' ? 'Late' : 'Present';
    return {
      id: a.id, username: a.username, name: u.full_name || a.username, department: dept,
      date: dateOnly(a.work_date),
      checkIn: a.check_in_time ?? null, checkOut: a.check_out_time ?? null,
      hours: Number(hours.toFixed(1)), status,
      checkInPhotoUrl: photoUrls[i][0], checkOutPhotoUrl: photoUrls[i][1],
    };
  });

  const totalUsers    = (users ?? []).length;
  const presentRows   = rows.filter(r => r.status === 'Present' || r.status === 'Late');
  const lateRows      = rows.filter(r => r.status === 'Late');
  const days          = [...new Set(rows.map(r => r.date))].sort();
  const dayCount      = days.length || 1;
  const totalExpected = totalUsers * dayCount;
  const rate          = totalExpected ? Math.round((presentRows.length / totalExpected) * 100) : 0;

  const trendMap: Record<string, { date: string; present: number; late: number; absent: number }> = {};
  for (const r of rows) {
    if (!trendMap[r.date]) trendMap[r.date] = { date: r.date, present: 0, late: 0, absent: 0 };
    if (r.status === 'Present') trendMap[r.date].present++;
    if (r.status === 'Late')  { trendMap[r.date].present++; trendMap[r.date].late++; }
    if (r.status === 'Absent') trendMap[r.date].absent++;
  }

  const empMap: Record<string, { name: string; department: string; presentDays: number; lateDays: number; totalHours: number }> = {};
  for (const r of rows) {
    if (!empMap[r.username]) empMap[r.username] = { name: r.name, department: r.department, presentDays: 0, lateDays: 0, totalHours: 0 };
    const e = empMap[r.username];
    if (r.status === 'Present' || r.status === 'Late') e.presentDays++;
    if (r.status === 'Late') e.lateDays++;
    e.totalHours += r.hours ?? 0;
  }
  const consistency = Object.entries(empMap).map(([username, e]) => ({
    username, name: e.name, department: e.department,
    presentDays: e.presentDays, lateDays: e.lateDays, absentDays: dayCount - e.presentDays,
    attendanceRate: dayCount ? Math.round((e.presentDays / dayCount) * 100) : 0,
    avgHours: e.presentDays ? +(e.totalHours / e.presentDays).toFixed(1) : 0,
  })).sort((a, b) => b.attendanceRate - a.attendanceRate);

  return c.json({ success: true, data: {
    rows,
    dateRange: { start, end, days: dayCount },
    stats: { present: presentRows.length, late: lateRows.length, absent: rows.filter(r => r.status === 'Absent').length, rate },
    dailyTrend: Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date)),
    consistency,
  } });
});

router.post('/getLiveAttendance', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const v = zv(c, GetLiveAttendanceSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  // Department-scoped actors are pinned to their own department; org-wide actors
  // honour the requested scope filter.
  const actorScope = await loadRoleScope(actor.role);
  const deptScope  = actorScope === 'own' ? actor.department_id : v.data.scope;

  const [{ data: users }, { data: depts }, { data: sites }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').eq('status', 'active').neq('role', 'admin'),
    sb.from('departments').select('id,name'),
    sb.from('project_sites').select('id,name'),
    sb.from('attendance').select('*').eq('work_date', today()),
  ]);
  const userMap = Object.fromEntries(((users ?? []) as AppUser[]).map(u => [u.id, u]));
  const deptMap = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const siteMap = Object.fromEntries(((sites ?? []) as any[]).map(s => [s.id, s.name]));

  const filtered = ((att ?? []) as any[]).filter(a => {
    const u = userMap[a.user_id] as AppUser | undefined;
    if (!u) return false;
    if (!deptScope || deptScope === 'all') return true;
    return u.department_id === deptScope;
  });

  const photoUrls = await Promise.all(filtered.map(a => {
    const u = (userMap[a.user_id] ?? {}) as AppUser;
    return Promise.all([
      getSignedUrl('attendance-photos', a.check_in_photo_url  ?? ''),
      getSignedUrl('attendance-photos', a.check_out_photo_url ?? ''),
      getProfileSignedUrl(u.id, u.profile_image ?? ''),
    ]);
  }));

  return c.json({ success: true, data: filtered.map((a, i) => {
    const u = (userMap[a.user_id] ?? {}) as AppUser;
    const [checkInPhotoUrl, checkOutPhotoUrl, profileImage] = photoUrls[i];
    return {
      userId: a.user_id, username: a.username, fullName: u.full_name || a.username,
      department: deptMap[u.department_id ?? ''] ?? '', position: u.position ?? '',
      checkInTime:  a.check_in_time  ?? null, checkOutTime: a.check_out_time ?? null,
      lastSeen:     (a.check_out_time || a.check_in_time) ?? null,
      checkInLat:   a.check_in_lat  == null ? null : Number(a.check_in_lat),
      checkInLng:   a.check_in_lng  == null ? null : Number(a.check_in_lng),
      checkOutLat:  a.check_out_lat == null ? null : Number(a.check_out_lat),
      checkOutLng:  a.check_out_lng == null ? null : Number(a.check_out_lng),
      checkInPhotoUrl, checkOutPhotoUrl, profileImage,
      status: a.status, siteId: a.check_in_site_id ?? '', siteName: siteMap[a.check_in_site_id] ?? '',
      distanceM: a.check_in_distance_m == null ? null : Number(a.check_in_distance_m),
      isCheckedOut: !!a.check_out_time,
    };
  }) });
});

router.post('/getDashboardCharts', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const todayStr   = today();
  const cutoff     = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

  let usersQ = sb.from('app_users').select('id,username,department_id').eq('status', 'active').neq('role', 'admin');
  if (!scope.all) usersQ = usersQ.eq('department_id', scope.departmentId);
  let allLeavesQ    = sb.from('leave_requests').select('type,department_id').gte('from_date', monthStart);
  let activeLeavesQ = sb.from('leave_requests').select('id,department_id').eq('status', 'approved').lte('from_date', todayStr).gte('to_date', todayStr);
  if (!scope.all) {
    allLeavesQ    = allLeavesQ.eq('department_id', scope.departmentId);
    activeLeavesQ = activeLeavesQ.eq('department_id', scope.departmentId);
  }
  const [{ data: users }, { data: depts }, { data: attAll }, { data: allLeaves }, { data: activeLeaves }] = await Promise.all([
    usersQ,
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('username,work_date,check_in_time,status').gte('work_date', cutoff),
    allLeavesQ,
    activeLeavesQ,
  ]);
  // Restrict attendance to the scoped user set.
  const scopedUsernames = new Set(((users ?? []) as any[]).map(u => u.username));
  const att = scope.all ? (attAll ?? []) : ((attAll ?? []) as any[]).filter(a => scopedUsernames.has(a.username));

  const byDate: Record<string, { date: string; present: number; late: number }> = {};
  for (const a of (att ?? []) as any[]) {
    const d = dateOnly(a.work_date);
    if (!byDate[d]) byDate[d] = { date: d, present: 0, late: 0 };
    if (a.check_in_time) byDate[d].present++;
    if (a.status === 'late') byDate[d].late++;
  }

  const deptMap    = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const deptCounts: Record<string, number> = {};
  for (const u of (users ?? []) as any[]) deptCounts[u.department_id ?? ''] = (deptCounts[u.department_id ?? ''] ?? 0) + 1;

  const todayAtt   = ((att ?? []) as any[]).filter(a => dateOnly(a.work_date) === todayStr);
  const late       = todayAtt.filter(a => a.status === 'late').length;
  const presentRaw = todayAtt.filter(a => a.check_in_time).length;
  const onLeave    = (activeLeaves ?? []).length;
  const totalEmp   = (users ?? []).length;
  const absent     = Math.max(0, totalEmp - presentRaw - onLeave);

  const leaveTypes: Record<string, number> = { sick: 0, casual: 0, annual: 0, medical: 0 };
  for (const l of (allLeaves ?? []) as any[]) {
    const t = String(l.type ?? '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(leaveTypes, t)) leaveTypes[t]++;
  }

  return c.json({ success: true, data: {
    dailyTrend:       Object.values(byDate),
    deptDistribution: Object.keys(deptCounts).map(id => ({ name: deptMap[id] ?? 'Unassigned', count: deptCounts[id] })),
    statusBreakdown:  { present: Math.max(0, presentRaw - late), late, absent, onLeave },
    leaveTypes,
  } });
});

router.post('/getDeptStats', async c => {
  const actor = await requireRole(c, ['manager', 'admin']);
  const v = zv(c, GetDeptStatsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const actorScope = await loadRoleScope(actor.role);
  const deptId = actorScope === 'own' ? actor.department_id : v.data.departmentId;
  const [{ data: users }, { data: att }, { data: leaves }] = await Promise.all([
    sb.from('app_users').select('*').eq('department_id', deptId).eq('status', 'active').neq('role', 'admin'),
    sb.from('attendance').select('*').eq('work_date', today()),
    sb.from('leave_requests').select('*').eq('department_id', deptId).eq('status', 'approved'),
  ]);
  const set    = new Set(((users ?? []) as AppUser[]).map(u => u.username));
  const todays = ((att ?? []) as any[]).filter(a => set.has(a.username));
  return c.json({ success: true, data: {
    total:   (users ?? []).length,
    present: todays.filter(a => a.check_in_time).length,
    onLeave: (leaves ?? []).length,
    late:    todays.filter(a => a.status === 'late').length,
  } });
});

router.post('/getDeptEmployees', async c => {
  const actor = await requireRole(c, ['manager', 'admin']);
  const v = zv(c, GetDeptStatsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const actorScope = await loadRoleScope(actor.role);
  const deptId = actorScope === 'own' ? actor.department_id : v.data.departmentId;
  const [{ data: users }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').eq('department_id', deptId).neq('role', 'admin').order('full_name'),
    sb.from('attendance').select('*').eq('work_date', today()),
  ]);
  const attMap = Object.fromEntries(((att ?? []) as any[]).map(a => [a.username, a]));
  return c.json({ success: true, data: ((users ?? []) as AppUser[]).map(u => {
    const a = attMap[u.username];
    return { name: u.full_name, position: u.position ?? '', status: !a ? 'notchecked' : (a.check_out_time ? 'checkedout' : 'checkedin'), lastActivity: a ? (a.check_out_time || a.check_in_time) : null, location: 'Project' };
  }) });
});

export default router;
