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
  return jwt.sign({ sub: u.id, username: u.username, role: u.role, departmentId: u.department_id || '' }, JWT_SECRET, { expiresIn: '8h' });
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

  // Public buckets (branding) → stable public URL.
  // profile-photos and attendance-photos are private; return path for signed URL generation.
  if (bucket === 'branding') {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  return path; // signed URL generated at read time (see getSignedUrl)
}

// ─── Signed URL helpers ────────────────────────────────────────────────────────
// Both profile-photos and attendance-photos are private buckets.
// TTL = 24 h. We persist signed URLs for profile photos in the DB (signed_url,
// signed_url_expires_at columns on app_users) so the same URL is reused across
// cold starts — making it stable enough for the SW photo cache to hit on refresh.
const SIGNED_TTL = 86400; // seconds — 24 hours
const SIGNED_REFRESH_BEFORE = 3600; // regenerate when less than 1 h remaining

// In-memory cache for attendance photos (short-lived, no need to persist)
const _signedUrlCache = new Map();
const SIGNED_CACHE_TTL = (SIGNED_TTL - 1800) * 1000;

async function getSignedUrl(bucket, pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;

  const cacheKey = bucket + ':' + pathOrUrl;
  const cached = _signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await sb.storage.from(bucket).createSignedUrl(pathOrUrl, SIGNED_TTL);
  if (error) { console.warn('signed url fail', bucket, pathOrUrl, error.message); return ''; }

  _signedUrlCache.set(cacheKey, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_CACHE_TTL });
  return data.signedUrl;
}

// Get a stable signed URL for a profile photo.
// Reads the cached URL from app_users; regenerates only when < 1 h from expiry.
// This ensures the same URL is returned across cold starts so the SW cache hits.
async function getProfileSignedUrl(userId, imagePath) {
  if (!imagePath || noPhoto(imagePath)) return '';
  if (/^https?:\/\//.test(imagePath)) return imagePath;

  // Read cached URL + expiry from DB
  const { data: row } = await sb
    .from('app_users')
    .select('signed_url, signed_url_expires_at')
    .eq('id', userId)
    .maybeSingle();

  const now = Date.now();
  const expiresAt = row && row.signed_url_expires_at ? new Date(row.signed_url_expires_at).getTime() : 0;
  const stillValid = row && row.signed_url && expiresAt > now + SIGNED_REFRESH_BEFORE * 1000;

  if (stillValid) return row.signed_url;

  // Generate a fresh signed URL and persist it
  const { data, error } = await sb.storage.from('profile-photos').createSignedUrl(imagePath, SIGNED_TTL);
  if (error || !data) { console.warn('profile signed url fail', imagePath, error && error.message); return ''; }

  const newExpiry = new Date(now + SIGNED_TTL * 1000).toISOString();
  await sb.from('app_users').update({ signed_url: data.signedUrl, signed_url_expires_at: newExpiry }).eq('id', userId);

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
    getProfileSignedUrl(u.id, u.profile_image),
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
  const [{ data, error }, { data: assignments }] = await Promise.all([
    sb.from('project_sites').select('*').order('name'),
    sb.from('project_site_employees')
      .select('site_id, user_id, app_users(id, full_name, profile_image, signed_url, signed_url_expires_at)')
  ]);
  if (error) throw new Error('Failed to load project sites: ' + error.message);

  // Build per-site assigned employee list with signed photo URLs
  const siteEmpMap = {};
  for (const a of assignments || []) {
    if (!siteEmpMap[a.site_id]) siteEmpMap[a.site_id] = [];
    const u = a.app_users || {};
    // Reuse cached signed URL if still valid (> 1h remaining)
    const now = Date.now();
    const expires = u.signed_url_expires_at ? new Date(u.signed_url_expires_at).getTime() : 0;
    const photoUrl = (u.signed_url && expires > now + 3600 * 1000) ? u.signed_url : '';
    siteEmpMap[a.site_id].push({ id: u.id, name: u.full_name || '', photoUrl });
  }

  return (data || []).map(s => ({
    id: s.id, name: s.name, address: s.address || '',
    latitude: Number(s.latitude), longitude: Number(s.longitude), radius: Number(s.radius),
    description: s.description || '',
    assignedEmployees: siteEmpMap[s.id] || []
  }));
}

async function assignSiteEmployees(args, ctx) {
  await requireRole(ctx, ['admin']);
  const siteId  = String(args.siteId  || '');
  const userIds = Array.isArray(args.userIds) ? args.userIds.map(String) : [];
  if (!siteId) return { success: false, message: 'Missing siteId' };

  // Replace all assignments for this site atomically
  await sb.from('project_site_employees').delete().eq('site_id', siteId);
  if (userIds.length) {
    const rows = userIds.map(uid => ({ site_id: siteId, user_id: uid }));
    const { error } = await sb.from('project_site_employees').insert(rows);
    if (error) return { success: false, message: error.message };
  }
  return { success: true };
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
  // Resolve profile photo URLs — reuses DB-persisted signed URLs so the same URL
  // is returned across cold starts (stable SW cache key = no reload on refresh)
  const profileImages = await Promise.all(
    usersArr.map(u => getProfileSignedUrl(u.id, u.profile_image))
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
      email: u.email || '', phone: u.phone || '',
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
    employee_number,
    email: args.email ? String(args.email).trim() : null,
    phone: args.phone ? String(args.phone).trim() : null,
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
    role: args.role, status: args.status, updated_at: new Date().toISOString(),
    email: args.email !== undefined ? (String(args.email).trim() || null) : undefined,
    phone: args.phone !== undefined ? (String(args.phone).trim() || null) : undefined,
  };
  Object.keys(patch).forEach(k => patch[k] == null || patch[k] === '' ? delete patch[k] : null);
  if (args.password) patch.password_hash = await bcrypt.hash(String(args.password), 10);
  // Admin can update employee profile photo
  if (args.removeProfileImage) {
    patch.profile_image = '__removed__';
  } else if (args.profileImageBase64) {
    patch.profile_image = await uploadBase64('profile-photos', args.profileImageBase64, `profile_${args.username}`);
  }
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

  // A project site must always be selected for check-in — no fallback allowed.
  // For check-out, siteId is optional (use nearest site for recording purposes only).
  let near = null;
  const isCheckIn = action === 'CheckIn' || action === 'Project';

  if (isCheckIn && !args.siteId) {
    return { success: false, message: 'Please select a project site before checking in.' };
  }

  if (args.siteId) {
    const { data: chosenSite } = await sb.from('project_sites').select('*').eq('id', args.siteId).maybeSingle();
    if (!chosenSite) return { success: false, message: 'Selected project site not found.' };
    const dist = (lat != null && lng != null) ? haversine(lat, lng, Number(chosenSite.latitude), Number(chosenSite.longitude)) : null;
    const siteRadius = Math.max(Number(chosenSite.radius) || 200, 50);
    // Add GPS accuracy to the allowed radius — benefit of the doubt for coarse fixes
    const gpsAcc = (acc != null && acc > 0) ? acc : 0;
    const allowedRadius = siteRadius + gpsAcc;
    if (dist == null) {
      return { success: false, message: 'Your location could not be determined. Please enable GPS and try again.' };
    }
    if (dist > allowedRadius) {
      return {
        success: false,
        message: `You are ${Math.round(dist)}m away from "${chosenSite.name}" (radius: ${siteRadius}m). Move closer and try again.`,
        outsideRadius: true, distanceM: Math.round(dist), siteName: chosenSite.name
      };
    }
    near = { site: chosenSite, distance: dist };
  } else if (lat != null && lng != null) {
    // Check-out only: record nearest site for reporting, no radius enforcement
    near = await nearestSite(lat, lng);
  }

  const outsideRadius = false; // radius already enforced above for check-in
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
    return { success: true, time: now.toISOString(), action, message: 'Checked in', site: near && near.site.name || '', outsideRadius };
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
  return { success: true, time: now.toISOString(), action, totalHours: hours, message: 'Checked out', outsideRadius };
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
      checkIn:  a.check_in_time  || null,
      checkOut: a.check_out_time || null,
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
  const profileImage = await getProfileSignedUrl(u.id, u.profile_image);
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
    radius: args.radius, description: args.description || '',
    updated_at: new Date().toISOString()
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
    return { name: u.full_name, position: u.position || '', status: !a ? 'notchecked' : (a.check_out_time ? 'checkedout' : 'checkedin'), lastActivity: a ? (a.check_out_time || a.check_in_time) : null, location: 'Project' };
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
      checkIn:  latest && latest.check_in_time  || null,
      checkOut: latest && latest.check_out_time || null,
      checkInPhotoUrl, checkOutPhotoUrl,
      totalDays, present, absent: Math.max(0, totalDays === 0 ? 0 : totalDays - present)
    };
  }));
  return resolved;
}

