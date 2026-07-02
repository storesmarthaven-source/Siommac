'use strict';

// The sliding-window algorithm now lives in the rate_limit_check Postgres RPC
// (supabase/migrations/20260714000012_rate_limit_hits.sql) — shared across every
// Lambda container, replacing the old in-process Map that reset on cold start.
// This test mocks `sb` and verifies ratelimit.ts's wrapper: it calls the RPC with
// the right key/window/max, maps the RPC's { allowed, retry_after_secs } shape to
// { ok, retryAfter }, calls the right delete on reset(), and fails OPEN (never
// blocks the request) if the RPC itself errors.

jest.mock('../../netlify/functions/lib/db', () => ({
  sb: { rpc: jest.fn(), from: jest.fn() },
}));

const { sb } = jest.requireMock('../../netlify/functions/lib/db');
const { rateLimit } = require('../../netlify/functions/lib/ratelimit');

function mockRpcResult(result) {
  sb.rpc.mockReturnValue({ single: () => Promise.resolve(result) });
}

describe('rateLimit — DB-backed wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allowed=true maps to { ok: true }', async () => {
    mockRpcResult({ data: { allowed: true, retry_after_secs: 0 }, error: null });
    const { check } = rateLimit({ max: 3, windowMs: 60000, prefix: 'test-allow' });
    const result = await check('1.2.3.4');
    expect(result).toEqual({ ok: true });
  });

  test('allowed=false maps to { ok: false, retryAfter }', async () => {
    mockRpcResult({ data: { allowed: false, retry_after_secs: 42 }, error: null });
    const { check } = rateLimit({ max: 2, windowMs: 60000, prefix: 'test-block' });
    const result = await check('10.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBe(42);
  });

  test('calls the RPC with the prefixed key, window, and max', async () => {
    mockRpcResult({ data: { allowed: true, retry_after_secs: 0 }, error: null });
    const { check } = rateLimit({ max: 5, windowMs: 900000, prefix: 'login' });
    await check('192.168.1.1');
    expect(sb.rpc).toHaveBeenCalledWith('rate_limit_check', {
      p_key: 'login:192.168.1.1', p_window_ms: 900000, p_max: 5,
    });
  });

  test('handles a null IP gracefully (keys as "unknown")', async () => {
    mockRpcResult({ data: { allowed: true, retry_after_secs: 0 }, error: null });
    const { check } = rateLimit({ max: 5, windowMs: 60000, prefix: 'test-null' });
    await expect(check(null)).resolves.toEqual({ ok: true });
    expect(sb.rpc).toHaveBeenCalledWith('rate_limit_check', expect.objectContaining({ p_key: 'test-null:unknown' }));
  });

  test('fails OPEN (does not block) when the RPC errors', async () => {
    mockRpcResult({ data: null, error: { message: 'connection reset' } });
    const { check } = rateLimit({ max: 1, windowMs: 60000, prefix: 'test-err' });
    const result = await check('5.5.5.5');
    expect(result.ok).toBe(true);
  });

  test('reset() deletes hits for the prefixed key', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    sb.from.mockReturnValue({ delete: del });

    const { reset } = rateLimit({ max: 1, windowMs: 60000, prefix: 'test-reset' });
    await reset('7.7.7.7');

    expect(sb.from).toHaveBeenCalledWith('rate_limit_hits');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('rl_key', 'test-reset:7.7.7.7');
  });
});
