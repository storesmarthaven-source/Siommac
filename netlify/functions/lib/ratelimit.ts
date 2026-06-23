// Lightweight in-process sliding-window rate limiter.
// Not distributed — resets on cold start. Sufficient for Lambda: each cold start
// represents a new IP connection, and Netlify already enforces concurrent limits.

import type { RateLimitResult } from '../../../types/api';
import type { Context, Next } from 'hono';
import type { HonoVariables } from '../../../types/api';

const _windows = new Map<string, number[]>();  // key → [timestamp, ...]

interface RateLimitOptions {
  max:      number;
  windowMs: number;
  prefix?:  string;
}

interface RateLimiter {
  check: (ip: string | null) => RateLimitResult;
  reset: (ip: string) => void;
}

function rateLimit({ max, windowMs, prefix = 'rl' }: RateLimitOptions): RateLimiter {
  return {
    check(ip: string | null): RateLimitResult {
      const key    = `${prefix}:${ip ?? 'unknown'}`;
      const now    = Date.now();
      const cutoff = now - windowMs;

      let hits = _windows.get(key) ?? [];
      hits = hits.filter(t => t > cutoff);

      if (hits.length >= max) {
        const retryAfter = Math.ceil(((hits[0] ?? now) - cutoff) / 1000);
        return { ok: false, retryAfter };
      }

      hits.push(now);
      _windows.set(key, hits);
      return { ok: true };
    },
    reset(ip: string): void {
      _windows.delete(`${prefix}:${ip}`);
    },
  };
}

// 5 failed attempts per 15 minutes per IP on the login route
const checkLoginLimit = rateLimit({ max: 5, windowMs: 15 * 60 * 1000, prefix: 'login' });

// 200 requests per minute per IP globally
const checkGlobalLimit = rateLimit({ max: 200, windowMs: 60 * 1000, prefix: 'global' });

// ── Shared auth-route limiters ─────────────────────────────────────────────────

// Authenticated code/assertion-verifying or sensitive mutations: 10 per 15 min keyed by userId.
// Applied to: /auth/2fa/confirm, /auth/2fa/disable, /auth/2fa/backup-codes/regenerate,
//             /webauthn/register/verify, /webauthn/credentials/delete,
//             /auth/trusted-devices/revoke, /auth/trusted-devices/revoke-all,
//             /admin/security/users/passkeys/revoke-all,
//             /admin/security/users/trusted-devices/revoke-all,
//             /auth/password/change (already keyed by IP; this is a complementary userId key).
const checkAuthMutationLimit = rateLimit({ max: 10, windowMs: 15 * 60 * 1000, prefix: 'auth_mut' });

// Tighter brute-force-sensitive verify endpoints: 5 per 15 min keyed by userId.
// Applied to: /auth/step-up/verify, /verify2fa, /confirm2faSetup.
const checkCodeVerifyLimit = rateLimit({ max: 5, windowMs: 15 * 60 * 1000, prefix: 'code_verify' });

// Loose limiter for read-only security endpoints: 60 per 15 min keyed by userId.
// Applied to: /auth/2fa/status, /auth/2fa/setup, /auth/step-up/options,
//             /webauthn/register/options, /webauthn/credentials/list,
//             /webauthn/credentials/rename, /auth/trusted-devices/list,
//             /admin/security/users/status, /auth/security/policy.
const checkAuthReadLimit = rateLimit({ max: 60, windowMs: 15 * 60 * 1000, prefix: 'auth_read' });

// Hono middleware: enforces the global rate limit and attaches client IP to context.
async function globalRateLimitMiddleware(
  c: Context<{ Variables: HonoVariables }>,
  next: Next,
): Promise<Response | void> {
  const ip =
    c.req.header('x-nf-client-connection-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  c.set('clientIp', ip);

  const result = checkGlobalLimit.check(ip);
  if (!result.ok) {
    return c.json({ success: false, message: 'Rate limit exceeded. Try again later.' }, 429);
  }
  await next();
}

export {
  rateLimit,
  checkLoginLimit,
  checkGlobalLimit,
  globalRateLimitMiddleware,
  checkAuthMutationLimit,
  checkCodeVerifyLimit,
  checkAuthReadLimit,
};
