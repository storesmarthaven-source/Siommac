// lib/auth.ts — JWT access tokens, refresh token rotation, revocation
//
// Token strategy:
//   Access token  — signed JWT, 15-minute TTL, contains jti (unique ID)
//   Refresh token — 256-bit random secret, 7-day TTL, stored hashed in DB
//
// On login:  issue access token + refresh token (hashed stored in refresh_tokens)
// On refresh: validate refresh token hash, delete old row, issue new pair (rotation)
// On logout:  insert jti into token_revocations + delete refresh token row
// requireUser: verifies signature, checks exp, checks jti not in revocations

import jwt                  from 'jsonwebtoken';
import crypto               from 'crypto';
import type { Context, Next } from 'hono';
import { sb }               from './db';
import { resolveWithSet, loadRolePermissions, type PermissionOverrideRow } from './permissions';
import { getReqContext }    from './reqContext';
import type { AppUser }     from '../../../types/db';
import type { JwtPayload, HonoVariables } from '../../../types/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET           = process.env.JWT_SECRET ?? '';
const ACCESS_TOKEN_TTL     = '15m';                        // short-lived
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;     // 7 days in ms
const REVOCATION_TTL_DAYS  = 1;                            // keep revoked JTIs for 1 day (matches max access token age)

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('[auth] JWT_SECRET is missing or shorter than 32 characters — this is insecure');
}

// ── Access token helpers ──────────────────────────────────────────────────────

/** Issue a short-lived signed access JWT for a user. */
function signUser(u: AppUser): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      sub:          u.id,
      username:     u.username,
      role:         u.role,
      departmentId: u.department_id ?? '',
      jti,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

/** Verify an access token. Returns payload or null (expired / invalid / revoked signature). */
function verifyToken(token: string): JwtPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
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
    .select('user_id, expires_at')
    .eq('token_hash', hash)
    .maybeSingle<{ user_id: string; expires_at: string }>();

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

  // Rotate: delete old token and issue a new pair
  await sb.from('refresh_tokens').delete().eq('token_hash', hash);
  const [newRefreshPlain, newRefreshHash] = _generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  await sb.from('refresh_tokens').insert({
    user_id:    user.id,
    token_hash: newRefreshHash,
    expires_at: newExpiresAt,
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

/** Extract bearer token from Authorization header (preferred) or legacy body token. */
function extractToken(c: Context<{ Variables: HonoVariables }>): string {
  const authHeader = c.req.header('authorization') ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  // Legacy: token in body or args (backwards compatibility)
  const body = c.get('body') ?? {};
  const args = (body as Record<string, unknown>).args as Record<string, unknown> | undefined;
  return (
    (body as Record<string, unknown>).token as string ??
    (args?.token as string | undefined) ??
    ''
  );
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
  } catch {
    // best-effort; never let logging crash a request
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
  loadUserOverrides,
  revokeUserSessions,
  log_,
};