// ── Daily Attendance Log (one row per employee per day, for the Attendance Overview page) ──
// Accepts either:
//   { month, year }             → full calendar month
//   { dateFrom, dateTo }        → arbitrary date range (YYYY-MM-DD)
//   { dateFrom } with no dateTo → single day
async function listDailyLog(args, ctx) {
  await requireRole(ctx, ['admin', 'manager']);
  const now = new Date();

  let start, end;
  if (args.dateFrom) {
    start = String(args.dateFrom).slice(0, 10);
    end   = args.dateTo ? String(args.dateTo).slice(0, 10) : start;
  } else {
    const y  = (args.year  != null && !isNaN(Number(args.year)))  ? Number(args.year)  : now.getFullYear();
    const mo = (args.month != null && !isNaN(Number(args.month))) ? Number(args.month) : now.getMonth();
    start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
    end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  }

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
    const checkIn  = a.check_in_time  || null;
    const checkOut = a.check_out_time || null;
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
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      hours: Number(hours),
      status,
      checkInPhotoUrl:  photoUrls[i][0],
      checkOutPhotoUrl: photoUrls[i][1]
    };
  });

  const totalUsers = (users || []).length;

  // Stats: summarise over the entire range
  const presentRows = rows.filter(r => r.status === 'Present' || r.status === 'Late');
  const lateRows    = rows.filter(r => r.status === 'Late');
  // Unique days with any attendance record
  const days = [...new Set(rows.map(r => r.date))].sort();
  const dayCount = days.length || 1;
  // Rate = avg daily attendance across all days in range
  const totalExpected = totalUsers * dayCount;
  const rate = totalExpected ? Math.round((presentRows.length / totalExpected) * 100) : 0;

  // Daily trend for chart (one entry per date)
  const trendMap = {};
  for (const r of rows) {
    if (!trendMap[r.date]) trendMap[r.date] = { date: r.date, present: 0, late: 0, absent: 0 };
    if (r.status === 'Present') trendMap[r.date].present++;
    if (r.status === 'Late')    { trendMap[r.date].present++; trendMap[r.date].late++; }
    if (r.status === 'Absent')  trendMap[r.date].absent++;
  }
  const dailyTrend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

  // Employee consistency analytics — streaks, rates, avg hours per employee
  const empMap = {};
  for (const r of rows) {
    if (!empMap[r.username]) empMap[r.username] = { name: r.name, department: r.department, days: [], presentDays: 0, lateDays: 0, totalHours: 0 };
    const e = empMap[r.username];
    e.days.push(r.date);
    if (r.status === 'Present' || r.status === 'Late') e.presentDays++;
    if (r.status === 'Late') e.lateDays++;
    e.totalHours += r.hours || 0;
  }
  const consistency = Object.entries(empMap).map(([username, e]) => {
    const rate = dayCount ? Math.round((e.presentDays / dayCount) * 100) : 0;
    return {
      username, name: e.name, department: e.department,
      presentDays: e.presentDays, lateDays: e.lateDays,
      absentDays: dayCount - e.presentDays,
      attendanceRate: rate,
      avgHours: e.presentDays ? +(e.totalHours / e.presentDays).toFixed(1) : 0
    };
  }).sort((a, b) => b.attendanceRate - a.attendanceRate);

  return {
    success: true,
    data: {
      rows,
      dateRange: { start, end, days: dayCount },
      stats: {
        present: presentRows.length,
        late: lateRows.length,
        absent: rows.filter(r => r.status === 'Absent').length,
        rate
      },
      dailyTrend,
      consistency
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
  // Resolve photo URLs in parallel — profile uses DB-persisted signed URL (stable cache key)
  const photoUrls = await Promise.all(filtered.map(a => {
    const u = userMap[a.user_id] || {};
    return Promise.all([
      getSignedUrl('attendance-photos', a.check_in_photo_url  || ''),
      getSignedUrl('attendance-photos', a.check_out_photo_url || ''),
      getProfileSignedUrl(u.id, u.profile_image || '')
    ]);
  }));
  return filtered.map((a, i) => {
    const u = userMap[a.user_id] || {};
    const last = a.check_out_time || a.check_in_time;
    const [checkInPhotoUrl, checkOutPhotoUrl, profileImage] = photoUrls[i];
    return {
      userId: a.user_id, username: a.username, fullName: u.full_name || a.username,
      department: deptMap[u.department_id] || '',
      position: u.position || '',
      checkInTime:  a.check_in_time  || null,
      checkOutTime: a.check_out_time || null,
      lastSeen: last || null,
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

  // ── 1. daily trend (last 30 days) — only dates with actual data ──
  const trendCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const byDate = {};
  for (const a of att || []) {
    const d = dateOnly(a.work_date);
    if (d < trendCutoff) continue;
    if (!byDate[d]) byDate[d] = { date: d, present: 0, late: 0 };
    if (a.check_in_time) byDate[d].present++;
    if (a.status === 'late') byDate[d].late++;
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
  const profileImage = await getProfileSignedUrl(actor.id, storedPath);
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
      checkIn:  a.check_in_time  || null,
      checkOut: a.check_out_time || null,
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
  listProjectSites: async (a, ctx) => {
    await requireUser(ctx);
    const [sites, activeEmpRes, { data: allEmps }] = await Promise.all([
      listProjectSites(),
      sb.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'admin'),
      sb.from('app_users').select('id, full_name, signed_url, signed_url_expires_at, profile_image').eq('status', 'active').neq('role', 'admin').order('full_name')
    ]);
    // Build employee picker list with stable photo URLs
    const now = Date.now();
    const pickerEmployees = (allEmps || []).map(u => {
      const expires = u.signed_url_expires_at ? new Date(u.signed_url_expires_at).getTime() : 0;
      const photoUrl = (u.signed_url && expires > now + 3600 * 1000) ? u.signed_url : '';
      return { id: u.id, name: u.full_name || '', photoUrl };
    });
    return { success: true, data: sites, totalActiveEmployees: activeEmpRes.count || 0, employees: pickerEmployees };
  },
  addProjectSite,
  updateProjectSite,
  deleteProjectSite,
  assignSiteEmployees,
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
  getSignedUrls,
  getNotifications,
  markNotificationsRead: async (a, ctx) => { await requireUser(ctx); return { success: true }; },
  // Messages
  sendMessage,
  getMessages,
  replyMessage,
  markMessageRead,
  deleteMessage,
  getEmployeesForMsg,
  // Tickets
  createTicket,
  getTickets,
  replyTicket,
  updateTicketStatus,
  deleteTicket,
  clearClosedTickets,
  // Lightweight badge counts — all 4 badges in one fast request on login
  getHeaderCounts: async (a, ctx) => {
    const actor = await requireUser(ctx);
    const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';

    const todayStr = today();
    const [notifRes, msgThreadsRes, ticketRes, leaveRes, checkinRes] = await Promise.all([
      // Notification count — reuse getNotifications (already optimised, returns array)
      getNotifications(a, ctx).catch(() => ({ data: [] })),
      // Fetch thread metadata for unread thread count (same logic as getMessages)
      isAdminOrMgr
        ? sb.from('messages').select('id, from_user_id, to_user_id, created_at').order('created_at', { ascending: false }).limit(100)
        : sb.from('messages').select('id, from_user_id, to_user_id, created_at').or(`from_user_id.eq.${actor.id},to_user_id.eq.${actor.id}`).order('created_at', { ascending: false }).limit(50),
      // Open tickets count: admin/manager sees all open; employee — computed separately below
      isAdminOrMgr
        ? sb.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open')
        : Promise.resolve({ count: 0 }),
      // Pending leaves count (admin/manager only)
      isAdminOrMgr
        ? (actor.role === 'manager'
            ? sb.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('department_id', actor.department_id)
            : sb.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
        : Promise.resolve({ count: 0 }),
      // Active sites today (admin/manager only — for live map badge)
      // A site is active if it has at least one employee currently checked in (check_out IS NULL)
      isAdminOrMgr
        ? sb.from('attendance').select('site_id').eq('date', todayStr).not('check_in', 'is', null).is('check_out', null).not('site_id', 'is', null)
        : Promise.resolve({ data: [] })
    ]);

    // Compute unread thread count — exact same logic as getMessages/unreadCount
    // Fetch read state, replies, and existing user IDs (to match otherPartyDeleted filter)
    const _threads   = msgThreadsRes.data || [];
    const _threadIds = _threads.map(m => m.id);
    let msgUnreadCount = 0;
    if (_threadIds.length) {
      // Collect all other-party user IDs from these threads
      const _otherUserIds = [...new Set(_threads.map(m =>
        m.from_user_id === actor.id ? m.to_user_id : m.from_user_id
      ).filter(Boolean))];

      const [msgReadsRes, msgRepliesRes, existingUsersRes] = await Promise.all([
        sb.from('message_reads').select('message_id, last_read_at').eq('user_id', actor.id).in('message_id', _threadIds),
        sb.from('message_replies').select('message_id, from_user_id, created_at').in('message_id', _threadIds).order('created_at', { ascending: false }),
        _otherUserIds.length ? sb.from('app_users').select('id').in('id', _otherUserIds) : Promise.resolve({ data: [] })
      ]);
      const _readMap = {};
      (msgReadsRes.data || []).forEach(r => { _readMap[r.message_id] = r.last_read_at; });
      const _latestOtherReply = {};
      (msgRepliesRes.data || []).forEach(r => {
        if (r.from_user_id !== actor.id && !_latestOtherReply[r.message_id])
          _latestOtherReply[r.message_id] = r.created_at; // ordered desc so first = latest
      });
      const _existingUserIds = new Set((existingUsersRes.data || []).map(u => u.id));
      msgUnreadCount = _threads.filter(m => {
        // Skip threads where the other party's account was deleted (matches getMessages filter)
        const otherUserId = m.from_user_id === actor.id ? m.to_user_id : m.from_user_id;
        if (otherUserId && !_existingUserIds.has(otherUserId)) return false;
        const lastOtherAt = _latestOtherReply[m.id]
          || (m.from_user_id !== actor.id ? m.created_at : null);
        if (!lastOtherAt) return false;
        const myLastRead = _readMap[m.id] || null;
        return !myLastRead || new Date(lastOtherAt) > new Date(myLastRead);
      }).length;
    }

    // Employee ticket badge: count unread admin replies on their own tickets
    let empTicketCount = 0;
    if (!isAdminOrMgr) {
      const { data: myTicketIds } = await sb.from('support_tickets')
        .select('id').eq('from_user_id', actor.id);
      if (myTicketIds && myTicketIds.length) {
        const ids = myTicketIds.map(t => t.id);
        const { count } = await sb.from('ticket_replies')
          .select('id', { count: 'exact', head: true })
          .in('ticket_id', ids)
          .neq('from_username', actor.username)
          .neq('from_username', '__system__')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        empTicketCount = count || 0;
      }
    }

    const activeSiteIds = new Set((checkinRes.data || []).map(r => r.site_id).filter(Boolean));

    return {
      success: true,
      data: {
        notificationIds: (notifRes && notifRes.data ? notifRes.data.map(n => n.id) : []),
        messages:      msgUnreadCount,
        tickets:       isAdminOrMgr ? (ticketRes.count || 0) : empTicketCount,
        pendingLeaves: leaveRes.count  || 0,
        activeSites:   activeSiteIds.size
      }
    };
  },
};

// ── Notifications ──────────────────────────────────────────────────────────────
async function getNotifications(args, ctx) {
  const actor = await requireUser(ctx);
  const todayStr = today();
  const notifs = [];

  // ── ADMIN / MANAGER ────────────────────────────────────────────────────────
  if (actor.role === 'admin' || actor.role === 'manager') {

    // 1. Pending leave requests (need approval action)
    let leavesQ = sb.from('leave_requests')
      .select('id, type, from_date, to_date, days, applied_at, username, user_id')
      .eq('status', 'pending')
      .order('applied_at', { ascending: false })
      .limit(20);
    if (actor.role === 'manager') leavesQ = leavesQ.eq('department_id', actor.department_id);
    const { data: leaves } = await leavesQ;

    // Resolve full names + profile photos for all leave requesters in one query
    const leaveUserIds = [...new Set((leaves || []).map(l => l.user_id).filter(Boolean))];
    const { data: leaveUsers } = leaveUserIds.length
      ? await sb.from('app_users').select('id, full_name, profile_image').in('id', leaveUserIds)
      : { data: [] };
    const leaveNameMap  = Object.fromEntries((leaveUsers || []).map(u => [u.id, u.full_name]));
    const leavePhotoMap = {};
    await Promise.all((leaveUsers || []).map(async u => {
      leavePhotoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => '');
    }));

    for (const l of leaves || []) {
      const fullName = leaveNameMap[l.user_id] || l.username;
      notifs.push({
        id: 'leave_' + l.id,
        type: 'leave',
        icon: 'fa-calendar-check',
        color: 'blue',
        title: 'Leave request pending approval',
        sub: `${fullName} · ${cap(l.type)} · ${l.days} day${l.days !== 1 ? 's' : ''} · ${l.from_date} – ${l.to_date}`,
        time: l.applied_at,
        photoUrl: leavePhotoMap[l.user_id] || '',
        priority: 1
      });
    }

    // Scope helper for manager vs admin attendance queries
    const deptFilter = q => actor.role === 'manager'
      ? q.in('username', sb.from('app_users').select('username').eq('department_id', actor.department_id))
      : q;

    // 2. Today's check-ins (present + late) — show all for admin, dept-only for manager
    let ciQ = sb.from('attendance')
      .select('username, user_id, check_in_time, status')
      .eq('work_date', todayStr)
      .not('check_in_time', 'is', null)
      .order('check_in_time', { ascending: false })
      .limit(actor.role === 'manager' ? 20 : 30);
    if (actor.role === 'manager') ciQ = ciQ.eq('department_id', actor.department_id);
    const { data: checkins } = await ciQ;

    // 3. Today's check-outs
    let coQ = sb.from('attendance')
      .select('username, user_id, check_out_time, total_hours')
      .eq('work_date', todayStr)
      .not('check_out_time', 'is', null)
      .order('check_out_time', { ascending: false })
      .limit(actor.role === 'manager' ? 20 : 30);
    if (actor.role === 'manager') coQ = coQ.eq('department_id', actor.department_id);
    const { data: checkouts } = await coQ;

    // Resolve full names + profile photos for all attendance rows in one query
    const attUserIds = [...new Set([
      ...(checkins  || []).map(a => a.user_id),
      ...(checkouts || []).map(a => a.user_id)
    ].filter(Boolean))];
    const { data: attUsers } = attUserIds.length
      ? await sb.from('app_users').select('id, full_name, profile_image').in('id', attUserIds)
      : { data: [] };
    const attNameMap  = Object.fromEntries((attUsers || []).map(u => [u.id, u.full_name]));
    const attPhotoMap = {};
    await Promise.all((attUsers || []).map(async u => {
      attPhotoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => '');
    }));

    for (const a of checkins || []) {
      const isLate  = a.status === 'late';
      const name    = attNameMap[a.user_id] || a.username;
      notifs.push({
        id: (isLate ? 'late_' : 'checkin_') + a.username + '_' + todayStr,
        type: isLate ? 'late' : 'checkin',
        icon: isLate ? 'fa-clock' : 'fa-sign-in-alt',
        color: isLate ? 'gold' : 'green',
        title: isLate ? `${name} checked in late` : `${name} checked in`,
        sub: 'Today',
        rawTime: a.check_in_time || null,
        time: a.check_in_time || todayStr,
        photoUrl: attPhotoMap[a.user_id] || '',
        priority: isLate ? 2 : 4
      });
    }

    for (const a of checkouts || []) {
      const hrs  = a.total_hours != null ? `${a.total_hours}h worked` : '';
      const name = attNameMap[a.user_id] || a.username;
      notifs.push({
        id: 'checkout_' + a.username + '_' + todayStr,
        type: 'checkout',
        icon: 'fa-sign-out-alt',
        color: 'navy',
        title: `${name} checked out`,
        sub: hrs || 'Today',
        rawTime: a.check_out_time || null,
        time: a.check_out_time || todayStr,
        photoUrl: attPhotoMap[a.user_id] || '',
        priority: 5
      });
    }

    // 4. Absent employees (active, non-admin, no attendance today, not on approved leave)
    const [{ data: allUsers }, { data: todayAtt }, { data: onLeave }] = await Promise.all([
      (() => {
        let q = sb.from('app_users').select('username, full_name').eq('status', 'active').neq('role', 'admin');
        if (actor.role === 'manager') q = q.eq('department_id', actor.department_id);
        return q;
      })(),
      sb.from('attendance').select('username').eq('work_date', todayStr),
      sb.from('leave_requests').select('username').eq('status', 'approved')
        .lte('from_date', todayStr).gte('to_date', todayStr)
    ]);
    const checkedInSet = new Set((todayAtt || []).map(a => a.username));
    const onLeaveSet   = new Set((onLeave  || []).map(l => l.username));
    const absent = (allUsers || []).filter(u => !checkedInSet.has(u.username) && !onLeaveSet.has(u.username));
    if (absent.length > 0) {
      const names = absent.map(u => u.full_name || u.username);
      const sub = absent.length <= 3
        ? names.join(', ')
        : names.slice(0, 2).join(', ') + ` and ${absent.length - 2} more`;
      notifs.push({
        id: 'absent_' + todayStr,
        type: 'absent',
        icon: 'fa-user-times',
        color: 'red',
        title: `${absent.length} employee${absent.length !== 1 ? 's' : ''} not checked in today`,
        sub,
        time: todayStr + 'T00:00:00Z',
        priority: 3
      });
    }

  // ── EMPLOYEE ───────────────────────────────────────────────────────────────
  } else {

    // 1. Today's own check-in confirmation
    const { data: todayRec } = await sb.from('attendance')
      .select('check_in_time, check_out_time, total_hours, status')
      .eq('username', actor.username)
      .eq('work_date', todayStr)
      .maybeSingle();

    if (todayRec && todayRec.check_in_time) {
      const isLate = todayRec.status === 'late';
      notifs.push({
        id: 'my_checkin_' + todayStr,
        type: 'my_checkin',
        icon: isLate ? 'fa-clock' : 'fa-sign-in-alt',
        color: isLate ? 'gold' : 'green',
        title: isLate ? 'You checked in late today' : 'You checked in today',
        sub: isLate ? 'You were past the check-in threshold' : 'Check-in recorded',
        rawTime: todayRec.check_in_time,
        time: todayRec.check_in_time,
        priority: 2
      });
    }

    // 2. Today's own check-out confirmation
    if (todayRec && todayRec.check_out_time) {
      const hrs = todayRec.total_hours != null ? `${todayRec.total_hours}h logged` : '';
      notifs.push({
        id: 'my_checkout_' + todayStr,
        type: 'my_checkout',
        icon: 'fa-sign-out-alt',
        color: 'navy',
        title: 'You checked out today',
        sub: hrs || 'Check-out recorded',
        rawTime: todayRec.check_out_time,
        time: todayRec.check_out_time,
        priority: 3
      });
    }

    // 3. Not checked in yet today (reminder — only if workday and past 9am)
    const nowHour = new Date().getHours();
    if (!todayRec && nowHour >= 9) {
      notifs.push({
        id: 'reminder_checkin_' + todayStr,
        type: 'reminder',
        icon: 'fa-bell',
        color: 'gold',
        title: "You haven't checked in today",
        sub: 'Remember to check in to log your attendance',
        time: todayStr + 'T09:00:00Z',
        priority: 1
      });
    }

    // 4. Approved & rejected leave decisions (most important status updates)
    const { data: decidedLeaves } = await sb.from('leave_requests')
      .select('id, type, status, from_date, to_date, days, applied_at')
      .eq('user_id', actor.id)
      .in('status', ['approved', 'rejected'])
      .order('applied_at', { ascending: false })
      .limit(10);

    for (const l of decidedLeaves || []) {
      const isApproved = l.status === 'approved';
      notifs.push({
        id: 'myleave_' + l.id,
        type: 'myleave',
        icon: isApproved ? 'fa-check-circle' : 'fa-times-circle',
        color: isApproved ? 'green' : 'red',
        title: `Leave ${isApproved ? 'approved ✓' : 'rejected'}`,
        sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`,
        time: l.applied_at,
        priority: isApproved ? 4 : 1
      });
    }

    // 5. Pending leave submissions (awaiting decision)
    const { data: pendingLeaves } = await sb.from('leave_requests')
      .select('id, type, from_date, to_date, days, applied_at')
      .eq('user_id', actor.id)
      .eq('status', 'pending')
      .order('applied_at', { ascending: false })
      .limit(5);

    for (const l of pendingLeaves || []) {
      notifs.push({
        id: 'mypending_' + l.id,
        type: 'pending',
        icon: 'fa-hourglass-half',
        color: 'gold',
        title: 'Leave request awaiting approval',
        sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`,
        time: l.applied_at,
        priority: 3
      });
    }

    // 6. Upcoming approved leave (within next 7 days — heads-up reminder)
    const in7 = new Date(); in7.setDate(in7.getDate() + 7);
    const in7Str = in7.toISOString().slice(0, 10);
    const { data: upcomingLeave } = await sb.from('leave_requests')
      .select('id, type, from_date, to_date, days')
      .eq('user_id', actor.id)
      .eq('status', 'approved')
      .gte('from_date', todayStr)
      .lte('from_date', in7Str)
      .order('from_date', { ascending: true })
      .limit(3);

    for (const l of upcomingLeave || []) {
      const daysUntil = Math.ceil((new Date(l.from_date) - new Date(todayStr)) / 86400000);
      notifs.push({
        id: 'upcoming_leave_' + l.id,
        type: 'upcoming',
        icon: 'fa-calendar-alt',
        color: 'blue',
        title: daysUntil === 0 ? 'Your leave starts today' : `Leave starts in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        sub: `${cap(l.type)} · ${l.from_date} – ${l.to_date} · ${l.days} day${l.days !== 1 ? 's' : ''}`,
        time: l.from_date + 'T00:00:00Z',
        priority: 2
      });
    }

    // 7. Unread message replies from admin (last 7 days)
    const { data: myMsgs } = await sb.from('messages')
      .select('id, subject')
      .or(`from_user_id.eq.${actor.id},to_user_id.eq.${actor.id}`)
      .eq('read_by_recipient', false)
      .order('created_at', { ascending: false })
      .limit(10);
    if ((myMsgs || []).length) {
      const msgIds = myMsgs.map(m => m.id);
      const { data: msgReplies } = await sb.from('message_replies')
        .select('id, message_id, from_name, created_at')
        .in('message_id', msgIds)
        .neq('from_username', actor.username)
        .order('created_at', { ascending: false })
        .limit(5);
      for (const r of msgReplies || []) {
        const subj = (myMsgs.find(m => m.id === r.message_id) || {}).subject || 'your message';
        notifs.push({
          id: 'msgreply_' + r.id,
          type: 'msgreply',
          icon: 'fa-envelope',
          color: 'blue',
          title: `${r.from_name || 'Admin'} replied to your message`,
          sub: subj,
          rawTime: r.created_at,
          time: r.created_at,
          priority: 1
        });
      }
    }

    // 8. Admin replies to employee's tickets (last 7 days)
    const { data: myTickets } = await sb.from('support_tickets')
      .select('id, ticket_number, subject')
      .eq('from_user_id', actor.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if ((myTickets || []).length) {
      const ticketIds = myTickets.map(t => t.id);
      const { data: ticketReplies } = await sb.from('ticket_replies')
        .select('id, ticket_id, from_name, body, created_at')
        .in('ticket_id', ticketIds)
        .neq('from_username', actor.username)
        .neq('from_username', '__system__')
        .order('created_at', { ascending: false })
        .limit(5);
      for (const r of ticketReplies || []) {
        const tkt = myTickets.find(t => t.id === r.ticket_id) || {};
        const preview = r.body ? (r.body.length > 80 ? r.body.slice(0, 80) + '…' : r.body) : '';
        notifs.push({
          id: 'ticketreply_' + r.id,
          type: 'ticketreply',
          icon: 'fa-ticket-alt',
          color: 'navy',
          title: `${r.from_name || 'Admin'} replied to your ticket`,
          sub: `#${tkt.ticket_number || ''} ${tkt.subject ? '· ' + tkt.subject : ''}`,
          body: preview,
          rawTime: r.created_at,
          time: r.created_at,
          priority: 1
        });
      }
    }

    // 9. Ticket closed / resolved notifications for employees
    const { data: closedTickets } = await sb.from('support_tickets')
      .select('id, ticket_number, subject, status, updated_at')
      .eq('from_user_id', actor.id)
      .in('status', ['closed', 'resolved'])
      .order('updated_at', { ascending: false })
      .limit(10);
    for (const t of closedTickets || []) {
      const icon  = t.status === 'closed' ? 'fa-lock' : 'fa-check-circle';
      const label = t.status === 'closed' ? 'closed' : 'resolved';
      notifs.push({
        id:       `ticket_${t.status}_${t.id}`,
        type:     'ticketstatus',
        icon,
        color:    t.status === 'closed' ? 'navy' : 'green',
        title:    `Your ticket has been ${label}`,
        sub:      `#${t.ticket_number || ''} ${t.subject ? '· ' + t.subject : ''}`,
        body:     t.status === 'closed'
                    ? 'This ticket has been closed. No further replies are possible.'
                    : 'This ticket has been marked as resolved. Open a new ticket if the issue persists.',
        rawTime:  t.updated_at,
        time:     t.updated_at,
        priority: 1
      });
    }
  }

  // Sort: priority ascending (1 = most urgent), then newest first within same priority
  notifs.sort((a, b) => a.priority - b.priority || new Date(b.time) - new Date(a.time));
  return { success: true, data: notifs };
}

// ── Messages ────────────────────────────────────────────────────────────────
// Table schema (use this for Supabase):
//   messages(id uuid pk default gen_random_uuid(),
//            from_user_id text, from_username text, from_name text,
//            to_user_id text, to_username text, to_name text,
//            subject text, body text,
//            read_by_recipient boolean default false,
//            created_at timestamptz default now())
//   message_replies(id uuid pk default gen_random_uuid(),
//                   message_id uuid references messages(id) on delete cascade,
//                   from_user_id text, from_username text, from_name text,
//                   body text, created_at timestamptz default now())

// ── Message read tracking ────────────────────────────────────────────────────
// message_reads(message_id, user_id, last_read_at) — one row per user per thread.
// Table must exist in Supabase — see supabase/schema.sql for the CREATE TABLE.
// isUnread is computed per-actor by comparing last_read_at against the latest
// reply/message timestamp, so both admin and employee track reads independently.

async function sendMessage(args, ctx) {
  const actor = await requireUser(ctx);
  const subject    = (args.subject    || '').trim();
  const body       = (args.body       || '').trim();
  const toUsername = (args.toUsername || '').trim();
  if (!subject) return { success: false, message: 'Subject is required.' };
  if (!body)    return { success: false, message: 'Message body is required.' };

  let toUserId = '', toName = '', resolvedToUsername = '';
  const isAdminSending = actor.role === 'admin' || actor.role === 'manager';

  if (isAdminSending) {
    if (!toUsername) return { success: false, message: 'Recipient is required.' };
    const { data: target } = await sb.from('app_users').select('id, full_name, username').eq('username', toUsername).maybeSingle();
    if (!target) return { success: false, message: 'Employee not found.' };
    toUserId = target.id; toName = target.full_name || target.username; resolvedToUsername = target.username;
  } else {
    const { data: admin } = await sb.from('app_users').select('id, full_name, username').eq('role', 'admin').limit(1).maybeSingle();
    toUserId = admin ? admin.id : ''; toName = admin ? (admin.full_name || admin.username) : 'Admin'; resolvedToUsername = admin ? admin.username : 'admin';
  }

  const { data, error } = await sb.from('messages').insert({
    from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name || actor.username,
    to_user_id: toUserId, to_username: resolvedToUsername, to_name: toName,
    subject, body, read_by_recipient: false
  }).select('id').single();
  if (error) return { success: false, message: error.message };

  // Sender has already "read" this thread (they just wrote it)
  try { await sb.from('message_reads').upsert(
    { message_id: data.id, user_id: actor.id, last_read_at: new Date().toISOString() },
    { onConflict: 'message_id,user_id' }
  ); } catch (_) {}

  return { success: true, id: data.id };
}

async function getMessages(args, ctx) {
  const actor = await requireUser(ctx);
  const isAdminView = actor.role === 'admin' || actor.role === 'manager';

  let query = sb.from('messages')
    .select('id, from_user_id, from_username, from_name, to_user_id, to_username, to_name, subject, body, read_by_recipient, created_at')
    .order('created_at', { ascending: false })
    .limit(isAdminView ? 100 : 50);

  if (!isAdminView) {
    query = query.or(`from_user_id.eq.${actor.id},to_user_id.eq.${actor.id}`);
  }

  const { data: msgs, error } = await query;
  if (error) return { success: false, message: error.message };

  const ids = (msgs || []).map(m => m.id);

  // Fetch replies + per-user read state in parallel
  const [repliesResult, readsResult] = await Promise.all([
    ids.length
      ? sb.from('message_replies')
          .select('id, message_id, from_user_id, from_username, from_name, body, created_at')
          .in('message_id', ids).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    ids.length
      ? sb.from('message_reads')
          .select('message_id, last_read_at')
          .eq('user_id', actor.id)
          .in('message_id', ids)
      : Promise.resolve({ data: [] })
  ]);

  const replies = repliesResult.data || [];
  // Build map: message_id → last_read_at for this actor
  const readMap = {};
  (readsResult.data || []).forEach(r => { readMap[r.message_id] = r.last_read_at; });

  // Batch-fetch profile photos
  const allUserIds = [...new Set([
    ...(msgs || []).flatMap(m => [m.from_user_id, m.to_user_id]),
    ...replies.map(r => r.from_user_id)
  ].filter(Boolean))];
  const { data: photoUsers } = allUserIds.length
    ? await sb.from('app_users').select('id, profile_image').in('id', allUserIds)
    : { data: [] };
  const existingUserIds = new Set((photoUsers || []).map(u => u.id));
  const photoMap = {};
  await Promise.all((photoUsers || []).map(async u => {
    photoMap[u.id] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => '');
  }));

  const replyMap = {};
  for (const r of replies) {
    if (!replyMap[r.message_id]) replyMap[r.message_id] = [];
    replyMap[r.message_id].push({
      id: r.id, messageId: r.message_id,
      fromUserId: r.from_user_id, fromUsername: r.from_username, fromName: r.from_name,
      fromPhoto: photoMap[r.from_user_id] || '',
      body: r.body, createdAt: r.created_at
    });
  }

  const mapped = (msgs || []).map(m => {
    const threadReplies = replyMap[m.id] || [];
    const otherUserId = m.from_user_id === actor.id ? m.to_user_id : m.from_user_id;
    const otherPartyDeleted = otherUserId ? !existingUserIds.has(otherUserId) : false;

    // Latest activity in thread (most recent reply, or original message)
    const latestAt = threadReplies.length
      ? threadReplies[threadReplies.length - 1].createdAt
      : m.created_at;
    // Latest message NOT from this actor
    const lastFromOther = [...threadReplies].reverse().find(r => r.fromUserId !== actor.id)
      || (m.from_user_id !== actor.id ? { createdAt: m.created_at } : null);

    // isUnread: there is activity from the other side that is newer than our last read
    const myLastRead = readMap[m.id] || null;
    let isUnread = false;
    if (lastFromOther) {
      isUnread = !myLastRead || new Date(lastFromOther.createdAt) > new Date(myLastRead);
    }

    // unreadReplyCount: replies from other side since our last read
    const unreadReplyCount = threadReplies.filter(r =>
      r.fromUserId !== actor.id && (!myLastRead || new Date(r.createdAt) > new Date(myLastRead))
    ).length;

    return {
      id: m.id,
      fromUserId: m.from_user_id, fromUsername: m.from_username, fromName: m.from_name,
      fromPhoto: photoMap[m.from_user_id] || '',
      toUserId: m.to_user_id, toUsername: m.to_username, toName: m.to_name,
      toPhoto: photoMap[m.to_user_id] || '',
      subject: m.subject, body: m.body,
      otherPartyDeleted, isUnread, unreadReplyCount,
      latestAt, createdAt: m.created_at,
      replies: threadReplies
    };
  });

  const unreadCount = mapped.filter(m => !m.otherPartyDeleted && (m.isUnread || m.unreadReplyCount > 0)).length;
  return { success: true, data: mapped, unreadCount };
}

async function replyMessage(args, ctx) {
  const actor = await requireUser(ctx);
  const { messageId, body } = args;
  if (!body || !body.trim()) return { success: false, message: 'Reply cannot be empty.' };
  const { data: msg } = await sb.from('messages').select('from_user_id, to_user_id').eq('id', messageId).maybeSingle();
  if (!msg) return { success: false, message: 'Message not found.' };
  const isAdminView = actor.role === 'admin' || actor.role === 'manager';
  const inConversation = isAdminView || msg.from_user_id === actor.id || msg.to_user_id === actor.id;
  if (!inConversation) return { success: false, message: 'Forbidden.' };
  if (isAdminView) {
    const otherUserId = msg.from_user_id === actor.id ? msg.to_user_id : msg.from_user_id;
    if (otherUserId) {
      const { data: otherUser } = await sb.from('app_users').select('id').eq('id', otherUserId).maybeSingle();
      if (!otherUser) return { success: false, message: 'This employee no longer exists. Please delete this conversation.' };
    }
  }
  const { error } = await sb.from('message_replies').insert({
    message_id: messageId, from_user_id: actor.id,
    from_username: actor.username, from_name: actor.full_name || actor.username,
    body: body.trim()
  });
  if (error) return { success: false, message: error.message };

  // Mark this thread as read for the sender right now (they just replied)
  try { await sb.from('message_reads').upsert(
    { message_id: messageId, user_id: actor.id, last_read_at: new Date().toISOString() },
    { onConflict: 'message_id,user_id' }
  ); } catch (_) {}

  return { success: true };
}

async function markMessageRead(args, ctx) {
  const actor = await requireUser(ctx);
  const now = new Date().toISOString();
  // Upsert per-user read record — works for both admin and employee independently
  try { await sb.from('message_reads').upsert(
    { message_id: args.messageId, user_id: actor.id, last_read_at: now },
    { onConflict: 'message_id,user_id' }
  ); } catch (_) {}
  // Keep legacy read_by_recipient for backwards compat
  try { await sb.from('messages').update({ read_by_recipient: true }).eq('id', args.messageId); } catch (_) {}
  return { success: true };
}

async function deleteMessage(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.role !== 'admin' && actor.role !== 'manager') return { success: false, message: 'Forbidden.' };
  const { messageId } = args;
  if (!messageId) return { success: false, message: 'messageId is required.' };
  try { await sb.from('message_reads').delete().eq('message_id', messageId); } catch (_) {}
  await sb.from('message_replies').delete().eq('message_id', messageId);
  const { error } = await sb.from('messages').delete().eq('id', messageId);
  if (error) return { success: false, message: error.message };
  return { success: true };
}

