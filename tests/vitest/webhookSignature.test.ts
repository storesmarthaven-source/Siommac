/**
 * Svix/Resend webhook signature verification.
 *
 * Pure crypto, so every property that matters is provable here without a provider, a network or a
 * database: fail-closed on a missing secret, raw-body sensitivity, the replay window in both
 * directions, and rotation support.
 */
import { describe, expect, it } from 'vitest';
import {
  signWebhookPayload, verifyWebhookSignature, WEBHOOK_TOLERANCE_SECONDS,
} from '../../netlify/functions/lib/email/webhookSignature';

const SECRET = 'whsec_dGVzdHNlY3JldHRlc3RzZWNyZXR0ZXN0c2VjcmV0';
const ID = 'msg_2abc';
const NOW = 1_800_000_000;
const TS = String(NOW);
const RAW = '{"type":"email.delivered","data":{"email_id":"abc-123"}}';

const headersFor = (rawBody: string, id = ID, ts = TS, secret = SECRET) => ({
  id, timestamp: ts,
  signature: `v1,${signWebhookPayload(secret, id, ts, rawBody)}`,
});

const verify = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({
    secret: SECRET, headers: headersFor(RAW), rawBody: RAW, nowSeconds: NOW, ...over,
  });

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('⛔ fails CLOSED when no secret is configured', () => {
    // An unconfigured secret must never mean "accept anything": this endpoint is public and
    // writes provider-attributed state.
    expect(verify({ secret: undefined })).toEqual({ ok: false, reason: 'no_secret_configured' });
    expect(verify({ secret: '   ' })).toEqual({ ok: false, reason: 'no_secret_configured' });
  });

  it('rejects a payload signed with a DIFFERENT secret', () => {
    const other = 'whsec_b3RoZXJzZWNyZXRvdGhlcnNlY3JldG90aGVy';
    expect(verify({ headers: headersFor(RAW, ID, TS, other) })).toEqual({ ok: false, reason: 'no_signature_match' });
  });

  it.each([
    ['id', { id: null }],
    ['timestamp', { timestamp: null }],
    ['signature', { signature: null }],
  ])('rejects a request missing the svix-%s header', (_label, patch) => {
    expect(verify({ headers: { ...headersFor(RAW), ...patch } })).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('⭐ rejects when the body differs by a single byte — the raw-body guarantee', () => {
    // This is the property that makes raw-body plumbing worth the trouble: re-serialising a
    // parsed object (key order, spacing) changes the bytes and must NOT verify.
    expect(verify({ rawBody: RAW + ' ' })).toEqual({ ok: false, reason: 'no_signature_match' });
    const reserialised = JSON.stringify(JSON.parse(RAW), null, 2);
    expect(verify({ rawBody: reserialised })).toEqual({ ok: false, reason: 'no_signature_match' });
  });

  it('binds the signature to the svix-id, so an id cannot be swapped', () => {
    expect(verify({ headers: { ...headersFor(RAW), id: 'msg_other' } })).toEqual({ ok: false, reason: 'no_signature_match' });
  });

  it('rejects a timestamp that is not a number', () => {
    expect(verify({ headers: { ...headersFor(RAW), timestamp: 'not-a-number' } })).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('rejects a replay older than the tolerance window', () => {
    const old = String(NOW - WEBHOOK_TOLERANCE_SECONDS - 1);
    expect(verify({ headers: headersFor(RAW, ID, old), nowSeconds: NOW }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects a FUTURE timestamp beyond tolerance too', () => {
    // A far-future timestamp is as suspicious as an expired one; tolerance is absolute.
    const future = String(NOW + WEBHOOK_TOLERANCE_SECONDS + 1);
    expect(verify({ headers: headersFor(RAW, ID, future), nowSeconds: NOW }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('accepts a timestamp at the edge of the window', () => {
    const edge = String(NOW - WEBHOOK_TOLERANCE_SECONDS);
    expect(verify({ headers: headersFor(RAW, ID, edge), nowSeconds: NOW })).toEqual({ ok: true });
  });

  it('accepts when ANY presented signature matches — secret rotation', () => {
    const good = signWebhookPayload(SECRET, ID, TS, RAW);
    expect(verify({ headers: { id: ID, timestamp: TS, signature: `v1,bogus v1,${good}` } })).toEqual({ ok: true });
  });

  it('ignores signature versions it does not implement rather than assuming compatibility', () => {
    const good = signWebhookPayload(SECRET, ID, TS, RAW);
    expect(verify({ headers: { id: ID, timestamp: TS, signature: `v2,${good}` } }))
      .toEqual({ ok: false, reason: 'no_signature_match' });
  });

  it('does not throw on a malformed signature header', () => {
    for (const signature of ['', 'garbage', 'v1', 'v1,', ',,,']) {
      expect(() => verify({ headers: { id: ID, timestamp: TS, signature } })).not.toThrow();
    }
  });
});
