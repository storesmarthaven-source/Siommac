import { Hono }   from 'hono';
import bcrypt      from 'bcryptjs';
import { sb }      from '../lib/db';
import { signUser, requireUser, log_ } from '../lib/auth';
import { getProfileSignedUrl }         from '../lib/photos';
import { setting, invalidateSettingsCache } from '../lib/settings';
import { checkLoginLimit }             from '../lib/ratelimit';
import { uploadBase64 }                from '../lib/upload';
import { noPhoto }                     from '../lib/photos';
import type { HonoVariables }          from '../../../types/api';
import type { AppUser }                from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

router.post('/login', async c => {
  const args = (c.get('body').args ?? {}) as Record<string, string>;
  const username = String(args.username ?? '').trim();
  const password = args.password ?? '';
  if (!username || !password) return c.json({ success: false, message: 'Missing credentials' });

  const ip = c.get('clientIp') ?? 'unknown';
  const rl = checkLoginLimit(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many login attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const { data: u } = await sb.from('app_users').select('*').ilike('username', username).maybeSingle<AppUser>();
  if (!u || u.status !== 'active') {
    await bcrypt.compare(password, '$2a$12$invalidhashpadding.......................................enough');
    return c.json({ success: false, message: 'Invalid username or password' });
  }
  const passOk = await bcrypt.compare(password, u.password_hash);
  if (!passOk) return c.json({ success: false, message: 'Invalid username or password' });

  await log_(u, 'login', 'user', u.id, 'login ok');
  const [profileImage, companyLogoUrl, companyName] = await Promise.all([
    getProfileSignedUrl(u.id, u.profile_image),
    setting('companyLogoUrl', ''),
    setting('companyName', 'My Company'),
  ]);

  return c.json({
    success: true,
    token:        signUser(u),
    userId:       u.id,
    username:     u.username,
    fullName:     u.full_name,
    role:         u.role,
    departmentId: u.department_id ?? '',
    position:     u.position      ?? '',
    colorScheme:  u.color_scheme  ?? 'navy',
    layoutMode:   u.layout_mode   ?? 'sidebar',
    profileImage,
    companyLogoUrl,
    companyName,
  });
});

router.post('/logout', async c => {
  const u = await requireUser(c);
  await log_(u, 'logout', 'user', u.id, '');
  return c.json({ success: true });
});

router.post('/updateColorScheme', async c => {
  const actor = await requireUser(c);
  const { username, scheme } = (c.get('body').args ?? {}) as Record<string, string>;
  if (actor.username !== username) return c.json({ success: false, message: 'Forbidden' });
  await sb.from('app_users').update({ color_scheme: scheme, updated_at: new Date().toISOString() }).eq('id', actor.id);
  return c.json({ success: true });
});

router.post('/updateLayoutMode', async c => {
  const actor = await requireUser(c);
  const { username, mode } = (c.get('body').args ?? {}) as Record<string, string>;
  if (actor.username !== username) return c.json({ success: false, message: 'Forbidden' });
  await sb.from('app_users').update({ layout_mode: mode, updated_at: new Date().toISOString() }).eq('id', actor.id);
  return c.json({ success: true });
});

router.post('/updateMyProfile', async c => {
  const actor = await requireUser(c);
  const args  = (c.get('body').args ?? {}) as Record<string, unknown>;
  if (actor.username !== args.username) return c.json({ success: false, message: 'Forbidden' });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.fullName)           patch.full_name = String(args.fullName).trim();
  if (args.email !== undefined) patch.email    = String(args.email).trim();
  if (args.phone !== undefined) patch.phone    = String(args.phone).trim();

  if (args.newPassword) {
    if (!args.oldPassword) return c.json({ success: false, message: 'Current password is required' });
    if (!await bcrypt.compare(String(args.oldPassword), actor.password_hash))
      return c.json({ success: false, message: 'Current password is incorrect' });
    patch.password_hash = await bcrypt.hash(String(args.newPassword), 12);
  }

  const removePhoto = args.removeProfileImage === true || args.removeProfileImage === 'true';
  if (removePhoto) {
    patch.profile_image = '__removed__';
  } else if (args.profileImageBase64) {
    patch.profile_image = await uploadBase64('profile-photos', String(args.profileImageBase64), `profile_${actor.username}`);
  }

  const { data, error } = await sb.from('app_users').update(patch).eq('id', actor.id)
    .select('profile_image, full_name, email, phone').single<Pick<AppUser, 'profile_image' | 'full_name' | 'email' | 'phone'>>();
  if (error) { console.error('[auth] updateMyProfile', error); return c.json({ success: false, message: error.message }); }

  const storedPath   = noPhoto(data.profile_image) ? '' : data.profile_image ?? '';
  const profileImage = await getProfileSignedUrl(actor.id, storedPath);
  return c.json({ success: true, profileImage, fullName: data.full_name, email: data.email ?? '', phone: data.phone ?? '' });
});

router.post('/verifyPassword', async c => {
  const u        = await requireUser(c);
  const password = String(((c.get('body').args ?? {}) as Record<string, unknown>).password ?? '');
  if (!password) return c.json({ success: false, message: 'Password required.' });
  const { data: row } = await sb.from('app_users').select('password_hash').eq('id', u.id).single<Pick<AppUser, 'password_hash'>>();
  if (!row) return c.json({ success: false, message: 'User not found.' });
  const ok = await bcrypt.compare(password, row.password_hash);
  return c.json(ok ? { success: true } : { success: false, message: 'Incorrect password.' });
});

// Gated by ALLOW_DEMO_SETUP env var — never available in production by default
router.post('/setupDemoUsers', async c => {
  if (process.env.ALLOW_DEMO_SETUP !== 'true') {
    return c.json({ success: false, message: 'Not available in this environment.' }, 403);
  }
  const users: [string, string, string, string, string, string | null, string][] = [
    ['USR-001', 'admin',     'admin123',   'System Admin',    'admin',    null,       'Administrator'],
    ['USR-002', 'manager1',  'manager123', 'Project Manager', 'manager',  'DEPT-001', 'Manager'],
    ['USR-003', 'employee1', 'emp123',     'Demo Employee',   'employee', 'DEPT-001', 'Worker'],
  ];
  for (const [id, username, password, full_name, role, department_id, position] of users) {
    const password_hash = await bcrypt.hash(password, 12);
    await sb.from('app_users').upsert({ id, username, password_hash, full_name, role, department_id, position, status: 'active' });
  }
  await sb.from('departments').update({ manager_id: 'USR-002' }).eq('id', 'DEPT-001');
  return c.json({ success: true });
});

export default router;
