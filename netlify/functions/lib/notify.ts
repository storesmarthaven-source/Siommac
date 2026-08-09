/**
 * netlify/functions/lib/notify.ts
 *
 * External notification delivery — Phase 2f.
 *
 * Responsibilities:
 *   1. Persist a `notifications` row for the target user (in-app)
 *   2. Load that user's delivery preferences (email / whatsapp)
 *   3. Fire email via the canonical service (lib/email/emailService) — if opted in
 *   4. Fire WhatsApp via Meta WhatsApp Business Cloud API (if opted in + tokens set)
 *
 * All delivery is fire-and-forget — errors are logged but never thrown back
 * to the caller so the business action (approve leave, publish payroll, …)
 * always succeeds even when the notification fails.
 *
 * Environment variables (Netlify → Site settings → Environment variables):
 *   Email delivery config is owned by lib/email/emailConfig.ts — see there.
 *   WHATSAPP_PHONE_NUMBER_ID    — Meta phone number ID (from Business API dashboard)
 *   WHATSAPP_ACCESS_TOKEN       — Permanent / long-lived access token
 *
 * @see docs/PHASE_PLAN.md §Phase-2f
 * @see docs/ARCHITECTURE.md
 */

import { sendEmail, type EmailSendResult } from './email/emailService';
import { sb }      from './db';

