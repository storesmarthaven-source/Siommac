/**
 * lib/email/emailRetry.ts — one generic Retry action, dispatched to origin-specific handlers.
 *
 * ⛔ THE DELIVERY TABLE IS EVIDENCE, NOT A CONTENT STORE. Rendered HTML and attachments are
 * deliberately NOT persisted: doing so would create a second home for payslip content, invitation
 * links and other personal data, with its own retention and exposure problem. A retry therefore
 * RECONSTRUCTS the email from its authoritative business record.
 *
 * ⛔ A RETRY MUST NOT RE-RUN THE BUSINESS OPERATION. It rebuilds the message and sends it — it
 * does not mint tokens, create handoffs, write business rows or emit business events. Re-running
 * `provisionAccount` to "retry an invite" would revoke a live invitation and issue new
 * credentials as a side effect of a button labelled Retry.
 *
 * ⭐ The same SIOMAC idempotency key and the SAME delivery row are reused. No new key is created
 * merely because something is a retry — that is what keeps a retry from becoming a duplicate.
 */

import { sb } from '../db';
import { sendEmail } from './emailService';
import { isRetryableStatus, requiresOperatorDecision } from './emailReconciliation';
import type { EmailDeliveryStatus } from './emailDeliveryRecord';
import type { EmailMessage } from './emailTransport';

export type RetryRefusal =
  /** bounced / complained — terminal by policy, never re-sent. */
  | 'not_retryable_status'
  /** delayed — the provider already has it; a human must decide. */
  | 'requires_operator_decision'
  /** No origin handler is registered for this use case. */
  | 'no_handler'
  /** The originating record is gone, so there is nothing to reconstruct from. */
  | 'origin_missing'
  /** The origin exists but can no longer produce this email — a NEW business operation is needed. */
  | 'origin_invalid';

export type RetryResult =
  | { ok: true; deliveryId: string; providerMessageId: string | null; deduplicated: boolean }
  | { ok: false; refusal: RetryRefusal; message: string };

export interface DeliveryForRetry {
  id: string; module_key: string; use_case: string; idempotency_key: string;
  recipient: string; subject: string; status: EmailDeliveryStatus;
  notification_id: string | null; actor_user_id: string | null;
  source_module: string | null; source_entity_type: string | null; source_entity_id: string | null;
}

type HandlerOutcome =
  | { ok: true; message: EmailMessage }
  | { ok: false; refusal: RetryRefusal; message: string };

type RetryHandler = (delivery: DeliveryForRetry) => Promise<HandlerOutcome>;

const DELIVERY_COLUMNS =
  'id, module_key, use_case, idempotency_key, recipient, subject, status, ' +
  'notification_id, actor_user_id, source_module, source_entity_type, source_entity_id';

// ── Origin handlers ─────────────────────────────────────────────────────────────

/**
 * Notifications reconstruct cleanly: the notifications row holds every field the body was built
 * from, and rebuilding it creates no business side effect.
 */
const notificationHandler: RetryHandler = async delivery => {
  if (!delivery.notification_id) {
    return { ok: false, refusal: 'origin_missing', message: 'This delivery has no notification to rebuild from.' };
  }
  const { data, error } = await sb.from('notifications')
    .select('id, user_id, type, title, body, link, action_route, module, severity, source_type, source_id')
    .eq('id', delivery.notification_id)
    .maybeSingle<{
      id: string; user_id: string; type: string; title: string; body: string | null;
      link: string | null; action_route: string | null; module: string | null; severity: string | null;
      source_type: string | null; source_id: string | null;
    }>();
  if (error) throw Object.assign(new Error(`Notification lookup failed: ${error.message}`), { status: 500 });
  if (!data) {
    return { ok: false, refusal: 'origin_missing', message: 'The notification this email was built from no longer exists.' };
  }

  const { data: user } = await sb.from('app_users').select('full_name, email').eq('id', data.user_id)
    .maybeSingle<{ full_name: string | null; email: string | null }>();
  const companyName = await sb.from('settings').select('value').eq('key', 'companyName')
    .maybeSingle<{ value: string }>().then(r => r.data?.value ?? 'Siomac');

  const { buildNotificationEmailHtml } = await import('../notify.js');
  return {
    ok: true,
    message: {
      // The CURRENT address on the record, not the one captured at the time: a retry that mails a
      // corrected address is the whole point when the original bounced on a typo.
      to: user?.email ?? delivery.recipient,
      subject: data.title,
      html: buildNotificationEmailHtml(
        { userId: data.user_id, type: data.type, title: data.title, body: data.body ?? '', link: data.link ?? data.action_route ?? undefined },
        user?.full_name ?? 'there',
        companyName,
      ),
    },
  };
};

/**
 * ⛔ An onboarding invitation can NEVER be retried, and this is a property of the security design
 * rather than a gap.
 *
 * Only `token_hash` is persisted — the raw token exists exactly once, inside the email that was
 * sent. There is nothing to reconstruct the link from, and manufacturing a new token here would be
 * a silent credential reissue behind a button labelled Retry. So this refuses and names the real
 * action: Reissue Invitation, which is a new business operation with its own delivery record.
 */
