// routes/adminSecurity.ts — Admin cross-user security management (Phase B4a)
//
// All routes require:
//   • The relevant permission key (auth.security.* or auth.passkeys.*)
//   • Step-up authentication for any destructive action
//
// Mounted at /api/admin/security/* in api.ts.
//
// POST /api/admin/security/users/status              — view a user's security posture
// POST /api/admin/security/users/passkeys/revoke-all — revoke all passkeys for a user
// POST /api/admin/security/users/trusted-devices/revoke-all — revoke all trusted devices
// POST /api/admin/security/policy/update             — set MFA-mandatory roles (DB-backed)

import { Hono }             from 'hono';
import { z }                from 'zod';
import { requirePermission, requireUser } from '../lib/auth';
import { requireStepUp }    from '../lib/stepUp';
import { checkAuthMutationLimit, checkAuthReadLimit } from '../lib/ratelimit';
import { sb }               from '../lib/db';
import { emitAppEvent }     from '../lib/appEvents';
import { zv }               from '../lib/validate';
import {
  revokeAllTrustedDevices,
  rotateSecurityStamp,
} from '../lib/trustedDevices';
import { isTwoFactorMandatory } from '../lib/totp';
import { getPublicPolicy, invalidatePolicyCache } from '../lib/securityPolicy';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UserIdSchema = z.object({
  userId: z.string().min(1).max(64),
});

// ── POST /api/admin/security/users/status ─────────────────────────────────────
// Returns a security overview for the target user (no step-up required — read-only).

