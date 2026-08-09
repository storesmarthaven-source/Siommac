/**
 * lib/email/emailReconciliation.ts — what an operator needs to act on.
 *
 * ⛔ FIXED DESIGN CONSTRAINT: "stuck in sent" is GATED ON WEBHOOK CAPABILITY.
 *
 * Nothing can move a delivery past `sent` except a `delivered` webhook. In an environment where no
 * webhook has ever arrived — every environment until SIOMAC is publicly reachable — an ungated
 * sweep would report 100% of mail as stuck. That is the alert everyone mutes in week one and which
 * then misses the real thing, so it is not built that way: with no webhook capability the bucket
 * reports "delivery confirmation unavailable" instead of accusing every email of being stuck.
 *
 * `pending` and genuine `failed` are surfaced REGARDLESS — neither depends on a webhook to be
 * true, and both are real problems the moment they happen.
 */

import { sb } from '../db';
import { EMAIL_LIFECYCLE, type EmailDeliveryStatus } from './emailDeliveryRecord';

/** A delivery sitting in `pending` this long never reached the provider. */
const PENDING_STUCK_MINUTES = 15;
/** Only meaningful once webhooks work: accepted but never confirmed delivered. */
const SENT_UNCONFIRMED_HOURS = 24;
/** A provider-reported delay this old has stopped being transient. */
const DELAYED_STALE_HOURS = 24;

/**
 * Has this environment ever received a VERIFIED provider webhook?
 *
 * ⭐ The signal needs no new state: signature verification runs BEFORE the insert, so the mere
 * existence of a row in `email_delivery_events` is proof a genuine verified webhook arrived. The
 * same query answers "last webhook received" for the settings surface.
 */
export interface WebhookCapability {
  everReceived: boolean;
  lastReceivedAt: string | null;
  lastEventType: string | null;
}

export async function getWebhookCapability(): Promise<WebhookCapability> {
  const { data, error } = await sb.from('email_delivery_events')
    .select('received_at, event_type').order('received_at', { ascending: false }).limit(1);
  if (error) throw Object.assign(new Error(`Webhook capability check failed: ${error.message}`), { status: 500 });
  const row = (data ?? [])[0] as { received_at: string; event_type: string } | undefined;
  return {
    everReceived: !!row,
    lastReceivedAt: row?.received_at ?? null,
    lastEventType: row?.event_type ?? null,
  };
}

export interface ReconciliationEntry {
  id: string;
  moduleKey: string;
  useCase: string;
  recipient: string;
  subject: string;
  status: EmailDeliveryStatus;
  queuedAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  /** Whether re-sending this delivery is permitted. See RETRYABLE below. */
  retryable: boolean;
}

export interface UnmatchedEvent {
  id: string;
  eventType: string;
  providerMessageId: string | null;
  receivedAt: string;
  occurredAt: string | null;
}

export interface ReconciliationReport {
  webhook: WebhookCapability;
  /** Never reached the provider. Real regardless of webhook readiness. */
  stuckPending: ReconciliationEntry[];
  /** Provider-reported delay that has gone stale. */
  staleDelayed: ReconciliationEntry[];
  /** Rejected by the provider — retryable. */
  failed: ReconciliationEntry[];
  /**
   * Accepted but never confirmed delivered.
   *
   * `available: false` means this environment cannot know — no webhook has ever been received, so
   * an empty list here is NOT evidence of health and is deliberately not presented as such.
   */
  unconfirmedSent: {
    available: boolean;
    reason: string | null;
    entries: ReconciliationEntry[];
  };
  /** Provider events that matched no delivery — an integration fault worth a human look. */
  unmatchedEvents: UnmatchedEvent[];
  thresholds: { pendingStuckMinutes: number; sentUnconfirmedHours: number; delayedStaleHours: number };
}

/**
 * States a re-send is permitted from.
 *
 * ⛔ `bounced` and `complained` are ABSENT and must stay absent. A bounce means the address
 * rejected the mail — retrying earns a worse sender reputation. A complaint means the recipient
 * marked it as spam; mailing them again is the single most damaging thing a sender can do. Neither
 * is retried automatically OR manually through this path.
 */
const RETRYABLE = new Set<EmailDeliveryStatus>(['pending', 'failed', 'delayed']);

export const isRetryableStatus = (status: EmailDeliveryStatus): boolean => RETRYABLE.has(status);

const SELECT = 'id, module_key, use_case, recipient, subject, status, queued_at, sent_at, ' +
  'error_message, provider_message_id, source_entity_type, source_entity_id';

type Row = {
  id: string; module_key: string; use_case: string; recipient: string; subject: string;
  status: EmailDeliveryStatus; queued_at: string; sent_at: string | null; error_message: string | null;
  provider_message_id: string | null; source_entity_type: string | null; source_entity_id: string | null;
};

