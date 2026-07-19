// ── Siomac API — Hono router entry point ─────────────────────────────────────
// All routes live in ./routes/*.  Shared infrastructure is in ./lib/*.
// This file wires them together and adapts Hono to the Netlify Lambda handler.

import './lib/bootstrapEnv'; // must be first — see that module for why

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
// leavesRouter RETIRED — legacy leave routes removed; all leave traffic now
// served by hrLeaveRouter at /api/hr/leave/* (canonical HR Leave service).
// payrollRouter UNMOUNTED — legacy payroll router removed per Spec §21.
// File quarantined: routes/payroll.ts. Use routes/financePayroll.ts instead.
import settingsRouter      from './routes/settings';
import settingsCatalogRouter from './routes/settingsCatalog';
import ticketsRouter       from './routes/tickets';
import notifyRouter         from './routes/notify';
import { superadminRouter } from './routes/superadmin';
import workflowsRouter      from './routes/workflows';
import workflowEngineRouter from './routes/workflowEngine';
import communicationsRouter from './routes/communications';
import communicationsComplianceRouter from './routes/communicationsCompliance';
import handoffsRouter       from './routes/handoffs';
import orchestrationRouter  from './routes/orchestration';
import hseIncidentsRouter   from './routes/hseIncidents';
import hseInvestigationsRouter from './routes/hseInvestigations';
import hseCapaRouter        from './routes/hseCapa';
import hseRiskJsaRouter    from './routes/hseRiskJsa';
import hsePtwRouter         from './routes/hsePtw';
import hseInspectionsRouter from './routes/hseInspections';
import hseTrainingRouter     from './routes/hseTraining';
import uiPrefsRouter        from './routes/uiPrefs';
import widgetPackagesRouter from './routes/widgetPackages';
import auth2faRouter        from './routes/auth2fa';
import webauthnRouter       from './routes/webauthn';
import trustedDevicesRouter from './routes/trustedDevices';
import authStepUpRouter     from './routes/authStepUp';
import adminSecurityRouter, { policyReadRouter } from './routes/adminSecurity';
import permissionApprovalsRouter from './routes/permissionApprovals';
import calendarRouter             from './routes/calendar';
import hrRouter                   from './routes/hr';
import hrEmployeeImportRouter     from './routes/hrEmployeeImport';
import hrOnboardingRouter         from './routes/hrOnboarding';
import hrOffboardingRouter        from './routes/hrOffboarding';
import hrLeaveRouter             from './routes/hrLeave';
import hrRequestsRouter          from './routes/hrRequests';
import hrAttendanceRouter        from './routes/hrAttendance';
import hrRosterRouter            from './routes/hrRoster';
import financeStatutoryRouter    from './routes/financeStatutory';
import financeNisRouter          from './routes/financeNis';
import financePayrollRouter      from './routes/financePayroll';
import financePayPoliciesRouter  from './routes/financePayPolicies';
import financeStatutoryFormsRouter from './routes/financeStatutoryForms';
import financePayslipTemplatesRouter from './routes/financePayslipTemplates';
import hrCompensationRouter      from './routes/hrCompensation';
import hrOvertimeRouter          from './routes/hrOvertime';
import hrStatutoryProfileRouter  from './routes/hrStatutoryProfile';
import financeRemittancesRouter   from './routes/financeRemittances';
import financeExpensesRouter       from './routes/financeExpenses';
import financeBudgetsRouter         from './routes/financeBudgets';
import financeBankAccountsRouter    from './routes/financeBankAccounts';
import financeDisbursementsRouter   from './routes/financeDisbursements';
import financeOverviewRouter         from './routes/financeOverview';
import financeAccountsPayableRouter  from './routes/financeAccountsPayable';
import financePickersRouter          from './routes/financePickers';
import financeLookupsRouter          from './routes/financeLookups';
import financeAttachmentsRouter      from './routes/financeAttachments';
import financeBridgesRouter          from './routes/financeBridges';

// Register module handoff receivers once at cold-start
import { registerModulesOnce } from './lib/registerModules';
registerModulesOnce();

// ── Allowed frontend origins ──────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Fails CLOSED: an unset/empty ALLOWED_ORIGINS denies every cross-origin request
// (previously it allowed ALL origins — safe only by accident, dangerous the moment
// the env var is forgotten in production). The one built-in exception is
// localhost/127.0.0.1 — safe to always allow because the Origin header is set by
// the browser itself and can't be spoofed by page JS: a request only ever carries
// a `localhost` origin when it's genuinely served from the developer's own
// machine, so local dev keeps working with zero env setup without weakening
// production (a real attacker's page always presents ITS OWN remote origin).
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
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
  const e      = err as { status?: number; code?: string };
  const status  = e.status ?? 500;
  const message = err.message || 'Internal server error';
  // Pass through discriminator codes (e.g. 'step_up_required', 'compliance_required')
  // so the frontend can branch on them without parsing message strings.
  const body: Record<string, unknown> = { success: false, message };
  if (e.code) body.code = e.code;
  return c.json(body, status as 200);
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

