// ── Siomac API — Hono router entry point ─────────────────────────────────────
// All routes live in ./routes/*.  Shared infrastructure is in ./lib/*.
// This file wires them together and adapts Hono to the Netlify Lambda handler.

import { Hono }   from 'hono';
import type { Context } from 'hono';

import { jwtMiddleware }             from './lib/auth';
import { globalRateLimitMiddleware } from './lib/ratelimit';
import { runWithReqContext }         from './lib/reqContext';
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
import notifyRouter         from './routes/notify';
import { superadminRouter } from './routes/superadmin';
import workflowRouter       from './routes/workflow';
import workflowsRouter      from './routes/workflows';
import communicationsRouter from './routes/communications';
import handoffsRouter       from './routes/handoffs';
import hseIncidentsRouter   from './routes/hseIncidents';
import hseInvestigationsRouter from './routes/hseInvestigations';
import hseCapaRouter        from './routes/hseCapa';

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

// ── Global error handler ──────────────────────────────────────────────────────
// Catches errors thrown by requireUser / requireRole (status 401/403) and any
// unhandled route errors, and returns a proper JSON response instead of letting
// them bubble up as unhandled exceptions (which Netlify turns into 500s with no body).
app.onError((err, c) => {
  const status = (err as { status?: number }).status ?? 500;
  const message = err.message || 'Internal server error';
  return c.json({ success: false, message }, status as 200);
});

// Security headers — applied to every response
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options',  'nosniff');
  c.header('X-Frame-Options',         'DENY');
  c.header('Referrer-Policy',         'strict-origin-when-cross-origin');
  c.header('Permissions-Policy',      'geolocation=(), camera=(), microphone=()');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // Tight CSP: API only returns JSON — no scripts, no frames, no embeds
  c.header('Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
});

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

// Global rate limiting (also sets clientIp)
app.use('*', globalRateLimitMiddleware);

// Bind request-scoped context (IP + user-agent) for the downstream chain so the
// audit logger can record them without threading the context everywhere.
app.use('*', async (c, next) => {
  const ip = (c.get('clientIp') as string | undefined) ?? undefined;
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 400) || undefined;
  await runWithReqContext({ ip, userAgent }, () => next());
});

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
app.route('/api', notifyRouter);
app.route('/api/superadmin', superadminRouter);
app.route('/api/hse',        hseIncidentsRouter);
app.route('/api/hse',        hseInvestigationsRouter);
app.route('/api/hse',        hseCapaRouter);
app.route('/api/workflow',   workflowRouter);
app.route('/api',            workflowsRouter);
app.route('/api',            communicationsRouter);
app.route('/api',            handoffsRouter);

// ── Legacy action-dispatch shim ───────────────────────────────────────────────
// The frontend still sends { action: "routeName", args: {...} }.
// Handles two entry points:
//   POST /api            — same-origin production path via netlify.toml redirect
//   POST /.netlify/functions/api — direct Netlify Dev path (dev only)
// Both read the action field and re-dispatch to the matching /api/<action> route.
async function _legacyDispatch(c: Context<{ Variables: HonoVariables }>): Promise<Response> {
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

  // executionCtx is not available in lambda-local (Netlify Dev) — pass undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return app.fetch(syntheticReq, c.env, undefined as any);
}

app.post('/api', c => _legacyDispatch(c));
// Dev: Netlify Dev calls the function directly at its native path
app.post('/.netlify/functions/api', c => _legacyDispatch(c));

// ── Netlify Lambda handler ────────────────────────────────────────────────────
// Netlify Dev (lambda-local) calls handlers with the v1 event shape:
//   { path, httpMethod, headers, body, isBase64Encoded, ... }
// hono/netlify's built-in handle() expects a v2 native Request object and
// crashes with "Cannot read properties of undefined (reading 'indexOf')" when
// given a v1 event. We bridge manually so the same code works in both
// Netlify Dev (v1) and deployed Netlify Functions v2.

interface NetlifyV1Event {
  path:              string;
  httpMethod:        string;
  headers:           Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body?:             string | null;
  isBase64Encoded?:  boolean;
}

interface NetlifyV1Context {
  awsRequestId?: string;
}

export const handler = async (
  event:   NetlifyV1Event | Request,
  context: NetlifyV1Context,
): Promise<unknown> => {
  // v2: event is already a native Request
  if (event instanceof Request) {
    return app.fetch(event, { context });
  }

  // v1: reconstruct a proper Request from the lambda event
  const base = 'http://localhost';
  const qs   = event.queryStringParameters
    ? '?' + new URLSearchParams(
        Object.entries(event.queryStringParameters).filter(([, v]) => v != null) as [string, string][]
      ).toString()
    : '';
  const url  = `${base}${event.path}${qs}`;

  const body = event.body
    ? (event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body)
    : undefined;

  const req = new Request(url, {
    method:  event.httpMethod,
    headers: new Headers(event.headers ?? {}),
    body:    ['GET', 'HEAD'].includes(event.httpMethod) ? undefined : body,
  });

  const res  = await app.fetch(req, { context });
  const text = await res.text();

  return {
    statusCode: res.status,
    headers:    Object.fromEntries(res.headers.entries()),
    body:       text,
  };
};
