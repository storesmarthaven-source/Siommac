// routes/trustedDevices.ts — Trusted Device self-service management (Phase B3a)
//
// All routes are self-service (requireUser) — no new permission keys needed.
// Mounted at /api/auth/trusted-devices/* in api.ts.
//
// POST /api/auth/trusted-devices/list       — list active devices
// POST /api/auth/trusted-devices/revoke     — revoke one device
// POST /api/auth/trusted-devices/revoke-all — revoke all + rotate stamp

import { Hono }         from 'hono';
import { z }            from 'zod';
import { getCookie, deleteCookie } from 'hono/cookie';
import { requireUser }  from '../lib/auth';
import { requireStepUp } from '../lib/stepUp';
import {
  COOKIE_NAME as TD_COOKIE_NAME,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  verifyTrustedDevice,
} from '../lib/trustedDevices';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const RevokeSchema = z.object({
  trustedDeviceId: z.string().min(1).max(64),
});

// ── POST /list ────────────────────────────────────────────────────────────────
// Returns all non-revoked trusted devices for the calling user.
// Marks the current request's device (if any) as `currentDevice: true`.

router.post('/list', async c => {
  const user = await requireUser(c);

  const devices = await listTrustedDevices(user.id);

  // Identify the current device by matching the request cookie
  const tdCookie = getCookie(c, TD_COOKIE_NAME);
  let currentDeviceId: string | null = null;

  if (tdCookie) {
    const verResult = await verifyTrustedDevice({
      userId:      user.id,
      cookieValue: tdCookie,
      ipAddress:   (c.get('clientIp') as string | undefined) ?? undefined,
    });
    if (verResult.trusted) {
      currentDeviceId = verResult.device.id;
    }
  }

  const mapped = devices.map(d => ({
    id:           d.id,
    label:        d.label,
    browserName:  d.browser_name,
    osName:       d.os_name,
    deviceType:   d.device_type,
    createdAt:    d.created_at,
    lastUsedAt:   d.last_used_at,
    trustedUntil: d.trusted_until,
    method:       d.created_with_method,
    currentDevice: d.id === currentDeviceId,
  }));

  return c.json({ success: true, devices: mapped });
});

// ── POST /revoke ──────────────────────────────────────────────────────────────
// Revoke a single trusted device by ID.
// If the device being revoked is the current device, also clears the cookie.

router.post('/revoke', async c => {
  const user = await requireUser(c);
  const body = c.get('body').args ?? c.get('body');
  const v    = RevokeSchema.safeParse(body);
  if (!v.success) {
    return c.json({ success: false, message: 'trustedDeviceId is required.' }, 400);
  }

  const { trustedDeviceId } = v.data;

  await revokeTrustedDevice(user.id, trustedDeviceId, user.id, 'user_revoke');

  // If this was the current device, clear the cookie
  const tdCookie = getCookie(c, TD_COOKIE_NAME);
  if (tdCookie) {
    const verResult = await verifyTrustedDevice({
      userId:      user.id,
      cookieValue: tdCookie,
      ipAddress:   (c.get('clientIp') as string | undefined) ?? undefined,
    });
    // Even if the verify returns trusted=false (we just revoked it), we can check
    // by the device id we matched. Re-verify is best-effort; clear the cookie
    // if the current device matches the revoked id.
    if (!verResult.trusted || (verResult.trusted && verResult.device.id === trustedDeviceId)) {
      deleteCookie(c, TD_COOKIE_NAME, { path: '/' });
    }
  }

  return c.json({ success: true });
});

// ── POST /revoke-all ──────────────────────────────────────────────────────────
// Revoke ALL trusted devices for the user, rotate the security stamp, and
// clear the current device cookie.  Requires step-up (high-risk action).

router.post('/revoke-all', async c => {
  const user = await requireStepUp(c);  // step-up: revoking all devices is high-risk

  await revokeAllTrustedDevices(user.id);

  // Clear cookie regardless
  deleteCookie(c, TD_COOKIE_NAME, { path: '/' });

  return c.json({ success: true });
});

export default router;
