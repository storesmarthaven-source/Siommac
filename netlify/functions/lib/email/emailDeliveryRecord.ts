/**
 * lib/email/emailDeliveryRecord.ts — the authoritative record of every production email.
 *
 * One row in `email_deliveries` per email SIOMAC attempts, whatever module asked for it. This is
 * what makes the audit question answerable: what was attempted, for which business operation, to
 * whom, when, through which provider, with which provider message id, and how far it got.
 *
 * ⭐ THE LIFECYCLE IS MONOTONIC. `status` is the FURTHEST point an email reached, and each moment
 * has its own write-once timestamp. Provider webhooks arrive late, duplicated and out of order, so
 * a `sent` event landing after a `delivered` event must not drag the record backwards — it records
 * its timestamp and leaves `status` alone. Without that rule the audit trail would report whatever
 * event happened to arrive last rather than what actually happened.
 */

import { sb } from '../db';

/** Lifecycle points, ordered. Index = how far the email got. */
export const EMAIL_LIFECYCLE = [
  'pending', 'skipped', 'failed', 'bounced', 'complained', 'delayed', 'sent', 'delivered',
] as const;
export type EmailDeliveryStatus = typeof EMAIL_LIFECYCLE[number];

/**
 * Rank for the monotonic rule.
 *
 * `delivered` outranks everything: it is the only status set from verified provider evidence.
 * The terminal negatives (`bounced`, `complained`) outrank `sent` deliberately — a message the
 * provider accepted and then bounced is BOUNCED, and a late `sent` webhook must never overwrite
 * that. `delayed` sits below `sent` so a retry that succeeds supersedes it.
 */
const RANK: Record<EmailDeliveryStatus, number> = {
  pending: 0, skipped: 1, failed: 2, delayed: 3, sent: 4, bounced: 5, complained: 6, delivered: 7,
};

/** Column that stamps each lifecycle moment. `pending` uses queued_at, set on insert. */
const TIMESTAMP_COLUMN: Record<EmailDeliveryStatus, string> = {
  pending: 'queued_at', sent: 'sent_at', delivered: 'delivered_at', delayed: 'delayed_at',
  failed: 'failed_at', bounced: 'bounced_at', complained: 'complained_at', skipped: 'skipped_at',
};