router.post('/users/status', async c => {
  const actor = await requirePermission(c, 'auth.security.view');
  const rl = await checkAuthReadLimit.check(actor.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const body = c.get('body');
  const v    = zv(c, UserIdSchema, body.args ?? body);
  if (!v.ok) return v.response;

  const { userId } = v.data;

  // Fetch the target user
  const { data: target, error: targetError } = await sb
    .from('app_users')
    .select('id, role, totp_enabled')
    .eq('id', userId)
    .maybeSingle<{ id: string; role: string; totp_enabled: boolean }>();

  if (targetError) throw new Error(`Security status user read failed: ${targetError.message}`);
  if (!target) {
    return c.json({ success: false, message: 'User not found.' }, 404);
  }

  // Passkey count
  const { count: passkeyCount, error: passkeyError } = await sb
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (passkeyError) throw new Error(`Security status passkey read failed: ${passkeyError.message}`);

  // Active trusted device count (non-revoked, non-expired)
  const { count: trustedDeviceCount, error: trustedDeviceError } = await sb
    .from('auth_trusted_devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('trusted_until', new Date().toISOString());
  if (trustedDeviceError) throw new Error(`Security status trusted-device read failed: ${trustedDeviceError.message}`);

  // The app's authenticated session ledger is the authoritative source for the
  // most recent successful sign-in/session activity. It contains no secret here;
  // only the timestamp is exposed behind auth.security.view.
  const { data: activeSession, error: sessionError } = await sb
    .from('refresh_tokens')
    .select('last_seen_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ last_seen_at: string | null }>();
  if (sessionError) throw new Error(`Security status session read failed: ${sessionError.message}`);

  return c.json({
    success: true,
    totpEnabled:         target.totp_enabled,
    passkeyCount:        passkeyCount ?? 0,
    trustedDeviceCount:  trustedDeviceCount ?? 0,
    mfaMandatory:        isTwoFactorMandatory(target.role),
    lastSeenAt:          activeSession?.last_seen_at ?? null,
  });
});

// ── POST /api/admin/security/users/passkeys/revoke-all ────────────────────────
// Revoke ALL passkeys for a target user (admin action, requires step-up).

router.post('/users/passkeys/revoke-all', async c => {
  const actor = await requirePermission(c, 'auth.passkeys.admin_revoke');
  await requireStepUp(c);
  const rl = await checkAuthMutationLimit.check(actor.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const body = c.get('body');
  const v    = zv(c, UserIdSchema, body.args ?? body);
  if (!v.ok) return v.response;

  const { userId } = v.data;

  // Ensure the target user exists
  const { data: target } = await sb
    .from('app_users')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle<{ id: string; username: string }>();

  if (!target) {
    return c.json({ success: false, message: 'User not found.' }, 404);
  }

  // Delete all webauthn credentials for this user
  const { error } = await sb
    .from('webauthn_credentials')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[adminSecurity] passkeys/revoke-all failed:', error);
    return c.json({ success: false, message: 'Failed to revoke passkeys.' }, 500);
  }

  // Rotate security stamp — invalidates trusted devices bound to the old factor state
  await rotateSecurityStamp(userId, 'admin_passkeys_revoked');

  void emitAppEvent({
    eventType:        'auth.passkey.admin_revoked',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   userId,
    actorUserId:      actor.id,
    severity:         'high',
    payload:          {
      targetUserId: userId,
      targetUsername: target.username,
      actorUsername:  actor.username,
    },
  });

  return c.json({ success: true });
});

// ── POST /api/admin/security/users/trusted-devices/revoke-all ────────────────
// Revoke ALL trusted devices for a target user (admin action, requires step-up).

router.post('/users/trusted-devices/revoke-all', async c => {
  const actor = await requirePermission(c, 'auth.trusted_devices.admin_revoke');
  await requireStepUp(c);
  const rl = await checkAuthMutationLimit.check(actor.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const body = c.get('body');
  const v    = zv(c, UserIdSchema, body.args ?? body);
  if (!v.ok) return v.response;

  const { userId } = v.data;

  // Ensure the target user exists
  const { data: target } = await sb
    .from('app_users')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle<{ id: string; username: string }>();

  if (!target) {
    return c.json({ success: false, message: 'User not found.' }, 404);
  }

  await revokeAllTrustedDevices(userId);

  void emitAppEvent({
    eventType:        'auth.trusted_devices.admin_revoked',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   userId,
    actorUserId:      actor.id,
    severity:         'high',
    payload:          {
      targetUserId:   userId,
      targetUsername: target.username,
      actorUsername:  actor.username,
    },
  });

  return c.json({ success: true });
});

// ── POST /api/auth/security/policy ───────────────────────────────────────────
// Returns the non-secret policy fields any authenticated user can read.
// (Mounted separately at /api/auth/security/policy — see api.ts.)

export const policyReadRouter = new Hono<{ Variables: HonoVariables }>();

policyReadRouter.post('/policy', async c => {
  // Any authenticated user may read policy (used by the step-up dialog etc.)
  const u = await requireUser(c);
  const rl = await checkAuthReadLimit.check(u.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many requests. Try again in ${rl.retryAfter}s.` }, 429);
  }

  return c.json({
    success: true,
    policy:  await getPublicPolicy(),
  });
});

// ── POST /api/admin/security/policy/update ────────────────────────────────────
// Superadmin-only (auth.security.manage_policy + step-up): set the MFA-mandatory
// roles, persisted to auth_security_policy and enforced by lib/securityPolicy.
// MFA is the DB-backed, enforceable knob; trusted-device / passkey / step-up knobs
// remain env-controlled, so the schema is strict — it only accepts what it honours
// (unknown fields are rejected, never silently dropped).
const PolicyUpdateSchema = z.object({
  requireMfaRoles: z.array(z.enum(['admin', 'manager', 'superadmin'])),
}).strict();

router.post('/policy/update', async c => {
  const actor = await requirePermission(c, 'auth.security.manage_policy');
  await requireStepUp(c);
  const rl = await checkAuthMutationLimit.check(actor.id);
  if (!rl.ok) {
    return c.json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s.` }, 429);
  }

  const body = c.get('body');
  const v    = zv(c, PolicyUpdateSchema, body.args ?? body);
  if (!v.ok) return v.response;

  const roles = new Set(v.data.requireMfaRoles);
  const { error } = await sb.from('auth_security_policy').update({
    require_mfa_for_admin:       roles.has('admin'),
    require_mfa_for_manager:     roles.has('manager'),
    require_mfa_for_super_admin: roles.has('superadmin'),
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  }).eq('id', 'default');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  invalidatePolicyCache();   // next login reads the new policy without waiting out the TTL
  void emitAppEvent({
    eventType:        'auth.security.policy_updated',
    sourceModule:     'auth',
    sourceEntityType: 'security_policy',
    sourceEntityId:   'default',
    actorUserId:      actor.id,
    severity:         'warning',
    payload:          { requireMfaRoles: [...roles] },
  });
  return c.json({ success: true, policy: await getPublicPolicy() });
});

export default router;
