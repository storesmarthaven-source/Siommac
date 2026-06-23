// lib/trustedDevices.ts — Trusted Device / "Remember this device" MFA bypass
//
// A trusted device is issued ONLY after a successful TOTP code or passkey
// second-factor. It is NEVER issued after a backup-code or password-only auth.
//
// Security properties:
//   • Raw deviceId and deviceSecret are never stored server-side.
//   • Only HMAC-SHA256(value, PEPPER) is stored.
//   • Cookie value = "v1.<deviceId>.<deviceSecret>.<sig>" where
//     sig = HMAC-SHA256("v1." + deviceId + "." + deviceSecret, PEPPER).
//   • Verification uses crypto.timingSafeEqual to prevent timing attacks.
//   • A per-user security_stamp links all device rows to the user's factor
//     state; rotating the stamp (on any factor change) atomically invalidates
//     every trusted device without a DB scan.

import crypto     from 'crypto';
import { sb }     from './db';
import { emitAppEvent } from './appEvents';

// ── Config & constants ────────────────────────────────────────────────────────

const DEV_PEPPER_FALLBACK = '__dev_trusted_device_pepper_DO_NOT_USE_IN_PRODUCTION__';

function getPepper(): string {
  const p = process.env.TRUSTED_DEVICE_PEPPER ?? '';
  if (!p) {
    console.warn(
      '[trustedDevices] TRUSTED_DEVICE_PEPPER env var is not set — ' +
      'using an insecure dev fallback. SET THIS IN PRODUCTION.',
    );
    return DEV_PEPPER_FALLBACK;
  }
  return p;
}

export const trustedDevicesEnabled = true;

export const COOKIE_NAME = 'siomac_td';

/** TTL in days per role. Controls how long a trusted-device bypass is valid. */
const TTL_BY_ROLE: Record<string, number> = {
  superadmin: 7,
  admin:      14,
  manager:    14,
  employee:   30,
};

export function ttlDaysForRole(role: string): number {
  return TTL_BY_ROLE[role] ?? 30;
}

/** True unless policy denies for the role (currently all roles are eligible). */
export function shouldOfferTrustedDevice(_role: string): boolean {
  return trustedDevicesEnabled;
}

// ── HMAC helpers ──────────────────────────────────────────────────────────────

function hmacHex(data: string): string {
  return crypto
    .createHmac('sha256', getPepper())
    .update(data)
    .digest('hex');
}

function hmacHexBuf(data: string): Buffer {
  return crypto
    .createHmac('sha256', getPepper())
    .update(data)
    .digest();
}

// ── Cookie value encoding / decoding ─────────────────────────────────────────

/** Build cookie value: "v1.<deviceId>.<deviceSecret>.<sig>" */
function buildCookieValue(deviceId: string, deviceSecret: string): string {
  const body = `v1.${deviceId}.${deviceSecret}`;
  const sig  = hmacHex(body);
  return `${body}.${sig}`;
}

interface ParsedCookie {
  deviceId:     string;
  deviceSecret: string;
}

/**
 * Parse and verify a cookie value.
 * Returns null if the format is wrong OR the signature does not match.
 * Uses timingSafeEqual to prevent timing attacks.
 */
function parseCookieValue(cookieValue: string): ParsedCookie | null {
  // Expected: "v1.<deviceId>.<deviceSecret>.<sig>"
  const parts = cookieValue.split('.');
  if (parts.length < 4) return null;
  // sig is the last segment; everything before it is the signed body
  const sig  = parts[parts.length - 1];
  if (!sig) return null;
  const body = parts.slice(0, -1).join('.');
  // version check
  if (!body.startsWith('v1.')) return null;

  // Recompute expected sig
  const expectedSigBuf = hmacHexBuf(body);
  const actualSigBuf   = Buffer.from(sig, 'hex');

  if (expectedSigBuf.length !== actualSigBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedSigBuf, actualSigBuf)) return null;

  // body = "v1.<deviceId>.<deviceSecret>"
  const inner = body.slice(3); // remove "v1."
  const dotIdx = inner.indexOf('.');
  if (dotIdx < 0) return null;
  const deviceId     = inner.slice(0, dotIdx);
  const deviceSecret = inner.slice(dotIdx + 1);

  if (!deviceId || !deviceSecret) return null;
  return { deviceId, deviceSecret };
}

