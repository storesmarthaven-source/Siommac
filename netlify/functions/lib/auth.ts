// lib/auth.ts — JWT access tokens, refresh token rotation, revocation
//
// Token strategy:
//   Access token  — signed JWT, 15-minute TTL, contains jti (unique ID). Sent to
//                   the client in the JSON body (held in memory/localStorage).
//   Refresh token — 256-bit random secret, 7-day TTL, stored hashed in DB and
//                   delivered ONLY as an httpOnly Secure cookie (never in JSON) —
//                   immune to XSS exfiltration. The refresh_tokens table is the
//                   server-side session table (device list, revocation).
//
// On login:  issue access token (JSON) + refresh token (httpOnly cookie)
// On refresh: validate cookie token hash, delete old row, issue new pair (rotation)
// On logout:  insert jti into token_revocations + delete refresh rows + clear cookie
// requireUser: verifies signature, checks exp, checks jti not in revocations

import jwt                  from 'jsonwebtoken';
import crypto               from 'crypto';
import type { Context, Next } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { isSecureRequest }  from './trustedDevices';
import { sb }               from './db';
import { resolveWithSet, loadRolePermissions, type PermissionOverrideRow } from './permissions';
import { getReqContext }    from './reqContext';
import type { AppUser }     from '../../../types/db';
import type { JwtPayload, HonoVariables } from '../../../types/api';

// ── Constants ─────────────────────────────────────────────────────────────────