async function getEmployeesForMsg(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.role !== 'admin' && actor.role !== 'manager') return { success: false, message: 'Forbidden.' };
  const { data } = await sb.from('app_users')
    .select('id, username, full_name, role')
    .eq('status', 'active')
    .neq('id', actor.id)
    .order('full_name');
  return { success: true, data: (data || []).map(u => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role })) };
}

// ── Support Tickets ──────────────────────────────────────────────────────────
// Table: support_tickets (id, from_user_id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at)
// Table: ticket_replies (id, ticket_id, from_user_id, from_username, from_name, body, created_at)

async function createTicket(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.role === 'admin' || actor.role === 'manager') return { success: false, message: 'Admins and managers cannot create support tickets.' };
  const subject  = (args.subject  || '').trim();
  const body     = (args.body     || '').trim();
  const category = (args.category || 'general').trim();
  if (!subject) return { success: false, message: 'Subject is required.' };
  if (!body)    return { success: false, message: 'Description is required.' };
  // Generate a collision-safe ticket number by finding the current MAX and incrementing.
  // Fall back to a timestamp+random suffix if the insert still conflicts (race condition).
  async function _genTicketNumber() {
    const { data: maxRow } = await sb.from('support_tickets')
      .select('ticket_number')
      .order('ticket_number', { ascending: false })
      .limit(1)
      .single();
    let next = 1;
    if (maxRow && maxRow.ticket_number) {
      const m = String(maxRow.ticket_number).match(/(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    return 'TKT-' + String(next).padStart(4, '0');
  }

  let ticketNumber = await _genTicketNumber();
  let data, error;
  // Retry up to 3 times with a random suffix on unique-constraint collision
  for (let attempt = 0; attempt < 3; attempt++) {
    ({ data, error } = await sb.from('support_tickets').insert({
      from_user_id:  actor.id,
      from_username: actor.username,
      from_name:     actor.full_name || actor.username,
      ticket_number: ticketNumber,
      category, subject, body,
      status: 'open'
    }).select('id, ticket_number').single());
    if (!error) break;
    if (!error.message.includes('unique') && !error.message.includes('duplicate')) break;
    // Collision — append random suffix and retry
    ticketNumber = 'TKT-' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100);
  }
  if (error) return { success: false, message: error.message };
  return { success: true, id: data.id, ticketNumber: data.ticket_number };
}

async function getTickets(args, ctx) {
  const actor = await requireUser(ctx);
  let query;
  if (actor.role === 'admin' || actor.role === 'manager') {
    query = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee')
      .eq('cleared_by_admin', false)
      .order('created_at', { ascending: false })
      .limit(50);
  } else {
    query = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee')
      .eq('from_user_id', actor.id)
      .eq('cleared_by_employee', false)
      .order('created_at', { ascending: false })
      .limit(20);
  }
  let { data: tickets, error } = await query;
  if (error && (error.message.includes('cleared_by_admin') || error.message.includes('cleared_by_employee'))) {
    // Columns not yet created — fall back to unfiltered query (legacy behaviour)
    const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';
    const fallback = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(isAdminOrMgr ? 50 : 20);
    if (!isAdminOrMgr) fallback.eq('from_user_id', actor.id);
    ({ data: tickets, error } = await fallback);
  }
  if (error) return { success: false, message: error.message };

  const ids = (tickets || []).map(t => t.id);
  const { data: replies } = ids.length
    ? await sb.from('ticket_replies')
        .select('id, ticket_id, from_username, from_name, body, created_at')
        .in('ticket_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] };

  // Batch-fetch profile photos by username for tickets + replies
  const ticketUsernames = [...new Set([
    ...(tickets || []).map(t => t.from_username),
    ...(replies  || []).map(r => r.from_username)
  ].filter(Boolean))];
  const ticketPhotoMap = {};
  if (ticketUsernames.length) {
    const { data: photoUsers2 } = await sb.from('app_users')
      .select('id, username, profile_image').in('username', ticketUsernames);
    await Promise.all((photoUsers2 || []).map(async u => {
      ticketPhotoMap[u.username] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => '');
    }));
  }

  const replyMap = {};
  for (const r of replies || []) {
    if (!replyMap[r.ticket_id]) replyMap[r.ticket_id] = [];
    replyMap[r.ticket_id].push({
      id: r.id,
      ticketId: r.ticket_id,
      fromUsername: r.from_username,
      fromName: r.from_name,
      fromPhoto: ticketPhotoMap[r.from_username] || '',
      body: r.body,
      createdAt: r.created_at
    });
  }

  const openCount = (tickets || []).filter(t => t.status === 'open').length;

  return {
    success: true,
    data: (tickets || []).map(t => ({
      id: t.id, fromUsername: t.from_username, fromName: t.from_name,
      fromPhoto: ticketPhotoMap[t.from_username] || '',
      ticketNumber: t.ticket_number, category: t.category,
      subject: t.subject, body: t.body, status: t.status,
      createdAt: t.created_at, updatedAt: t.updated_at,
      replies: replyMap[t.id] || []
    })),
    openCount
  };
}

async function replyTicket(args, ctx) {
  const actor = await requireUser(ctx);
  const { ticketId, body } = args;
  if (!body || !body.trim()) return { success: false, message: 'Reply cannot be empty.' };
  // Fetch ticket to check status and ownership
  const { data: ticket } = await sb.from('support_tickets').select('status, from_user_id').eq('id', ticketId).maybeSingle();
  if (!ticket) return { success: false, message: 'Ticket not found.' };
  const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';
  // No one can reply to a closed or resolved ticket
  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    return { success: false, message: 'This ticket is closed and can no longer be replied to.' };
  }
  const { error } = await sb.from('ticket_replies').insert({
    ticket_id:     ticketId,
    from_user_id:  actor.id,
    from_username: actor.username,
    from_name:     actor.full_name || actor.username,
    body: body.trim()
  });
  if (error) return { success: false, message: error.message };
  // Move ticket to in_progress when admin replies
  if (actor.role === 'admin' || actor.role === 'manager') {
    await sb.from('support_tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticketId);
  }
  return { success: true };
}

async function clearClosedTickets(args, ctx) {
  const actor = await requireUser(ctx);
  const isAdminOrMgr = actor.role === 'admin' || actor.role === 'manager';
  // Find matching tickets to clear
  let query = sb.from('support_tickets')
    .select('id')
    .in('status', ['closed', 'resolved', 'deleted']);
  if (!isAdminOrMgr) query = query.eq('from_user_id', actor.id);
  const { data: toHide, error: fetchErr } = await query;
  if (fetchErr) return { success: false, message: fetchErr.message };
  if (!toHide || !toHide.length) return { success: true, count: 0 };
  const ids = toHide.map(t => t.id);
  // Soft-hide: set the caller's cleared flag instead of physically deleting.
  // This keeps the ticket visible to the other party.
  const flag = isAdminOrMgr ? { cleared_by_admin: true } : { cleared_by_employee: true };
  const { error } = await sb.from('support_tickets').update(flag).in('id', ids);
  if (error) {
    // Columns don't exist yet — fall back to hard delete (legacy behaviour)
    await sb.from('ticket_replies').delete().in('ticket_id', ids);
    const { error: delErr } = await sb.from('support_tickets').delete().in('id', ids);
    if (delErr) return { success: false, message: delErr.message };
  }
  return { success: true, count: ids.length };
}

async function deleteTicket(args, ctx) {
  const actor = await requireUser(ctx);
  const { ticketId } = args;
  // Only employees can delete their own tickets
  if (actor.role === 'admin' || actor.role === 'manager') {
    return { success: false, message: 'Admins cannot delete tickets. Use the status controls instead.' };
  }
  const { data: ticket } = await sb.from('support_tickets')
    .select('id, from_user_id, status, subject')
    .eq('id', ticketId).maybeSingle();
  if (!ticket) return { success: false, message: 'Ticket not found.' };
  if (ticket.from_user_id !== actor.id) return { success: false, message: 'You can only delete your own tickets.' };
  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    return { success: false, message: 'This ticket is already closed and cannot be deleted.' };
  }
  // Soft-delete: set status to 'deleted'
  const { error } = await sb.from('support_tickets')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) return { success: false, message: error.message };
  // Post a system note so admin can see it was deleted before being resolved
  const wasActive = ticket.status === 'open' || ticket.status === 'in_progress';
  if (wasActive) {
    await sb.from('ticket_replies').insert({
      ticket_id:     ticketId,
      from_user_id:  actor.id,
      from_username: '__system__',
      from_name:     'System',
      body:          `This ticket was deleted by the employee (${actor.full_name || actor.username}) before it was resolved.`
    });
  }
  return { success: true };
}

