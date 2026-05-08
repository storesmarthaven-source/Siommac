const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const TZ = process.env.APP_TZ || 'America/Port_of_Spain';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.warn('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or JWT_SECRET');
}

const sb = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_SERVICE_ROLE_KEY || 'missing', {
  auth: { persistSession: false }
});

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, OPTIONS'
  },
  body: JSON.stringify(body)
});

const ok = data => json(200, data && typeof data === 'object' && 'success' in data ? data : { success: true, data });
const fail = (message, statusCode = 200) => json(statusCode, { success: false, message });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hhmm    = d => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
const hhmm24  = d => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const dateOnly = v => !v ? '' : String(v).slice(0, 10);
const cap = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;

function signUser(u) {
  return jwt.sign({ sub: u.id, username: u.username, role: u.role, departmentId: u.department_id || '' }, JWT_SECRET, { expiresIn: '1h' });
}

function verifyToken(token) {
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch (_) { return null; }
}

async function requireUser(ctx) {
  if (!ctx.auth) throw new Error('Unauthorized');
  const { data, error } = await sb.from('app_users').select('*').eq('id', ctx.auth.sub).single();
  if (error || !data || data.status !== 'active') throw new Error('Unauthorized');
  return data;
}

async function requireRole(ctx, roles) {
  const u = await requireUser(ctx);
  if (!roles.includes(u.role)) throw new Error('Forbidden');
  return u;
}

async function log_(user, action, entity, entityId, details) {
  try {
    await sb.from('activity_logs').insert({
      user_id: user && user.id || '',
      username: user && user.username || '',
      action, entity, entity_id: entityId || '', details: details || ''
    });
  } catch (_) {}
}

async function setting(key, fallback = '') {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : fallback;
}

// Returns true when a profile_image value means "no photo":
// null, empty string, or the '__removed__' sentinel written when user deletes their photo.
function noPhoto(v) { return !v || v.trim() === '' || v === '__removed__'; }

// Allowed MIME types and their canonical extensions
const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif'
};
// 8 MB hard cap (base64 is ~33% larger than binary, so 8 MB base64 ≈ 6 MB file)
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

