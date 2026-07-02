// routes/auth2fa.ts — Post-login TOTP self-service (Phase B1)
//
// All routes here require a valid session JWT (requireUser).
// They are session-authenticated, NOT pre-auth token flows.
// The pre-auth (login-time) TOTP routes live in routes/auth.ts.
//
// Mounted at /api/auth/2fa/* in api.ts.

import { Hono }    from 'hono';
import { sb }      from '../lib/db';
import { requireUser } from '../lib/auth';
import { checkAuthMutationLimit, checkCodeVerifyLimit, checkAuthReadLimit } from '../lib/ratelimit';
import {
  zv, z,
} from '../lib/validate';
import {
  generateTotpSecret,
  buildQrCode,
  verifyCode,
  generateBackupCodes,
  consumeBackupCode,
  isTwoFactorMandatory,
} from '../lib/totp';
import { emitAppEvent } from '../lib/appEvents';
import { rotateSecurityStamp } from '../lib/trustedDevices';
import type { HonoVariables } from '../../../types/api';
import type { AppUser }       from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Shared Zod primitives ─────────────────────────────────────────────────────

// 6-digit TOTP or 8-char backup code — accepted by confirm / disable / regen
const zAnyTotpCode = z.string()
  .min(6).max(8)
  .regex(/^(\d{6}|[A-Z0-9]{8})$/i, 'Must be a 6-digit TOTP code or 8-character backup code');

const ConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit TOTP code'),
});

const DisableSchema  = z.object({ code: zAnyTotpCode });
const RegenSchema    = z.object({ code: zAnyTotpCode });

// ── Helper: verify a TOTP code OR a backup code against a user ────────────────

async function verifyAnyCode(u: AppUser, code: string): Promise<boolean> {
  if (/^\d{6}$/.test(code)) {
    if (!u.totp_secret) return false;
    return verifyCode(u.totp_secret, code);
  }
  // 8-char backup code
  return consumeBackupCode(u, code);
}

// ── POST /api/auth/2fa/status ─────────────────────────────────────────────────
// Returns current TOTP enrollment state for the authenticated user.

router.post('/status', async c => {
  const u = await requireUser(c);
  const rl = await checkAuthReadLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const codesRemaining = (u.backup_codes ?? []).filter(Boolean).length;
  return c.json({
    success:              true,
    enabled:              u.totp_enabled,
    enrolledAt:           u.totp_enrolled_at ?? null,
    hasBackupCodes:       codesRemaining > 0,
    backupCodesRemaining: codesRemaining,
    mandatory:            isTwoFactorMandatory(u.role),
  });
});

// ── POST /api/auth/2fa/setup ──────────────────────────────────────────────────
// Generate a fresh TOTP secret, store it (disabled until confirmed).
// Returns { qrDataUrl, secret, otpauthUrl } — secret shown to user once.

router.post('/setup', async c => {
  const u = await requireUser(c);
  const rl = await checkAuthReadLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const [plain, encrypted] = generateTotpSecret();
  const qrDataUrl = await buildQrCode(plain, u.username);

  // Write the pending secret (totp_enabled remains false until /confirm).
  // Any previous pending secret is overwritten — safe.
  await sb.from('app_users')
    .update({ totp_secret: encrypted })
    .eq('id', u.id);

  // Build the otpauth URI so the frontend can show both QR + manual copy
  const otpauthUrl = `otpauth://totp/Siomac:${encodeURIComponent(u.username)}?secret=${plain}&issuer=Siomac`;

  return c.json({
    success:    true,
    qrDataUrl,
    secret:     plain,     // plaintext shown ONCE — never stored in plaintext
    otpauthUrl,
  });
});

// ── POST /api/auth/2fa/confirm ────────────────────────────────────────────────
// Verify the 6-digit TOTP code against the pending secret, enable 2FA,
// generate + return backup codes (shown ONCE).