async function updateTicketStatus(args, ctx) {
  const actor = await requireUser(ctx);
  if (actor.role !== 'admin' && actor.role !== 'manager') return { success: false, message: 'Forbidden.' };
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!validStatuses.includes(args.status)) return { success: false, message: 'Invalid status.' };
  // Fetch current status so we can detect the transition
  const { data: ticket } = await sb.from('support_tickets').select('status').eq('id', args.ticketId).maybeSingle();
  if (!ticket) return { success: false, message: 'Ticket not found.' };
  const { error } = await sb.from('support_tickets').update({ status: args.status, updated_at: new Date().toISOString() }).eq('id', args.ticketId);
  if (error) return { success: false, message: error.message };
  // Auto-post a system message when ticket is closed or resolved for the first time
  const wasOpen = ticket.status !== 'closed' && ticket.status !== 'resolved';
  if (wasOpen && (args.status === 'closed' || args.status === 'resolved')) {
    const systemMsg = args.status === 'closed'
      ? `This ticket has been closed by ${actor.full_name || actor.username}. No further replies are possible.`
      : `This ticket has been marked as resolved by ${actor.full_name || actor.username}. If your issue persists, please open a new ticket.`;
    await sb.from('ticket_replies').insert({
      ticket_id:     args.ticketId,
      from_user_id:  actor.id,
      from_username: '__system__',
      from_name:     'System',
      body:          systemMsg
    });
  }
  return { success: true };
}

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