const accountInviteHandler: RetryHandler = async delivery => {
  const employeeId = delivery.source_entity_id;
  if (!employeeId) {
    return { ok: false, refusal: 'origin_missing', message: 'This invitation delivery has no employee to reissue for.' };
  }
  const { data } = await sb.from('hr_onboarding_account_invites')
    .select('id, status, expires_at').eq('user_id', employeeId)
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle<{ id: string; status: string; expires_at: string }>();

  const detail = !data ? 'No invitation exists for this employee.'
    : data.status !== 'pending' ? `The invitation is ${data.status}.`
    : new Date(data.expires_at).getTime() < Date.now() ? 'The invitation has expired.'
    : 'The invitation is still valid.';

  return {
    ok: false,
    refusal: 'origin_invalid',
    message: `An invitation email cannot be re-sent: the invite token is stored only as a hash, so the link cannot be rebuilt. ${detail} Use Reissue Invitation, which issues a new token and creates a new delivery.`,
  };
};

/** The platform test email is static, so it rebuilds exactly. */
const testEmailHandler: RetryHandler = async delivery => ({
  ok: true,
  message: {
    to: delivery.recipient,
    subject: delivery.subject,
    html: `<p>This is a test of Siomac email delivery.</p><p>If you received it, the platform's outbound email is configured correctly.</p>`,
    text: 'This is a test of Siomac email delivery. If you received it, the platform\'s outbound email is configured correctly.',
  },
});

/**
 * Registry, keyed by `use_case`.
 *
 * An unregistered use case refuses with `no_handler` rather than guessing. That refusal is the
 * honest answer — offering Retry on something the backend cannot rebuild would be a control that
 * lies about what it does.
 *
 * ⬜ `payslip` is deliberately NOT registered yet: rebuilding it means re-rendering the
 * password-protected PDF from the immutable snapshot, which is real work and deserves its own
 * verification rather than being bolted on here.
 */
const HANDLERS: Record<string, RetryHandler> = {
  notification: notificationHandler,
  account_invite: accountInviteHandler,
  test_email: testEmailHandler,
};

// ── The generic action ──────────────────────────────────────────────────────────

export async function retryDelivery(
  deliveryId: string,
  opts: { force?: boolean } = {},
): Promise<RetryResult> {
  const { data: delivery, error } = await sb.from('email_deliveries')
    .select(DELIVERY_COLUMNS).eq('id', deliveryId).maybeSingle<DeliveryForRetry>();
  if (error) throw Object.assign(new Error(`Delivery lookup failed: ${error.message}`), { status: 500 });
  if (!delivery) return { ok: false, refusal: 'origin_missing', message: 'Delivery not found.' };

  // ── status gate, before any reconstruction work ──
  if (requiresOperatorDecision(delivery.status) && !opts.force) {
    return {
      ok: false,
      refusal: 'requires_operator_decision',
      message: 'The provider already accepted this message and reported a delay, so re-sending risks delivering two copies. Wait for a final provider event, or confirm explicitly that a new send is necessary.',
    };
  }
  if (!isRetryableStatus(delivery.status) && !(requiresOperatorDecision(delivery.status) && opts.force)) {
    return {
      ok: false,
      refusal: 'not_retryable_status',
      message: `A delivery that is ${delivery.status} is not re-sent. A bounce means the address rejected it, and a complaint means the recipient marked it as spam — mailing either again causes real harm.`,
    };
  }

  const handler = HANDLERS[delivery.use_case];
  if (!handler) {
    return {
      ok: false,
      refusal: 'no_handler',
      message: `No retry handler is registered for "${delivery.use_case}", so this email cannot be rebuilt from its source.`,
    };
  }

  const rebuilt = await handler(delivery);
  if (!rebuilt.ok) return rebuilt;

  // ⭐ The SAME idempotency key, so sendEmail reuses the SAME delivery row. `failed` and `pending`
  // both rank below `sent`, so the short-circuit does not fire and the message really goes —
  // while anything that already reached the provider still refuses to send twice.
  const result = await sendEmail(rebuilt.message, {
    moduleKey: delivery.module_key,
    useCase: delivery.use_case,
    idempotencyKey: delivery.idempotency_key,
    sourceModule: delivery.source_module,
    sourceEntityType: delivery.source_entity_type,
    sourceEntityId: delivery.source_entity_id,
    notificationId: delivery.notification_id,
    actorUserId: delivery.actor_user_id,
  });

  if (!result.ok) {
    return { ok: false, refusal: 'origin_invalid', message: result.message };
  }
  return {
    ok: true,
    deliveryId: result.deliveryId ?? delivery.id,
    providerMessageId: result.providerMessageId,
    deduplicated: result.deduplicated,
  };
}
