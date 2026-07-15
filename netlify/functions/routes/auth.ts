import { Hono }     from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sb, createAnonClient } from '../lib/db';
import { signUser, issueRefreshToken, rotateRefreshToken, revokeToken, requireUser, loadUserOverrides, log_, setRefreshCookie, clearRefreshCookie, RT_COOKIE_NAME, ACCESS_TOKEN_TTL_MS } from '../lib/auth';
import type { AuthMethodClaims }       from '../lib/auth';
import { loadRolePermissions, loadRoleIsEmployee, loadRoleScope } from '../lib/permissions';
import { getProfileSignedUrl, resolveProfileImageUrl } from '../lib/photos';
import { setting }                     from '../lib/settings';
import { checkLoginLimit, rateLimit, checkCodeVerifyLimit }  from '../lib/ratelimit';
import { noPhoto }                     from '../lib/photos';
import {
  zv, LoginSchema, UpdateColorSchemeSchema, UpdateLayoutModeSchema,
  UpdateMyProfileSchema, VerifyPasswordSchema, ChangePasswordSchema,
  Setup2faInitSchema, Setup2faConfirmSchema, Disable2faSchema,
  z,
} from '../lib/validate';
import {
  issueChallenge, validateChallenge, consumeChallenge, incrementChallengeAttempt,
  generateTotpSecret, verifyCode, buildQrCode,
  generateBackupCodes, consumeBackupCode,
} from '../lib/totp';
import { isMfaRequiredForRole } from '../lib/securityPolicy';
import { hasStrongFactor, getFactorMethods, listCredentials } from '../lib/webauthn';
import {
  COOKIE_NAME as TD_COOKIE_NAME,
  verifyTrustedDevice,
  createTrustedDevice,
  ttlDaysForRole,
  shouldOfferTrustedDevice,
  rotateSecurityStamp,
  isSecureRequest,
} from '../lib/trustedDevices';
import { emitAppEvent } from '../lib/appEvents';
import type { HonoVariables }          from '../../../types/api';
import type { AppUser }                from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// Per-role idle-timeout defaults (minutes). Higher-privilege roles get shorter
// idle windows. Superadmin can override these in Settings → stored as
// settings key `sessionIdleTimeout.<role>`.
const IDLE_DEFAULT_MIN: Record<string, number> = {
  superadmin: 60, admin: 240, manager: 240, employee: 480,
};

/** Resolve a role's idle-timeout window in ms (configurable setting → default). */
async function resolveIdleTimeoutMs(role: string): Promise<number> {
  const fallback = String(IDLE_DEFAULT_MIN[role] ?? 240);
  const raw = await setting(`sessionIdleTimeout.${role}`, fallback);
  const mins = Number(raw);
  // Clamp to a sane range: 5 min … 30 days.
  const safe = Number.isFinite(mins) && mins > 0 ? Math.min(Math.max(mins, 5), 43200) : Number(fallback);
  return safe * 60 * 1000;
}

/** Extract device/context (user-agent + client IP) from the request for session records. */
function deviceFrom(c: { req: { header: (k: string) => string | undefined }; get: (k: string) => unknown }): { userAgent?: string; ip?: string } {
  return {
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 400) || undefined,
    ip:        (c.get('clientIp') as string | undefined) ?? undefined,
  };
}

// ── Passkey prompt helpers ─────────────────────────────────────────────────────

const PASSKEY_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns true when the user should be nudged to register a passkey.
 * Fires when `last_passkey_prompt_at` is null (never prompted) or older than
 * PASSKEY_PROMPT_INTERVAL_MS (7 days).
 */
function shouldPromptForPasskey(user: AppUser): boolean {
  if (!user.last_passkey_prompt_at) return true;
  const lastPrompt = new Date(user.last_passkey_prompt_at).getTime();
  return Date.now() - lastPrompt > PASSKEY_PROMPT_INTERVAL_MS;
}

