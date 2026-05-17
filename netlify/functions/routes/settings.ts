import { Hono } from 'hono';
import { sb, sbAnon } from '../lib/db';
import { requireUser, requireRole, log_ }               from '../lib/auth';
import { getAllSettings, setting, invalidateSettingsCache } from '../lib/settings';
import { uploadBase64, createUploadUrl }                 from '../lib/upload';
import { getSignedUrl }                                  from '../lib/photos';
import { zv, UpdateSettingSchema, SaveWorkHoursSchema, UploadLogoSchema, z } from '../lib/validate';
import type { HonoVariables }                            from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

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
