import { Hono }   from 'hono';
import bcrypt      from 'bcryptjs';
import { sb }      from '../lib/db';
import { signUser, issueRefreshToken, rotateRefreshToken, revokeToken, requireUser, log_ } from '../lib/auth';
import { getProfileSignedUrl }         from '../lib/photos';
import { setting }                     from '../lib/settings';
import { checkLoginLimit }             from '../lib/ratelimit';
import { uploadBase64 }                from '../lib/upload';
import { noPhoto }                     from '../lib/photos';
import {
  zv, LoginSchema, UpdateColorSchemeSchema, UpdateLayoutModeSchema,
  UpdateMyProfileSchema, VerifyPasswordSchema,
  Verify2faSchema, Setup2faInitSchema, Setup2faConfirmSchema, Disable2faSchema,
  z,
} from '../lib/validate';
import {
  isTwoFactorMandatory,
  issueChallenge, validateChallenge, consumeChallenge, incrementChallengeAttempt,
  generateTotpSecret, verifyCode, buildQrCode,
  generateBackupCodes, consumeBackupCode,
} from '../lib/totp';
import type { HonoVariables }          from '../../../types/api';
import type { AppUser }                from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Shared helper: build full session payload after successful auth ────────────
async function buildSessionPayload(u: AppUser) {
  const [profileImage, companyLogoUrl, companyName, refreshToken] = await Promise.all([
    getProfileSignedUrl(u.id, u.profile_image),
    setting('companyLogoUrl', ''),
    setting('companyName', 'My Company'),
    issueRefreshToken(u.id),
  ]);
  return {
    success:      true as const,
    token:        signUser(u),
    refreshToken,
    userId:       u.id,
    username:     u.username,
    fullName:     u.full_name,
    role:         u.role,
    departmentId: u.department_id ?? '',
    position:     u.position      ?? '',
    colorScheme:  u.color_scheme  ?? 'navy',
    layoutMode:   u.layout_mode   ?? 'sidebar',
    profileImage,
    companyLogoUrl,
    companyName,
  };
}

// ── Login — password check → 2FA gate → session ───────────────────────────────
router.post('/login', async c => {
  const v = zv(c, LoginSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { username, password } = v.data;

  const ip = c.get('clientIp') ?? 'unknown';
  const rl = checkLoginLimit(ip);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many login attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const { data: u } = await sb
    .from('app_users')
    .select('*')
    .ilike('username', username)
    .maybeSingle<AppUser>();

  if (!u || u.status !== 'active') {
    await bcrypt.compare(password, '$2a$12$invalidhashpadding.......................................enough');
    return c.json({ success: false, message: 'Invalid username or password' });
  }
  const passOk = await bcrypt.compare(password, u.password_hash);
  if (!passOk) return c.json({ success: false, message: 'Invalid username or password' });

  // ── 2FA gate ──────────────────────────────────────────────────────────────
  const mandatory = isTwoFactorMandatory(u.role);

  if (mandatory && !u.totp_enabled) {
    // Admin/manager hasn't enrolled yet — force setup before granting access
    const setupToken = await issueChallenge(u.id, 'setup');
    await log_(u, 'login_requires_setup', 'user', u.id, '2FA setup required');
    return c.json({ success: true, requiresSetup: true, preAuthToken: setupToken });
  }

  if (u.totp_enabled) {
    // User has 2FA enrolled — require TOTP verification
    const preAuthToken = await issueChallenge(u.id, 'verify');
    await log_(u, 'login_requires_2fa', 'user', u.id, '');
    return c.json({ success: true, requiresTwoFactor: true, preAuthToken });
  }

  // No 2FA required (employee, opted out) — issue full session
  await log_(u, 'login', 'user', u.id, 'login ok');
  return c.json(await buildSessionPayload(u));
});

// ── Verify 2FA — consume pre-auth token + TOTP/backup code ───────────────────
router.post('/verify2fa', async c => {
  const v = zv(c, Verify2faSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { preAuthToken, code } = v.data;

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
  let codeOk = false;
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
  await log_(u, 'login', 'user', u.id, usedBackup ? 'login ok (backup code)' : 'login ok (2FA)');
  return c.json(await buildSessionPayload(u));
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

  const session = await buildSessionPayload(uFull);
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
    mandatory:      isTwoFactorMandatory(u.role),
    codesRemaining,
  });
});

// ── Disable 2FA — employees only, requires password confirmation ──────────────
router.post('/disable2fa', async c => {
  const u = await requireUser(c);
  const v = zv(c, Disable2faSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  if (isTwoFactorMandatory(u.role)) {
    return c.json({ success: false, message: '2FA cannot be disabled for your role.' }, 403);
  }

  if (!await bcrypt.compare(v.data.password, u.password_hash)) {
    return c.json({ success: false, message: 'Incorrect password.' }, 403);
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
const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});

router.post('/refreshToken', async c => {
  const v = zv(c, RefreshSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const result = await rotateRefreshToken(v.data.refreshToken);
  if (!result) {
    return c.json({ success: false, message: 'Invalid or expired refresh token. Please log in again.' }, 401);
  }

  await log_(result.user, 'tokenRefresh', 'user', result.user.id, '');

  return c.json({
    success:      true,
    token:        result.accessToken,
    refreshToken: result.refreshToken,
  });
});

// ── Logout — revoke access token JTI + delete refresh token ──────────────────
router.post('/logout', async c => {
  const u    = await requireUser(c);
  const auth = c.get('auth');

  await Promise.all([
    auth?.jti ? revokeToken(auth.jti, auth.exp) : Promise.resolve(),
    sb.from('refresh_tokens').delete().eq('user_id', u.id),
    log_(u, 'logout', 'user', u.id, ''),
  ]);

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

  if (args.newPassword) {
    if (!args.oldPassword) return c.json({ success: false, message: 'Current password is required' });
    if (!await bcrypt.compare(args.oldPassword, actor.password_hash))
      return c.json({ success: false, message: 'Current password is incorrect' });
    patch.password_hash = await bcrypt.hash(args.newPassword, 12);
  }

  if (args.removeProfileImage) {
    patch.profile_image = '__removed__';
  } else if (args.profileImageBase64) {
    patch.profile_image = await uploadBase64('profile-photos', args.profileImageBase64, `profile_${actor.username}`);
  }

  const { data, error } = await sb.from('app_users').update(patch).eq('id', actor.id)
    .select('profile_image, full_name, email, phone').single<Pick<AppUser, 'profile_image' | 'full_name' | 'email' | 'phone'>>();
  if (error) { console.error('[auth] updateMyProfile', error); return c.json({ success: false, message: error.message }); }

  const storedPath   = noPhoto(data.profile_image) ? '' : data.profile_image ?? '';
  const profileImage = await getProfileSignedUrl(actor.id, storedPath);
  return c.json({ success: true, profileImage, fullName: data.full_name, email: data.email ?? '', phone: data.phone ?? '' });
});

router.post('/verifyPassword', async c => {
  const u = await requireUser(c);
  const v = zv(c, VerifyPasswordSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { data: row } = await sb.from('app_users').select('password_hash').eq('id', u.id).single<Pick<AppUser, 'password_hash'>>();
  if (!row) return c.json({ success: false, message: 'User not found.' });
  const ok = await bcrypt.compare(v.data.password, row.password_hash);
  return c.json(ok ? { success: true } : { success: false, message: 'Incorrect password.' });
});

export default router;