/** Business context every email must carry. Required, so no email can be sent unrecorded. */
export interface EmailContext {
  /** Owning module, e.g. 'hr_onboarding', 'finance_payroll', 'platform'. */
  moduleKey: string;
  /** What this email IS, e.g. 'account_invite', 'payslip', 'notification', 'test_email'. */
  useCase: string;
  /**
   * ⛔ MUST be derived from content + the originating record — never random.
   * A random key can never dedupe, which makes the whole idempotency guarantee ceremony.
   */
  idempotencyKey: string;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  notificationId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EmailDeliveryRow {
  id: string;
  status: EmailDeliveryStatus;
  provider_message_id: string | null;
  idempotency_key: string;
  recipient: string;
  sender: string;
  sent_at: string | null;
  delivered_at: string | null;
}

const SELECT = 'id, status, provider_message_id, idempotency_key, recipient, sender, sent_at, delivered_at';

/** A delivery that already reached the provider must not be sent again. */
export const isAlreadyDelivered = (status: EmailDeliveryStatus): boolean =>
  RANK[status] >= RANK.sent;

export async function findDeliveryByIdempotencyKey(key: string): Promise<EmailDeliveryRow | null> {
  const { data, error } = await sb.from('email_deliveries').select(SELECT)
    .eq('idempotency_key', key).maybeSingle<EmailDeliveryRow>();
  // A read failure must NOT be treated as "no record exists" — that would turn an outage into a
  // duplicate email. The caller fails closed on null-with-error by propagating.
  if (error) throw Object.assign(new Error(`Delivery lookup failed: ${error.message}`), { status: 500 });
  return data ?? null;
}

/**
 * Open (or re-open) the delivery record for an attempt.
 *
 * Returns the existing row when the idempotency key is already known — a retry reuses its record
 * rather than creating a second one, so evidence never double-counts an email.
 */
export async function openDelivery(
  context: EmailContext,
  fields: { recipient: string; sender: string; replyTo: string | null; subject: string; provider: string },
): Promise<EmailDeliveryRow> {
  const existing = await findDeliveryByIdempotencyKey(context.idempotencyKey);
  if (existing) return existing;

  const { data, error } = await sb.from('email_deliveries').insert({
    module_key: context.moduleKey,
    use_case: context.useCase,
    idempotency_key: context.idempotencyKey,
    recipient: fields.recipient,
    sender: fields.sender,
    reply_to: fields.replyTo,
    subject: fields.subject,
    provider: fields.provider,
    status: 'pending',
    source_module: context.sourceModule ?? context.moduleKey,
    source_entity_type: context.sourceEntityType ?? null,
    source_entity_id: context.sourceEntityId ?? null,
    notification_id: context.notificationId ?? null,
    actor_user_id: context.actorUserId ?? null,
    metadata: context.metadata ?? {},
  }).select(SELECT).single<EmailDeliveryRow>();

  if (error) {
    // 23505 = another request opened the same key concurrently. Its row is the authority; read it
    // back rather than failing, so two racing senders converge on ONE delivery instead of one
    // erroring out and being retried into a duplicate.
    if ((error as { code?: string }).code === '23505') {
      const raced = await findDeliveryByIdempotencyKey(context.idempotencyKey);
      if (raced) return raced;
    }
    throw Object.assign(new Error(`Delivery record could not be opened: ${error.message}`), { status: 500 });
  }
  return data;
}

export interface WebhookRecordResult {
  /** `recorded` = first sight; `duplicate` = the unique index already had it; `unmatched` = no such delivery. */
  outcome: 'recorded' | 'duplicate' | 'unmatched';
  deliveryId: string | null;
  recipient: string | null;
  /** The status the delivery now holds — unchanged when the event was older than current state. */
  statusApplied: EmailDeliveryStatus | null;
}

/**
 * Record a verified provider event and apply it to its delivery.
 *
 * ⭐ IDEMPOTENCY IS THE UNIQUE INDEX, not a pre-check. Inserting FIRST and treating 23505 as
 * "already handled" is race-free; a select-then-insert would let two concurrent redeliveries both
 * see nothing and both transition the delivery. The database decides who was first.
 *
 * ⭐ An event whose message id matches no delivery is RETAINED with a null delivery_id and
 * reported as `unmatched`. It must never fall back to "closest" or "most recent" delivery —
 * attributing a bounce to the wrong email is worse than not attributing it at all — and
 * discarding it would hide a real integration fault from reconciliation.
 */
export async function recordWebhookEvent(args: {
  providerEventId: string;
  eventType: string;
  providerMessageId: string | null;
  occurredAt: string | null;
  payload: Record<string, unknown>;
  status: EmailDeliveryStatus | null;
}): Promise<WebhookRecordResult> {
  const delivery = args.providerMessageId
    ? await findDeliveryByProviderMessageId(args.providerMessageId)
    : null;

  const insert = await sb.from('email_delivery_events').insert({
    provider: 'resend',
    provider_event_id: args.providerEventId,
    event_type: args.eventType,
    provider_message_id: args.providerMessageId,
    delivery_id: delivery?.id ?? null,
    occurred_at: args.occurredAt,
    payload: args.payload,
  }).select('id').single<{ id: string }>();

  if (insert.error) {
    if ((insert.error as { code?: string }).code === '23505') {
      return {
        outcome: 'duplicate',
        deliveryId: delivery?.id ?? null,
        recipient: delivery?.recipient ?? null,
        statusApplied: delivery?.status ?? null,
      };
    }
    throw Object.assign(new Error(`Webhook event could not be recorded: ${insert.error.message}`), { status: 500 });
  }

  if (!delivery) {
    return { outcome: 'unmatched', deliveryId: null, recipient: null, statusApplied: null };
  }

  // Monotonic. A late `sent` after `delivered`, or a stale `delayed`, stamps its own timestamp
  // and leaves `status` where it is — the trail keeps every moment without letting arrival order
  // rewrite the outcome.
  let statusApplied: EmailDeliveryStatus = delivery.status;
  if (args.status) {
    const advanced = await advanceDelivery(delivery.id, args.status, { occurredAt: args.occurredAt });
    statusApplied = advanced.status;
  }

  return { outcome: 'recorded', deliveryId: delivery.id, recipient: delivery.recipient, statusApplied };
}

export async function findDeliveryByProviderMessageId(providerMessageId: string): Promise<EmailDeliveryRow | null> {
  const { data, error } = await sb.from('email_deliveries').select(SELECT)
    .eq('provider', 'resend').eq('provider_message_id', providerMessageId)
    .maybeSingle<EmailDeliveryRow>();
  if (error) throw Object.assign(new Error(`Delivery lookup failed: ${error.message}`), { status: 500 });
  return data ?? null;
}

/**
 * Advance a delivery to a lifecycle point.
 *
 * The timestamp for that point is ALWAYS stamped — history is recorded even when the status does
 * not move — but `status` only advances. `occurredAt` lets a webhook supply the provider's own
 * time instead of ours.
 */
export async function advanceDelivery(
  deliveryId: string,
  to: EmailDeliveryStatus,
  extra: {
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    occurredAt?: string | null;
  } = {},
): Promise<{ status: EmailDeliveryStatus; moved: boolean }> {
  const { data: current, error: readErr } = await sb.from('email_deliveries')
    .select('id, status').eq('id', deliveryId).maybeSingle<{ id: string; status: EmailDeliveryStatus }>();
  if (readErr) throw Object.assign(new Error(`Delivery read failed: ${readErr.message}`), { status: 500 });
  if (!current) throw Object.assign(new Error('Delivery not found.'), { status: 404 });

  const stampedAt = extra.occurredAt ?? new Date().toISOString();
  const patch: Record<string, unknown> = { [TIMESTAMP_COLUMN[to]]: stampedAt };

  // Monotonic: an out-of-order or duplicate event stamps its moment and leaves status alone.
  const moved = RANK[to] > RANK[current.status];
  if (moved) patch['status'] = to;

  // The provider id is filled in the first time it is known and never overwritten with null.
  if (extra.providerMessageId) patch['provider_message_id'] = extra.providerMessageId;
  if (extra.errorCode !== undefined) patch['error_code'] = extra.errorCode;
  if (extra.errorMessage !== undefined) patch['error_message'] = extra.errorMessage;

  const { error } = await sb.from('email_deliveries').update(patch).eq('id', deliveryId);
  if (error) throw Object.assign(new Error(`Delivery could not be advanced: ${error.message}`), { status: 500 });
  return { status: moved ? to : current.status, moved };
}
