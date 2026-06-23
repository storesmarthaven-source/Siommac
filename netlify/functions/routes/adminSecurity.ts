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
// POST /api/admin/security/policy/update             — update org security policy (v1: no-op)

import { Hono }             from 'hono';
import { z }                from 'zod';
import { requirePermission, requireUser } from '../lib/auth';
import { requireStepUp }    from '../lib/stepUp';
import { sb }               from '../lib/db';
import { emitAppEvent }     from '../lib/appEvents';
import { zv }               from '../lib/validate';
import {
  revokeAllTrustedDevices,
  rotateSecurityStamp,
} from '../lib/trustedDevices';
import { isTwoFactorMandatory } from '../lib/totp';
import { getPublicPolicy }      from '../lib/securityPolicy';
import type { HonoVariables } from '../../../types/api';
import type { AppUser }       from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const UserIdSchema = z.object({
  userId: z.string().min(1).max(64),
});

// ── POST /api/admin/security/users/status ─────────────────────────────────────
// Returns a security overview for the target user (no step-up required — read-only).

router.post('/users/status', async c => {
  await requirePermission(c, 'auth.security.view');

  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, UserIdSchema, body.args ?? body);
  if (!v.ok) return v.response;

  const { userId } = v.data;

  // Fetch the target user
  const { data: target } = await sb
    .from('app_users')
    .select('id, role, totp_enabled')
    .eq('id', userId)
    .maybeSingle<{ id: string; role: string; totp_enabled: boolean }>();

  if (!target) {
    return c.json({ success: false, message: 'User not found.' }, 404);
  }

  // Passkey count
  const { count: passkeyCount } = await sb
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Active trusted device count (non-revoked, non-expired)
  const { count: trustedDeviceCount } = await sb
    .from('auth_trusted_devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('trusted_until', new Date().toISOString());

  return c.json({
    success: true,
    totpEnabled:         target.totp_enabled,
    passkeyCount:        passkeyCount ?? 0,
    trustedDeviceCount:  trustedDeviceCount ?? 0,
    mfaMandatory:        isTwoFactorMandatory(target.role),
  });
});

// ── POST /api/admin/security/users/passkeys/revoke-all ────────────────────────
// Revoke ALL passkeys for a target user (admin action, requires step-up).

router.post('/users/passkeys/revoke-all', async c => {
  const actor = await requirePermission(c, 'auth.passkeys.admin_revoke');
  await requireStepUp(c);

  const body = c.get('body') as Record<string, unknown>;
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

  const body = c.get('body') as Record<string, unknown>;
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
  await requireUser(c);

  return c.json({
    success: true,
    policy:  getPublicPolicy(),
  });
});

// ── POST /api/admin/security/policy/update ────────────────────────────────────
// Superadmin-only: update the organisation security policy.
// v1: validates input and returns not-implemented (no app_settings table yet).
// When an app_settings store is added, replace the stub body below.

const PolicyUpdateSchema = z.object({
  trustedDevicesEnabled:      z.boolean().optional(),
  trustedDeviceTtlByRole:     z.record(z.string(), z.number().int().positive()).optional(),
  requireMfaRoles:            z.array(z.string()).optional(),
  allowPasswordlessPasskey:   z.boolean().optional(),
  allowPasskeyAsSecondFactor: z.boolean().optional(),
  stepUpMaxAgeMinutes:        z.number().int().positive().max(60).optional(),
});

router.post('/policy/update', async c => {
  await requirePermission(c, 'auth.security.manage_policy');
  await requireStepUp(c);

  const body = c.get('body') as Record<string, unknown>;
  const v    = zv(c, PolicyUpdateSchema, body.args ?? body);
  if (!v.ok) return v.response;

  // v1: No persistent settings store exists yet. Validate the shape and
  // return a clear not-implemented so the frontend can gate the feature.
  // TODO: persist to app_settings when that table is created.
  return c.json({
    success: false,
    code:    'not_implemented',
    message: 'Policy persistence is not yet available. The policy is currently controlled via environment variables.',
    received: v.data,
  }, 501 as 200);
});

export default router;
