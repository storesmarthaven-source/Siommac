import { Hono } from 'hono';
import { sb, sbAnon } from '../lib/db';
import { requireUser, requireRole, userCan, log_ }      from '../lib/auth';
import { getAllSettings, setting, invalidateSettingsCache } from '../lib/settings';
import { resolveSettingValue } from '../lib/settings/resolveSetting';
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

  // upsert: a re-submit reuses the same versioned path while a photo is still
  // pending (the live profile_image_version only advances on approval), so the
  // object can already exist. Overwriting your OWN avatar slot is correct —
  // without this the second attempt fails with "The resource already exists".
  const [avatarUp, thumbUp] = await Promise.all([
    sb.storage.from(AVATARS_BUCKET).createSignedUploadUrl(avatarPath, { upsert: true }),
    sb.storage.from(AVATARS_BUCKET).createSignedUploadUrl(thumbPath, { upsert: true }),
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

// Commits a submitted photo. Two paths, decided by authorization:
//   • Reviewers (anyone who can approve photos — superadmin/admin/hr_manager, or
//     any role granted `hr.employees.photo_approve`) have NO one to review them,
//     so their change applies to the LIVE avatar immediately. No self-review.
//   • Everyone else: the photo stays PENDING (old photo still live) until a
//     reviewer approves it from the Employee Master profile drawer (see hr.ts
//     `/hr/employees/photo/decide`) — a real review gate, not a no-op.
router.post('/profile-photo/commit', async c => {
  const actor = await requireUser(c);
  const v = zv(c, ProfilePhotoCommitSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  // Path ownership — both objects must live under this user's prefix.
  if (!v.data.avatarPath.startsWith(`${actor.id}/`) || !v.data.thumbPath.startsWith(`${actor.id}/`)) {
    return c.json({ success: false, message: 'Path does not belong to you' }, 403 as 200);
  }

  const clearPending = {
    profile_image_pending_url: null, profile_image_pending_path: null,
    profile_image_pending_thumb_url: null, profile_image_pending_thumb_path: null,
    profile_image_pending_version: null, profile_image_pending_submitted_at: null,
  };

  const canSelfApprove = await userCan(actor, 'hr.employees.photo_approve');

  if (canSelfApprove) {
    // Promote straight to the live avatar (mirrors hr.ts photo/decide approve).
    const { error } = await sb.from('app_users').update({
      ...clearPending,
      profile_image_url:        v.data.avatarPublicUrl,
      profile_image_path:       v.data.avatarPath,
      profile_image_thumb_url:  v.data.thumbPublicUrl,
      profile_image_thumb_path: v.data.thumbPath,
      profile_image_version:    v.data.version,
      profile_image_updated_at: new Date().toISOString(),
      profile_image_removed_at: null,
      profile_image:            v.data.avatarPublicUrl,   // back-compat mirror (http url)
      signed_url: null, signed_url_expires_at: null,
    }).eq('id', actor.id);
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);

    void emitAppEvent({ eventType: 'auth.profile_photo.updated', sourceModule: 'auth', sourceEntityType: 'app_user', sourceEntityId: actor.id, actorUserId: actor.id, severity: 'info', payload: { version: v.data.version, selfApproved: true } });
    return c.json({ success: true, data: { profileImage: v.data.avatarPublicUrl, profileImageVersion: v.data.version, pending: false } });
  }

  const { error } = await sb.from('app_users').update({
    profile_image_pending_url:         v.data.avatarPublicUrl,
    profile_image_pending_path:        v.data.avatarPath,
    profile_image_pending_thumb_url:   v.data.thumbPublicUrl,
    profile_image_pending_thumb_path:  v.data.thumbPath,
    profile_image_pending_version:     v.data.version,
    profile_image_pending_submitted_at: new Date().toISOString(),
  }).eq('id', actor.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({ eventType: 'auth.profile_photo.submitted', sourceModule: 'auth', sourceEntityType: 'app_user', sourceEntityId: actor.id, actorUserId: actor.id, severity: 'info', payload: { version: v.data.version } });
  // The live avatar is unchanged — return the PENDING thumb so the UI can show
  // "submitted" state without claiming the live photo already changed.
  return c.json({ success: true, data: { profileImage: v.data.thumbPublicUrl, profileImageVersion: v.data.version, pending: true } });
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

// ── Profile photo enhancement (server-side OpenAI — key never sent to client) ──
//
// POST /api/profile-photo/enhance
// Body: { args: { imageBase64: string; mimeType?: string } }
//
// The actor can only enhance their own photo.
// If OPENAI_API_KEY is not configured the route returns a 503 with a clear message
// so the UI can show an honest "not available" state instead of silently failing.
// The enhanced image is returned as a base64 PNG in { data: { imageBase64, mimeType } }.
// The caller must then run it through the normal uploadMyProfilePhoto / commit pipeline
// to persist it — we do NOT commit here to keep the flow explicit and auditable on
// the frontend.

// Fallback used only if the 'auth.profile_photo.enhance_prompt' setting is
// unavailable (catalog row missing / not yet migrated) — see the catalog seed
// in supabase/migrations/20260801000000_ai_photo_enhance_prompt_setting.sql,
// which carries the same text as its default_value.
const ENHANCE_PROMPT_FALLBACK = `Standardize this manually cropped employee profile photo for a
professional SIOMAC employee record. Preserve the person's identity and natural appearance.
Improve lighting, clarity, and background cleanliness. Use a clean neutral professional
background. Keep the crop suitable for an employee profile and HR record. Do not change
facial structure, age, skin tone, identity, or create an unrealistic image.`;

router.post('/profile-photo/enhance', async c => {
  const actor = await requireUser(c);

  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return c.json({
      success: false,
      message: 'Photo enhancement is not configured on this server. Contact your system administrator to enable the OPENAI_API_KEY environment variable.',
    }, 503 as 200);
  }

  const args = (c.get('body').args ?? {}) as { imageBase64?: string; mimeType?: string };
  if (!args.imageBase64) {
    return c.json({ success: false, message: 'Missing imageBase64.' }, 400 as 200);
  }
  if (args.imageBase64.length > 8 * 1024 * 1024 * 1.4) { // ~8 MB raw → ~11 MB base64
    return c.json({ success: false, message: 'Image is too large (max 8 MB).' }, 400 as 200);
  }

  // WebP is included because the frontend cropper exports its crop as
  // image/webp; gpt-image-1 accepts png/webp/jpg inputs natively.
  const inputMime = (args.mimeType ?? 'image/png').toLowerCase() as 'image/png' | 'image/jpeg' | 'image/webp';
  const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const ext = EXT_BY_MIME[inputMime];
  if (!ext) {
    return c.json({ success: false, message: 'Only PNG, JPEG, and WebP images are supported for enhancement.' }, 400 as 200);
  }

  // Lazily import openai to avoid cold-start cost on routes that don't use it
  const { default: OpenAI, toFile } = await import('openai');
  // Pin the base URL so a stray OPENAI_BASE_URL in the environment can't
  // redirect calls to a gateway that rejects the key.
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1' });

  const imgBuffer = Buffer.from(args.imageBase64, 'base64');
  const imageFile = await toFile(imgBuffer, `profile.${ext}`, { type: inputMime });

  const prompt = await resolveSettingValue(
    sb, 'auth.profile_photo.enhance_prompt', { moduleKey: 'system' }, ENHANCE_PROMPT_FALLBACK,
  );

  let result: { data?: Array<{ b64_json?: string | null }> };
  try {
    // NB: gpt-image-1 always returns base64 in data[0].b64_json and REJECTS the
    // `response_format` param (that's dall-e-2/3 only) — passing it 400s at
    // OpenAI, which surfaces here as a 502. Do not re-add it.
    const raw = await client.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      quality: 'medium',
      size: '1024x1024',
    } as Parameters<typeof client.images.edit>[0]);
    result = raw as { data?: Array<{ b64_json?: string | null }> };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenAI photo enhancement failed.';
    return c.json({ success: false, message }, 502 as 200);
  }

  const imageBase64 = result.data?.[0]?.b64_json;
  if (!imageBase64) {
    return c.json({ success: false, message: 'OpenAI did not return an enhanced image.' }, 502 as 200);
  }

  void emitAppEvent({
    eventType: 'auth.profile_photo.ai_enhanced',
    sourceModule: 'auth',
    sourceEntityType: 'app_user',
    sourceEntityId: actor.id,
    actorUserId: actor.id,
    severity: 'info',
    payload: {},
  });

  return c.json({ success: true, data: { imageBase64, mimeType: 'image/png' } });
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