// ── UA parsing (best-effort, no external deps) ────────────────────────────────

interface ParsedUA {
  browserName: string | null;
  osName:      string | null;
  deviceType:  string | null;
  label:       string | null;
}

function parseUserAgent(ua: string | undefined | null): ParsedUA {
  if (!ua) return { browserName: null, osName: null, deviceType: null, label: null };

  let browserName: string | null = null;
  let osName:      string | null = null;
  let deviceType:  string | null = 'desktop';

  // Browser
  if (/Edg\//.test(ua))                            browserName = 'Edge';
  else if (/OPR\/|Opera/.test(ua))                 browserName = 'Opera';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browserName = 'Chrome';
  else if (/Firefox\//.test(ua))                   browserName = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua))   browserName = 'Safari';
  else if (/MSIE|Trident/.test(ua))                browserName = 'Internet Explorer';

  // OS
  if (/Windows NT/.test(ua))           osName = 'Windows';
  else if (/Mac OS X/.test(ua))        osName = 'macOS';
  else if (/Linux/.test(ua))           osName = 'Linux';
  else if (/Android/.test(ua))       { osName = 'Android';  deviceType = 'mobile'; }
  else if (/iPhone|iPad/.test(ua))   { osName = 'iOS';      deviceType = /iPad/.test(ua) ? 'tablet' : 'mobile'; }

  // Friendly label
  const parts: string[] = [];
  if (browserName) parts.push(browserName);
  if (osName)      parts.push(`on ${osName}`);
  const label = parts.length > 0 ? parts.join(' ') : null;

  return { browserName, osName, deviceType, label };
}

// ── Security state ────────────────────────────────────────────────────────────

interface SecurityState {
  user_id:        string;
  security_stamp: string;
}

/**
 * Read (or lazily create) the security state row for a user.
 * On first creation a random stamp is generated.
 */
export async function getUserSecurityState(userId: string): Promise<SecurityState> {
  const { data: existing } = await sb
    .from('auth_user_security_state')
    .select('user_id, security_stamp')
    .eq('user_id', userId)
    .maybeSingle<SecurityState>();

  if (existing) return existing;

  // First time — create with a fresh random stamp
  const stamp = crypto.randomBytes(32).toString('hex');
  const { data: created, error } = await sb
    .from('auth_user_security_state')
    .insert({ user_id: userId, security_stamp: stamp })
    .select('user_id, security_stamp')
    .single<SecurityState>();

  if (error || !created) {
    // Race: row was inserted by a concurrent request — re-read
    const { data: retry } = await sb
      .from('auth_user_security_state')
      .select('user_id, security_stamp')
      .eq('user_id', userId)
      .single<SecurityState>();
    if (!retry) throw new Error('[trustedDevices] failed to create/read security state');
    return retry;
  }

  return created;
}

/**
 * Rotate the security stamp (invalidates all trusted devices).
 * Called whenever a user's strong factors change.
 */
export async function rotateSecurityStamp(
  userId: string,
  reason: string,
): Promise<void> {
  const newStamp = crypto.randomBytes(32).toString('hex');
  await sb
    .from('auth_user_security_state')
    .upsert({
      user_id:                 userId,
      security_stamp:          newStamp,
      strong_factor_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  void emitAppEvent({
    eventType:        'auth.security_stamp.rotated',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   userId,
    actorUserId:      userId,
    severity:         'warning',
    payload:          { reason },
  });
}

// ── Device rows ───────────────────────────────────────────────────────────────

export interface TrustedDeviceRow {
  id:                  string;
  user_id:             string;
  device_id_hash:      string;
  device_secret_hash:  string;
  label:               string | null;
  browser_name:        string | null;
  os_name:             string | null;
  device_type:         string | null;
  user_agent_hash:     string | null;
  first_ip:            string | null;
  last_ip:             string | null;
  created_at:          string;
  last_used_at:        string | null;
  trusted_until:       string;
  created_with_method: 'totp' | 'webauthn';
  security_stamp:      string;
  revoked_at:          string | null;
  revoked_by:          string | null;
  revoke_reason:       string | null;
  metadata:            Record<string, unknown>;
}

export interface CreateTrustedDeviceInput {
  userId:      string;
  method:      'totp' | 'webauthn';
  label?:      string;
  userAgent?:  string;
  ipAddress?:  string;
  ttlDays:     number;
}

export interface CreateTrustedDeviceResult {
  row:         TrustedDeviceRow;
  cookieValue: string;
}

/**
 * Create a new trusted device record.
 * Generates a random deviceId + deviceSecret, hashes both with PEPPER,
 * stores only the hashes, and returns the cookie value to send to the client.
 */
export async function createTrustedDevice(
  input: CreateTrustedDeviceInput,
): Promise<CreateTrustedDeviceResult> {
  const { userId, method, userAgent, ipAddress, ttlDays } = input;

  // Generate raw credentials (NEVER stored)
  const deviceId     = crypto.randomBytes(32).toString('base64url');
  const deviceSecret = crypto.randomBytes(48).toString('base64url');

  // Hash with PEPPER for storage
  const deviceIdHash     = hmacHex(deviceId);
  const deviceSecretHash = hmacHex(deviceSecret);
  const userAgentHash    = userAgent ? hmacHex(userAgent) : null;

  // Current security stamp (binds device to factor state)
  const state        = await getUserSecurityState(userId);
  const securityStamp = state.security_stamp;

  // Build friendly label from UA
  const parsed = parseUserAgent(userAgent);
  const label  = input.label ?? parsed.label;

  const id          = `TD-${crypto.randomUUID()}`;
  const trustedUntil = new Date(Date.now() + ttlDays * 86400 * 1000).toISOString();
  const now          = new Date().toISOString();

  const rowData = {
    id,
    user_id:             userId,
    device_id_hash:      deviceIdHash,
    device_secret_hash:  deviceSecretHash,
    label:               label ?? null,
    browser_name:        parsed.browserName,
    os_name:             parsed.osName,
    device_type:         parsed.deviceType,
    user_agent_hash:     userAgentHash,
    first_ip:            ipAddress ?? null,
    last_ip:             ipAddress ?? null,
    created_at:          now,
    last_used_at:        now,
    trusted_until:       trustedUntil,
    created_with_method: method,
    security_stamp:      securityStamp,
    revoked_at:          null,
    revoked_by:          null,
    revoke_reason:       null,
    metadata:            {},
  };

  const { data: row, error } = await sb
    .from('auth_trusted_devices')
    .insert(rowData)
    .select('*')
    .single<TrustedDeviceRow>();

  if (error || !row) {
    console.error('[trustedDevices] createTrustedDevice insert failed:', error);
    throw new Error('Failed to create trusted device');
  }

  const cookieValue = buildCookieValue(deviceId, deviceSecret);

  void emitAppEvent({
    eventType:        'auth.trusted_device.created',
    sourceModule:     'auth',
    sourceEntityType: 'auth_trusted_devices',
    sourceEntityId:   id,
    actorUserId:      userId,
    severity:         'info',
    payload:          { method, label, deviceType: parsed.deviceType, osName: parsed.osName },
  });

  return { row, cookieValue };
}

// ── Verification ──────────────────────────────────────────────────────────────

export type VerifyResult =
  | { trusted: true;  device: TrustedDeviceRow }
  | { trusted: false; reason: string };

/**
 * Verify a trusted-device cookie and return whether the device is still trusted.
 * Never throws — always returns a discriminated union.
 */
export async function verifyTrustedDevice(input: {
  userId:      string;
  cookieValue: string;
  ipAddress?:  string;
}): Promise<VerifyResult> {
  const { userId, cookieValue, ipAddress } = input;

  try {
    // 1. Parse and verify cookie signature
    const parsed = parseCookieValue(cookieValue);
    if (!parsed) return { trusted: false, reason: 'invalid_cookie_signature' };

    // 2. Hash deviceId to look up the row
    const deviceIdHash = hmacHex(parsed.deviceId);

    // 3. Fetch the row
    const { data: row } = await sb
      .from('auth_trusted_devices')
      .select('*')
      .eq('device_id_hash', deviceIdHash)
      .maybeSingle<TrustedDeviceRow>();

    if (!row)                        return { trusted: false, reason: 'device_not_found' };
    if (row.user_id !== userId)      return { trusted: false, reason: 'user_mismatch' };
    if (row.revoked_at)              return { trusted: false, reason: 'device_revoked' };
    if (new Date(row.trusted_until) < new Date()) return { trusted: false, reason: 'device_expired' };

    // 4. Validate security stamp (detects factor changes since device was created)
    const state = await getUserSecurityState(userId);
    if (row.security_stamp !== state.security_stamp) {
      return { trusted: false, reason: 'security_stamp_mismatch' };
    }

    // 5. Verify device secret (timing-safe)
    const expectedSecretBuf = Buffer.from(hmacHex(parsed.deviceSecret), 'hex');
    const storedSecretBuf   = Buffer.from(row.device_secret_hash, 'hex');

    if (expectedSecretBuf.length !== storedSecretBuf.length) {
      return { trusted: false, reason: 'secret_mismatch' };
    }
    if (!crypto.timingSafeEqual(expectedSecretBuf, storedSecretBuf)) {
      return { trusted: false, reason: 'secret_mismatch' };
    }

    // 6. Update last_used_at and last_ip (best-effort, non-blocking)
    const now = new Date().toISOString();
    void sb
      .from('auth_trusted_devices')
      .update({ last_used_at: now, last_ip: ipAddress ?? row.last_ip })
      .eq('id', row.id);

    void emitAppEvent({
      eventType:        'auth.trusted_device.used',
      sourceModule:     'auth',
      sourceEntityType: 'auth_trusted_devices',
      sourceEntityId:   row.id,
      actorUserId:      userId,
      severity:         'info',
      payload:          { deviceId: row.id, label: row.label },
    });

    return { trusted: true, device: row };
  } catch (err) {
    console.error('[trustedDevices] verifyTrustedDevice error:', err);
    return { trusted: false, reason: 'internal_error' };
  }
}

// ── List / revoke ─────────────────────────────────────────────────────────────

export async function listTrustedDevices(userId: string): Promise<TrustedDeviceRow[]> {
  const { data, error } = await sb
    .from('auth_trusted_devices')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[trustedDevices] listTrustedDevices error:', error);
    return [];
  }
  return (data ?? []) as TrustedDeviceRow[];
}

export async function revokeTrustedDevice(
  userId:    string,
  id:        string,
  revokedBy: string,
  reason:    string,
): Promise<void> {
  await sb
    .from('auth_trusted_devices')
    .update({
      revoked_at:    new Date().toISOString(),
      revoked_by:    revokedBy,
      revoke_reason: reason,
    })
    .eq('id', id)
    .eq('user_id', userId);   // scope to owning user

  void emitAppEvent({
    eventType:        'auth.trusted_device.revoked',
    sourceModule:     'auth',
    sourceEntityType: 'auth_trusted_devices',
    sourceEntityId:   id,
    actorUserId:      userId,
    severity:         'warning',
    payload:          { reason, revokedBy },
  });
}

export async function revokeAllTrustedDevices(userId: string): Promise<void> {
  const now = new Date().toISOString();

  // Revoke all active rows
  await sb
    .from('auth_trusted_devices')
    .update({
      revoked_at:    now,
      revoked_by:    userId,
      revoke_reason: 'user_revoke_all',
    })
    .eq('user_id', userId)
    .is('revoked_at', null);

  // Update security state
  await sb
    .from('auth_user_security_state')
    .upsert(
      { user_id: userId, trusted_devices_revoked_at: now },
      { onConflict: 'user_id' },
    );

  // Rotate stamp (invalidates any in-flight devices)
  await rotateSecurityStamp(userId, 'user_revoke_all');

  void emitAppEvent({
    eventType:        'auth.trusted_devices.revoked_all',
    sourceModule:     'auth',
    sourceEntityType: 'user',
    sourceEntityId:   userId,
    actorUserId:      userId,
    severity:         'high',
    payload:          {},
  });
}
