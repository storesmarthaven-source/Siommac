// ── Siomac API — Hono router entry point ─────────────────────────────────────
// All routes live in ./routes/*.  Shared infrastructure is in ./lib/*.
// This file wires them together and adapts Hono to the Netlify Lambda handler.

import { Hono }   from 'hono';
import { handle } from '@hono/node-server/netlify';

import { jwtMiddleware }             from './lib/auth';
import { globalRateLimitMiddleware } from './lib/ratelimit';
import type { HonoVariables }        from '../../types/api';

// Route modules
import authRouter          from './routes/auth';
import employeesRouter     from './routes/employees';
import departmentsRouter   from './routes/departments';
import sitesRouter         from './routes/sites';
import attendanceRouter    from './routes/attendance';
import leavesRouter        from './routes/leaves';
import payrollRouter       from './routes/payroll';
import settingsRouter      from './routes/settings';
import messagesRouter      from './routes/messages';
import ticketsRouter       from './routes/tickets';
import notificationsRouter from './routes/notifications';

// ── Allowed frontend origins ──────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length === 0) return true; // not configured → allow all (dev)
  return ALLOWED_ORIGINS.some(
    o => origin === o || origin.endsWith('.' + o.replace(/^https?:\/\//, '')),
  );
}

// ── Build the Hono app ────────────────────────────────────────────────────────
const app = new Hono<{ Variables: HonoVariables }>();

// CORS — echo the origin back only if it is in the allowlist
app.use('*', async (c, next) => {
  const origin  = c.req.header('origin') ?? '';
  const allowed = isAllowedOrigin(origin) || ALLOWED_ORIGINS.length === 0;
  c.header('access-control-allow-origin',  allowed ? (origin || '*') : '');
  c.header('access-control-allow-methods', 'POST, OPTIONS');
  c.header('access-control-allow-headers', 'content-type, authorization');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// Body size guard (before JSON parsing) — hard-cap at 9 MB to stay under Netlify's 6 MB limit
// after accounting for base64 overhead. Prevents JSON.parse from allocating huge strings.
app.use('*', async (c, next) => {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > 9 * 1024 * 1024) return c.json({ success: false, message: 'Request too large.' }, 413);
  await next();
});

// Parse the JSON body and store it in context. The legacy protocol sends:
//   { action: "routeName", args: { ... }, token: "..." }
app.use('*', async (c, next) => {
  let body: Record<string, unknown> = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return c.json({ success: false, message: 'Invalid JSON' }, 400);
  }
  c.set('body', body);
  await next();
});

// Global rate limiting
app.use('*', globalRateLimitMiddleware);

// JWT parsing — extracts and verifies the token; does not block unauthenticated requests.
app.use('*', jwtMiddleware);

// ── Health check (no auth) ────────────────────────────────────────────────────
app.post('/api/ping', c => c.json({ ok: true, ts: new Date().toISOString() }));

// ── Route groups ──────────────────────────────────────────────────────────────
app.route('/api', authRouter);
app.route('/api', employeesRouter);
app.route('/api', departmentsRouter);
app.route('/api', sitesRouter);
app.route('/api', attendanceRouter);
app.route('/api', leavesRouter);
app.route('/api', payrollRouter);
app.route('/api', settingsRouter);
app.route('/api', messagesRouter);
app.route('/api', ticketsRouter);
app.route('/api', notificationsRouter);

// ── Legacy action-dispatch shim ───────────────────────────────────────────────
// The frontend still sends { action: "routeName", args: {...} }.
// This middleware intercepts any POST to /api (exact), reads the action field,
// and internally re-dispatches to the matching /api/<action> route.
app.post('/api', async c => {
  const body   = c.get('body') ?? {};
  const action = (body as Record<string, unknown>).action as string | undefined;
  if (!action) return c.json({ success: false, message: 'Missing action' }, 400);

  const url = new URL(c.req.url);
  url.pathname = `/api/${action}`;

  const syntheticReq = new Request(url.toString(), {
    method:  'POST',
    headers: c.req.raw.headers,
    body:    JSON.stringify(body),
  });

  const res = await app.fetch(syntheticReq, c.env, c.executionCtx);
  return res;
});

// ── Netlify Lambda handler ────────────────────────────────────────────────────
export const handler = handle(app);
