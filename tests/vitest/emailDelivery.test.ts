/**
 * Unit coverage for the canonical email path: configuration validation and result
 * classification.
 *
 * The provider SDK is mocked, so nothing here can send mail. What it proves is the half that
 * used to be duplicated three times and got it wrong: that a MISSING SENDER IS AN ERROR rather
 * than a silent fallback to an address nobody verified.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseSender, readEmailConfig } from '../../netlify/functions/lib/email/emailConfig';

// Hoisted so the dynamic `import('resend')` inside the transport resolves to this mock.
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: class { emails = { send: sendMock }; },
}));

const GOOD_ENV = {
  RESEND_API_KEY: 're_test_key_value',
  RESEND_FROM_EMAIL: 'Siomac <no-reply@example.com>',
} as NodeJS.ProcessEnv;

describe('parseSender', () => {
  it('parses a display name with an angle-bracketed address', () => {
    expect(parseSender('Siomac <no-reply@example.com>')).toEqual({
      formatted: 'Siomac <no-reply@example.com>', address: 'no-reply@example.com', name: 'Siomac',
    });
  });

  it('parses a bare address', () => {
    expect(parseSender('no-reply@example.com')).toEqual({
      formatted: 'no-reply@example.com', address: 'no-reply@example.com', name: null,
    });
  });

  it('strips quotes from a quoted display name', () => {
    expect(parseSender('"Siomac HR" <hr@example.com>')?.name).toBe('Siomac HR');
  });

  it.each(['', '   ', 'not-an-address', 'Siomac <not-an-address>', 'a@b', 'a@@b.com'])(
    'rejects %j rather than accepting an unusable sender', raw => {
      expect(parseSender(raw)).toBeNull();
    });
});

describe('readEmailConfig', () => {
  it('accepts a complete configuration', () => {
    const result = readEmailConfig(GOOD_ENV);
    expect(result.configured).toBe(true);
    if (!result.configured) return;
    expect(result.config.sender.address).toBe('no-reply@example.com');
    expect(result.config.replyTo).toBeNull();
  });

  it('⛔ does NOT fall back to a default sender when RESEND_FROM_EMAIL is unset', () => {
    // The regression this whole module exists for: three call sites defaulted to
    // `Siomac <no-reply@siomac.app>`, an address unverified on the account behind the key, so
    // every send was rejected by the provider. Absent config must be an ERROR, never a guess.
    const result = readEmailConfig({ RESEND_API_KEY: 're_test_key_value' } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(result.problems.map(p => p.variable)).toContain('RESEND_FROM_EMAIL');
    expect(JSON.stringify(result.problems)).not.toContain('siomac.app');
  });

  it('reports a missing API key', () => {
    const result = readEmailConfig({ RESEND_FROM_EMAIL: 'a@example.com' } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(result.problems.map(p => p.variable)).toContain('RESEND_API_KEY');
  });

  it('rejects a key that is not shaped like a Resend key', () => {
    const result = readEmailConfig({ ...GOOD_ENV, RESEND_API_KEY: 'sk_live_something' });
    expect(result.configured).toBe(false);
  });

  it('reports EVERY problem at once, not just the first', () => {
    const result = readEmailConfig({} as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(result.problems).toHaveLength(2);
  });

  it('never returns the credential in a problem message', () => {
    const result = readEmailConfig({ RESEND_API_KEY: 'wrong_prefix_abc123secret' } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(JSON.stringify(result.problems)).not.toContain('abc123secret');
  });
});

describe('sendEmail', () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    process.env = { ...ORIGINAL, ...GOOD_ENV };
  });
  afterEach(() => { process.env = ORIGINAL; });

  const load = async () => (await import('../../netlify/functions/lib/email/emailService')).sendEmail;

  it('sends through the transport and returns the resolved sender', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const sendEmail = await load();
    const result = await sendEmail({ to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerMessageId).toBe('msg_1');
    expect(result.sender).toBe('Siomac <no-reply@example.com>');
    expect(result.dryRun).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({ from: 'Siomac <no-reply@example.com>', to: ['someone@example.com'] });
  });

  it('classifies a missing configuration as not_configured and never calls the transport', async () => {
    process.env = { ...ORIGINAL, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' };
    const sendEmail = await load();
    const result = await sendEmail({ to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_configured');
    expect(result.problems?.length).toBeGreaterThan(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('classifies a provider rejection as transport_error, distinct from not_configured', async () => {
    // The distinction payslip delivery depends on: not_configured => skipped (nothing tried),
    // transport_error => failed (tried and rejected).
    sendMock.mockResolvedValue({ data: null, error: { message: 'The example.com domain is not verified' } });
    const sendEmail = await load();
    const result = await sendEmail({ to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('transport_error');
    expect(result.message).toContain('not verified');
  });

  it('treats a thrown transport error as transport_error rather than escaping', async () => {
    sendMock.mockRejectedValue(new Error('socket hang up'));
    const sendEmail = await load();
    const result = await sendEmail({ to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('transport_error');
  });

  it('rejects an invalid recipient by name, without calling the transport', async () => {
    const sendEmail = await load();
    const result = await sendEmail({ to: 'nope', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_recipient');
    expect(result.message).toContain('nope');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('de-duplicates recipients case-insensitively', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_2' }, error: null });
    const sendEmail = await load();
    const result = await sendEmail({ to: ['A@example.com', 'a@example.com'], subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipients).toEqual(['A@example.com']);
  });

  it.each([
    ['subject', { to: 'a@example.com', subject: '   ', html: '<p>x</p>' }],
    ['body', { to: 'a@example.com', subject: 'Hi', html: '   ' }],
  ])('refuses a message with no %s', async (_label, message) => {
    const sendEmail = await load();
    const result = await sendEmail(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_message');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a dry run validates everything but transmits nothing', async () => {
    const sendEmail = await load();
    const result = await sendEmail({ to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>' }, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.sender).toBe('Siomac <no-reply@example.com>');
    expect(result.providerMessageId).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a dry run still reports a configuration problem rather than passing', async () => {
    process.env = { ...ORIGINAL, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' };
    const sendEmail = await load();
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>' }, { dryRun: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_configured');
  });

  it('passes attachments through in the provider\'s shape', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_3' }, error: null });
    const sendEmail = await load();
    await sendEmail({
      to: 'a@example.com', subject: 'Payslip', html: '<p>x</p>',
      attachments: [{ filename: 'p.pdf', contentBase64: 'QUJD', contentType: 'application/pdf' }],
    });
    expect(sendMock.mock.calls[0]?.[0].attachments).toEqual([
      { filename: 'p.pdf', content: 'QUJD', contentType: 'application/pdf' },
    ]);
  });
});

describe('emailDeliveryStatusFor — what an attempt is RECORDED as', () => {
  // The invariant, proven directly rather than inferred from a live send: `sent` is reachable
  // ONLY from an accepted result, so a provider rejection can never be recorded as a delivery.
  const load = async () => (await import('../../netlify/functions/lib/notify')).emailDeliveryStatusFor;

  it('records an accepted send as sent', async () => {
    const fn = await load();
    expect(fn({ ok: true, providerMessageId: 'm1', sender: 's', transport: 'resend', recipients: ['a@b.com'], dryRun: false })).toBe('sent');
  });

  it('records missing configuration as skipped — nothing was transmitted', async () => {
    const fn = await load();
    expect(fn({ ok: false, reason: 'not_configured', message: 'x' })).toBe('skipped');
  });

  it.each(['transport_error', 'invalid_recipient', 'invalid_message'] as const)(
    'records %s as failed, never as sent', async reason => {
      const fn = await load();
      expect(fn({ ok: false, reason, message: 'x' })).toBe('failed');
    });

  it('has NO path from a rejected result to sent', async () => {
    const fn = await load();
    const rejections = (['not_configured', 'transport_error', 'invalid_recipient', 'invalid_message'] as const)
      .map(reason => fn({ ok: false, reason, message: 'x' }));
    expect(rejections).not.toContain('sent');
  });
});

describe('getEmailDeliveryStatus', () => {
  const ORIGINAL = process.env;
  beforeEach(() => { vi.resetModules(); process.env = { ...ORIGINAL, ...GOOD_ENV }; });
  afterEach(() => { process.env = ORIGINAL; });

  const load = async () => (await import('../../netlify/functions/lib/email/emailService')).getEmailDeliveryStatus;

  it('reports the resolved sender and never the credential', async () => {
    const status = (await load())();
    expect(status.configured).toBe(true);
    expect(status.sender?.address).toBe('no-reply@example.com');
    expect(status.transport).toBe('resend');
    expect(JSON.stringify(status)).not.toContain('re_test_key_value');
  });

  it('reports the named variables at fault when unconfigured, with a null sender', async () => {
    process.env = { ...ORIGINAL, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' };
    const status = (await load())();
    expect(status.configured).toBe(false);
    expect(status.sender).toBeNull();
    expect(status.problems.map(p => p.variable).sort()).toEqual(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  });
});
