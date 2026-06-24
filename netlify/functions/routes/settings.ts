import { Hono } from 'hono';
import { sb, sbAnon } from '../lib/db';
import { requireUser, requireRole, log_ }               from '../lib/auth';
import { getAllSettings, setting, invalidateSettingsCache } from '../lib/settings';
import { uploadBase64, createUploadUrl }                 from '../lib/upload';
import { getSignedUrl, avatarPublicUrl, AVATARS_BUCKET } from '../lib/photos';
import { emitAppEvent }                                  from '../lib/appEvents';
import { zv, UpdateSettingSchema, SaveWorkHoursSchema, UploadLogoSchema, z } from '../lib/validate';
import type { HonoVariables }                            from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// Public — no auth required. Returns only branding fields needed for the login screen.
router.post('/getPublicBranding', async c => {
  const [logoUrl, companyName] = await Promise.all([
    setting('companyLogoUrl', ''),
    setting('companyName', ''),
  ]);
  return c.json({ success: true, companyLogoUrl: logoUrl, companyName });
});

router.post('/getSettings', async c => {
  await requireUser(c);
  const s = await getAllSettings();
  if (!s.currency || s.currency === 'Rs.' || s.currency === 'Rs') {
    s.currency = 'TT';
    sb.from('settings').upsert({ key: 'currency', value: 'TT', updated_at: new Date().toISOString() }).then(() => {});
  }
  return c.json({ success: true, data: s });
});

router.post('/updateSetting', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, UpdateSettingSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { key, value } = v.data;
  const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return c.json({ success: false, message: error.message });
  invalidateSettingsCache();
  await log_(actor, 'update', 'setting', key, '');
  return c.json({ success: true });
});

router.post('/getWorkHours', async c => {
  await requireUser(c);
  const raw = await setting('workHours', '{"start":"08:00","end":"17:00"}');
  let wh = { start: '08:00', end: '17:00' };
  try { wh = JSON.parse(raw); } catch { /* keep default */ }
  return c.json({ success: true, data: wh });
});

