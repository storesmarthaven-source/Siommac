'use strict';

const { rateLimit } = require('../../dist/netlify/functions/lib/ratelimit');

describe('rateLimit — sliding window', () => {
  test('allows requests below the limit', () => {
    const { check } = rateLimit({ max: 3, windowMs: 60000, prefix: 'test-allow' });
    expect(check('1.2.3.4').ok).toBe(true);
    expect(check('1.2.3.4').ok).toBe(true);
    expect(check('1.2.3.4').ok).toBe(true);
  });

  test('blocks on the N+1th request within the window', () => {
    const { check } = rateLimit({ max: 2, windowMs: 60000, prefix: 'test-block' });
    expect(check('10.0.0.1').ok).toBe(true);
    expect(check('10.0.0.1').ok).toBe(true);
    const result = check('10.0.0.1');
    expect(result.ok).toBe(false);
    expect(typeof result.retryAfter).toBe('number');
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test('different IPs have independent counters', () => {
    const { check } = rateLimit({ max: 1, windowMs: 60000, prefix: 'test-ip' });
    expect(check('192.168.1.1').ok).toBe(true);
    expect(check('192.168.1.1').ok).toBe(false);
    // Different IP is unaffected
    expect(check('192.168.1.2').ok).toBe(true);
  });

  test('requests expire after the window', async () => {
    const { check } = rateLimit({ max: 1, windowMs: 50, prefix: 'test-expire' });
    expect(check('5.5.5.5').ok).toBe(true);
    expect(check('5.5.5.5').ok).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    // After window expires the slot is free again
    expect(check('5.5.5.5').ok).toBe(true);
  });

  test('handles unknown/null IP gracefully', () => {
    const { check } = rateLimit({ max: 5, windowMs: 60000, prefix: 'test-null' });
    expect(() => check(null)).not.toThrow();
    expect(check(null).ok).toBe(true);
  });

  test('reset clears the counter for an IP', () => {
    const { check, reset } = rateLimit({ max: 1, windowMs: 60000, prefix: 'test-reset' });
    expect(check('7.7.7.7').ok).toBe(true);
    expect(check('7.7.7.7').ok).toBe(false);
    reset('7.7.7.7');
    // Counter cleared — should allow again
    expect(check('7.7.7.7').ok).toBe(true);
  });
});
