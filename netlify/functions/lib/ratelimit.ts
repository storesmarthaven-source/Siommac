// Distributed sliding-window rate limiter, backed by the rate_limit_check Postgres
// RPC (see supabase/migrations/20260714000012_rate_limit_hits.sql). Shared across
// every Lambda container — unlike the old in-process Map, a cold start or scaling
// out to a new container no longer resets an attacker's count.

import type { RateLimitResult } from '../../../types/api';
import type { Context, Next } from 'hono';
import type { HonoVariables } from '../../../types/api';
import { sb } from './db';

interface RateLimitOptions {
  max:      number;
  windowMs: number;
  prefix?:  string;
}

interface RateLimiter {
  check: (ip: string | null) => Promise<RateLimitResult>;
  reset: (ip: string) => Promise<void>;
}

function rateLimit({ max, windowMs, prefix = 'rl' }: RateLimitOptions): RateLimiter {
  return {
    async check(ip: string | null): Promise<RateLimitResult> {
      // Dev/testing off-switch: set RATELIMIT_DISABLED=1 in .env to turn every limiter
      // off (e.g. while hammering auth / admin-security endpoints during manual testing).
      // Defaults to ON — the limiter is only bypassed when this is explicitly set, so it
      // can never be disabled by accident in a real deploy.
      if (process.env.RATELIMIT_DISABLED === '1') return { ok: true };
      const key = `${prefix}:${ip ?? 'unknown'}`;
      const { data, error } = await sb
        .rpc('rate_limit_check', { p_key: key, p_window_ms: windowMs, p_max: max })
        .single<{ allowed: boolean; retry_after_secs: number }>();

      if (error || !data) {
        // Fail OPEN on a limiter DB error — this is a defense-in-depth layer, not
        // the sole security boundary (every gated route already has its own
        // requireUser/requireRole/requirePermission check). A limiter outage is
        // very likely correlated with a broader DB outage, in which case the
        // underlying business operation will fail on its own regardless — failing
        // closed here would just turn a transient DB blip into an app-wide login/
        // 2FA lockout for every user, which is a worse outcome than the rare
        // window of unbounded rate limiting during that same outage.
        console.error('[ratelimit] rate_limit_check RPC failed — failing open', { key, error: error?.message });
        return { ok: true };
      }

      return data.allowed
        ? { ok: true }
        : { ok: false, retryAfter: data.retry_after_secs };
    },
    async reset(ip: string): Promise<void> {
      const key = `${prefix}:${ip}`;
      const { error } = await sb.from('rate_limit_hits').delete().eq('rl_key', key);
      if (error) console.warn('[ratelimit] reset failed', { key, error: error.message });
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

  const result = await checkGlobalLimit.check(ip);
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