// RS256 asymmetric signing (preferred). Private key signs; public key verifies.
// A leaked public key cannot mint tokens — the private key stays server-only.
const JWT_PRIVATE_KEY = (process.env.JWT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const JWT_PUBLIC_KEY  = (process.env.JWT_PUBLIC_KEY  ?? '').replace(/\\n/g, '\n');

// HS256 shared-secret fallback — kept during transition so existing sessions
// remain valid. Remove JWT_SECRET from env once all active tokens have expired
// (after 15 minutes on a rolling basis, or a forced logout of all users).
const JWT_SECRET = process.env.JWT_SECRET ?? '';

const USE_RS256            = Boolean(JWT_PRIVATE_KEY && JWT_PUBLIC_KEY);
const ACCESS_TOKEN_TTL     = '15m';
/** Access-token TTL in ms — returned to the client so it schedules its proactive
 *  refresh from the server's authoritative value (keep in sync with ACCESS_TOKEN_TTL). */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REVOCATION_TTL_DAYS  = 1;

// ── Refresh-token cookie (httpOnly — the browser never exposes it to JS) ──────
// Path-scoped to the API so it rides only on API calls. SameSite=Lax + the
// wrapped-args POST convention keeps cross-site abuse off the table; `secure`
// follows the request protocol so http://localhost dev still works (Firefox
// drops Secure cookies set over plain http).
export const RT_COOKIE_NAME = 'siomac_rt';

export function setRefreshCookie(c: Context, token: string): void {
  setCookie(c, RT_COOKIE_NAME, token, {
    httpOnly: true,
    secure:   isSecureRequest(c),
    sameSite: 'Lax',
    path:     '/api',
    maxAge:   Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  });
}

export function clearRefreshCookie(c: Context): void {
  deleteCookie(c, RT_COOKIE_NAME, { path: '/api' });
}

if (!USE_RS256 && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  console.warn('[auth] Neither RS256 keys nor a 32-char JWT_SECRET are set — this is insecure');
}
if (USE_RS256) {
  console.info('[auth] RS256 JWT signing active');
}

// ── Access token helpers ──────────────────────────────────────────────────────

export interface AuthMethodClaims {
  /** Authentication Method References (RFC 8176). */
  amr:           string[];
  /** True when the session has fully satisfied MFA for the user's role. */
  mfaSatisfied:  boolean;
  /** ISO timestamp of the second-factor verification (absent for password-only). */
  mfaVerifiedAt?: string;
  /** Coarse strength classification. */
  authStrength:  'password_only' | 'mfa' | 'passwordless_passkey' | 'trusted_device';
}

/** Issue a short-lived signed access JWT for a user. */
function signUser(u: AppUser, amrClaims?: Partial<AuthMethodClaims>): string {
  const jti = crypto.randomUUID();
  const now  = new Date().toISOString();
  const payload = {
    sub:          u.id,
    username:     u.username,
    role:         u.role,
    departmentId: u.department_id ?? '',
    jti,
    // Auth-method claims — default to password-only for backward compat
    amr:           amrClaims?.amr          ?? ['pwd'],
    mfaSatisfied:  amrClaims?.mfaSatisfied ?? false,
    mfaVerifiedAt: amrClaims?.mfaVerifiedAt,
    authStrength:  amrClaims?.authStrength  ?? 'password_only',
  };
  if (USE_RS256) {
    return jwt.sign(payload, JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL });
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/** Verify an access token. Returns payload or null (expired / invalid / bad signature).
 *  Tries RS256 first; falls back to HS256 to allow existing sessions to survive the migration. */
function verifyToken(token: string): JwtPayload | null {
  if (!token) return null;
  if (USE_RS256) {
    try {
      return jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload;
    } catch {
      // Fall through to HS256 fallback for tokens issued before the migration.
    }
  }
  if (JWT_SECRET) {
    try {
      return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Refresh token helpers ─────────────────────────────────────────────────────

/** Generate a cryptographically random refresh token. Returns [plaintext, sha256hash]. */
function _generateRefreshToken(): [string, string] {
  const plain = crypto.randomBytes(32).toString('hex');   // 256 bits
  const hash  = crypto.createHash('sha256').update(plain).digest('hex');
  return [plain, hash];
}

/**
 * Issue a refresh token for a user.
 * Stores the hash in the DB; returns the plaintext to send to the client.
 * Any previous refresh tokens for this user are deleted (single active session).
 */
async function issueRefreshToken(
  userId: string,
  device?: { userAgent?: string; ip?: string },
): Promise<string> {
  const [plain, hash] = _generateRefreshToken();
  const expiresAt     = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

  // Delete any existing refresh tokens for this user (single-session policy)
  await sb.from('refresh_tokens').delete().eq('user_id', userId);

  await sb.from('refresh_tokens').insert({
    user_id:      userId,
    token_hash:   hash,
    expires_at:   expiresAt,
    user_agent:   device?.userAgent ?? null,
    ip_address:   device?.ip ?? null,
    last_seen_at: new Date().toISOString(),
  });

  return plain;
}

/**
 * Validate a refresh token and rotate it.
 * Returns the user row on success, or null if invalid/expired.
 * Old token is deleted and a new pair is issued atomically.
 */
async function rotateRefreshToken(
  plainToken: string,
): Promise<{ user: AppUser; accessToken: string; refreshToken: string } | null> {
  const hash = crypto.createHash('sha256').update(plainToken).digest('hex');

  const { data: row } = await sb
    .from('refresh_tokens')
    .select('user_id, expires_at, user_agent, ip_address')
    .eq('token_hash', hash)
    .maybeSingle<{ user_id: string; expires_at: string; user_agent: string | null; ip_address: string | null }>();

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    // expired — clean up and reject
    await sb.from('refresh_tokens').delete().eq('token_hash', hash);
    return null;
  }

  const { data: user } = await sb
    .from('app_users')
    .select('*')
    .eq('id', row.user_id)
    .single<AppUser>();

  if (!user || user.status !== 'active') {
    await sb.from('refresh_tokens').delete().eq('token_hash', hash);
    return null;
  }

  // Rotate: delete old token and issue a new pair. Device metadata carries over
  // so the Sessions page keeps showing the device after rotation, and
  // last_seen_at is bumped — a rotation IS activity on that session.
  await sb.from('refresh_tokens').delete().eq('token_hash', hash);
  const [newRefreshPlain, newRefreshHash] = _generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  await sb.from('refresh_tokens').insert({
    user_id:      user.id,
    token_hash:   newRefreshHash,
    expires_at:   newExpiresAt,
    user_agent:   row.user_agent,
    ip_address:   row.ip_address,
    last_seen_at: new Date().toISOString(),
  });

  return {
    user,
    accessToken:  signUser(user),
    refreshToken: newRefreshPlain,
  };
}

// ── Token revocation ──────────────────────────────────────────────────────────

/**
 * Revoke an access token by JTI.
 * Called on logout. The JTI is stored until the token would have expired anyway.
 */
async function revokeToken(jti: string, expiresAt: number): Promise<void> {
  const revokedUntil = new Date(expiresAt * 1000).toISOString();
  try {
    await sb.from('token_revocations').insert({ jti, revoked_until: revokedUntil });
  } catch {
    // best-effort; if insert fails the token will still expire in 15 min
  }
}

/** Returns true if a JTI has been revoked (i.e. the user logged out). */
async function isTokenRevoked(jti: string): Promise<boolean> {
  const { data } = await sb
    .from('token_revocations')
    .select('jti')
    .eq('jti', jti)
    .maybeSingle<{ jti: string }>();
  return !!data;
}

/**
 * Returns true if the user has a revocation epoch newer than this token's iat —
 * i.e. a superadmin force-revoked their sessions after the token was issued.
 * `iat` is in seconds (JWT standard).
 */
async function isSessionRevoked(userId: string, iat: number): Promise<boolean> {
  const { data } = await sb
    .from('session_revocations')
    .select('revoked_at')
    .eq('user_id', userId)
    .maybeSingle<{ revoked_at: string }>();
  if (!data) return false;
  return new Date(data.revoked_at).getTime() > iat * 1000;
}

/**
 * Force-revoke ALL of a user's sessions (superadmin action). Sets the revocation
 * epoch (so existing access tokens are rejected) and deletes their refresh token
 * (so they cannot silently refresh). The user must log in again — which requires
 * a fresh 2FA code for mandatory-2FA roles.
 */
async function revokeUserSessions(userId: string, revokedBy: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await sb.from('session_revocations').upsert(
    { user_id: userId, revoked_at: nowIso, revoked_by: revokedBy },
    { onConflict: 'user_id' },
  );
  await sb.from('refresh_tokens').delete().eq('user_id', userId);
}

// ── Token extraction ──────────────────────────────────────────────────────────

/**
 * Extract the bearer token from the Authorization header — the ONLY accepted
 * location. A body/args token fallback used to exist for backwards compat, but
 * every real caller (src/lib/apiLegacy.ts's _rawApi) already sends the header
 * whenever it has a token, so the fallback was dead weight that just widened the
 * attack surface (body content is far more likely to be logged/proxied/persisted
 * than headers).
 */
function extractToken(c: Context<{ Variables: HonoVariables }>): string {
  const authHeader = c.req.header('authorization') ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  return '';
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Hono middleware: verifies the JWT signature + expiry and attaches the decoded
 * payload to context. Does NOT check revocation here (that is done in requireUser
 * to avoid a DB hit on every unauthenticated request).
 */
async function jwtMiddleware(
  c: Context<{ Variables: HonoVariables }>,
  next: Next,
): Promise<void> {
  const token = extractToken(c);
  c.set('auth', verifyToken(token));
  await next();
}

/**
 * Resolve the full app_users row for the calling user.
 * Checks: token present → signature valid → not expired → not revoked → user active.
 * Throws a typed error (status 401) on any failure.
 */
async function requireUser(c: Context<{ Variables: HonoVariables }>): Promise<AppUser> {
  const auth = c.get('auth');
  if (!auth) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  // Revocation checks — per-JTI (logout) and per-user epoch (superadmin revoke).
  if (auth.jti && await isTokenRevoked(auth.jti)) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (auth.iat && await isSessionRevoked(auth.sub, auth.iat)) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  const { data, error } = await sb
    .from('app_users')
    .select('*')
    .eq('id', auth.sub)
    .single<AppUser>();

  if (error || !data || data.status !== 'active') {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  return data;
}

/** Like requireUser but also enforces role membership. */
async function requireRole(
  c: Context<{ Variables: HonoVariables }>,
  roles: string[],
): Promise<AppUser> {
  const u = await requireUser(c);
  // superadmin bypasses all role checks — has full access to every route.
  if (u.role !== 'superadmin' && !roles.includes(u.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return u;
}

/** Load a user's per-user permission overrides (best-effort; [] if table absent). */
async function loadUserOverrides(userId: string): Promise<PermissionOverrideRow[]> {
  const { data, error } = await sb
    .from('user_permissions')
    .select('permission, granted')
    .eq('user_id', userId);
  if (error || !data) return [];
  return data as PermissionOverrideRow[];
}

/**
 * Like requireUser but enforces a permission key (resource.action).
 * Resolution: per-user override → role default → deny. superadmin always passes
 * (ROLE_PERMISSIONS.superadmin contains every key). Throws 403 if denied.
 */
async function requirePermission(
  c: Context<{ Variables: HonoVariables }>,
  key: string,
): Promise<AppUser> {
  const u = await requireUser(c);
  if (u.role === 'superadmin') return u;   // allow-all, no DB round-trips
  const [roleSet, overrides] = await Promise.all([
    loadRolePermissions(u.role),
    loadUserOverrides(u.id),
  ]);
  if (!resolveWithSet(key, roleSet, overrides)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return u;
}

/**
 * Non-throwing permission check for an already-loaded user. Same resolution as
 * requirePermission (per-user override → role default → deny; superadmin allow-all)
 * but returns a boolean instead of throwing — for routes that must branch on
 * several capabilities (e.g. the messaging read-gate) rather than gate the whole
 * request on one key.
 */
async function userCan(user: { id: string; role?: string | null }, key: string): Promise<boolean> {
  if (user.role === 'superadmin') return true;
  const [roleSet, overrides] = await Promise.all([
    loadRolePermissions(user.role ?? ''),
    loadUserOverrides(user.id),
  ]);
  return resolveWithSet(key, roleSet, overrides);
}

// ── Activity logging ──────────────────────────────────────────────────────────

async function log_(
  user: Pick<AppUser, 'id' | 'username'> | null,
  action: string,
  entity: string,
  entityId: string,
  details: string,
): Promise<void> {
  try {
    // IP + user-agent come from the request-scoped context (set in api.ts), so
    // every existing call site gets audit context for free.
    const { ip, userAgent } = getReqContext();
    await sb.from('activity_logs').insert({
      user_id:    user?.id       ?? '',
      username:   user?.username ?? '',
      action,
      entity,
      entity_id:  entityId ?? '',
      details:    details  ?? '',
      ip_address: ip        ?? null,
      user_agent: userAgent ?? null,
    });
  } catch (e) {
    console.error('[audit] log_ failed:', e);
  }
}

export {
  signUser,
  verifyToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeToken,
  isTokenRevoked,
  jwtMiddleware,
  requireUser,
  requireRole,
  requirePermission,
  userCan,
  loadUserOverrides,
  revokeUserSessions,
  log_,
};