const toEntry = (r: Row): ReconciliationEntry => ({
  id: r.id, moduleKey: r.module_key, useCase: r.use_case, recipient: r.recipient, subject: r.subject,
  status: r.status, queuedAt: r.queued_at, sentAt: r.sent_at, errorMessage: r.error_message,
  providerMessageId: r.provider_message_id, sourceEntityType: r.source_entity_type,
  sourceEntityId: r.source_entity_id, retryable: isRetryableStatus(r.status),
});

const agoISO = (ms: number): string => new Date(Date.now() - ms).toISOString();

export async function buildReconciliationReport(limit = 100): Promise<ReconciliationReport> {
  const webhook = await getWebhookCapability();

  const query = (status: EmailDeliveryStatus, column: string, olderThanISO: string) =>
    sb.from('email_deliveries').select(SELECT)
      .eq('status', status).lt(column, olderThanISO)
      .order(column, { ascending: true }).limit(limit);

  const [pendingRes, delayedRes, failedRes, unmatchedRes] = await Promise.all([
    query('pending', 'queued_at', agoISO(PENDING_STUCK_MINUTES * 60_000)),
    query('delayed', 'queued_at', agoISO(DELAYED_STALE_HOURS * 3_600_000)),
    // Failures are listed whatever their age: an operator should see a rejection immediately.
    sb.from('email_deliveries').select(SELECT).eq('status', 'failed')
      .order('queued_at', { ascending: false }).limit(limit),
    sb.from('email_delivery_events')
      .select('id, event_type, provider_message_id, received_at, occurred_at')
      .is('delivery_id', null).order('received_at', { ascending: false }).limit(limit),
  ]);

  for (const r of [pendingRes, delayedRes, failedRes, unmatchedRes]) {
    // A swallowed read here would present an EMPTY reconciliation report — which reads exactly
    // like "everything is healthy". Fail loudly instead.
    if (r.error) throw Object.assign(new Error(`Reconciliation read failed: ${r.error.message}`), { status: 500 });
  }

  // ── the gated bucket ──────────────────────────────────────────────────────
  let unconfirmedSent: ReconciliationReport['unconfirmedSent'];
  if (!webhook.everReceived) {
    unconfirmedSent = {
      available: false,
      reason: 'Delivery confirmation unavailable — webhook not active. Nothing can confirm delivery in this environment, so accepted mail is not reported as stuck.',
      entries: [],
    };
  } else {
    const { data, error } = await query('sent', 'sent_at', agoISO(SENT_UNCONFIRMED_HOURS * 3_600_000));
    if (error) throw Object.assign(new Error(`Reconciliation read failed: ${error.message}`), { status: 500 });
    unconfirmedSent = { available: true, reason: null, entries: ((data ?? []) as unknown as Row[]).map(toEntry) };
  }

  return {
    webhook,
    stuckPending: ((pendingRes.data ?? []) as unknown as Row[]).map(toEntry),
    staleDelayed: ((delayedRes.data ?? []) as unknown as Row[]).map(toEntry),
    failed: ((failedRes.data ?? []) as unknown as Row[]).map(toEntry),
    unconfirmedSent,
    unmatchedEvents: ((unmatchedRes.data ?? []) as unknown as Array<{
      id: string; event_type: string; provider_message_id: string | null; received_at: string; occurred_at: string | null;
    }>).map(e => ({
      id: e.id, eventType: e.event_type, providerMessageId: e.provider_message_id,
      receivedAt: e.received_at, occurredAt: e.occurred_at,
    })),
    thresholds: {
      pendingStuckMinutes: PENDING_STUCK_MINUTES,
      sentUnconfirmedHours: SENT_UNCONFIRMED_HOURS,
      delayedStaleHours: DELAYED_STALE_HOURS,
    },
  };
}

/**
 * A safe, non-identifying health summary for the settings surface.
 *
 * Counts only — no recipients, no subjects, no error text. The settings page is a configuration
 * screen, not a mail log, and it is visible to anyone holding `settings.system.view`.
 */
export interface DeliveryHealth {
  windowHours: number;
  total: number;
  byStatus: Record<EmailDeliveryStatus, number>;
  /** Null when the environment cannot know — see the webhook gate. */
  deliveryConfirmationAvailable: boolean;
}

export async function getDeliveryHealth(windowHours = 24): Promise<DeliveryHealth> {
  const since = agoISO(windowHours * 3_600_000);
  const [{ data, error }, webhook] = await Promise.all([
    sb.from('email_deliveries').select('status').gte('queued_at', since),
    getWebhookCapability(),
  ]);
  if (error) throw Object.assign(new Error(`Delivery health read failed: ${error.message}`), { status: 500 });

  const byStatus = Object.fromEntries(EMAIL_LIFECYCLE.map(s => [s, 0])) as Record<EmailDeliveryStatus, number>;
  for (const row of (data ?? []) as { status: EmailDeliveryStatus }[]) {
    if (row.status in byStatus) byStatus[row.status] += 1;
  }
  return {
    windowHours,
    total: (data ?? []).length,
    byStatus,
    deliveryConfirmationAvailable: webhook.everReceived,
  };
}