router.post('/saveWorkHours', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, SaveWorkHoursSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { start, end } = v.data;
  const value = JSON.stringify({ start, end });
  const { error } = await sb.from('settings').upsert({ key: 'workHours', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return c.json({ success: false, message: error.message });
  invalidateSettingsCache();
  await log_(actor, 'update', 'setting', 'workHours', value);
  return c.json({ success: true });
});

router.post('/uploadLogo', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, UploadLogoSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const url = await uploadBase64('branding', v.data.imageBase64, 'company_logo');
  const { error } = await sb.from('settings').upsert({ key: 'companyLogoUrl', value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return c.json({ success: false, message: error.message });
  invalidateSettingsCache();
  await log_(actor, 'update', 'companyLogoUrl', '', '');
  return c.json({ success: true, url });
});

// ── Profile photo (PUBLIC avatars bucket; presigned direct upload) ───────────
// Self-service: any authenticated user manages their own avatar. The browser
// resizes to webp (512 + 96 thumb), PUTs both to the presigned URLs, then commits
// the public URLs. No base64 through Lambda, no signed-URL cache.

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

router.post('/profile-photo/upload-url', async c => {
  const actor = await requireUser(c);
  const args  = (c.get('body').args ?? {}) as { mimeType?: string };
  const mime  = (args.mimeType ?? 'image/webp').toLowerCase();
  if (!ALLOWED_AVATAR_MIME.has(mime)) {
    return c.json({ success: false, message: 'Unsupported image type (jpeg, png, webp)' }, 400 as 200);
  }

  const { data: row } = await sb.from('app_users').select('profile_image_version').eq('id', actor.id).maybeSingle<{ profile_image_version: number | null }>();
  const nextVersion = (row?.profile_image_version ?? 1) + 1;
  // Versioned object paths → a new photo changes the URL → CDN/browser refresh.
  const avatarPath = `${actor.id}/avatar-v${nextVersion}.webp`;
  const thumbPath  = `${actor.id}/avatar-v${nextVersion}-thumb.webp`;

  const [avatarUp, thumbUp] = await Promise.all([
    sb.storage.from(AVATARS_BUCKET).createSignedUploadUrl(avatarPath),
    sb.storage.from(AVATARS_BUCKET).createSignedUploadUrl(thumbPath),
  ]);
  if (avatarUp.error || thumbUp.error || !avatarUp.data || !thumbUp.data) {
    return c.json({ success: false, message: avatarUp.error?.message ?? thumbUp.error?.message ?? 'Failed to create upload URL' }, 400 as 200);
  }

  return c.json({ success: true, data: {
    version:      nextVersion,
    avatar:    { path: avatarPath, uploadUrl: avatarUp.data.signedUrl, token: avatarUp.data.token, publicUrl: avatarPublicUrl(avatarPath) },
    thumbnail: { path: thumbPath,  uploadUrl: thumbUp.data.signedUrl,  token: thumbUp.data.token,  publicUrl: avatarPublicUrl(thumbPath) },
    maxSizeBytes: 5 * 1024 * 1024,
  } });
});

const ProfilePhotoCommitSchema = z.object({
  version:         z.number().int().positive(),
  avatarPath:      z.string().min(1).max(255),
  avatarPublicUrl: z.string().url(),
  thumbPath:       z.string().min(1).max(255),
  thumbPublicUrl:  z.string().url(),
});

router.post('/profile-photo/commit', async c => {
  const actor = await requireUser(c);
  const v = zv(c, ProfilePhotoCommitSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  // Path ownership — both objects must live under this user's prefix.
  if (!v.data.avatarPath.startsWith(`${actor.id}/`) || !v.data.thumbPath.startsWith(`${actor.id}/`)) {
    return c.json({ success: false, message: 'Path does not belong to you' }, 403 as 200);
  }

  const { error } = await sb.from('app_users').update({
    profile_image_url:        v.data.avatarPublicUrl,
    profile_image_path:       v.data.avatarPath,
    profile_image_thumb_url:  v.data.thumbPublicUrl,
    profile_image_thumb_path: v.data.thumbPath,
    profile_image_version:    v.data.version,
    profile_image_updated_at: new Date().toISOString(),
    profile_image_removed_at: null,
    profile_image:            v.data.avatarPublicUrl,  // back-compat mirror (public URL)
    signed_url:               null,                    // clear legacy signed cache
    signed_url_expires_at:    null,
  }).eq('id', actor.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({ eventType: 'auth.profile_photo.updated', sourceModule: 'auth', sourceEntityType: 'app_user', sourceEntityId: actor.id, actorUserId: actor.id, severity: 'info', payload: { version: v.data.version } });
  return c.json({ success: true, data: { profileImage: v.data.thumbPublicUrl, profileImageVersion: v.data.version } });
});

router.post('/profile-photo/remove', async c => {
  const actor = await requireUser(c);
  const { data: row } = await sb.from('app_users').select('profile_image_version').eq('id', actor.id).maybeSingle<{ profile_image_version: number | null }>();
  const nextVersion = (row?.profile_image_version ?? 1) + 1;

  const { error } = await sb.from('app_users').update({
    profile_image_url:        null,
    profile_image_path:       null,
    profile_image_thumb_url:  null,
    profile_image_thumb_path: null,
    profile_image_version:    nextVersion,
    profile_image_removed_at: new Date().toISOString(),
    profile_image:            null,   // back-compat — NULL, never '__removed__'
    signed_url:               null,
    signed_url_expires_at:    null,
  }).eq('id', actor.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({ eventType: 'auth.profile_photo.removed', sourceModule: 'auth', sourceEntityType: 'app_user', sourceEntityId: actor.id, actorUserId: actor.id, severity: 'info', payload: {} });
  return c.json({ success: true, data: { profileImage: null, profileImageVersion: nextVersion } });
});

router.post('/getSignedUrls', async c => {
  await requireUser(c);
  const args = (c.get('body').args ?? {}) as Record<string, unknown>;
  if (args.paths) {
    const paths = args.paths as Array<{ bucket: string; path: string }>;
    if (!Array.isArray(paths) || paths.length > 100) return c.json({ success: false, message: 'Invalid paths array' }, 400);
    const urls = await Promise.all(paths.map(({ bucket, path: p }) => getSignedUrl(String(bucket), String(p))));
    return c.json({ success: true, data: urls });
  }
  const url = await getSignedUrl(String(args.bucket ?? ''), String(args.path ?? ''));
  return c.json({ success: true, data: url });
});

// ── Presigned upload URL ──────────────────────────────────────────────────────
// Returns a short-lived URL the client uses to PUT a file directly to Supabase
// Storage — the Lambda never holds image bytes in memory.
const GetUploadUrlSchema = z.object({
  bucket:   z.enum(['profile-photos', 'attendance-photos', 'branding']),
  name:     z.string().min(1).max(128),
  mimeType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
});

router.post('/getUploadUrl', async c => {
  await requireUser(c);
  const v = zv(c, GetUploadUrlSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { bucket, name, mimeType } = v.data;
  try {
    const result = await createUploadUrl(bucket, name, mimeType);
    return c.json({ success: true, ...result });
  } catch (e) {
    return c.json({ success: false, message: (e as Error).message }, 500);
  }
});

export default router;
