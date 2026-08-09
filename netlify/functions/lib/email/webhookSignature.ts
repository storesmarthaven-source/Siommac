/**
 * lib/email/webhookSignature.ts — Svix (Resend) webhook signature verification.
 *
 * Resend signs webhooks with Svix. The signature is computed over the RAW request body, so this
 * module takes the untouched text and never an object: re-serialising a parsed payload produces a
 * different string (key order, spacing, unicode escaping) and would reject every genuine call
 * while accepting nothing — a verification that fails closed on real traffic and teaches everyone
 * to disable it.
 *
 * Scheme:
 *   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   expected      = base64( HMAC-SHA256( base64decode(secret without "whsec_"), signedContent ) )
 *   svix-signature = space-separated list of `v1,<signature>` — ANY may match, because Svix
 *                    sends multiple during a secret rotation.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Why a webhook was refused. Surfaced to logs, never to the caller in detail. */
export type WebhookVerificationFailure =
  | 'no_secret_configured'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'no_signature_match';

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: WebhookVerificationFailure };

/**
 * Replay window. Svix's own default is five minutes: a captured request older than that is
 * refused even with a valid signature, because a signature never expires on its own.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

const decodeSecret = (secret: string): Buffer =>
  Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');

/** Constant-time compare that cannot throw on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual REQUIRES equal lengths, so an unequal-length pair must short-circuit — but
  // only after both buffers exist, so the comparison itself stays constant-time for equal lengths.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function signWebhookPayload(secret: string, id: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', decodeSecret(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
}

/**
 * Verify a Svix-signed webhook.
 *
 * `nowSeconds` is injectable so the tolerance window can be tested without waiting or faking the
 * clock globally.
 */
export function verifyWebhookSignature(args: {
  secret: string | undefined;
  headers: SvixHeaders;
  rawBody: string;
  nowSeconds?: number;
}): WebhookVerificationResult {
  const secret = (args.secret ?? '').trim();
  // Fail CLOSED. An unconfigured secret must never mean "accept anything" — that would leave a
  // public endpoint writing provider-attributed state from any caller on the internet.
  if (!secret) return { ok: false, reason: 'no_secret_configured' };

  const { id, timestamp, signature } = args.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Both directions: a far-future timestamp is as suspicious as an expired one.
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = signWebhookPayload(secret, id, timestamp, args.rawBody);

  // Svix sends a space-separated list and may include several during a secret rotation, so ANY
  // match is a pass. Versions other than v1 are ignored rather than assumed compatible.
  const presented = signature.split(' ').map(part => part.trim()).filter(Boolean);
  for (const entry of presented) {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) continue;
    if (safeEqual(value, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no_signature_match' };
}
