import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ }               from '../lib/auth';
import { getAllSettings, setting, invalidateSettingsCache } from '../lib/settings';
import { uploadBase64 }                                  from '../lib/upload';
import { getSignedUrl }                                  from '../lib/photos';
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
  const { key, value } = (c.get('body').args ?? {}) as Record<string, string>;
  const { error } = await sb.from('settings').upsert({ key, value: String(value ?? ''), updated_at: new Date().toISOString() }, { onConflict: 'key' });
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
  const { start, end } = (c.get('body').args ?? {}) as Record<string, string>;
  const s = (start ?? '').trim(), e = (end ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e)) return c.json({ success: false, message: 'Invalid time format. Use HH:MM.' });
  if (s >= e) return c.json({ success: false, message: 'Work start must be before end time.' });
  const value = JSON.stringify({ start: s, end: e });
  const { error } = await sb.from('settings').upsert({ key: 'workHours', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return c.json({ success: false, message: error.message });
  invalidateSettingsCache();
  await log_(actor, 'update', 'setting', 'workHours', value);
  return c.json({ success: true });
});

router.post('/uploadLogo', async c => {
  const actor = await requireRole(c, ['admin']);
  const { base64 } = (c.get('body').args ?? {}) as Record<string, string>;
  const url = await uploadBase64('branding', base64, 'company_logo');
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
    const urls = await Promise.all((args.paths as Array<{ bucket: string; path: string }>).map(({ bucket, path: p }) => getSignedUrl(bucket, p)));
    return c.json({ success: true, data: urls });
  }
  const url = await getSignedUrl(String(args.bucket ?? ''), String(args.path ?? ''));
  return c.json({ success: true, data: url });
});

export default router;
