// routes/webauthn.ts — WebAuthn / passkey registration, authentication, management
//
// Route groups:
//   Authenticated (requireUser):
//     POST /api/webauthn/register/options   — start credential registration
//     POST /api/webauthn/register/verify    — complete + persist credential
//     POST /api/webauthn/credentials/list   — list user's passkeys
//     POST /api/webauthn/credentials/rename — rename a passkey
//     POST /api/webauthn/credentials/delete — delete a passkey (last-factor guard)
//
//   Pre-auth / public (like /login):
//     POST /api/webauthn/auth/options       — start authentication ceremony
//     POST /api/webauthn/auth/verify        — complete + issue session or 2nd factor

import { Hono }        from 'hono';
import { z }           from 'zod';
import { setCookie }   from 'hono/cookie';
import { requireUser, log_ } from '../lib/auth';
import { requireStepUp }    from '../lib/stepUp';
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  listCredentials,
  renameCredential,
  deleteCredential,
  hasStrongFactor,
  getFactorMethods,
  isTwoFactorMandatory,
} from '../lib/webauthn';
import { validateChallenge, consumeChallenge } from '../lib/totp';
import { buildSessionPayload }                  from '../routes/auth';
import { checkLoginLimit, checkAuthMutationLimit, checkAuthReadLimit } from '../lib/ratelimit';
import { sb }                                   from '../lib/db';
import { zv }                                   from '../lib/validate';
import {
  COOKIE_NAME as TD_COOKIE_NAME,
  createTrustedDevice,
  rotateSecurityStamp,
  ttlDaysForRole,
} from '../lib/trustedDevices';
import type { HonoVariables }                   from '../../../types/api';
import type { AppUser }                         from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract device context from Hono context (same pattern as auth.ts). */
function deviceFrom(c: { req: { header: (k: string) => string | undefined }; get: (k: string) => unknown }) {
  return {
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 400) || undefined,
    ip:        (c.get('clientIp') as string | undefined) ?? undefined,
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const RegisterVerifySchema = z.object({
  // The full RegistrationResponseJSON from the browser
  response: z.object({
    id:                    z.string(),
    rawId:                 z.string(),
    response:              z.record(z.string(), z.unknown()),
    authenticatorAttachment: z.string().optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
    type:                  z.string(),
  }),
  label: z.string().max(80).optional(),
});

const CredentialIdSchema = z.object({
  credentialId: z.string().min(1),
});

const RenameSchema = z.object({
  credentialId: z.string().min(1),
  label:        z.string().max(80),
});

const AuthOptionsSchema = z.object({
  username: z.string().optional(),
});

const AuthVerifySchema = z.object({
  flow:           z.enum(['passwordless', 'second_factor']),
  preAuthToken:   z.string().optional(),
  rememberDevice: z.boolean().optional().default(false),
  deviceLabel:    z.string().max(80).optional(),
  response: z.object({
    id:                    z.string(),
    rawId:                 z.string(),
    response:              z.record(z.string(), z.unknown()),
    authenticatorAttachment: z.string().optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
    type:                  z.string(),
  }),
});

// ── Authenticated routes ──────────────────────────────────────────────────────

// POST /api/webauthn/register/options
router.post('/webauthn/register/options', async c => {
  const user = await requireUser(c);
  const rl = checkAuthReadLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const { options } = await generateRegistrationOptions({
    id:        user.id,
    username:  user.username,
    full_name: user.full_name,
  });

  return c.json({ success: true, options });
});

// POST /api/webauthn/register/verify
router.post('/webauthn/register/verify', async c => {
  const user = await requireUser(c);
  const rl = checkAuthMutationLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const raw  = c.get('body') as Record<string, unknown>;
  const v    = zv(c, RegisterVerifySchema, (raw.args as Record<string, unknown>) ?? raw);
  if (!v.ok) return v.response;

  // Cast: our zod schema enforces the shape; the library accepts the same JSON
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credential = await verifyRegistration(user, v.data.response as any, v.data.label);

  await log_(user, 'auth.passkey.registered', 'webauthn_credentials', credential.id,
    `Passkey registered: ${credential.label ?? credential.credentialId.slice(0, 16)}`);

  // New strong factor registered — rotate stamp to invalidate existing trusted devices
  void rotateSecurityStamp(user.id, 'passkey_registered');

  return c.json({ success: true, credential });
});

// ── Pre-auth passkey registration (mandatory-MFA setup at login) ───────────────
// The user has cleared password auth (challenge type 'verify') but has no session
// yet; register a passkey against the challenge, then issue the full session.
// Public (no requireUser): authorisation is the preAuthToken in the body.

const PreauthRegOptionsSchema = z.object({ preAuthToken: z.string().min(1) });
const PreauthRegVerifySchema  = z.object({
  preAuthToken: z.string().min(1),
  response: z.object({
    id: z.string(), rawId: z.string(), response: z.record(z.string(), z.unknown()),
    authenticatorAttachment: z.string().optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
    type: z.string(),
  }),
  label:          z.string().max(80).optional(),
  rememberDevice: z.boolean().optional().default(false),
  deviceLabel:    z.string().max(80).optional(),
});

async function loadChallengeUser(preAuthToken: string): Promise<AppUser | null> {
  const challenge = await validateChallenge(preAuthToken);
  if (!challenge || challenge.type !== 'verify') return null;
  const { data } = await sb.from('app_users').select('*').eq('id', challenge.user_id).single<AppUser>();
  return data && data.status === 'active' ? data : null;
}

// POST /api/webauthn/register/preauth/options
router.post('/webauthn/register/preauth/options', async c => {
  const ip = (c.get('clientIp') as string | undefined) ?? 'unknown';
  const rl = checkLoginLimit.check(ip);
  if (!rl.ok) return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, PreauthRegOptionsSchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;
  const user = await loadChallengeUser(v.data.preAuthToken);
  if (!user) return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
  const { options } = await generateRegistrationOptions({ id: user.id, username: user.username, full_name: user.full_name });
  return c.json({ success: true, options });
});

// POST /api/webauthn/register/preauth/verify
router.post('/webauthn/register/preauth/verify', async c => {
  const ip = (c.get('clientIp') as string | undefined) ?? 'unknown';
  const rl = checkLoginLimit.check(ip);
  if (!rl.ok) return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, PreauthRegVerifySchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;

  const challenge = await validateChallenge(v.data.preAuthToken);
  if (!challenge || challenge.type !== 'verify') {
    return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
  }
  const { data: user } = await sb.from('app_users').select('*').eq('id', challenge.user_id).single<AppUser>();
  if (!user || user.status !== 'active') {
    await consumeChallenge(challenge.id);
    return c.json({ success: false, message: 'Authentication failed.' }, 401);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credential = await verifyRegistration(user, v.data.response as any, v.data.label);
  await consumeChallenge(challenge.id);
  void rotateSecurityStamp(user.id, 'passkey_registered');
  await log_(user, 'auth.passkey.registered', 'webauthn_credentials', credential.id, 'Passkey registered at mandatory setup');

  const payload = await buildSessionPayload(user, deviceFrom(c), {
    amr: ['pwd', 'webauthn'], mfaSatisfied: true, authStrength: 'mfa',
  });

  if (v.data.rememberDevice) {
    try {
      const ttlDays = ttlDaysForRole(user.role);
      const { cookieValue } = await createTrustedDevice({
        userId: user.id, method: 'webauthn', label: v.data.deviceLabel,
        userAgent: c.req.header('user-agent') ?? undefined, ipAddress: ip, ttlDays,
      });
      setCookie(c, TD_COOKIE_NAME, cookieValue, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: ttlDays * 86400 });
    } catch (err) { console.error('[webauthn/register/preauth/verify] createTrustedDevice failed:', err); }
  }

  return c.json(payload);
});

// POST /api/webauthn/prompt/dismiss — reset the post-login passkey-prompt cadence
router.post('/webauthn/prompt/dismiss', async c => {
  const user = await requireUser(c);
  await sb.from('app_users').update({ last_passkey_prompt_at: new Date().toISOString() }).eq('id', user.id);
  return c.json({ success: true });
});

// POST /api/webauthn/credentials/list
router.post('/webauthn/credentials/list', async c => {
  const user = await requireUser(c);
  const rl = checkAuthReadLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const creds = await listCredentials(user.id);
  return c.json({ success: true, credentials: creds });
});

// POST /api/webauthn/credentials/rename
router.post('/webauthn/credentials/rename', async c => {
  const user = await requireUser(c);
  const rl = checkAuthReadLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, RenameSchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;

  await renameCredential(user.id, v.data.credentialId, v.data.label);
  return c.json({ success: true });
});

// POST /api/webauthn/credentials/delete  (requires step-up)
router.post('/webauthn/credentials/delete', async c => {
  const user = await requireStepUp(c);  // step-up: deleting a passkey is high-risk
  const rl = checkAuthMutationLimit.check(user.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, CredentialIdSchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;

  // Last-factor guard: block deletion if this is the user's only strong factor
  // and their role mandates MFA.
  if (isTwoFactorMandatory(user.role)) {
    const creds = await listCredentials(user.id);
    const remaining = creds.filter(c => c.id !== v.data.credentialId);
    const stillHasTotp = user.totp_enabled;

    if (!stillHasTotp && remaining.length === 0) {
      return c.json(
        { success: false, message: 'Cannot delete your last strong factor. Add another passkey or enable TOTP first.', code: 'last_factor' },
        400,
      );
    }
  }

  await deleteCredential(user.id, v.data.credentialId);
  await log_(user, 'auth.passkey.deleted', 'webauthn_credentials', v.data.credentialId,
    'Passkey deleted');

  // Factor removed — rotate stamp to invalidate trusted devices
  void rotateSecurityStamp(user.id, 'passkey_deleted');

  return c.json({ success: true });
});

// ── Pre-auth / public routes ──────────────────────────────────────────────────

// POST /api/webauthn/auth/options
router.post('/webauthn/auth/options', async c => {
  const ip = (c.get('clientIp') as string | undefined) ?? 'unknown';
  const rl = checkLoginLimit.check(ip);
  if (!rl.ok) {
    return c.json(
      { success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` },
      429,
    );
  }

  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, AuthOptionsSchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;

  // If a username was supplied, scope the allowCredentials to that user
  let userId: string | undefined;
  if (v.data.username) {
    const { data: u } = await sb
      .from('app_users')
      .select('id, status')
      .ilike('username', v.data.username)
      .maybeSingle<{ id: string; status: string }>();
    // Only resolve if the user exists and is active — avoids user enumeration via
    // different option payloads (timing still differs but we don't hard-error)
    if (u?.status === 'active') userId = u.id;
  }

  const { options } = await generateAuthenticationOptions(userId);
  return c.json({ success: true, options });
});

// POST /api/webauthn/auth/verify
router.post('/webauthn/auth/verify', async c => {
  const ip = (c.get('clientIp') as string | undefined) ?? 'unknown';
  const rl = checkLoginLimit.check(ip);
  if (!rl.ok) {
    return c.json(
      { success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` },
      429,
    );
  }

  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, AuthVerifySchema, (body.args as Record<string, unknown>) ?? body);
  if (!v.ok) return v.response;

  const { flow, preAuthToken, rememberDevice, deviceLabel, response: assertionResp } = v.data;

  if (flow === 'second_factor') {
    // ── Second-factor path ────────────────────────────────────────────────────
    // Validate the preAuthToken (same mechanism as /verify2fa)
    if (!preAuthToken) {
      return c.json({ success: false, message: 'preAuthToken is required for second_factor flow.' }, 400);
    }

    const challenge = await validateChallenge(preAuthToken);
    if (!challenge || challenge.type !== 'verify') {
      return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
    }

    // Verify the assertion
    let result: Awaited<ReturnType<typeof verifyAuthentication>>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await verifyAuthentication(assertionResp as any);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      return c.json({ success: false, message: err.message ?? 'Authentication failed.' }, (err.status ?? 401) as 400 | 401 | 500);
    }

    // The credential must belong to the same user as the challenge
    if (result.user.id !== challenge.user_id) {
      return c.json({ success: false, message: 'Credential does not belong to this session.' }, 401);
    }

    await consumeChallenge(challenge.id);

    const payload = await buildSessionPayload(result.user, deviceFrom(c), {
      amr:           ['pwd', 'webauthn'],
      mfaSatisfied:  true,
      authStrength:  'mfa',
    });

    // Issue trusted-device cookie if requested
    if (rememberDevice) {
      try {
        const ttlDays = ttlDaysForRole(result.user.role);
        const { cookieValue } = await createTrustedDevice({
          userId:    result.user.id,
          method:    'webauthn',
          label:     deviceLabel,
          userAgent: c.req.header('user-agent') ?? undefined,
          ipAddress: ip,
          ttlDays,
        });
        setCookie(c, TD_COOKIE_NAME, cookieValue, {
          httpOnly: true,
          secure:   true,
          sameSite: 'Lax',
          path:     '/',
          maxAge:   ttlDays * 86400,
        });
      } catch (err) {
        console.error('[webauthn/auth/verify] createTrustedDevice failed:', err);
      }
    }

    await log_(result.user, 'auth.login.webauthn_2fa', 'user', result.user.id, 'Passkey 2nd-factor login');
    return c.json(payload);
  }

  // ── Passwordless path ─────────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof verifyAuthentication>>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await verifyAuthentication(assertionResp as any);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Authentication failed.' }, (err.status ?? 401) as 400 | 401 | 500);
  }

  const payload = await buildSessionPayload(result.user, deviceFrom(c), {
    amr:           ['webauthn'],
    mfaSatisfied:  true,
    authStrength:  'passwordless_passkey',
  });

  await log_(result.user, 'auth.login.passwordless', 'user', result.user.id, 'Passwordless passkey login');
  return c.json(payload);
});

export default router;