router.post('/confirm', async c => {
  const u = await requireUser(c);
  const rl = await checkCodeVerifyLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const v = zv(c, ConfirmSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  if (!u.totp_secret) {
    return c.json({
      success: false,
      message: 'No pending setup found. Please start setup again.',
    }, 400);
  }

  if (!verifyCode(u.totp_secret, v.data.code)) {
    return c.json({
      success: false,
      message: 'Invalid code. Make sure your authenticator app is synced and try again.',
    }, 400);
  }

  const [plains, hashes] = await generateBackupCodes();
  await sb.from('app_users').update({
    totp_enabled:     true,
    totp_enrolled_at: new Date().toISOString(),
    backup_codes:     hashes,
  }).eq('id', u.id);

  // Rotate security stamp — invalidates all trusted devices (new factor = fresh trust required)
  void rotateSecurityStamp(u.id, 'totp_enabled');

  void emitAppEvent({
    eventType:        'auth.totp.enabled',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   u.id,
    actorUserId:      u.id,
    severity:         'info',
    payload:          { username: u.username, role: u.role },
  });

  return c.json({
    success:     true,
    backupCodes: plains,  // plaintext — shown ONCE
  });
});

// ── POST /api/auth/2fa/disable ────────────────────────────────────────────────
// Disable TOTP. Requires a current TOTP code (or backup code).
// Blocked by last-factor guard for mandatory roles.

router.post('/disable', async c => {
  const u = await requireUser(c);
  const rl = await checkAuthMutationLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const v = zv(c, DisableSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  // Last-factor guard: mandatory roles cannot remove the only strong factor.
  if (isTwoFactorMandatory(u.role)) {
    return c.json({
      success: false,
      code:    'last_factor',
      message: 'Two-factor is required for your role and cannot be disabled.',
    }, 400);
  }

  if (!u.totp_enabled || !u.totp_secret) {
    return c.json({ success: false, message: 'Two-factor authentication is not enabled.' }, 400);
  }

  // Re-fetch to get fresh backup_codes for consumeBackupCode
  const { data: fresh } = await sb
    .from('app_users')
    .select('*')
    .eq('id', u.id)
    .single<AppUser>();

  if (!fresh) return c.json({ success: false, message: 'User not found.' }, 404);

  const ok = await verifyAnyCode(fresh, v.data.code);
  if (!ok) {
    return c.json({ success: false, message: 'Invalid code. Please try again.' }, 400);
  }

  await sb.from('app_users').update({
    totp_secret:      null,
    totp_enabled:     false,
    totp_enrolled_at: null,
    backup_codes:     null,
  }).eq('id', u.id);

  // Rotate security stamp — factor removed, all trusted devices must re-authenticate
  void rotateSecurityStamp(u.id, 'totp_disabled');

  void emitAppEvent({
    eventType:        'auth.totp.disabled',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   u.id,
    actorUserId:      u.id,
    severity:         'warning',
    payload:          { username: u.username, role: u.role },
  });

  return c.json({ success: true });
});

// ── POST /api/auth/2fa/backup-codes/regenerate ────────────────────────────────
// Verify current TOTP code, then regenerate backup codes.
// Returns new codes ONCE.

router.post('/backup-codes/regenerate', async c => {
  const u = await requireUser(c);
  const rl = await checkAuthMutationLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }
  const v = zv(c, RegenSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  if (!u.totp_enabled || !u.totp_secret) {
    return c.json({ success: false, message: 'Two-factor authentication is not enabled.' }, 400);
  }

  // Re-fetch for fresh backup_codes (needed by consumeBackupCode)
  const { data: fresh } = await sb
    .from('app_users')
    .select('*')
    .eq('id', u.id)
    .single<AppUser>();

  if (!fresh) return c.json({ success: false, message: 'User not found.' }, 404);

  const ok = await verifyAnyCode(fresh, v.data.code);
  if (!ok) {
    return c.json({ success: false, message: 'Invalid code. Please enter your current authenticator code.' }, 400);
  }

  const [plains, hashes] = await generateBackupCodes();
  await sb.from('app_users').update({ backup_codes: hashes }).eq('id', u.id);

  // Rotate security stamp — new backup codes = changed factor state, invalidate trusted devices
  void rotateSecurityStamp(u.id, 'backup_codes_regenerated');

  void emitAppEvent({
    eventType:        'auth.totp.backup_codes_regenerated',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   u.id,
    actorUserId:      u.id,
    severity:         'warning',
    payload:          { username: u.username, role: u.role },
  });

  return c.json({
    success:     true,
    backupCodes: plains,  // plaintext — shown ONCE
  });
});

export default router;