// ── Shared helper: build full session payload after successful auth ────────────
// Takes the Hono context so the ONE issuance point can deliver the refresh token
// as an httpOnly cookie — it is deliberately NOT part of the returned JSON, so it
// never touches JS-readable storage (XSS cannot exfiltrate it).
export async function buildSessionPayload(
  c:       Context,
  u:       AppUser,
  amr?:    Partial<AuthMethodClaims>,
) {
  const device = deviceFrom(c);
  // Prefer the new public avatar URL (no signing, never stale); fall back to the
  // legacy signed-URL path only for users who haven't re-uploaded yet.
  const publicAvatar = resolveProfileImageUrl(u);
  const [profileImage, companyLogoUrl, companyName, refreshToken, overrides, sessionIdleTimeoutMs, roleSet, isEmployee, roleScope, credentials] = await Promise.all([
    publicAvatar ? Promise.resolve(publicAvatar) : getProfileSignedUrl(u.id, u.profile_image),
    setting('companyLogoUrl', ''),
    setting('companyName', 'My Company'),
    issueRefreshToken(u.id, device, amr),
    // superadmin needs no overrides (role default already grants everything)
    u.role === 'superadmin'
      ? Promise.resolve([] as { permission: string; granted: boolean }[])
      : loadUserOverrides(u.id),
    resolveIdleTimeoutMs(u.role),
    loadRolePermissions(u.role),
    loadRoleIsEmployee(u.role),
    loadRoleScope(u.role),
    listCredentials(u.id),
  ]);

  const hasPasskey = credentials.length > 0;
  // Show the optional passkey-setup nudge when the user has no passkey yet and
  // the prompt cadence allows it (null or older than 7 days).
  const showPrompt = !hasPasskey && shouldPromptForPasskey(u);

  // Refresh token travels ONLY in the httpOnly cookie — never in the JSON body.
  setRefreshCookie(c, refreshToken);

  return {
    success:      true as const,
    token:        signUser(u, amr),
    // Client-side proactive refresh schedules off this (server-authoritative TTL).
    expiresAt:    Date.now() + ACCESS_TOKEN_TTL_MS,
    userId:       u.id,
    username:     u.username,
    fullName:     u.full_name,
    role:         u.role,
    departmentId: u.department_id ?? '',
    position:     u.position      ?? '',
    colorScheme:  u.color_scheme  ?? 'navy',
    layoutMode:   u.layout_mode   ?? 'sidebar',
    profileImage,
    profileImageVersion: u.profile_image_version ?? 1,
    companyLogoUrl,
    companyName,
    // Resolved per-role idle-timeout window (ms) — drives the client idle timer.
    sessionIdleTimeoutMs,
    // The role's resolved default permission set — drives the client's can()/useCan()
    // (replaces the previously hardcoded ROLE_PERMISSIONS on the frontend).
    rolePermissions: [...roleSet],
    // Whether this role is a clocking employee → gets the self-service Personal nav.
    isEmployee,
    // Data scope: 'all' (org-wide) or 'own' (own department only). Lets the UI
    // hint scoped views; the backend filter remains authoritative regardless.
    roleScope,
    // Per-user RBAC grants/denials — consumed by the session store + can()/useCan().
    permissionOverrides: overrides.map(o => ({
      user_id:    u.id,
      permission: o.permission,
      granted:    o.granted,
      set_by:     '',
      set_at:     new Date(0).toISOString(),
    })),
    // ── Passkey prompt signal (optional — UI shows a setup nudge) ───────────
    hasPasskey,
    ...(showPrompt ? { nextStep: 'passkey_prompt' as const, passkeyRequired: false as const } : {}),
  };
}