// CORS — echo the origin back only if it is in the allowlist (fail closed otherwise)
app.use('*', async (c, next) => {
  const origin  = c.req.header('origin') ?? '';
  const allowed = isAllowedOrigin(origin);
  c.header('access-control-allow-origin',  allowed ? origin : '');
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
app.route('/api/hr', hrRouter);
app.route('/api/hr', hrEmployeeImportRouter);
app.route('/api/hr', hrOnboardingRouter);
app.route('/api/hr', hrOffboardingRouter);
app.route('/api/hr', hrLeaveRouter);
app.route('/api/hr', hrRequestsRouter);
app.route('/api/hr', hrAttendanceRouter);
app.route('/api/hr/roster', hrRosterRouter);
app.route('/api/finance', financeStatutoryRouter);
app.route('/api/finance', financeNisRouter);
app.route('/api/finance', financePayrollRouter);
app.route('/api/finance', financePayPoliciesRouter);
app.route('/api/finance', financeStatutoryFormsRouter);
app.route('/api/finance', financePayslipTemplatesRouter);
app.route('/api/finance', financeRemittancesRouter);
app.route('/api/finance', financeExpensesRouter);
app.route('/api/finance', financeBudgetsRouter);
app.route('/api/finance', financeBankAccountsRouter);
app.route('/api/finance', financeDisbursementsRouter);
app.route('/api/finance', financeOverviewRouter);
app.route('/api/finance', financeAccountsPayableRouter);
app.route('/api/finance', financePickersRouter);
app.route('/api/finance', financeLookupsRouter);
app.route('/api/finance', financeAttachmentsRouter);
app.route('/api/finance', financeBridgesRouter);
app.route('/api/hr', hrCompensationRouter);
app.route('/api/hr', hrOvertimeRouter);
app.route('/api/hr', hrStatutoryProfileRouter);
app.route('/api', departmentsRouter);
app.route('/api', sitesRouter);
app.route('/api', attendanceRouter);
// leavesRouter removed — canonical HR leave at /api/hr/leave/* via hrLeaveRouter (mounted above).
// payrollRouter UNMOUNTED — see Spec §21 legacy removal. Legacy /api/payroll/* routes are gone.
// The replacement is /api/finance/payroll/* (financePayrollRouter, already mounted above).
app.route('/api', settingsRouter);
app.route('/api/settings', settingsCatalogRouter);
app.route('/api', ticketsRouter);
app.route('/api', notifyRouter);
app.route('/api/superadmin', superadminRouter);
app.route('/api/hse',        hseIncidentsRouter);
app.route('/api/hse',        hseInvestigationsRouter);
app.route('/api/hse',        hseCapaRouter);
app.route('/api/hse',        hseRiskJsaRouter);
app.route('/api/hse',        hsePtwRouter);
app.route('/api/hse',        hseInspectionsRouter);
app.route('/api/hse',        hseTrainingRouter);
app.route('/api/workflow-engine', workflowEngineRouter);
app.route('/api',            uiPrefsRouter);
app.route('/api',            widgetPackagesRouter);
app.route('/api',            workflowsRouter);
app.route('/api',            calendarRouter);
app.route('/api',            communicationsRouter);
app.route('/api',            communicationsComplianceRouter);
app.route('/api',            handoffsRouter);
app.route('/api/orchestration', orchestrationRouter);
app.route('/api/auth/2fa',             auth2faRouter);
app.route('/api',                      webauthnRouter);
app.route('/api/auth/trusted-devices', trustedDevicesRouter);
app.route('/api/auth/step-up',         authStepUpRouter);
app.route('/api/auth/security',        policyReadRouter);
app.route('/api/admin/security',       adminSecurityRouter);
app.route('/api/admin/approvals',      permissionApprovalsRouter);

// ── Legacy action-dispatch shim ───────────────────────────────────────────────
// The frontend still sends { action: "routeName", args: {...} }.
// Handles two entry points:
//   POST /api            — same-origin production path via netlify.toml redirect
//   POST /.netlify/functions/api — direct Netlify Dev path (dev only)
// Both read the action field and re-dispatch to the matching /api/<action> route.
async function _legacyDispatch(c: Context<{ Variables: HonoVariables }>): Promise<Response> {
  const body   = c.get('body');
  const action = (body).action as string | undefined;
  if (!action) return c.json({ success: false, message: 'Missing action' }, 400);

  const url = new URL(c.req.url);
  url.pathname = `/api/${action}`;

  const syntheticReq = new Request(url.toString(), {
    method:  'POST',
    headers: c.req.raw.headers,
    body:    JSON.stringify(body),
  });

  // executionCtx is not available in lambda-local (Netlify Dev) — pass undefined
  return app.fetch(syntheticReq, c.env, undefined);
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
        Object.entries(event.queryStringParameters)
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
    headers: new Headers(event.headers),
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
