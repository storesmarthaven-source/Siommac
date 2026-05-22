/**
 * netlify/functions/routes/notify.ts
 *
 * Notification management endpoints — Phase 2f.
 *
 *   POST /getMyNotifications      — paginated in-app notification history
 *   POST /markNotificationRead    — mark one notification read
 *   POST /markAllNotificationsRead— mark all read for current user
 *   POST /getMyPreferences        — fetch delivery prefs (email / whatsapp)
 *   POST /updateMyPreference      — upsert one preference row
 *   POST /sendNotification        — admin: manually trigger a notification
 *
 * @see docs/PHASE_PLAN.md §Phase-2f
 * @see docs/ARCHITECTURE.md
 */

import { Hono }         from 'hono';
import { sb }           from '../lib/db';
import { requireUser, requireRole } from '../lib/auth';
import { notify }       from '../lib/notify';
import { zv }           from '../lib/validate';
import { z }            from 'zod';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Validation schemas ────────────────────────────────────────────────────────

const UpdatePrefSchema = z.object({
  type:     z.string().min(1),
  in_app:   z.boolean().optional(),
  email:    z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

const MarkReadSchema = z.object({
  notificationId: z.string().uuid(),
});

const SendNotifSchema = z.object({
  userId: z.string().uuid(),
  type:   z.string().min(1),
  title:  z.string().min(1).max(200),
  body:   z.string().max(1000).optional(),
  link:   z.string().max(200).optional(),
});

const GetNotifSchema = z.object({
  limit:  z.number().int().min(1).max(100).optional().default(30),
  before: z.string().optional(),   // ISO timestamp for cursor pagination
});

// ── GET my in-app notifications ───────────────────────────────────────────────

router.post('/getMyNotifications', async c => {
  const actor = await requireUser(c);
  const v     = zv(c, GetNotifSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('notifications')
    .select('id, type, title, body, is_read, link, created_at')
    .eq('user_id', actor.id)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.before) {
    q = q.lt('created_at', v.data.before);
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });

  return c.json({ success: true, data: data ?? [] });
});

// ── Mark one notification read ────────────────────────────────────────────────

router.post('/markNotificationRead', async c => {
  const actor = await requireUser(c);
  const v     = zv(c, MarkReadSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { error } = await sb
    .from('notifications')
    .update({ is_read: true })
    .eq('id', v.data.notificationId)
    .eq('user_id', actor.id);   // scoped to current user — no admin override

  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true });
});

// ── Mark all read ─────────────────────────────────────────────────────────────

router.post('/markAllNotificationsRead', async c => {
  const actor = await requireUser(c);

  await sb
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', actor.id)
    .eq('is_read', false);

  return c.json({ success: true });
});

// ── Get delivery preferences ──────────────────────────────────────────────────

router.post('/getMyPreferences', async c => {
  const actor = await requireUser(c);

  const { data, error } = await sb
    .from('notification_preferences')
    .select('type, in_app, email, whatsapp')
    .eq('user_id', actor.id);

  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── Update one preference ─────────────────────────────────────────────────────

router.post('/updateMyPreference', async c => {
  const actor = await requireUser(c);
  const v     = zv(c, UpdatePrefSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { type, ...fields } = v.data;
  if (!Object.keys(fields).length) return c.json({ success: false, message: 'No fields to update.' });

  const { error } = await sb
    .from('notification_preferences')
    .upsert({
      user_id: actor.id,
      type,
      ...fields,
    }, { onConflict: 'user_id,type' });

  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true });
});

// ── Admin: send a notification manually ──────────────────────────────────────

router.post('/sendNotification', async c => {
  await requireRole(c, ['admin']);
  const v = zv(c, SendNotifSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  // Fire-and-forget — we respond immediately, delivery happens in background
  void notify({
    userId: v.data.userId,
    type:   v.data.type,
    title:  v.data.title,
    body:   v.data.body,
    link:   v.data.link,
  });

  return c.json({ success: true });
});

export default router;
