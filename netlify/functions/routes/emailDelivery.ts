/**
 * netlify/functions/routes/emailDelivery.ts — operator view of outbound email.
 *
 *   POST /email/status     — is email delivery configured, and as whom?
 *   POST /email/test-send  — prove it, to an address the operator names
 *   POST /email/webhook    — Resend lifecycle events (PUBLIC; signature IS the authentication)
 *
 * Both are gated on `settings.system.*`, which already exists in both permission catalogues and
 * is already granted to admin + superadmin in role_permissions. Email transport credentials ARE
 * system configuration, so a new key would have been a synonym for an existing one — and a new
 * key is dead until a migration grants it, which is a failure mode worth not inviting.
 *
 * ⛔ Neither endpoint ever returns the API key, masked or otherwise. `configured: true` answers
 * every question an operator can act on; four characters of a credential answer none of them.
 */

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import { sendEmail, getEmailDeliveryStatus } from '../lib/email/emailService';
import { recordWebhookEvent, type EmailDeliveryStatus } from '../lib/email/emailDeliveryRecord';
import { verifyWebhookSignature } from '../lib/email/webhookSignature';
import { emitAppEvent } from '../lib/appEvents';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// apiPost/authPost wrap the payload as { args }, so every route reads body.args.
const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

router.post('/email/status', async c => {
  await requirePermission(c, 'settings.system.view');
  return c.json({ success: true, data: getEmailDeliveryStatus() });
});

/**
 * `dryRun` defaults to TRUE.
 *
 * Sending real mail is the irreversible half of this endpoint, so it is the half an operator has
 * to ask for explicitly. A default that mails a human the moment someone clicks "test" is the
 * kind of default that gets discovered by mailing a customer. A dry run still proves the parts
 * that are usually wrong — credential shape, sender resolution, recipient validity — without
 * transmitting anything, and says so in the response rather than implying a send.
 */
const TestSendSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
  /** Optional caller-supplied key so a retried request cannot mail twice. */
  idempotencyKey: z.string().min(8).max(200).optional(),
});

router.post('/email/test-send', async c => {
  const actor = await requirePermission(c, 'settings.system.manage');
  const v = zv(c, TestSendSchema, body(c));
  if (!v.ok) return v.response;

  const dryRun = v.data.dryRun !== false;
  const subject = v.data.subject?.trim() || 'Siomac email delivery test';
  // The OPERATION being made idempotent here is this request. An operator who clicks Test twice
  // means two tests, so a content-derived key would be wrong — it would silently swallow the
  // second. A caller may pass its own key to make a specific retry safe (e.g. a UI resubmitting
  // after a timeout), and that retry then dedupes exactly as it should.
  const idempotencyKey = v.data.idempotencyKey?.trim() || `test_email:${actor.id}:${crypto.randomUUID()}`;

  const result = await sendEmail({
    to: v.data.to,
    subject,
    html: `<p>This is a test of Siomac email delivery.</p><p>If you received it, the platform's outbound email is configured correctly.</p>`,
    text: 'This is a test of Siomac email delivery. If you received it, the platform\'s outbound email is configured correctly.',
  }, {
    moduleKey: 'platform',
    useCase: 'test_email',
    idempotencyKey,
    sourceModule: 'platform',
    sourceEntityType: 'email_delivery_test',
    sourceEntityId: actor.id,
    actorUserId: actor.id,
  }, { dryRun });

  // A REAL test send is an administrative act against an external service: it is recorded, with
  // who asked and where it went. A dry run transmits nothing, so it is not an event.
  if (!dryRun) {
    void emitAppEvent({
      eventType: result.ok ? 'platform.email.test_sent' : 'platform.email.test_failed',
      sourceModule: 'platform', sourceEntityType: 'email_delivery', sourceEntityId: actor.id,
      actorUserId: actor.id, severity: result.ok ? 'info' : 'warning',
      payload: result.ok
        ? { to: v.data.to, sender: result.sender, transport: result.transport, providerMessageId: result.providerMessageId }
        : { to: v.data.to, reason: result.reason, detail: result.message },
    });
  }

  if (!result.ok) {
    // 422 for a configuration/message problem the operator must fix; 502 when the provider
    // itself rejected or was unreachable. Collapsing both into 500 tells them nothing.
    const status = result.reason === 'transport_error' ? 502 : 422;
    return c.json({ success: false, message: result.message, data: { reason: result.reason, problems: result.problems ?? [] } }, status as 200);
  }

  return c.json({
    success: true,
    data: {
      dryRun: result.dryRun,
      sender: result.sender,
      transport: result.transport,
      recipients: result.recipients,
      providerMessageId: result.providerMessageId,
      deliveryId: result.deliveryId,
      deduplicated: result.deduplicated,
      message: result.deduplicated
        ? 'This idempotency key had already reached the provider — nothing was sent again.'
        : result.dryRun
          ? 'Configuration and message are valid. Nothing was sent — set dryRun to false to deliver a real test email.'
          : 'Test email accepted by the provider.',
    },
  });
});

