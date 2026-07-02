// routes/authStepUp.ts — Step-up authentication endpoints (Phase B4a)
//
// High-risk routes require a *recent* MFA verification even when the session
// is already authenticated.  This route group lets the client:
//   1. Discover which factor methods are available   (OPTIONS)
//   2. Verify a factor and get a fresh token         (VERIFY)
//
// On step-up success a new access token is re-issued with a fresh `mfaVerifiedAt`
// claim.  The frontend replaces its stored token with this one.
//
// Backup codes are NOT accepted for step-up (recovery ≠ assurance).
//
// Mounted at /api/auth/step-up/* in api.ts.

import { Hono }       from 'hono';
import { z }          from 'zod';
import { requireUser, signUser } from '../lib/auth';
import { checkCodeVerifyLimit, checkAuthReadLimit } from '../lib/ratelimit';
import { verifyCode }            from '../lib/totp';
import {
  generateAuthenticationOptions,
  verifyAuthentication,
} from '../lib/webauthn';
import { emitAppEvent }          from '../lib/appEvents';
import { sb }                    from '../lib/db';
import { zv }                    from '../lib/validate';
import type { HonoVariables }    from '../../../types/api';
import type { AppUser }          from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const VerifySchema = z.object({
  method:   z.enum(['totp', 'webauthn']),
  code:     z.string().optional(),      // required when method = totp
  response: z.unknown().optional(),     // required when method = webauthn (AuthenticationResponseJSON)
});

// ── POST /api/auth/step-up/options ────────────────────────────────────────────
// Returns available factor methods for the calling user.
// The client uses this to decide whether to show a TOTP input, passkey prompt,
// or both.

router.post('/options', async c => {
  const user = await requireUser(c);
  const rl = await checkAuthReadLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }

  // Check TOTP
  const totpAvailable = Boolean(user.totp_enabled && user.totp_secret);

  // Check passkeys: count enrolled credentials
  let webauthn: unknown | null = null;
  try {
    const { count } = await sb
      .from('webauthn_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Only expose webauthn options if the user has at least one credential.
    // (For a discoverable-credential / usernameless flow you'd omit this check,
    //  but step-up must be scoped to THIS user.)
    if ((count ?? 0) > 0) {
      const { options } = await generateAuthenticationOptions(user.id);
      webauthn = options;
    }
  } catch {
    // best-effort — if webauthn options fail, fall back to TOTP only
  }

  return c.json({
    success:      true,
    totpAvailable,
    webauthn,
  });
});

// ── POST /api/auth/step-up/verify ─────────────────────────────────────────────
// Verify a factor and re-issue a fresh access token with updated mfaVerifiedAt.
// Returns { success: true, token } on success.

router.post('/verify', async c => {
  const user = await requireUser(c);
  const rl = await checkCodeVerifyLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, VerifySchema, body.args ?? body);
  if (!v.ok) return v.response;

  const { method, code, response: webauthnResponse } = v.data;

  if (method === 'totp') {
    // ── TOTP path ─────────────────────────────────────────────────────────────
    if (!user.totp_enabled || !user.totp_secret) {
      return c.json({ success: false, message: 'TOTP is not enabled on your account.' }, 400);
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return c.json({ success: false, message: 'A 6-digit TOTP code is required.' }, 400);
    }

    const ok = verifyCode(user.totp_secret, code);
    if (!ok) {
      void emitStepUpEvent(user, 'auth.step_up.failed', { method: 'totp' });
      return c.json({ success: false, message: 'Invalid code. Please try again.' }, 400);
    }

    const token = issueStepUpToken(user, 'otp');
    void emitStepUpEvent(user, 'auth.step_up.completed', { method: 'totp' });
    return c.json({ success: true, token });
  }

  // ── WebAuthn path ─────────────────────────────────────────────────────────
  if (!webauthnResponse) {
    return c.json({ success: false, message: 'WebAuthn response is required.' }, 400);
  }

  let result: Awaited<ReturnType<typeof verifyAuthentication>>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await verifyAuthentication(webauthnResponse as any);
  } catch (e) {
    const err = e as { message?: string };
    void emitStepUpEvent(user, 'auth.step_up.failed', { method: 'webauthn', error: err.message });
    return c.json({ success: false, message: err.message ?? 'WebAuthn verification failed.' }, 401);
  }

  // The passkey must belong to THIS user — prevent cross-user step-up
  if (result.user.id !== user.id) {
    void emitStepUpEvent(user, 'auth.step_up.failed', { method: 'webauthn', reason: 'user_mismatch' });
    return c.json({ success: false, message: 'Passkey does not belong to this account.' }, 401);
  }

  const token = issueStepUpToken(user, 'webauthn');
  void emitStepUpEvent(user, 'auth.step_up.completed', { method: 'webauthn' });
  return c.json({ success: true, token });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Re-issue a fresh access token with updated mfaVerifiedAt and mfaSatisfied. */
function issueStepUpToken(user: AppUser, factorMethod: 'otp' | 'webauthn'): string {
  return signUser(user, {
    amr:           ['pwd', factorMethod],
    mfaSatisfied:  true,
    mfaVerifiedAt: new Date().toISOString(),
    authStrength:  'mfa',
  });
}

/** Fire-and-forget step-up audit event. */
function emitStepUpEvent(
  user: AppUser,
  eventType: 'auth.step_up.completed' | 'auth.step_up.failed',
  payload:   Record<string, unknown>,
): Promise<void> {
  return emitAppEvent({
    eventType,
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   user.id,
    actorUserId:      user.id,
    severity:         eventType === 'auth.step_up.failed' ? 'warning' : 'info',
    payload:          { username: user.username, ...payload },
  }).then(() => undefined).catch(() => undefined);
}

export default router;