async function uploadBase64(bucket, base64, name) {
  if (!base64) return '';
  const str = String(base64);

  // Size guard — check before decoding to save CPU
  if (str.length > MAX_BASE64_BYTES) throw new Error('Image too large (max 6 MB)');

  const m = str.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = (m ? m[1] : 'image/jpeg').toLowerCase().trim();
  const raw  = m ? m[2] : str.split('base64,').pop();

  // MIME allowlist
  const ext = ALLOWED_IMAGE_TYPES[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}. Allowed: jpeg, png, webp, gif`);

  // Sanitise filename — strip path traversal and non-alphanumeric chars (except _ -)
  const safeName = String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const path = `${safeName}_${Date.now()}.${ext}`;

  const buffer = Buffer.from(raw, 'base64');
  // Binary size guard (after decode)
  if (buffer.byteLength > 6 * 1024 * 1024) throw new Error('Image too large (max 6 MB)');

  const { error } = await sb.storage.from(bucket).upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw error;

  // Return path so callers can generate signed URLs; public URL only for branding bucket
  if (bucket === 'branding') {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  return path; // signed URL generated at read time (see getSignedUrl)
}

// ─── Signed URL helpers ────────────────────────────────────────────────────────
// Private buckets: attendance-photos, profile-photos.
// Returns a signed URL valid for 1 hour, or '' if path is empty / not a storage path.
const SIGNED_TTL = 3600; // seconds

async function getSignedUrl(bucket, pathOrUrl) {
  if (!pathOrUrl) return '';
  // If it's already a full URL (legacy lh3 or public branding URL), pass through
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(pathOrUrl, SIGNED_TTL);
  if (error) { console.warn('signed url fail', bucket, pathOrUrl, error.message); return ''; }
  return data.signedUrl;
}

// Resolve photo URLs for an attendance record in-place, returning new URL strings.
async function resolveAttendancePhotos(rec) {
  if (!rec) return rec;
  const [inUrl, outUrl] = await Promise.all([
    getSignedUrl('attendance-photos', rec.check_in_photo_url  || rec.checkInPhotoUrl  || ''),
    getSignedUrl('attendance-photos', rec.check_out_photo_url || rec.checkOutPhotoUrl || '')
  ]);
  return { ...rec, checkInPhotoUrl: inUrl, checkOutPhotoUrl: outUrl };
}

// Batch-resolve photo URLs for an array of attendance-shaped objects
async function resolveAttendancePhotosBatch(rows) {
  return Promise.all((rows || []).map(r => resolveAttendancePhotos(r)));
}

// ─── Public route: getSignedUrls ──────────────────────────────────────────────
// Frontend calls this when it needs a signed URL for a known storage path.
// args: { bucket, path } or { paths: [{bucket, path}] }
async function getSignedUrls(args, ctx) {
  await requireUser(ctx);
  if (args.paths) {
    const urls = await Promise.all(args.paths.map(({ bucket, path: p }) => getSignedUrl(bucket, p)));
    return { success: true, data: urls };
  }
  const url = await getSignedUrl(args.bucket, args.path);
  return { success: true, data: url };
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function nearestSite(lat, lng) {
  const { data } = await sb.from('project_sites').select('*');
  let best = null;
  for (const s of data || []) {
    const d = haversine(lat, lng, Number(s.latitude), Number(s.longitude));
    if (!best || d < best.distance) best = { site: s, distance: d };
  }
  return best;
}

async function login(args) {
  const username = String(args.username || '').trim();
  const password = String(args.password || '');
  if (!username || !password) return { success: false, message: 'Missing credentials' };
  const { data: u } = await sb.from('app_users').select('*').ilike('username', username).maybeSingle();
  if (!u || u.status !== 'active') return { success: false, message: 'Invalid username or password' };
  const passOk = await bcrypt.compare(password, u.password_hash);
  if (!passOk) return { success: false, message: 'Invalid username or password' };
  await log_(u, 'login', 'user', u.id, 'login ok');
  const [profileImage, companyLogoUrl, companyName] = await Promise.all([
    noPhoto(u.profile_image) ? Promise.resolve('') : getSignedUrl('profile-photos', u.profile_image),
    setting('companyLogoUrl', ''),
    setting('companyName', 'My Company')
  ]);
  return {
    success: true,
    token: signUser(u),
    userId: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role,
    departmentId: u.department_id || '',
    position: u.position || '',
    colorScheme: u.color_scheme || 'navy',
    layoutMode: u.layout_mode || 'sidebar',
    profileImage,
    companyLogoUrl,
    companyName
  };
}

async function setupDemoUsers() {
  const users = [
    ['USR-001', 'admin', 'admin123', 'System Admin', 'admin', null, 'Administrator'],
    ['USR-002', 'manager1', 'manager123', 'Project Manager', 'manager', 'DEPT-001', 'Manager'],
    ['USR-003', 'employee1', 'emp123', 'Demo Employee', 'employee', 'DEPT-001', 'Worker']
  ];
  for (const [id, username, password, full_name, role, department_id, position] of users) {
    const password_hash = await bcrypt.hash(password, 10);
    await sb.from('app_users').upsert({ id, username, password_hash, full_name, role, department_id, position, status: 'active' });
  }
  await sb.from('departments').update({ manager_id: 'USR-002' }).eq('id', 'DEPT-001');
  return { success: true };
}

async function listDepartments() {
  // Two simple queries — avoids relying on the FK constraint alias name which may differ per DB
  const [{ data: depts, error: dErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from('departments').select('*').order('name'),
    sb.from('app_users').select('id, full_name, department_id, role')
  ]);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  if (uErr) throw new Error('Failed to load users for departments: ' + uErr.message);
  const managerMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name]));
  const deptUserCounts = {};
  (users || []).forEach(u => { if (u.department_id) deptUserCounts[u.department_id] = (deptUserCounts[u.department_id] || 0) + 1; });
  return (depts || []).map(d => ({
    id: d.id,
    name: d.name,
    description: d.description || '',
    managerId: d.manager_id || '',
    manager: d.manager_id ? (managerMap[d.manager_id] || '—') : '—',
    employeeCount: deptUserCounts[d.id] || 0
  }));
}

async function listProjectSites() {
  const { data, error } = await sb.from('project_sites').select('*').order('name');
  if (error) throw new Error('Failed to load project sites: ' + error.message);
  return (data || []).map(s => ({
    id: s.id, name: s.name, address: s.address || '',
    latitude: Number(s.latitude), longitude: Number(s.longitude), radius: Number(s.radius),
    description: s.description || ''
  }));
}

async function listEmployees() {
  const t = today();
  const [{ data: users, error: uErr }, { data: depts, error: dErr }, { data: att, error: aErr }] = await Promise.all([
    sb.from('app_users').select('*').order('full_name'),
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').eq('work_date', t)
  ]);
  if (uErr) throw new Error('Failed to load employees: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const attMap = Object.fromEntries((att || []).map(a => [a.username, a]));
  const usersArr = users || [];
  const profileImages = await Promise.all(
    usersArr.map(u => noPhoto(u.profile_image) ? Promise.resolve('') : getSignedUrl('profile-photos', u.profile_image))
  );
  return usersArr.map((u, i) => {
    const a = attMap[u.username];
    let todayStatus = 'notchecked';
    if (a && a.check_out_time) todayStatus = 'checkedout';
    else if (a && a.check_in_time) todayStatus = 'checkedin';
    return {
      idx: i + 1, id: u.id, username: u.username, fullName: u.full_name,
      employeeNumber: u.employee_number || '',
      department: deptMap[u.department_id] || '', departmentId: u.department_id || '',
      position: u.position || '', role: u.role, status: u.status === 'active' ? 'Active' : 'Inactive',
      todayStatus, profileImage: profileImages[i] || ''
    };
  });
}

async function _nextEmployeeNumber() {
  // Find the highest existing EMP-NNNN number and increment
  const { data } = await sb.from('app_users')
    .select('employee_number')
    .like('employee_number', 'EMP-%')
    .order('employee_number', { ascending: false })
    .limit(1);
  if (data && data.length && data[0].employee_number) {
    const n = parseInt(data[0].employee_number.replace('EMP-', ''), 10);
    return `EMP-${String(n + 1).padStart(4, '0')}`;
  }
  return 'EMP-0001';
}

async function addEmployee(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const password_hash = await bcrypt.hash(String(args.password || ''), 10);
  // Use provided employee number or auto-generate one
  const employee_number = args.employeeNumber
    ? String(args.employeeNumber).trim().toUpperCase()
    : await _nextEmployeeNumber();
  // Check uniqueness
  if (employee_number) {
    const { data: existing } = await sb.from('app_users').select('id').eq('employee_number', employee_number).maybeSingle();
    if (existing) return { success: false, message: `Employee ID "${employee_number}" is already in use.` };
  }
  const { data, error } = await sb.from('app_users').insert({
    username: args.username, password_hash, full_name: args.fullName, role: args.role,
    department_id: args.department, position: args.position, status: 'active',
    employee_number
  }).select('id').single();
  if (error) {
    if (error.code === '23505') {
      if (error.message.includes('username')) return { success: false, message: `Username "${args.username}" is already taken. Please choose a different username.` };
      if (error.message.includes('employee_number')) return { success: false, message: `Employee ID "${employee_number}" is already in use. Please choose a different one.` };
    }
    return { success: false, message: error.message };
  }
  await log_(actor, 'create', 'user', data.id, args.fullName);
  return { success: true, id: data.id, employeeNumber: employee_number };
}

async function updateEmployee(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const patch = {
    full_name: args.fullName, department_id: args.department, position: args.position,
    role: args.role, status: args.status, updated_at: new Date().toISOString()
  };
  Object.keys(patch).forEach(k => patch[k] == null || patch[k] === '' ? delete patch[k] : null);
  if (args.password) patch.password_hash = await bcrypt.hash(String(args.password), 10);
  // Allow admin to manually set/change employee number
  if (args.employeeNumber !== undefined) {
    const empNum = String(args.employeeNumber || '').trim().toUpperCase();
    if (empNum) {
      // Ensure uniqueness (exclude this user)
      const { data: existing } = await sb.from('app_users')
        .select('id').eq('employee_number', empNum).neq('username', args.username).maybeSingle();
      if (existing) return { success: false, message: `Employee ID "${empNum}" is already in use.` };
      patch.employee_number = empNum;
    } else {
      patch.employee_number = null;
    }
  }
  const { error } = await sb.from('app_users').update(patch).eq('username', args.username);
  if (error) {
    if (error.code === '23505' && error.message.includes('employee_number'))
      return { success: false, message: `Employee ID "${patch.employee_number}" is already in use. Please choose a different one.` };
    return { success: false, message: error.message };
  }
  await log_(actor, 'update', 'user', args.username, args.fullName || args.username);
  return { success: true };
}

async function deleteEmployee(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  // Cannot delete yourself
  if (actor.username === args.username) return { success: false, message: 'You cannot delete your own account' };
  // Cannot delete the last active admin
  const { data: target } = await sb.from('app_users').select('id,role').eq('username', args.username).maybeSingle();
  if (!target) return { success: false, message: 'Employee not found' };
  if (target.role === 'admin') {
    const { count } = await sb.from('app_users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'active');
    if (count <= 1) return { success: false, message: 'Cannot delete the last admin account' };
  }
  // Delete related records first to avoid FK constraint violations
  await sb.from('attendance').delete().eq('user_id', target.id);
  await sb.from('attendance').delete().eq('username', args.username);
  await sb.from('leave_requests').delete().eq('user_id', target.id);
  await sb.from('leave_requests').delete().eq('username', args.username);
  const { error } = await sb.from('app_users').delete().eq('id', target.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'delete', 'user', args.username, args.username);
  return { success: true };
}

async function markAttendance(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.username !== args.username && actor.role !== 'admin') return { success: false, message: 'Forbidden' };
  const action = args.action;
  const loc = args.location || {};
  const lat = num(loc.latitude), lng = num(loc.longitude), acc = num(loc.accuracy);
  const near = lat != null && lng != null ? await nearestSite(lat, lng) : null;
  const maxDistance = Number(await setting('maxDistanceM', '200'));
  if (near && near.distance > Math.max(Number(near.site.radius), maxDistance)) {
    return { success: false, message: `Outside allowed project radius (${near.distance}m)` };
  }
  const work_date = today();
  const now = new Date();
  const photoBucket = 'attendance-photos';
  const photo = args.photoBase64 ? await uploadBase64(photoBucket, args.photoBase64, `${actor.username}_${action}_${work_date}`) : '';
  const { data: rec } = await sb.from('attendance').select('*').eq('user_id', actor.id).eq('work_date', work_date).maybeSingle();
  const lateThreshold = await setting('lateThresholdHHMM', '09:15');
  const late = hhmm24(now) > lateThreshold;

  if (action === 'CheckIn' || action === 'Project') {
    if (rec && rec.check_in_time) return { success: false, message: 'Already checked in today' };
    const row = {
      user_id: actor.id, username: actor.username, work_date,
      check_in_time: now.toISOString(), check_in_lat: lat, check_in_lng: lng, check_in_accuracy: acc,
      check_in_photo_url: photo, check_in_site_id: near && near.site.id, check_in_distance_m: near && near.distance,
      status: late ? 'late' : 'present'
    };
    const { error } = await sb.from('attendance').upsert(row, { onConflict: 'user_id,work_date' });
    if (error) return { success: false, message: error.message };
    await log_(actor, 'checkin', 'attendance', '', near && near.site.name);
    return { success: true, time: hhmm(now), action, message: 'Checked in', site: near && near.site.name || '' };
  }

  if (!rec || !rec.check_in_time) return { success: false, message: 'Check in first' };
  if (rec.check_out_time) return { success: false, message: 'Already checked out today' };
  const hours = Math.round(((now - new Date(rec.check_in_time)) / 3600000) * 100) / 100;
  const { error } = await sb.from('attendance').update({
    check_out_time: now.toISOString(), check_out_lat: lat, check_out_lng: lng, check_out_accuracy: acc,
    check_out_photo_url: photo, check_out_site_id: near && near.site.id, check_out_distance_m: near && near.distance,
    total_hours: hours, updated_at: now.toISOString()
  }).eq('id', rec.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'checkout', 'attendance', rec.id, `${hours}h`);
  return { success: true, time: hhmm(now), action, totalHours: hours, message: 'Checked out' };
}

async function getMyStatus(args, ctx) {
  const actor = await requireUser(ctx);
  const username = actor.role === 'admin' && args.username ? args.username : actor.username;
  // Avoid FK alias join — fetch attendance row plain, then look up site name separately
  const { data: rec } = await sb.from('attendance').select('*').eq('username', username).eq('work_date', today()).maybeSingle();
  if (!rec) return { success: true, data: { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, location: '', checkInPhotoUrl: '', checkOutPhotoUrl: '' } };
  const [checkInPhotoUrl, checkOutPhotoUrl, siteRow] = await Promise.all([
    getSignedUrl('attendance-photos', rec.check_in_photo_url  || ''),
    getSignedUrl('attendance-photos', rec.check_out_photo_url || ''),
    rec.check_in_site_id
      ? sb.from('project_sites').select('name').eq('id', rec.check_in_site_id).maybeSingle().then(r => r.data)
      : Promise.resolve(null)
  ]);
  return { success: true, data: {
    hasCheckedIn:   !!rec.check_in_time,
    hasCheckedOut:  !!rec.check_out_time,
    checkInTime:    rec.check_in_time  || null,   // raw ISO — frontend formats in browser timezone
    checkOutTime:   rec.check_out_time || null,
    location: siteRow && siteRow.name || '',
    checkInPhotoUrl, checkOutPhotoUrl
  } };
}

async function getMyHistory(args, ctx) {
  const actor = await requireUser(ctx);
  const since = new Date(); since.setDate(since.getDate() - Math.min(Number(args.days) || 30, 365));
  const { data } = await sb.from('attendance').select('*').eq('username', actor.username).gte('work_date', since.toISOString().slice(0, 10)).order('work_date', { ascending: false });
  const rows = await resolveAttendancePhotosBatch(
    (data || []).map(a => ({
      date: dateOnly(a.work_date),
      checkIn:  a.check_in_time  ? hhmm(new Date(a.check_in_time))  : '--:--',
      checkOut: a.check_out_time ? hhmm(new Date(a.check_out_time)) : '--:--',
      hours: a.total_hours || 0, status: a.status,
      check_in_photo_url:  a.check_in_photo_url  || '',
      check_out_photo_url: a.check_out_photo_url || ''
    }))
  );
  return rows.map(r => ({ date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, hours: r.hours, status: r.status, checkInPhotoUrl: r.checkInPhotoUrl, checkOutPhotoUrl: r.checkOutPhotoUrl }));
}

async function getMyChart(args, ctx) {
  const actor = await requireUser(ctx);
  const y = Number(args.year) || new Date().getFullYear();
  const m = Number(args.month);
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const { data } = await sb.from('attendance').select('work_date,check_in_time').eq('user_id', actor.id).gte('work_date', start).lte('work_date', end);
  const present = new Set((data || []).filter(a => a.check_in_time).map(a => dateOnly(a.work_date))).size;
  let working = 0, sundays = 0;
  const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const now = new Date();
  for (let d = 1; d <= total; d++) {
    const dt = new Date(Date.UTC(y, m, d));
    if (dt > now) break;
    if (dt.getUTCDay() === 0) sundays++; else working++;
  }
  return { present, absent: Math.max(0, working - present), sundays };
}

async function submitLeave(args, ctx) {
  const actor = await requireUser(ctx);
  const days = Math.ceil((new Date(args.toDate) - new Date(args.fromDate)) / 86400000) + 1;
  const { data, error } = await sb.from('leave_requests').insert({
    user_id: actor.id, username: actor.username, department_id: actor.department_id,
    type: args.type, from_date: args.fromDate, to_date: args.toDate, days, reason: args.reason
  }).select('id').single();
  if (error) return { success: false, message: error.message };
  await log_(actor, 'create', 'leave', data.id, args.type);
  return { success: true, id: data.id };
}

async function getMyLeaves(args, ctx) {
  const actor = await requireUser(ctx);
  const { data } = await sb.from('leave_requests').select('*').eq('user_id', actor.id).order('applied_at', { ascending: false });
  return (data || []).map(l => ({ id: l.id, type: l.type, from: l.from_date, to: l.to_date, days: l.days, reason: l.reason, status: l.status, appliedOn: dateOnly(l.applied_at) }));
}

async function getLeaveById(args, ctx) {
  const actor = await requireUser(ctx);
  // Plain query — no FK alias joins (they silently return null when constraint names differ)
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', args.leaveId).single();
  if (!l) return { success: false, message: 'Leave not found' };
  const allowed = actor.role === 'admin' || l.user_id === actor.id || (actor.role === 'manager' && l.department_id === actor.department_id);
  if (!allowed) return { success: false, message: 'Not allowed' };
  // Fetch related rows separately
  const [userRow, deptRow, reviewerRow, companyName, companyLogoUrl] = await Promise.all([
    l.user_id    ? sb.from('app_users').select('full_name,position,username').eq('id', l.user_id).maybeSingle().then(r => r.data) : Promise.resolve(null),
    l.department_id ? sb.from('departments').select('name').eq('id', l.department_id).maybeSingle().then(r => r.data) : Promise.resolve(null),
    l.reviewed_by   ? sb.from('app_users').select('full_name').eq('id', l.reviewed_by).maybeSingle().then(r => r.data)   : Promise.resolve(null),
    setting('companyName', 'Company'),
    setting('companyLogoUrl', '')
  ]);
  return { success: true, data: {
    id: l.id,
    employee: { username: userRow && userRow.username || l.username, fullName: userRow && userRow.full_name || l.username, position: userRow && userRow.position || '', department: deptRow && deptRow.name || '' },
    type: l.type, fromDate: l.from_date, toDate: l.to_date, days: l.days, reason: l.reason, status: l.status,
    reviewedBy: reviewerRow && reviewerRow.full_name || '', reviewedAt: l.reviewed_at, reviewNotes: l.review_notes || '', appliedAt: l.applied_at,
    companyName, companyLogoUrl
  } };
}

async function updateLeave(args, ctx) {
  const actor = await requireUser(ctx);
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', args.id).single();
  if (!l) return { success: false, message: 'Leave not found' };
  if (l.status !== 'pending') return { success: false, message: 'Only pending leaves can be edited' };
  if (actor.role !== 'admin' && l.user_id !== actor.id) return { success: false, message: 'Only the owner or admin can edit' };
  const days = args.fromDate && args.toDate ? Math.ceil((new Date(args.toDate) - new Date(args.fromDate)) / 86400000) + 1 : l.days;
  await sb.from('leave_requests').update({ type: args.type || l.type, from_date: args.fromDate || l.from_date, to_date: args.toDate || l.to_date, reason: args.reason || l.reason, days }).eq('id', args.id);
  await log_(actor, 'update', 'leave', args.id, '');
  return { success: true };
}

async function deleteLeave(args, ctx) {
  const actor = await requireUser(ctx);
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', args.leaveId).single();
  if (!l) return { success: false, message: 'Leave not found' };
  if (actor.role !== 'admin' && !(l.user_id === actor.id && l.status === 'pending')) return { success: false, message: 'Cannot delete this leave' };
  await sb.from('leave_requests').delete().eq('id', args.leaveId);
  await log_(actor, 'delete', 'leave', args.leaveId, l.type);
  return { success: true };
}

async function decideLeave(args, ctx, status) {
  const actor = await requireRole(ctx, ['admin', 'manager']);
  const { data: l } = await sb.from('leave_requests').select('*').eq('id', args.leaveId).single();
  if (!l) return { success: false, message: 'Leave not found' };
  if (actor.role === 'manager' && l.department_id !== actor.department_id) return { success: false, message: 'Forbidden' };
  const { error } = await sb.from('leave_requests').update({ status, reviewed_by: actor.id, reviewed_at: new Date().toISOString(), review_notes: args.notes || '' }).eq('id', args.leaveId).eq('status', 'pending');
  if (error) return { success: false, message: error.message };
  await log_(actor, status, 'leave', args.leaveId, l.username);
  return { success: true };
}

async function getSettings() {
  const { data } = await sb.from('settings').select('*');
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  // currency is fixed to TT — correct any stale value in DB
  if (!s.currency || s.currency === 'Rs.' || s.currency === 'Rs') {
    s.currency = 'TT';
    sb.from('settings').upsert({ key: 'currency', value: 'TT', updated_at: new Date().toISOString() }).then(() => {});
  }
  return s;
}

async function updateSetting(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { error } = await sb.from('settings').upsert({ key: args.key, value: String(args.value || ''), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return { success: false, message: error.message };
  await log_(actor, 'update', 'setting', args.key, String(args.value || ''));
  return { success: true };
}

async function updatePref(args, ctx, col, valueKey) {
  const actor = await requireUser(ctx);
  if (actor.username !== args.username) return { success: false, message: 'Forbidden' };
  await sb.from('app_users').update({ [col]: args[valueKey], updated_at: new Date().toISOString() }).eq('id', actor.id);
  return { success: true };
}

async function getEmployeeByUsername(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.role === 'employee' && actor.username !== args.username) return null;
  const { data: u } = await sb.from('app_users').select('*').eq('username', args.username).maybeSingle();
  if (!u) return { success: false, message: 'User not found' };
  const profileImage = noPhoto(u.profile_image) ? '' : await getSignedUrl('profile-photos', u.profile_image);
  // Resolve department name if department_id is set
  let department = '';
  if (u.department_id) {
    const { data: dept } = await sb.from('departments').select('name').eq('id', u.department_id).maybeSingle();
    if (dept) department = dept.name;
  }
  return { success: true, data: {
    id: u.id, username: u.username, fullName: u.full_name, role: u.role,
    employeeNumber: u.employee_number || '',
    departmentId: u.department_id || '', department, position: u.position || '', status: u.status,
    email: u.email || '', phone: u.phone || '',
    colorScheme: u.color_scheme || 'navy', layoutMode: u.layout_mode || 'sidebar',
    hourlyRate: Number(u.hourly_rate) || 0, profileImage
  } };
}

async function listManagers(args, ctx) {
  await requireRole(ctx, ['admin']);
  const { data } = await sb.from('app_users').select('id,full_name').in('role', ['admin', 'manager']).eq('status', 'active').order('full_name');
  return (data || []).map(u => ({ id: u.id, name: u.full_name }));
}

async function addDepartment(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { data, error } = await sb.from('departments').insert({ name: args.name, description: args.description || '', manager_id: args.manager || null }).select('id').single();
  if (error) return { success: false, message: error.message };
  await log_(actor, 'create', 'department', data.id, args.name);
  return { success: true, id: data.id };
}

async function updateDepartment(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { error } = await sb.from('departments').update({ name: args.name, description: args.description || '', manager_id: args.manager || null, updated_at: new Date().toISOString() }).eq('id', args.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'update', 'department', args.id, args.name);
  return { success: true };
}

async function deleteDepartment(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { error } = await sb.from('departments').delete().eq('id', args.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'delete', 'department', args.id, '');
  return { success: true };
}

async function addProjectSite(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { data, error } = await sb.from('project_sites').insert({
    name: args.name, address: args.address || '', latitude: args.latitude, longitude: args.longitude,
    radius: args.radius, description: args.description || ''
  }).select('id').single();
  if (error) return { success: false, message: error.message };
  await log_(actor, 'create', 'site', data.id, args.name);
  return { success: true, id: data.id };
}

async function updateProjectSite(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { error } = await sb.from('project_sites').update({
    name: args.name, address: args.address || '', latitude: args.latitude, longitude: args.longitude,
    radius: args.radius, description: args.description || '', updated_at: new Date().toISOString()
  }).eq('id', args.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'update', 'site', args.id, args.name);
  return { success: true };
}

async function deleteProjectSite(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const { error } = await sb.from('project_sites').delete().eq('id', args.id);
  if (error) return { success: false, message: error.message };
  await log_(actor, 'delete', 'site', args.id, '');
  return { success: true };
}

async function listAllLeaves(args, ctx) {
  await requireRole(ctx, ['admin']);
  // Two plain queries — no FK alias joins (silently null when constraint names differ)
  const [{ data: leaves, error: lErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from('leave_requests').select('*').order('applied_at', { ascending: false }),
    sb.from('app_users').select('id, full_name')
  ]);
  if (lErr) throw new Error('Failed to load leaves: ' + lErr.message);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name]));
  return { success: true, data: (leaves || []).map(l => ({
    id: l.id,
    employee: (l.user_id && userMap[l.user_id]) || l.username,
    type: cap(l.type) + ' Leave',
    from: l.from_date, to: l.to_date, days: l.days,
    status: cap(l.status), reason: l.reason
  })) };
}

async function getPendingLeavesForManager(args, ctx) {
  const actor = await requireRole(ctx, ['manager', 'admin']);
  // Two plain queries — no FK alias joins
  let leavesQ = sb.from('leave_requests').select('*').eq('status', 'pending').order('applied_at', { ascending: false });
  if (actor.role === 'manager') leavesQ = leavesQ.eq('department_id', actor.department_id);
  const [{ data: leaves, error: lErr }, { data: users, error: uErr }] = await Promise.all([
    leavesQ,
    sb.from('app_users').select('id, full_name')
  ]);
  if (lErr) throw new Error('Failed to load leaves: ' + lErr.message);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name]));
  return (leaves || []).map(l => ({
    id: l.id,
    employee: (l.user_id && userMap[l.user_id]) || l.username,
    type: l.type, from: l.from_date, to: l.to_date, days: l.days,
    appliedOn: dateOnly(l.applied_at), reason: l.reason
  }));
}

async function getDeptStats(args, ctx) {
  const actor = await requireRole(ctx, ['manager', 'admin']);
  const deptId = actor.role === 'manager' ? actor.department_id : args.departmentId;
  const [{ data: users }, { data: att }, { data: leaves }] = await Promise.all([
    sb.from('app_users').select('*').eq('department_id', deptId).eq('status', 'active').neq('role', 'admin'),
    sb.from('attendance').select('*').eq('work_date', today()),
    sb.from('leave_requests').select('*').eq('department_id', deptId).eq('status', 'approved')
  ]);
  const set = new Set((users || []).map(u => u.username));
  const todays = (att || []).filter(a => set.has(a.username));
  return { total: (users || []).length, present: todays.filter(a => a.check_in_time).length, onLeave: (leaves || []).length, late: todays.filter(a => a.status === 'late').length };
}

async function getDeptEmployees(args, ctx) {
  const actor = await requireRole(ctx, ['manager', 'admin']);
  const deptId = actor.role === 'manager' ? actor.department_id : args.departmentId;
  const [{ data: users }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').eq('department_id', deptId).neq('role', 'admin').order('full_name'),
    sb.from('attendance').select('*').eq('work_date', today())
  ]);
  const attMap = Object.fromEntries((att || []).map(a => [a.username, a]));
  return (users || []).map(u => {
    const a = attMap[u.username];
    return { name: u.full_name, position: u.position || '', status: !a ? 'notchecked' : (a.check_out_time ? 'checkedout' : 'checkedin'), lastActivity: a ? hhmm(new Date(a.check_out_time || a.check_in_time)) : '—', location: 'Project' };
  });
}

async function getAdminStats(args, ctx) {
  await requireRole(ctx, ['admin']);
  const todayStr = today();
  const [{ data: users }, { data: att }, { data: leaves }] = await Promise.all([
    sb.from('app_users').select('id').eq('status', 'active').neq('role', 'admin'),
    sb.from('attendance').select('check_in_time,check_in_site_id,status').eq('work_date', todayStr),
    // only leaves active today
    sb.from('leave_requests').select('id').eq('status', 'approved').lte('from_date', todayStr).gte('to_date', todayStr)
  ]);
  const totalEmployees = (users || []).length;
  const presentToday   = (att || []).filter(a => a.check_in_time).length;
  const onLeaveToday   = (leaves || []).length;
  return {
    totalEmployees,
    presentToday,
    absentToday:     Math.max(0, totalEmployees - presentToday - onLeaveToday),
    onLeaveToday,
    activeLocations: new Set((att || []).map(a => a.check_in_site_id).filter(Boolean)).size,
    lateToday:       (att || []).filter(a => a.status === 'late').length
  };
}

async function getRecentAttendance(args, ctx) {
  await requireRole(ctx, ['admin', 'manager']);
  const limit = Math.min(Number(args.limit) || 10, 50);
  // Fetch today's attendance rows ordered by most-recent check-in first
  const todayStr = today();
  const [{ data: att }, { data: users }, { data: depts }] = await Promise.all([
    sb.from('attendance').select('*').eq('work_date', todayStr).order('check_in_time', { ascending: false }).limit(limit),
    sb.from('app_users').select('id,username,full_name,department_id'),
    sb.from('departments').select('id,name')
  ]);
  const userMap = Object.fromEntries((users || []).map(u => [u.username, u]));
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const rows = (att || []).map(a => {
    const u = userMap[a.username] || {};
    const statusLabel = a.check_out_time ? 'Checked Out'
      : a.status === 'late' ? 'Late'
      : a.check_in_time  ? 'Present'
      : 'Absent';
    return {
      name:       u.full_name || a.username,
      department: deptMap[u.department_id] || '—',
      checkIn:    a.check_in_time  ? a.check_in_time  : null,
      checkOut:   a.check_out_time ? a.check_out_time : null,
      status:     statusLabel,
      workDate:   a.work_date
    };
  });
  return { success: true, data: rows };
}

async function listAttendance(args, ctx) {
  await requireRole(ctx, ['admin']);
  // month (0-11) + year filter — if not provided, default to today's month
  const now = new Date();
  const y  = (args.year  != null && !isNaN(Number(args.year)))  ? Number(args.year)  : now.getFullYear();
  const mo = (args.month != null && !isNaN(Number(args.month))) ? Number(args.month) : now.getMonth();
  const start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);

  const [{ data: users }, { data: depts }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').gte('work_date', start).lte('work_date', end)
  ]);
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));

  // Group attendance rows by username for the selected period
  const attByUser = {};
  for (const a of att || []) {
    if (!attByUser[a.username]) attByUser[a.username] = [];
    attByUser[a.username].push(a);
  }

  // For a multi-day view we resolve photos for the most recent record per user
  const resolved = await Promise.all((users || []).map(async u => {
    const recs = attByUser[u.username] || [];
    // Most recent record for today's status display
    const latest = recs.sort((a, b) => b.work_date < a.work_date ? -1 : 1)[0];
    const totalDays = recs.length;
    const present = recs.filter(r => r.check_in_time).length;
    const absent = totalDays > 0 ? 0 : 1; // show 0 absent if any records exist
    const [checkInPhotoUrl, checkOutPhotoUrl] = await Promise.all([
      getSignedUrl('attendance-photos', latest && latest.check_in_photo_url  || ''),
      getSignedUrl('attendance-photos', latest && latest.check_out_photo_url || '')
    ]);
    const todayRec = (att || []).find(a => a.username === u.username && a.work_date === today());
    const statusLabel = !todayRec ? 'Not Checked In'
      : todayRec.check_out_time ? 'Checked Out'
      : todayRec.status === 'late' ? 'Late' : 'Present';
    return {
      username: u.username, name: u.full_name, department: deptMap[u.department_id] || '—',
      todayStatus: statusLabel,
      checkIn:  latest && latest.check_in_time  ? hhmm(new Date(latest.check_in_time))  : '—',
      checkOut: latest && latest.check_out_time ? hhmm(new Date(latest.check_out_time)) : '—',
      checkInPhotoUrl, checkOutPhotoUrl,
      totalDays, present, absent: Math.max(0, totalDays === 0 ? 0 : totalDays - present)
    };
  }));
  return resolved;
}

// ── Daily Attendance Log (one row per employee per day, for the Attendance Overview page) ──
async function listDailyLog(args, ctx) {
  await requireRole(ctx, ['admin', 'manager']);
  const now = new Date();
  const y  = (args.year  != null && !isNaN(Number(args.year)))  ? Number(args.year)  : now.getFullYear();
  const mo = (args.month != null && !isNaN(Number(args.month))) ? Number(args.month) : now.getMonth();
  const start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);

  const [{ data: users }, { data: depts }, { data: att }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,department_id').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').gte('work_date', start).lte('work_date', end).order('work_date', { ascending: false })
  ]);

  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const userMap = Object.fromEntries((users || []).map(u => [u.username, u]));

  // Resolve signed URLs for all records
  const photoUrls = await Promise.all((att || []).map(a => Promise.all([
    getSignedUrl('attendance-photos', a.check_in_photo_url  || ''),
    getSignedUrl('attendance-photos', a.check_out_photo_url || '')
  ])));

  const rows = (att || []).map((a, i) => {
    const u = userMap[a.username] || {};
    const dept = deptMap[u.department_id || ''] || '—';
    const checkIn  = a.check_in_time  ? hhmm(new Date(a.check_in_time))  : null;
    const checkOut = a.check_out_time ? hhmm(new Date(a.check_out_time)) : null;
    let hours = 0;
    if (a.check_in_time && a.check_out_time) {
      hours = ((new Date(a.check_out_time) - new Date(a.check_in_time)) / 3600000).toFixed(1);
    }
    const status = !checkIn ? 'Absent'
      : a.status === 'late' ? 'Late' : 'Present';
    return {
      id: a.id, username: a.username,
      name: u.full_name || a.username,
      department: dept,
      date: dateOnly(a.work_date),
      checkIn: checkIn || '—',
      checkOut: checkOut || '—',
      hours: Number(hours),
      status,
      checkInPhotoUrl:  photoUrls[i][0],
      checkOutPhotoUrl: photoUrls[i][1]
    };
  });

  // Also compute summary stats for the period
  const presentToday = rows.filter(r => r.date === today() && (r.status === 'Present' || r.status === 'Late'));
  const lateToday = rows.filter(r => r.date === today() && r.status === 'Late');
  const totalUsers = (users || []).length;
  const presentCount = presentToday.length;
  const rate = totalUsers ? Math.round((presentCount / totalUsers) * 100) : 0;

  // Daily trend for the month (for chart)
  const trendMap = {};
  for (const r of rows) {
    if (!trendMap[r.date]) trendMap[r.date] = { date: r.date, present: 0, late: 0, absent: 0 };
    if (r.status === 'Present') trendMap[r.date].present++;
    if (r.status === 'Late')    { trendMap[r.date].present++; trendMap[r.date].late++; }
    if (r.status === 'Absent')  trendMap[r.date].absent++;
  }
  const dailyTrend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    success: true,
    data: {
      rows,
      stats: {
        present: presentCount,
        late: lateToday.length,
        absent: totalUsers - presentCount,
        rate
      },
      dailyTrend
    }
  };
}

async function getLiveAttendance(args, ctx) {
  const actor = await requireRole(ctx, ['admin', 'manager']);
  const scope = actor.role === 'manager' ? actor.department_id : args.scope;
  const [{ data: users }, { data: depts }, { data: sites }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').eq('status', 'active').neq('role', 'admin'),
    sb.from('departments').select('id,name'),
    sb.from('project_sites').select('id,name'),
    sb.from('attendance').select('*').eq('work_date', today())
  ]);
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const siteMap = Object.fromEntries((sites || []).map(s => [s.id, s.name]));
  const filtered = (att || []).filter(a => {
    const u = userMap[a.user_id];
    if (!u) return false;
    if (!scope || scope === 'all') return true;
    return u.department_id === scope;
  });
  // Resolve signed URLs in parallel
  const photoUrls = await Promise.all(filtered.map(a => Promise.all([
    getSignedUrl('attendance-photos', a.check_in_photo_url  || ''),
    getSignedUrl('attendance-photos', a.check_out_photo_url || ''),
    (a.user_id && userMap[a.user_id] && !noPhoto(userMap[a.user_id].profile_image)) ? getSignedUrl('profile-photos', userMap[a.user_id].profile_image) : Promise.resolve('')
  ])));
  return filtered.map((a, i) => {
    const u = userMap[a.user_id] || {};
    const last = a.check_out_time || a.check_in_time;
    const [checkInPhotoUrl, checkOutPhotoUrl, profileImage] = photoUrls[i];
    return {
      userId: a.user_id, username: a.username, fullName: u.full_name || a.username,
      department: deptMap[u.department_id] || '',
      position: u.position || '',
      checkInTime:  a.check_in_time  ? hhmm(new Date(a.check_in_time))  : null,
      checkOutTime: a.check_out_time ? hhmm(new Date(a.check_out_time)) : null,
      lastSeen: last ? hhmm(new Date(last)) : null,
      checkInLat:  a.check_in_lat  == null ? null : Number(a.check_in_lat),
      checkInLng:  a.check_in_lng  == null ? null : Number(a.check_in_lng),
      checkOutLat: a.check_out_lat == null ? null : Number(a.check_out_lat),
      checkOutLng: a.check_out_lng == null ? null : Number(a.check_out_lng),
      checkInPhotoUrl, checkOutPhotoUrl, profileImage,
      status: a.status, siteId: a.check_in_site_id || '', siteName: siteMap[a.check_in_site_id] || '',
      distanceM: a.check_in_distance_m == null ? null : Number(a.check_in_distance_m),
      isCheckedOut: !!a.check_out_time
    };
  });
}

async function getDashboardCharts(args, ctx) {
  await requireRole(ctx, ['admin']);
  const todayStr = today();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  // Fetch this month's leave requests to count leave-type breakdown
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

  const [{ data: users }, { data: depts }, { data: att }, { data: allLeaves }, { data: activeLeaves }] = await Promise.all([
    sb.from('app_users').select('id,department_id').eq('status', 'active').neq('role', 'admin'),
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('work_date,check_in_time,status').gte('work_date', cutoff),
    // leave breakdown — this calendar month only (matches Apps Script behaviour)
    sb.from('leave_requests').select('type').gte('from_date', monthStart),
    // leaves active today — for onLeave stat
    sb.from('leave_requests').select('id').eq('status', 'approved').lte('from_date', todayStr).gte('to_date', todayStr)
  ]);

  // ── 1. daily trend (last 30 days) ──
  const byDate = {};
  for (let i = 30; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDate[d] = { date: d, present: 0, late: 0 };
  }
  for (const a of att || []) {
    const d = dateOnly(a.work_date);
    if (byDate[d] && a.check_in_time) byDate[d].present++;
    if (byDate[d] && a.status === 'late') byDate[d].late++;
  }

  // ── 2. department distribution ──
  const deptMap    = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  const deptCounts = {};
  for (const u of users || []) deptCounts[u.department_id || ''] = (deptCounts[u.department_id || ''] || 0) + 1;

  // ── 3. today's status breakdown ──
  const todayAtt  = (att || []).filter(a => dateOnly(a.work_date) === todayStr);
  const late      = todayAtt.filter(a => a.status === 'late').length;
  const presentRaw = todayAtt.filter(a => a.check_in_time).length;
  const onLeave   = (activeLeaves || []).length;
  const totalEmp  = (users || []).length;
  const absent    = Math.max(0, totalEmp - presentRaw - onLeave);

  // ── 4. leave type breakdown (this month) ──
  const leaveTypes = { sick: 0, casual: 0, annual: 0, medical: 0 };
  for (const l of allLeaves || []) {
    const t = String(l.type || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(leaveTypes, t)) leaveTypes[t]++;
  }

  return {
    dailyTrend: Object.values(byDate),
    deptDistribution: Object.keys(deptCounts).map(id => ({ name: deptMap[id] || 'Unassigned', count: deptCounts[id] })),
    statusBreakdown: { present: Math.max(0, presentRaw - late), late, absent, onLeave },
    leaveTypes
  };
}

async function updateMyProfile(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.username !== args.username) return { success: false, message: 'Forbidden' };
  const patch = { updated_at: new Date().toISOString() };
  if (args.fullName) patch.full_name = String(args.fullName).trim();
  if (args.email !== undefined) patch.email = String(args.email).trim();
  if (args.phone !== undefined) patch.phone = String(args.phone).trim();
  if (args.newPassword) {
    if (!args.oldPassword) return { success: false, message: 'Current password is required' };
    if (!await bcrypt.compare(String(args.oldPassword), actor.password_hash)) return { success: false, message: 'Current password is incorrect' };
    patch.password_hash = await bcrypt.hash(String(args.newPassword), 10);
  }
  const removePhoto = args.removeProfileImage === true || args.removeProfileImage === 'true';
  if (removePhoto) {
    // Write '__removed__' — a real non-null string the DB will always store.
    // Null and empty string are silently dropped by Supabase JS .update() on nullable columns.
    patch.profile_image = '__removed__';
  } else if (args.profileImageBase64) {
    patch.profile_image = await uploadBase64('profile-photos', args.profileImageBase64, `profile_${actor.username}`);
  }
  const { data, error } = await sb.from('app_users').update(patch).eq('id', actor.id).select('profile_image, full_name, email, phone').single();
  if (error) { console.error('updateMyProfile DB error:', error); return { success: false, message: error.message }; }
  // '__removed__', null, and '' all mean "no photo"
  const storedPath = noPhoto(data.profile_image) ? '' : data.profile_image;
  const profileImage = storedPath ? await getSignedUrl('profile-photos', storedPath) : '';
  return { success: true, profileImage, fullName: data.full_name, email: data.email || '', phone: data.phone || '' };
}

async function uploadLogo(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  const url = await uploadBase64('branding', args.base64, 'company_logo');
  const { error } = await sb.from('settings').upsert(
    { key: 'companyLogoUrl', value: url, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) { console.error('uploadLogo settings upsert error:', error); return { success: false, message: error.message }; }
  await log_(actor, 'update', 'companyLogoUrl', '', url);
  return { success: true, url };
}

async function listHourlyRates(args, ctx) {
  await requireRole(ctx, ['admin']);
  // Two plain queries — no FK alias joins
  const [{ data: users, error: uErr }, { data: depts, error: dErr }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,role,department_id,position,hourly_rate').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name')
  ]);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  return (users || []).map(u => ({
    username: u.username, fullName: u.full_name, role: u.role,
    department: (u.department_id && deptMap[u.department_id]) || '—',
    position: u.position || '—',
    hourlyRate: Number(u.hourly_rate) || 0
  }));
}

async function updateHourlyRate(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  await sb.from('app_users').update({ hourly_rate: Math.max(0, Number(args.rate) || 0), updated_at: new Date().toISOString() }).eq('username', args.username);
  await log_(actor, 'update', 'hourlyRate', args.username, String(args.rate || 0));
  return { success: true };
}

async function bulkImportRates(args, ctx) {
  const actor = await requireRole(ctx, ['admin']);
  let updated = 0, skipped = 0;
  for (const row of args.rows || []) {
    const username = String(row.username || '').trim();
    if (!username) { skipped++; continue; }
    const { error } = await sb.from('app_users').update({ hourly_rate: Math.max(0, Number(row.rate) || 0) }).eq('username', username);
    if (error) skipped++; else updated++;
  }
  await log_(actor, 'bulkImport', 'hourlyRates', '', `${updated} updated, ${skipped} skipped`);
  return { success: true, updated, skipped, total: (args.rows || []).length, skippedNames: [] };
}

async function getPayrollEmployees(args, ctx) {
  const actor = await requireRole(ctx, ['admin', 'manager']);
  // Use two plain queries to avoid FK alias issues
  const [{ data: users, error: uErr }, { data: depts, error: dErr }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,department_id,position,status,role').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name')
  ]);
  if (uErr) throw new Error('Failed to load employees: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  const deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
  let list = (users || []);
  if (actor.role === 'manager') list = list.filter(u => u.department_id === actor.department_id);
  return { success: true, data: list.map(u => ({ username: u.username, fullName: u.full_name, department: deptMap[u.department_id] || '—', position: u.position || '—' })) };
}

// Count Mon–Fri days in a given UTC month (Saturday + Sunday = off, Trinidad standard)
function workingDaysInMonth(y, mo) {
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const day = new Date(Date.UTC(y, mo, d)).getUTCDay();
    if (day !== 0 && day !== 6) count++; // 0=Sun, 6=Sat
  }
  return count;
}

async function getPayroll(args, ctx) {
  const actor = await requireRole(ctx, ['admin', 'manager']);
  const { data: emp } = await sb.from('app_users').select('*').eq('username', args.username).single();
  if (!emp) return { success: false, message: 'Employee not found' };
  // Resolve department name separately to avoid FK alias issues
  let empDeptName = '—';
  if (emp.department_id) {
    const { data: deptRow } = await sb.from('departments').select('name').eq('id', emp.department_id).maybeSingle();
    if (deptRow) empDeptName = deptRow.name;
  }
  if (actor.role === 'manager' && emp.department_id !== actor.department_id) return { success: false, message: 'Employee not in your department' };
  const y = Number(args.year), mo = Number(args.month);
  const start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, mo, 1)));

  const [{ data: recs }, [latePerDay, finePerDay, currency, companyName]] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', emp.id).gte('work_date', start).lte('work_date', end).order('work_date'),
    Promise.all([
      setting('latePenaltyPerDay', '0'),
      setting('leaveFinePerDay', '0'),
      setting('currency', 'TT'),
      setting('companyName', 'Company')
    ])
  ]);

  const rate = Number(emp.hourly_rate) || 0;
  const lateDeduct = Number(latePerDay) || 0;
  const fineDeduct = Number(finePerDay) || 0;

  const days = (recs || []).map(a => {
    const hours = Number(a.total_hours) || 0;
    return {
      date: dateOnly(a.work_date),
      checkIn:  a.check_in_time  ? hhmm(new Date(a.check_in_time))  : '—',
      checkOut: a.check_out_time ? hhmm(new Date(a.check_out_time)) : '—',
      hours, status: a.status || '—',
      earnings: Math.round(hours * rate * 100) / 100
    };
  });

  const totalHours    = Math.round(days.reduce((s, d) => s + d.hours,    0) * 100) / 100;
  const grossEarnings = Math.round(days.reduce((s, d) => s + d.earnings, 0) * 100) / 100;
  const workingDays   = workingDaysInMonth(y, mo);
  const presentDays   = days.filter(d => d.status === 'present' || d.status === 'late').length;
  const lateDays      = days.filter(d => d.status === 'late').length;
  const absentDays    = Math.max(0, workingDays - presentDays);
  const latePenalty   = Math.round(lateDays   * lateDeduct * 100) / 100;
  const leaveFine     = Math.round(absentDays * fineDeduct * 100) / 100;
  const netEarnings   = Math.max(0, Math.round((grossEarnings - latePenalty - leaveFine) * 100) / 100);

  return {
    success: true,
    data: {
      employee: { username: emp.username, fullName: emp.full_name, position: emp.position || '—', department: empDeptName, hourlyRate: rate },
      period:   { year: y, month: mo, label, start, end },
      days,
      totals: {
        totalDays: days.length, workingDays, presentDays, absentDays, lateDays,
        totalHours, grossEarnings,
        latePenaltyPerDay: lateDeduct, latePenalty,
        leaveFinePerDay:   fineDeduct, leaveFine,
        netEarnings, totalEarnings: grossEarnings
      },
      currency,
      companyName,
      generatedAt: new Date().toISOString()
    }
  };
}

const routes = {
  ping: async () => ({ ok: true, ts: new Date().toISOString() }),
  setupDemoUsers,
  login,
  logout: async (a, ctx) => { const u = await requireUser(ctx); await log_(u, 'logout', 'user', u.id, ''); return { success: true }; },
  updateColorScheme: (a, ctx) => updatePref(a, ctx, 'color_scheme', 'scheme'),
  updateLayoutMode: (a, ctx) => updatePref(a, ctx, 'layout_mode', 'mode'),
  listEmployees: async (a, ctx) => { await requireRole(ctx, ['admin']); return listEmployees(); },
  addEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeByUsername,
  listDepartments: async (a, ctx) => { await requireUser(ctx); return listDepartments(); },
  addDepartment,
  updateDepartment,
  deleteDepartment,
  listManagers,
  listProjectSites: async (a, ctx) => { await requireUser(ctx); return listProjectSites(); },
  addProjectSite,
  updateProjectSite,
  deleteProjectSite,
  getSettings: async () => getSettings(),
  updateSetting,
  markAttendance,
  getMyStatus,
  getMyHistory,
  getMyChart,
  submitLeave,
  getMyLeaves,
  getLeaveById,
  updateLeave,
  deleteLeave,
  listAllLeaves,
  getPendingLeavesForManager,
  getDeptStats,
  getDeptEmployees,
  getAdminStats,
  getRecentAttendance,
  listAttendance,
  listDailyLog,
  getLiveAttendance,
  getDashboardCharts,
  updateMyProfile,
  uploadLogo,
  listHourlyRates,
  updateHourlyRate,
  bulkImportRates,
  getPayrollEmployees,
  getPayroll,
  approveLeave: (a, ctx) => decideLeave(a, ctx, 'approved'),
  rejectLeave:  (a, ctx) => decideLeave(a, ctx, 'rejected'),
  getSignedUrls
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return fail('Invalid JSON'); }
  const action = body.action;
  const fn = routes[action];
  if (!fn) return fail(`Route not migrated yet: ${action}`);
  const ctx = { auth: verifyToken(body.token || (body.args && body.args.token)) };
  try {
    return ok(await fn(body.args || {}, ctx));
  } catch (e) {
    console.error(action, e);
    return fail(e.message || String(e));
  }
};