// ── Provider webhook ────────────────────────────────────────────────────────────
/**
 * POST /email/webhook — Resend delivery lifecycle events. PUBLIC by necessity.
 *
 * Authentication IS the signature. There is no permission gate because the caller is Resend, not
 * a SIOMAC user, and the raw body is verified against RESEND_WEBHOOK_SECRET before a single row
 * is written. An unconfigured secret fails CLOSED — a public endpoint that writes
 * provider-attributed state on an unverified request is worse than one that is switched off.
 *
 * Returns 200 for anything successfully accounted for, INCLUDING duplicates and events for
 * message ids we do not recognise. Resend retries on a non-2xx, so returning an error for
 * something we have already handled — or can never handle — turns a benign event into an
 * indefinite retry loop.
 */
const WEBHOOK_STATUS: Record<string, EmailDeliveryStatus> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

/** Outcomes an operator genuinely needs told about. A `sent` webhook is not news. */
const NOTEWORTHY = new Set<EmailDeliveryStatus>(['failed', 'bounced', 'complained']);

router.post('/email/webhook', async c => {
  const rawBody = c.get('rawBody') ?? '';
  const verification = verifyWebhookSignature({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    headers: {
      id: c.req.header('svix-id') ?? null,
      timestamp: c.req.header('svix-timestamp') ?? null,
      signature: c.req.header('svix-signature') ?? null,
    },
    rawBody,
  });

  if (!verification.ok) {
    // The reason is logged, never returned: telling an unverified caller WHY it failed helps it
    // iterate towards a forgery.
    console.warn('[email/webhook] rejected', { reason: verification.reason });
    return c.json({ success: false, message: 'Invalid webhook signature.' }, 401 as 200);
  }

  const payload = (c.get('body') ?? {}) as { type?: string; created_at?: string; data?: Record<string, unknown> };
  const eventType = String(payload.type ?? '');
  const status = WEBHOOK_STATUS[eventType];
  const providerMessageId = payload.data && typeof payload.data['email_id'] === 'string'
    ? String(payload.data['email_id']) : null;
  const eventId = c.req.header('svix-id') ?? '';
  const occurredAt = typeof payload.created_at === 'string' ? payload.created_at : null;

  // An event type we do not model is recorded and acknowledged, never guessed at. Subscribing to
  // a new type in the Resend dashboard should not silently mutate deliveries here.
  const result = await recordWebhookEvent({
    providerEventId: eventId,
    eventType,
    providerMessageId,
    occurredAt,
    payload: payload as Record<string, unknown>,
    status: status ?? null,
  });

  if (result.outcome === 'duplicate') {
    // Idempotency: the unique index already held this event. A retry is a successful no-op, and
    // crucially no app_event is emitted a second time.
    return c.json({ success: true, data: { outcome: 'duplicate', eventType } });
  }

  // Meaningful failures are surfaced ONCE — this line is only reachable for a first-seen event.
  if (status && NOTEWORTHY.has(status) && result.deliveryId) {
    void emitAppEvent({
      eventType: `platform.email.${status}`,
      sourceModule: 'platform', sourceEntityType: 'email_delivery', sourceEntityId: result.deliveryId,
      actorUserId: null, severity: status === 'failed' ? 'warning' : 'critical',
      payload: { providerMessageId, eventType, recipient: result.recipient },
    });
  }

  return c.json({
    success: true,
    data: { outcome: result.outcome, eventType, deliveryId: result.deliveryId, statusApplied: result.statusApplied },
  });
});

export default router;
