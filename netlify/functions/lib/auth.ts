import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import { sb } from './db';
import type { AppUser } from '../../../types/db';
import type { JwtPayload, HonoVariables } from '../../../types/api';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('[auth] JWT_SECRET is missing or shorter than 32 characters — this is insecure');
}

function signUser(u: AppUser): string {
  return jwt.sign(
    { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id ?? '' },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

function verifyToken(token: string): JwtPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// Extract bearer token from Authorization header (preferred) or fallback body token.
// Token-in-body is the legacy path kept for backwards compatibility during migration.
function extractToken(c: Context<{ Variables: HonoVariables }>): string {
  const authHeader = c.req.header('authorization') ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  const body = c.get('body') ?? {};
  const args = (body as Record<string, unknown>).args as Record<string, unknown> | undefined;
  return (
    (body as Record<string, unknown>).token as string ??
    (args?.token as string | undefined) ??
    ''
  );
}

// Hono middleware: verifies the JWT and attaches the decoded payload to context.
async function jwtMiddleware(
  c: Context<{ Variables: HonoVariables }>,
  next: Next,
): Promise<void> {
  const token = extractToken(c);
  c.set('auth', verifyToken(token));
  await next();
}

// Resolve the full app_users row for the calling user.
// Throws 'Unauthorized' if the token is missing, expired, or the user is inactive.
async function requireUser(c: Context<{ Variables: HonoVariables }>): Promise<AppUser> {
  const auth = c.get('auth');
  if (!auth) throw Object.assign(new Error('Unauthorized'), { status: 401 });
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

// Like requireUser but also enforces role membership.
async function requireRole(
  c: Context<{ Variables: HonoVariables }>,
  roles: string[],
): Promise<AppUser> {
  const u = await requireUser(c);
  if (!roles.includes(u.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return u;
}

async function log_(
  user: Pick<AppUser, 'id' | 'username'> | null,
  action: string,
  entity: string,
  entityId: string,
  details: string,
): Promise<void> {
  try {
    await sb.from('activity_logs').insert({
      user_id:   user?.id       ?? '',
      username:  user?.username ?? '',
      action,
      entity,
      entity_id: entityId ?? '',
      details:   details  ?? '',
    });
  } catch {
    // best-effort; never let logging crash a request
  }
}

export { signUser, verifyToken, jwtMiddleware, requireUser, requireRole, log_ };
