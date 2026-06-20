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

export { rateLimit, checkLoginLimit, checkGlobalLimit, globalRateLimitMiddleware };