const logger = {
  info:  (msg: string, ctx?: Record<string, unknown>) => console.log('[notify]',  msg, ctx ?? ''),
  warn:  (msg: string, ctx?: Record<string, unknown>) => console.warn('[notify]', msg, ctx ?? ''),
  error: (msg: string, ctx?: Record<string, unknown>) => console.error('[notify]',msg, ctx ?? ''),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotifyPayload {
  /** app_users.id of the target */
  userId:  string;
  /** Event/notification type, e.g. 'hse.capa.overdue' */
  type:    string;
  /** Short headline, max ~100 chars */
  title:   string;
  /** Longer body text, max ~500 chars */
  body?:   string;
  /** Optional deep-link (legacy section id or path) */
  link?:   string;

  // ── ERP notification fields (notification system) ──
  eventId?:        string | null;
  module?:         string;
  severity?:       string;
  sourceType?:     string | null;
  sourceId?:       string | null;
  actionRoute?:    string | null;
  metadata?:       Record<string, unknown>;
  /** Base dedupe key; persisted as `${userId}:${dedupeKey}` (unique per user). */
  dedupeKey?:      string | null;
  actionRequired?: boolean;
  dueAt?:          string | null;
}

interface UserDeliveryInfo {
  email:     string | null;
  whatsapp:  string | null;   // phone in E.164 format, e.g. +18681234567
  fullName:  string;
}

interface DeliveryPrefs {
  in_app:   boolean;
  email:    boolean;
  whatsapp: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a simple HTML email body.
 * Kept intentionally minimal — a branded template can be added later.
 */
function buildEmailHtml(payload: NotifyPayload, recipientName: string, companyName: string): string {
  const bodyText = payload.body ? `<p style="color:#444;font-size:15px;line-height:1.5;">${payload.body}</p>` : '';
  const linkHtml = payload.link
    ? `<p style="margin-top:16px;"><a href="${payload.link}" style="color:#1b2d54;font-weight:600;">View details →</a></p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${payload.title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f4f6f9;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1b2d54;padding:22px 28px;">
      <span style="color:#fff;font-size:20px;font-weight:700;">${companyName}</span>
    </div>
    <div style="padding:28px 28px 24px;">
      <p style="color:#888;font-size:13px;margin:0 0 6px;">Hi ${recipientName},</p>
      <h2 style="color:#1b2d54;font-size:18px;margin:0 0 12px;">${payload.title}</h2>
      ${bodyText}
      ${linkHtml}
    </div>
    <div style="background:#f8fafe;padding:14px 28px;border-top:1px solid #eee;">
      <p style="color:#bbb;font-size:11px;margin:0;">You're receiving this because you have notifications enabled in ${companyName}.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Build a WhatsApp text message body (plain text — template messages require
 * Meta approval; we use plain-text for now which works in sandbox / approved numbers).
 */
function buildWhatsAppText(payload: NotifyPayload, recipientName: string): string {
  const lines = [
    `*${payload.title}*`,
    payload.body ?? '',
    recipientName ? `Hi ${recipientName}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

// ── Core delivery function ────────────────────────────────────────────────────

/**
 * Persist a notification and fan out to email / WhatsApp based on the
 * user's preferences. Never throws — all errors are caught and logged.
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  const { userId, type, title, body = '', link } = payload;

  try {
    // 1. Load user delivery info, preferences (this type → fallback '*'), and mutes.
    const [userRes, prefRes, prefDefaultRes, mutesRes] = await Promise.all([
      sb.from('app_users')
        .select('email, phone, full_name')
        .eq('id', userId)
        .maybeSingle<{ email: string | null; phone: string | null; full_name: string }>(),
      sb.from('notification_preferences')
        .select('in_app, email, whatsapp')
        .eq('user_id', userId).eq('event_type', type)
        .maybeSingle<DeliveryPrefs>(),
      sb.from('notification_preferences')
        .select('in_app, email, whatsapp')
        .eq('user_id', userId).eq('event_type', '*')
        .maybeSingle<DeliveryPrefs>(),
      sb.from('notification_mutes')
        .select('scope, muted_until')
        .eq('user_id', userId)
        .in('scope', ['all', `module:${payload.module ?? ''}`, `event:${type}`]),
    ]);

    // Mute gate: any active mute (indefinite or future) silences this notification.
    const now = Date.now();
    const mutes = (mutesRes.data ?? []) as Array<{ scope: string; muted_until: string | null }>;
    const muted = mutes.some(m => m.muted_until == null || new Date(m.muted_until).getTime() > now);
    if (muted) return;

    const user: UserDeliveryInfo = {
      email:    userRes.data?.email    ?? null,
      whatsapp: userRes.data?.phone    ?? null,
      fullName: userRes.data?.full_name ?? 'there',
    };

    // Default: in-app on, email off, whatsapp off. Specific pref overrides default.
    const prefs: DeliveryPrefs = prefRes.data ?? prefDefaultRes.data ?? { in_app: true, email: false, whatsapp: false };
    if (!prefs.in_app && !prefs.email && !prefs.whatsapp) return;

    // 2. Persist the in-app notification (rich columns) + record the delivery.
    // The id is captured because notification_deliveries.notification_id is NOT NULL: every
    // per-channel delivery record hangs off this row, so the email leg below can only be
    // recorded when it exists.
    let notificationId: string | null = null;
    if (prefs.in_app) {
      const insRes = await sb.from('notifications').insert({
        user_id:         userId,
        type,
        title,
        body,
        is_read:         false,
        link:            link ?? payload.actionRoute ?? null,
        event_id:        payload.eventId ?? null,
        module:          payload.module ?? null,
        severity:        payload.severity ?? 'info',
        source_type:     payload.sourceType ?? null,
        source_id:       payload.sourceId ?? null,
        action_route:    payload.actionRoute ?? null,
        metadata:        payload.metadata ?? {},
        dedupe_key:      payload.dedupeKey ? `${userId}:${payload.dedupeKey}` : null,
        action_required: payload.actionRequired ?? false,
        action_status:   payload.actionRequired ? 'pending' : 'none',
        due_at:          payload.dueAt ?? null,
        created_at:      new Date().toISOString(),
      }).select('id').single<{ id: string }>();

      if (insRes.error) {
        // 23505 = duplicate dedupe_key for this user → already notified, skip silently.
        if ((insRes.error as { code?: string }).code !== '23505') {
          logger.warn('[notify] Failed to persist notification', { userId, type, error: insRes.error.message });
        }
      } else if (insRes.data) {
        notificationId = insRes.data.id;
        void sb.from('notification_deliveries').insert({
          notification_id: insRes.data.id,
          channel:         'in_app',
          // 'sent' is the success status allowed by notification_deliveries_status_check
          // (pending|sent|failed|skipped); 'delivered' is not a permitted value.
          status:          'sent',
          attempted_at:    new Date().toISOString(),
        }).then(({ error }) => {
          if (error) logger.warn('[notify] Failed to record in_app delivery', { error: error.message });
        });
      }
    }

    // Fetch company name for email branding (best-effort)
    const companyName = await sb.from('settings')
      .select('value')
      .eq('key', 'companyName')
      .maybeSingle<{ value: string }>()
      .then(r => r.data?.value ?? 'Siomac');

    // 3. Email delivery.
    // AWAITED, unlike the fire-and-forget call this replaces: an outcome you did not wait for is
    // an outcome you cannot record, and the whole point of this leg is that it leaves evidence.
    // notify() is already called as a side effect (`void notify(...)`) by its callers, so the
    // added latency never delays a business action.
    if (prefs.email) {
      if (user.email) {
        await _sendEmail(payload, user, companyName, notificationId);
      } else {
        // Opted in with nowhere to send. That is a real, reportable skip — silence here is how
        // "why did this person never get the email?" becomes unanswerable.
        await _recordEmailDelivery(notificationId, 'skipped', {
          error: 'No email address on file for this user.',
        });
      }
    }

    // 4. WhatsApp delivery (Meta Cloud API)
    if (prefs.whatsapp && user.whatsapp) {
      void _sendWhatsApp(payload, user);
    }

  } catch (err) {
    logger.error('[notify] Unexpected error', { userId, type, err: String(err) });
  }
}

// ── Email via Resend ──────────────────────────────────────────────────────────

type EmailDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/**
 * The rule that decides what an email attempt is RECORDED as.
 *
 * Exported and pure so the invariant can be proven directly rather than inferred from a live
 * send: `sent` is reachable ONLY from an accepted result, so no provider rejection can ever be
 * recorded as a delivery. `not_configured` is separated from real transport failure because they
 * are different operational facts — nothing was transmitted versus the provider refused it, and
 * only the second is worth investigating or retrying.
 */
export function emailDeliveryStatusFor(result: EmailSendResult): EmailDeliveryStatus {
  if (result.ok) return 'sent';
  return result.reason === 'not_configured' ? 'skipped' : 'failed';
}

/**
 * Write (or update) the email leg's row in notification_deliveries.
 *
 * ⛔ The email channel previously recorded NOTHING. `notification_deliveries` has carried
 * `channel`, `provider_message_id` and `error` columns since the table was created, and only
 * `in_app` rows were ever written — so "did this person actually get the email?" had no answer
 * anywhere in the system. This is that evidence gap closed.
 *
 * ⚠ `notification_id` is NOT NULL with an FK, so a delivery row cannot exist without a
 * notifications row. A user who opts OUT of in-app but IN to email therefore has no parent to
 * hang evidence from. That combination is not silently ignored — it is logged as an explicit
 * recording failure, because pretending to record is worse than admitting the limit.
 */
async function _recordEmailDelivery(
  notificationId: string | null,
  status: EmailDeliveryStatus,
  extra: { providerMessageId?: string | null; error?: string | null } = {},
  deliveryId?: string | null,
): Promise<string | null> {
  if (!notificationId) {
    logger.warn('[notify/email] Cannot record email delivery: no in-app notification row exists for it', { status });
    return null;
  }
  const row = {
    notification_id:     notificationId,
    channel:             'email' as const,
    status,
    provider_message_id: extra.providerMessageId ?? null,
    error:               extra.error ?? null,
    attempted_at:        new Date().toISOString(),
  };

  if (deliveryId) {
    const { error } = await sb.from('notification_deliveries')
      .update({ status, provider_message_id: row.provider_message_id, error: row.error, attempted_at: row.attempted_at })
      .eq('id', deliveryId);
    if (error) logger.warn('[notify/email] Failed to finalise email delivery record', { error: error.message });
    return deliveryId;
  }

  const { data, error } = await sb.from('notification_deliveries').insert(row).select('id').single<{ id: string }>();
  if (error) {
    logger.warn('[notify/email] Failed to record email delivery', { error: error.message, status });
    return null;
  }
  return data.id;
}

async function _sendEmail(
  payload:      NotifyPayload,
  user:         UserDeliveryInfo,
  companyName:  string,
  notificationId: string | null,
): Promise<void> {
  // Queued-first, the same rule finance/payrollPayslipDelivery.ts follows: the attempt is
  // recorded BEFORE the send, so a crash between sending and recording leaves a visible
  // `pending` row rather than an email that reached someone with no trace that it was ever tried.
  const deliveryId = await _recordEmailDelivery(notificationId, 'pending');

  // Configuration, sender resolution and provider handling all live in the canonical service.
  // This function's only job is to turn a notification into a message, record what happened, and
  // log it — it no longer knows that Resend exists, nor what the sender address is.
  // Key derived from the notification itself — the same notification can never mail twice.
  // With no notifications row (in-app opted out) it falls back to the caller's dedupe key or the
  // user+type+title, which is still CONTENT, never a random value that could not dedupe.
  const idempotencyKey = notificationId
    ? `notification:${notificationId}`
    : `notification:${payload.userId}:${payload.type}:${payload.dedupeKey ?? payload.title}`;

  const result = await sendEmail({
    to:      user.email!,
    subject: payload.title,
    html:    buildEmailHtml(payload, user.fullName, companyName),
  }, {
    moduleKey: payload.module ?? 'platform',
    useCase: 'notification',
    idempotencyKey,
    sourceModule: payload.module ?? 'platform',
    sourceEntityType: payload.sourceType ?? 'notification',
    sourceEntityId: payload.sourceId ?? notificationId,
    notificationId,
    actorUserId: payload.userId,
  });

  if (result.ok) {
    // `sent` is written ONLY here — on an accepted send. A provider rejection can never reach
    // this branch, so the record can never claim a delivery the provider refused.
    await _recordEmailDelivery(notificationId, emailDeliveryStatusFor(result), { providerMessageId: result.providerMessageId }, deliveryId);
    logger.info('[notify/email] Sent', { to: user.email, type: payload.type, providerMessageId: result.providerMessageId });
    return;
  }

  // `not_configured` is an environment state, not an incident — it is the normal case in dev and
  // in E2E, and logging it at error level trained everyone to ignore this logger. It is recorded
  // as SKIPPED because nothing was transmitted: there is no failed delivery to investigate or
  // retry, which is a different operational fact from a provider that rejected the message.
  await _recordEmailDelivery(notificationId, emailDeliveryStatusFor(result), { error: result.message }, deliveryId);

  if (result.reason === 'not_configured') {
    logger.warn('[notify/email] Email delivery is not configured — skipping', { reason: result.message });
    return;
  }
  logger.warn('[notify/email] Delivery failed', { to: user.email, type: payload.type, reason: result.reason, detail: result.message });
}

// ── WhatsApp via Meta Cloud API ───────────────────────────────────────────────

async function _sendWhatsApp(
  payload: NotifyPayload,
  user:    UserDeliveryInfo,
): Promise<void> {
  const phoneNumberId  = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken    = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.warn('[notify/whatsapp] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set — skipping');
    return;
  }

  // Normalise phone — ensure E.164 (strip spaces/dashes, ensure leading +)
  let phone = (user.whatsapp ?? '').replace(/[\s\-()]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;

  try {
    const url  = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to:                phone,
      type:              'text',
      text:              { body: buildWhatsAppText(payload, user.fullName) },
    });

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.warn('[notify/whatsapp] Meta API error', { phone, status: res.status, body: errBody });
    } else {
      logger.info('[notify/whatsapp] Sent', { phone, type: payload.type });
    }
  } catch (err) {
    logger.error('[notify/whatsapp] Unexpected error', { err: String(err) });
  }
}

// ── Batch helper for admin-broadcast scenarios ────────────────────────────────

/**
 * Send the same notification to multiple users (e.g. "payroll published for dept").
 * Runs in parallel with a concurrency cap of 10 to avoid overwhelming the DB.
 */
export async function notifyMany(
  userIds: string[],
  payload: Omit<NotifyPayload, 'userId'>,
): Promise<void> {
  const CONCURRENCY = 10;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(userId => notify({ ...payload, userId })));
  }
}