// ── Login — Supabase Auth → app_users lookup → 2FA gate → session ────────────
router.post('/login', async c => {
  const v = zv(c, LoginSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { username, password } = v.data;

  const ip = c.get('clientIp') ?? 'unknown';
  const rl = await checkLoginLimit.check(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many login attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  // Step 1: look up the app_users row by username to get auth_email
  const { data: u } = await sb
    .from('app_users')
    .select('*')
    .ilike('username', username)
    .maybeSingle<AppUser>();

  if (!u || u.status !== 'active' || !u.auth_email) {
    console.log('[login] user not found or inactive:', { found: !!u, status: u?.status, hasEmail: !!u?.auth_email });
    return c.json({ success: false, message: 'Invalid username or password' });
  }

  // Step 2: authenticate via Supabase Auth using the stored email.
  // Use a per-request client to avoid session state bleeding between requests.
  const { error: authError } = await createAnonClient().auth.signInWithPassword({
    email:    u.auth_email,
    password,
  });

  if (authError) {
    console.log('[login] supabase auth failed:', authError.message);
    return c.json({ success: false, message: 'Invalid username or password' });
  }

  // ── 2FA gate ──────────────────────────────────────────────────────────────
  const mandatory = await isMfaRequiredForRole(u.role);

  if (mandatory) {
    // Use hasStrongFactor: TOTP OR a registered passkey satisfies the gate.
    const strongFactor = await hasStrongFactor(u.id);

    if (!strongFactor) {
      // No factor at all — prompt for initial strong-factor setup.
      // Advertise both methods so the frontend can offer passkey registration
      // (pre-auth via /webauthn/register/preauth/*) OR TOTP enrolment.
      const setupToken = await issueChallenge(u.id, 'setup');
      await log_(u, 'login_requires_setup', 'user', u.id, '2FA setup required');
      return c.json({
        success:      true,
        requiresSetup: true,
        preAuthToken: setupToken,
        setupMethods: ['webauthn', 'totp'],
        reason:       'mandatory_mfa',
      });
    }

    // ── Trusted device check ────────────────────────────────────────────────
    // If the browser has a valid trusted-device cookie, skip the 2FA step and
    // issue a full session with authStrength='trusted_device'.
    const tdCookie = getCookie(c, TD_COOKIE_NAME);
    if (tdCookie) {
      const tdResult = await verifyTrustedDevice({
        userId:     u.id,
        cookieValue: tdCookie,
        ipAddress:   c.get('clientIp') ?? undefined,
      });
      if (tdResult.trusted) {
        const payload = await buildSessionPayload(c, u, {
          amr:          ['pwd', 'trusted_device'],
          mfaSatisfied: true,
          authStrength: 'trusted_device',
        });
        void emitAppEvent({
          eventType:        'auth.login.trusted_device_used',
          sourceModule:     'auth',
          sourceEntityType: 'user',
          sourceEntityId:   u.id,
          actorUserId:      u.id,
          severity:         'info',
          payload:          { deviceId: tdResult.device.id, label: tdResult.device.label },
        });
        await log_(u, 'login', 'user', u.id, 'login ok (trusted device)');
        return c.json(payload);
      }
      // Cookie present but rejected — record WHY (device_expired / security_stamp_mismatch /
      // secret_mismatch / device_not_found / invalid_cookie_signature) so an unexpected
      // re-prompt inside the trust window is diagnosable instead of silently falling through.
      console.log('[login] trusted-device cookie NOT honored', { userId: u.id, reason: tdResult.reason });
      await log_(u, 'trusted_device_rejected', 'user', u.id, tdResult.reason);
    } else {
      console.log('[login] no trusted-device cookie sent', { userId: u.id });
    }

    // User has at least one strong factor — require them to use it
    const [preAuthToken, factorMethods, tdEligible2, tdMaxDays2] = await Promise.all([
      issueChallenge(u.id, 'verify'),
      getFactorMethods(u.id),
      shouldOfferTrustedDevice(u.role),
      ttlDaysForRole(u.role),
    ]);
    const methods: string[] = [];
    if (factorMethods.hasTotp)          methods.push('totp');
    if (factorMethods.passkeyCount > 0) methods.push('webauthn');
    await log_(u, 'login_requires_2fa', 'user', u.id, `methods: ${methods.join(',')}`);
    return c.json({
      success:              true,
      requiresTwoFactor:    true,
      preAuthToken,
      methods,
      trustedDeviceEligible: tdEligible2,
      trustedDevicePolicy:   { enabled: true, maxDays: tdMaxDays2 },
    });
  }

  if (u.totp_enabled) {
    // Non-mandatory role has voluntarily enrolled TOTP — honour it.
    // Check trusted device first.
    const tdCookie = getCookie(c, TD_COOKIE_NAME);
    if (tdCookie) {
      const tdResult = await verifyTrustedDevice({
        userId:      u.id,
        cookieValue: tdCookie,
        ipAddress:   c.get('clientIp') ?? undefined,
      });
      if (tdResult.trusted) {
        const payload = await buildSessionPayload(c, u, {
          amr:          ['pwd', 'trusted_device'],
          mfaSatisfied: true,
          authStrength: 'trusted_device',
        });
        void emitAppEvent({
          eventType:        'auth.login.trusted_device_used',
          sourceModule:     'auth',
          sourceEntityType: 'user',
          sourceEntityId:   u.id,
          actorUserId:      u.id,
          severity:         'info',
          payload:          { deviceId: tdResult.device.id, label: tdResult.device.label },
        });
        await log_(u, 'login', 'user', u.id, 'login ok (trusted device)');
        return c.json(payload);
      }
      console.log('[login] trusted-device cookie NOT honored', { userId: u.id, reason: tdResult.reason });
      await log_(u, 'trusted_device_rejected', 'user', u.id, tdResult.reason);
    } else {
      console.log('[login] no trusted-device cookie sent', { userId: u.id });
    }
    const [preAuthToken, tdEligible, tdMaxDays] = await Promise.all([
      issueChallenge(u.id, 'verify'),
      shouldOfferTrustedDevice(u.role),
      ttlDaysForRole(u.role),
    ]);
    await log_(u, 'login_requires_2fa', 'user', u.id, '');
    return c.json({
      success:              true,
      requiresTwoFactor:    true,
      preAuthToken,
      methods:              ['totp'],
      trustedDeviceEligible: tdEligible,
      trustedDevicePolicy:   { enabled: true, maxDays: tdMaxDays },
    });
  }

  // No 2FA required — issue full session (password-only)
  console.log('[login] building session for', u.username);
  try {
    const payload = await buildSessionPayload(c, u, {
      amr:          ['pwd'],
      mfaSatisfied: false,
      authStrength: 'password_only',
    });
    await log_(u, 'login', 'user', u.id, 'login ok');
    return c.json(payload);
  } catch (e) {
    console.error('[login] buildSessionPayload failed:', e);
    return c.json({ success: false, message: 'Login failed. Please try again.' }, 500);
  }
});

// ── Verify 2FA — consume pre-auth token + TOTP/backup code ───────────────────
// Extended for B3a: accepts optional rememberDevice + deviceLabel.
// rememberDevice is honoured ONLY when a TOTP code (not a backup code) succeeds.

const Verify2faExtSchema = z.object({
  preAuthToken:  z.string().min(1),
  code:          z.string().min(6).max(8),
  rememberDevice: z.boolean().optional().default(false),
  deviceLabel:    z.string().max(80).optional(),
});

router.post('/verify2fa', async c => {
  const ip = c.get('clientIp') ?? 'unknown';
  const rl = await checkCodeVerifyLimit.check(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const rawArgs = c.get('body').args ?? {};
  const v = zv(c, Verify2faExtSchema, rawArgs);
  if (!v.ok) return v.response;
  const { preAuthToken, code, rememberDevice, deviceLabel } = v.data;

  const challenge = await validateChallenge(preAuthToken);
  if (!challenge || challenge.type !== 'verify') {
    return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
  }

  const { data: u } = await sb
    .from('app_users')
    .select('*')
    .eq('id', challenge.user_id)
    .single<AppUser>();

  if (!u || u.status !== 'active' || !u.totp_secret) {
    await consumeChallenge(challenge.id);
    return c.json({ success: false, message: 'Authentication failed.' }, 401);
  }

  // Try TOTP code first, then backup code
  const isDigits = /^\d{6}$/.test(code);
  let codeOk    = false;
  let usedBackup = false;

  if (isDigits) {
    codeOk = verifyCode(u.totp_secret, code);
  } else {
    codeOk = await consumeBackupCode(u, code);
    usedBackup = codeOk;
  }

  if (!codeOk) {
    await incrementChallengeAttempt(challenge.id);
    return c.json({ success: false, message: 'Invalid code. Please try again.' }, 401);
  }

  await consumeChallenge(challenge.id);

  const session = await buildSessionPayload(c, u, {
    amr:           ['pwd', 'otp'],
    mfaSatisfied:  true,
    mfaVerifiedAt: new Date().toISOString(),
    authStrength:  'mfa',
  });

  // Issue trusted-device cookie ONLY for TOTP (not backup code)
  if (rememberDevice && !usedBackup) {
    try {
      const ttlDays = await ttlDaysForRole(u.role);
      const { cookieValue } = await createTrustedDevice({
        userId:    u.id,
        method:    'totp',
        label:     deviceLabel,
        userAgent: c.req.header('user-agent') ?? undefined,
        ipAddress: c.get('clientIp') ?? undefined,
        ttlDays,
      });
      setCookie(c, TD_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        secure:   isSecureRequest(c),   // not over http://localhost (Firefox drops Secure cookies there)
        sameSite: 'Lax',
        path:     '/',
        maxAge:   ttlDays * 86400,
      });
    } catch (err) {
      // Non-fatal: log but don't fail the login
      console.error('[verify2fa] createTrustedDevice failed:', err);
    }
  }

  await log_(u, 'login', 'user', u.id, usedBackup ? 'login ok (backup code)' : 'login ok (2FA)');
  return c.json(session);
});

// ── Setup 2FA (step 1) — generate secret + QR code ───────────────────────────
// Called with a preAuthToken of type 'setup'. Returns QR code and manual code.
// Does NOT save the secret yet — only saved after confirm (step 2).
router.post('/setup2fa', async c => {
  const v = zv(c, Setup2faInitSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const challenge = await validateChallenge(v.data.preAuthToken);
  if (!challenge || challenge.type !== 'setup') {
    return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
  }

  const { data: u } = await sb
    .from('app_users')
    .select('id, username, status, role')
    .eq('id', challenge.user_id)
    .single<Pick<AppUser, 'id' | 'username' | 'status' | 'role'>>();

  if (!u || u.status !== 'active') {
    return c.json({ success: false, message: 'Authentication failed.' }, 401);
  }

  const [plain, encrypted] = generateTotpSecret();
  const qrCode = await buildQrCode(plain, u.username);

  // Temporarily store the encrypted secret on the challenge row so confirm can retrieve it.
  // We reuse the challenge's user_id lookup — we update app_users with a "pending" marker.
  // Strategy: write to totp_secret immediately but leave totp_enabled = false.
  // Confirm will flip totp_enabled = true. If user abandons setup, the secret stays
  // disabled and is overwritten on the next setup attempt.
  await sb.from('app_users').update({ totp_secret: encrypted }).eq('id', u.id);

  return c.json({
    success:    true,
    qrCode,
    manualCode: plain,
  });
});

// ── Setup 2FA (step 2) — confirm with a valid TOTP code ───────────────────────
router.post('/confirm2faSetup', async c => {
  const ip = c.get('clientIp') ?? 'unknown';
  const rl = await checkCodeVerifyLimit.check(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const v = zv(c, Setup2faConfirmSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { preAuthToken, code } = v.data;

  const challenge = await validateChallenge(preAuthToken);
  if (!challenge || challenge.type !== 'setup') {
    return c.json({ success: false, message: 'Invalid or expired session. Please log in again.' }, 401);
  }

  const { data: u } = await sb
    .from('app_users')
    .select('*')
    .eq('id', challenge.user_id)
    .single<AppUser>();

  if (!u || u.status !== 'active' || !u.totp_secret) {
    return c.json({ success: false, message: 'Setup session expired. Please log in again.' }, 401);
  }

  if (!verifyCode(u.totp_secret, code)) {
    await incrementChallengeAttempt(challenge.id);
    return c.json({ success: false, message: 'Invalid code. Make sure your authenticator app is synced.' }, 400);
  }

  // Generate backup codes and enable 2FA
  const [plains, hashes] = await generateBackupCodes();
  await sb.from('app_users').update({
    totp_enabled:     true,
    totp_enrolled_at: new Date().toISOString(),
    backup_codes:     hashes,
  }).eq('id', u.id);

  await consumeChallenge(challenge.id);

  // Fetch updated user row to build full session
  const { data: uFull } = await sb.from('app_users').select('*').eq('id', u.id).single<AppUser>();
  if (!uFull) return c.json({ success: false, message: 'Session error.' }, 500);

  await log_(uFull, '2fa_enrolled', 'user', uFull.id, '');

  const session = await buildSessionPayload(c, uFull, {
    amr:           ['pwd', 'otp'],
    mfaSatisfied:  true,
    mfaVerifiedAt: new Date().toISOString(),
    authStrength:  'mfa',
  });
  return c.json({ ...session, backupCodes: plains });  // plaintext shown ONCE
});

// ── 2FA Status — check enrollment state (authenticated) ──────────────────────
router.post('/get2faStatus', async c => {
  const u = await requireUser(c);
  const codesRemaining = (u.backup_codes ?? []).filter(Boolean).length;
  return c.json({
    success:        true,
    enabled:        u.totp_enabled,
    enrolledAt:     u.totp_enrolled_at ?? null,
    mandatory:      await isMfaRequiredForRole(u.role),
    codesRemaining,
  });
});

// ── Disable 2FA — employees only, requires password confirmation ──────────────
router.post('/disable2fa', async c => {
  const u = await requireUser(c);
  const v = zv(c, Disable2faSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  if (await isMfaRequiredForRole(u.role)) {
    return c.json({ success: false, message: '2FA cannot be disabled for your role.' }, 403);
  }

  if (u.auth_email) {
    const { error: pwErr } = await createAnonClient().auth.signInWithPassword({ email: u.auth_email, password: v.data.password });
    if (pwErr) return c.json({ success: false, message: 'Incorrect password.' }, 403);
  }

  await sb.from('app_users').update({
    totp_secret:      null,
    totp_enabled:     false,
    totp_enrolled_at: null,
    backup_codes:     null,
  }).eq('id', u.id);

  await log_(u, '2fa_disabled', 'user', u.id, '');
  return c.json({ success: true });
});

// ── Refresh — rotate refresh token, issue new access token ────────────────────
// The refresh token arrives ONLY via the httpOnly cookie (never the body) and the
// rotated replacement leaves the same way — JS on either side never sees it.
router.post('/refreshToken', async c => {
  const rt = getCookie(c, RT_COOKIE_NAME);
  if (!rt) {
    return c.json({ success: false, message: 'No refresh token. Please log in again.' }, 401);
  }

  const result = await rotateRefreshToken(rt);
  if (!result) {
    clearRefreshCookie(c);
    return c.json({ success: false, message: 'Invalid or expired refresh token. Please log in again.' }, 401);
  }

  setRefreshCookie(c, result.refreshToken);
  await log_(result.user, 'tokenRefresh', 'user', result.user.id, '');

  return c.json({
    success:   true,
    token:     result.accessToken,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  });
});

// ── Logout — revoke access token JTI + delete refresh token + clear cookie ────
router.post('/logout', async c => {
  const u    = await requireUser(c);
  const auth = c.get('auth');

  await Promise.all([
    auth?.jti ? revokeToken(auth.jti, auth.exp) : Promise.resolve(),
    sb.from('refresh_tokens').delete().eq('user_id', u.id),
    log_(u, 'logout', 'user', u.id, ''),
  ]);

  clearRefreshCookie(c);
  return c.json({ success: true });
});

// ── Profile / preference routes ───────────────────────────────────────────────

router.post('/updateColorScheme', async c => {
  const actor = await requireUser(c);
  const v = zv(c, UpdateColorSchemeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  if (actor.username !== v.data.username) return c.json({ success: false, message: 'Forbidden' }, 403);
  await sb.from('app_users').update({ color_scheme: v.data.scheme, updated_at: new Date().toISOString() }).eq('id', actor.id);
  return c.json({ success: true });
});

router.post('/updateLayoutMode', async c => {
  const actor = await requireUser(c);
  const v = zv(c, UpdateLayoutModeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  if (actor.username !== v.data.username) return c.json({ success: false, message: 'Forbidden' }, 403);
  await sb.from('app_users').update({ layout_mode: v.data.mode, updated_at: new Date().toISOString() }).eq('id', actor.id);
  return c.json({ success: true });
});

router.post('/updateMyProfile', async c => {
  const actor = await requireUser(c);
  const v = zv(c, UpdateMyProfileSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const args = v.data;
  if (actor.username !== args.username) return c.json({ success: false, message: 'Forbidden' }, 403);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.fullName)            patch.full_name = args.fullName.trim();
  if (args.email !== undefined) patch.email     = args.email.trim();
  if (args.phone !== undefined) patch.phone     = args.phone.trim();

  // Profile PHOTO flows through the presigned /api/profile-photo/* endpoints, and
  // PASSWORD changes go through the canonical /api/auth/password/change route (which
  // rotates the security stamp + revokes other sessions). This route is name /
  // email / phone ONLY — one password path, no dual system.

  const { data, error } = await sb.from('app_users').update(patch).eq('id', actor.id)
    .select('profile_image, profile_image_url, profile_image_thumb_url, full_name, email, phone')
    .single<Pick<AppUser, 'profile_image' | 'profile_image_url' | 'profile_image_thumb_url' | 'full_name' | 'email' | 'phone'>>();
  if (error) { console.error('[auth] updateMyProfile', error); return c.json({ success: false, message: error.message }); }

  if (args.fullName || args.email !== undefined || args.phone !== undefined) {
    void emitAppEvent({ eventType: 'auth.profile.updated', sourceModule: 'auth', sourceEntityType: 'app_user', sourceEntityId: actor.id, actorUserId: actor.id, severity: 'info', payload: {
      fullNameChanged: !!args.fullName, emailChanged: args.email !== undefined, phoneChanged: args.phone !== undefined,
    } });
  }

  // Resolve the (unchanged) avatar: prefer the public URL, else the legacy signed URL.
  const profileImage = resolveProfileImageUrl(data)
    ?? (noPhoto(data.profile_image) ? '' : await getProfileSignedUrl(actor.id, data.profile_image ?? ''));
  return c.json({ success: true, profileImage, fullName: data.full_name, email: data.email ?? '', phone: data.phone ?? '' });
});

// ── Self-service activity feed — real app_events for MY account, not the
// deprecated attendance/leave "history" endpoints. ────────────────────────────
router.post('/getMyRecentActivity', async c => {
  const actor = await requireUser(c);
  const { data, error } = await sb
    .from('app_events')
    .select('event_type, created_at, payload')
    .eq('source_entity_type', 'app_user')
    .eq('source_entity_id', actor.id)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: (data ?? []).map(r => ({
    eventType: r.event_type, createdAt: r.created_at, payload: r.payload,
  })) });
});

router.post('/getMyPermissionOverrides', async c => {
  // The authenticated user's OWN per-user permission overrides, loaded at login to reconcile
  // the client permission set. Service-role read keyed off the JWT actor — never another
  // user's rows. This is the ONLY browser read path: the user_permissions table is deny-all
  // to anon/authenticated (review finding #4 — the old USING(true) policy let anyone with
  // the anon key enumerate every user's allow/deny exceptions).
  const actor = await requireUser(c);
  const { data, error } = await sb
    .from('user_permissions')
    .select('user_id, permission, granted, set_by, set_at')
    .eq('user_id', actor.id);
  if (error) {
    // Table absent (pre-migration) → no overrides, fall back to role defaults.
    if ((error as { code?: string }).code === '42P01') return c.json({ success: true, data: [] });
    return c.json({ success: false, message: error.message });
  }
  return c.json({ success: true, data: data ?? [] });
});

router.post('/verifyPassword', async c => {
  const u = await requireUser(c);
  const v = zv(c, VerifyPasswordSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  if (!u.auth_email) return c.json({ success: false, message: 'Account not linked to auth.' });
  const { error } = await createAnonClient().auth.signInWithPassword({ email: u.auth_email, password: v.data.password });
  return error ? c.json({ success: false, message: 'Incorrect password.' }) : c.json({ success: true });
});

// ── Change password — self-service, verify-current-then-set ──────────────────
// Rate-limited: 5 attempts per 15 minutes per IP (same window as /login).
const checkPasswordChangeLimit = rateLimit({ max: 5, windowMs: 15 * 60 * 1000, prefix: 'pwchange' });

router.post('/auth/password/change', async c => {
  // Rate limit first (before any DB work)
  const ip = c.get('clientIp') ?? 'unknown';
  const rl = await checkPasswordChangeLimit.check(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const u = await requireUser(c);
  const v = zv(c, ChangePasswordSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { currentPassword, newPassword } = v.data;

  if (currentPassword === newPassword) {
    return c.json({ success: false, code: 'same_password', message: 'New password must differ from the current password.' }, 400);
  }

  if (!u.auth_email) {
    return c.json({ success: false, message: 'Account not linked to auth.' }, 400);
  }

  // Verify current password — captures auth UID from the sign-in response
  const { data: signInData, error: signInError } = await createAnonClient().auth.signInWithPassword({
    email:    u.auth_email,
    password: currentPassword,
  });

  if (signInError || !signInData.user) {
    return c.json({ success: false, code: 'invalid_password', message: 'Current password is incorrect.' }, 400);
  }

  const authUid = signInData.user.id;

  // Set the new password via admin API (service-role client)
  const { error: updateError } = await sb.auth.admin.updateUserById(authUid, { password: newPassword });
  if (updateError) {
    console.error('[auth/password/change] admin updateUserById failed:', updateError.message);
    return c.json({ success: false, message: 'Failed to update password. Please try again.' }, 500);
  }

  // Rotate security stamp — invalidates all trusted devices
  await rotateSecurityStamp(u.id, 'password_changed');

  // Record password_changed_at in security state
  await sb
    .from('auth_user_security_state')
    .upsert({ user_id: u.id, password_changed_at: new Date().toISOString() }, { onConflict: 'user_id' });

  // Emit audit event
  void emitAppEvent({
    eventType:        'auth.password.changed',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   u.id,
    actorUserId:      u.id,
    severity:         'warning',
    payload:          {},
  });

  await log_(u, 'password_changed', 'user', u.id, '');

  return c.json({ success: true });
});

export default router;
