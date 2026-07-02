import { Hono } from 'hono';
import { sb, sbAnon } from '../lib/db';
import { requireUser, requireRole, log_ }               from '../lib/auth';
import { getAllSettings, setting, invalidateSettingsCache } from '../lib/settings';
import { uploadBase64 }                                  from '../lib/upload';
import { avatarPublicUrl, AVATARS_BUCKET }               from '../lib/photos';
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

// NOTE: the old generic `/getSignedUrls` (any authenticated user, caller-supplied
// bucket+path — an IDOR: nothing scoped the path to the requester) and
// `/getUploadUrl` (same auth gap, plus let ANY authenticated user request a write
// URL into the admin-only `branding` bucket) were removed — both were unused by
// every current caller (grepped clean across src/, scripts/e2e/, docs/). Photo
// uploads now go through the properly-scoped, per-user-path routes:
// /profile-photo/upload-url (below) and the module-specific attachment routes
// (e.g. communications/messages/attachments/upload-url). Do not re-add a generic
// signed-url/upload endpoint — new upload flows must be record-scoped,
// permission-checked, and derive their own path (never take a bare path/bucket
// from the client).

export default router;
