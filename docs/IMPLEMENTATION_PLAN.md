# IMPLEMENTATION_PLAN.md — Phase-by-Phase Production Migration

> **Machine-executable.** Feed this document to Claude with the instruction: "Execute Phase N of IMPLEMENTATION_PLAN.md." Claude will implement every numbered step in order, run verification commands, and stop if any verification fails.

---

## Pre-conditions (verify before starting any phase)

```bash
# 1. Confirm you are in the project root
ls netlify/functions/api.js   # must exist

# 2. Confirm Node version
node --version                # must be >= 18.x

# 3. Confirm Netlify CLI installed
npx netlify-cli --version     # must be >= 17.x

# 4. Confirm Supabase CLI installed
supabase --version            # must be >= 1.x

# 5. Confirm git is clean (or at least tracked)
git status
```

---

## Phase 1 — Foundation (TypeScript, Hono, Zod, bcrypt cost 12)

**Goal:** Replace the monolithic `api.js` with a modular Hono app in TypeScript. No behaviour changes — identical inputs produce identical outputs. Fix VULN-002 (bcrypt cost) and VULN-007 (input validation) and remove VULN-009 (demo users route).

### Step 1.1 — Install dependencies

```bash
npm install hono @hono/node-server zod bcryptjs jsonwebtoken @supabase/supabase-js @netlify/functions
npm install --save-dev typescript @types/node @types/bcryptjs @types/jsonwebtoken ts-node esbuild
```

### Step 1.2 — Create `tsconfig.json`

Create file `tsconfig.json` in project root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "outDir": ".netlify/functions-build",
    "rootDir": "netlify",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["netlify/**/*.ts"],
  "exclude": ["node_modules", ".netlify"]
}
```

### Step 1.3 — Update `netlify.toml`

Edit `netlify.toml` (create if not present) to add esbuild bundling for TypeScript:

```toml
[build]
  command = "echo 'no build step'"
  publish = "."

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api"
  to = "/.netlify/functions/api"
  status = 200

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
```

### Step 1.4 — Create shared lib files

**Create `netlify/functions/api/lib/supabase.ts`:**
```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL             = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const sb = createClient(
  SUPABASE_URL || 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY || 'missing',
  { auth: { persistSession: false } }
);
```

**Create `netlify/functions/api/lib/date.ts`:**
```typescript
const TZ = process.env.APP_TZ || 'America/Port_of_Spain';

export const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const hhmm = (d: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

export const hhmm24 = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

export const dateOnly = (v: unknown): string =>
  !v ? '' : String(v).slice(0, 10);

export const cap = (s: string): string =>
  s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
```

**Create `netlify/functions/api/lib/logger.ts`:**
```typescript
import { sb } from './supabase';

interface Actor { id?: string; username?: string }

export async function log_(
  user: Actor | null,
  action: string,
  entity: string,
  entityId: string,
  details: string
): Promise<void> {
  try {
    await sb.from('activity_logs').insert({
      user_id:   user?.id       || '',
      username:  user?.username || '',
      action, entity,
      entity_id: entityId || '',
      details:   details  || ''
    });
  } catch (err) {
    // Log failure must not crash the request, but must not be silent
    console.error('[logger] Failed to write activity_log:', err);
  }
}
```

**Create `netlify/functions/api/lib/settings.ts`:**
```typescript
import { sb } from './supabase';

export async function setting(key: string, fallback = ''): Promise<string> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : fallback;
}

export async function getWorkHours(): Promise<{ start: string; end: string }> {
  const raw = await setting('workHours', '{"start":"08:00","end":"17:00"}');
  try { return JSON.parse(raw); } catch { return { start: '08:00', end: '17:00' }; }
}
```

**Create `netlify/functions/api/lib/bcrypt.ts`:**
```typescript
import bcrypt from 'bcryptjs';

const COST = 12; // OWASP minimum — increased from 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash);
  // Transparent rehash: if stored cost < 12, update hash in DB
  // Caller must handle the rehash — see login route
  return ok;
}

export function getHashCost(hash: string): number {
  try { return bcrypt.getRounds(hash); } catch { return 0; }
}
```

**Create `netlify/functions/api/lib/jwt.ts`:**
```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JwtPayload {
  sub: string;
  username: string;
  role: 'admin' | 'manager' | 'employee';
  departmentId: string;
  iat?: number;
  exp?: number;
}

export function signUser(u: {
  id: string; username: string; role: string; department_id?: string | null;
}): string {
  return jwt.sign(
    { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id || '' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

export function verifyToken(token: string | undefined | null): JwtPayload | null {
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as JwtPayload; } catch { return null; }
}
```

**Create `netlify/functions/api/lib/geo.ts`:**
```typescript
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
```

### Step 1.5 — Create auth middleware

**Create `netlify/functions/api/middleware/auth.middleware.ts`:**
```typescript
import { Context, Next } from 'hono';
import { verifyToken, JwtPayload } from '../lib/jwt';
import { sb } from '../lib/supabase';

export type AppEnv = {
  Variables: {
    auth: JwtPayload | null;
    user: Record<string, unknown> | null;
  };
};

export async function requireUser(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const auth = c.get('auth');
  if (!auth) throw new Error('Unauthorized');
  const { data, error } = await sb.from('app_users').select('*').eq('id', auth.sub).single();
  if (error || !data || data.status !== 'active') throw new Error('Unauthorized');
  return data;
}

export async function requireRole(
  c: Context<AppEnv>,
  roles: string[]
): Promise<Record<string, unknown>> {
  const u = await requireUser(c);
  if (!roles.includes(u.role as string)) throw new Error('Forbidden');
  return u;
}

export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  // Store parsed body so handlers don't re-parse
  c.set('_body' as never, body);
  const token = body.token as string | undefined;
  c.set('auth', verifyToken(token));
  await next();
}
```

### Step 1.6 — Create Hono entry point

**Create `netlify/functions/api/index.ts`:**
```typescript
import { Hono } from 'hono';
import { handle } from '@hono/node-server/netlify';
import { authMiddleware, AppEnv } from './middleware/auth.middleware';

// Import all route handlers
import { registerAuthRoutes }        from './routes/auth/index';
import { registerEmployeeRoutes }     from './routes/employees/index';
import { registerAttendanceRoutes }   from './routes/attendance/index';
import { registerLeaveRoutes }        from './routes/leave/index';
import { registerDepartmentRoutes }   from './routes/departments/index';
import { registerProjectSiteRoutes }  from './routes/project-sites/index';
import { registerPayrollRoutes }      from './routes/payroll/index';
import { registerSettingsRoutes }     from './routes/settings/index';
import { registerProfileRoutes }      from './routes/profile/index';
import { registerDashboardRoutes }    from './routes/dashboard/index';
import { registerMessageRoutes }      from './routes/messages/index';
import { registerTicketRoutes }       from './routes/tickets/index';
import { registerNotificationRoutes } from './routes/notifications/index';

const app = new Hono<AppEnv>();

// CORS — permissive in Phase 1; tighten in Phase 2
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });
  }
  c.header('Access-Control-Allow-Origin', '*');
  await next();
});

// Auth middleware — parses body and verifies JWT
app.use('*', authMiddleware);

// Register all route groups
registerAuthRoutes(app);
registerEmployeeRoutes(app);
registerAttendanceRoutes(app);
registerLeaveRoutes(app);
registerDepartmentRoutes(app);
registerProjectSiteRoutes(app);
registerPayrollRoutes(app);
registerSettingsRoutes(app);
registerProfileRoutes(app);
registerDashboardRoutes(app);
registerMessageRoutes(app);
registerTicketRoutes(app);
registerNotificationRoutes(app);

// Global error handler
app.onError((err, c) => {
  console.error('[api error]', err.message, err.stack);
  const message = err.message || 'Internal server error';
  return c.json({ success: false, message }, 200);
});

// Netlify handler export
export const handler = handle(app);
```

### Step 1.7 — Create route index files (one example: auth)

**Create `netlify/functions/api/routes/auth/index.ts`:**
```typescript
import { Hono } from 'hono';
import { AppEnv } from '../../middleware/auth.middleware';
import { loginHandler }          from './login';
import { logoutHandler }         from './logout';
import { verifyPasswordHandler } from './verify-password';

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.post('/api', async (c) => {
    const body = c.get('_body' as never) as Record<string, unknown>;
    const action = body.action as string;
    const args   = (body.args  as Record<string, unknown>) || {};

    switch (action) {
      case 'ping':           return c.json({ ok: true, ts: new Date().toISOString() });
      case 'login':          return loginHandler(c, args);
      case 'logout':         return logoutHandler(c, args);
      case 'verifyPassword': return verifyPasswordHandler(c, args);
      default:               return c.next();  // pass to next route group
    }
  });
}
```

> **Note to implementer:** Each route group follows the same pattern: a switch on `action`, calling the appropriate handler. Remaining route files follow the same pattern as shown in STRUCTURE.md. Implement all handlers by copying the logic from the corresponding function in the existing `api.js`, but:
> 1. Replace `require()` with `import`
> 2. Replace `ctx.auth` with `c.get('auth')`
> 3. Replace `requireUser(ctx)` with `requireUser(c)` from the middleware module
> 4. Replace `return { success: false, message }` with `return c.json({ success: false, message })`
> 5. Replace `return ok(data)` with `return c.json({ success: true, data })`
> 6. Use `hashPassword()` from `lib/bcrypt.ts` (cost 12) instead of `bcrypt.hash(plain, 10)`
> 7. **Remove the `setupDemoUsers` route entirely** (VULN-009)

### Step 1.8 — Verify Phase 1

```bash
# 1. TypeScript compiles without errors
npx tsc --noEmit

# 2. Netlify dev starts
npx netlify dev &
sleep 5

# 3. Ping test
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' | grep '"ok":true'

# 4. Login test (use existing admin credentials)
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d '{"action":"login","args":{"username":"admin","password":"admin123"}}' \
  | grep '"success":true'

# 5. setupDemoUsers must be gone
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d '{"action":"setupDemoUsers","args":{}}' \
  | grep '"success":false'
```

All 5 checks must pass before proceeding to Phase 2.

---

## Phase 2 — Security Hardening (CORS, Rate Limiting, Soft-delete, RS256)

**Goal:** Fix VULN-001 (RS256), VULN-003 (rate limiting), VULN-004 (CORS), VULN-008 (soft-delete), VULN-010 (ticket sequence), VULN-011 (log failures), VULN-013 (LRU cache), VULN-014 (settings split).

### Step 2.1 — Install Upstash and LRU cache

```bash
npm install @upstash/ratelimit @upstash/redis lru-cache
```

### Step 2.2 — Add rate limit middleware

**Create `netlify/functions/api/middleware/rate-limit.middleware.ts`:**
```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';
import { Context, Next } from 'hono';
import { AppEnv } from './auth.middleware';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

// Login: 5 requests per minute per IP
const loginLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  prefix:  'rl:login'
});

// All other routes: 60 requests per minute per user ID
const apiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  prefix:  'rl:api'
});

export async function rateLimitMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const body      = c.get('_body' as never) as Record<string, unknown>;
  const action    = body?.action as string;
  const auth      = c.get('auth');
  const ip        = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  const isLogin   = action === 'login';
  const key       = isLogin ? ip : (auth?.sub || ip);
  const limiter   = isLogin ? loginLimiter : apiLimiter;

  const { success, limit, remaining } = await limiter.limit(key);

  c.header('X-RateLimit-Limit',     String(limit));
  c.header('X-RateLimit-Remaining', String(remaining));

  if (!success) {
    throw Object.assign(new Error('Too many requests. Please try again later.'), { status: 429 });
  }
  await next();
}
```

### Step 2.3 — Tighten CORS in `index.ts`

Replace the permissive CORS in Phase 1's `index.ts` with:

```typescript
import { cors } from 'hono/cors';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8888')
  .split(',')
  .map(s => s.trim());

app.use('*', cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  allowHeaders:  ['Content-Type', 'Authorization'],
  allowMethods:  ['POST', 'OPTIONS'],
  maxAge:        86400,
  credentials:   false
}));
```

### Step 2.4 — Migrate JWT to RS256

```bash
# Generate RSA key pair (4096-bit)
openssl genrsa -out jwt_private.pem 4096
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem

# Print as single-line for env var (newlines → \n)
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_private.pem
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_public.pem
```

Set these values as Netlify env vars:
- `JWT_PRIVATE_KEY` = output of private key command
- `JWT_PUBLIC_KEY`  = output of public key command
- Keep `JWT_SECRET` temporarily for token migration (remove after all users re-login)

**Update `netlify/functions/api/lib/jwt.ts`:**
```typescript
const PRIVATE_KEY = (process.env.JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const PUBLIC_KEY  = (process.env.JWT_PUBLIC_KEY  || '').replace(/\\n/g, '\n');
const LEGACY_SECRET = process.env.JWT_SECRET;  // fallback during migration

export function signUser(u: { id: string; username: string; role: string; department_id?: string | null }): string {
  return jwt.sign(
    { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id || '' },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '8h' }
  );
}

export function verifyToken(token: string | undefined | null): JwtPayload | null {
  if (!token) return null;
  // Try RS256 first, fall back to HS256 for tokens issued before migration
  try { return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload; }
  catch {
    if (LEGACY_SECRET) {
      try { return jwt.verify(token, LEGACY_SECRET, { algorithms: ['HS256'] }) as JwtPayload; }
      catch { return null; }
    }
    return null;
  }
}
```

### Step 2.5 — Postgres ticket sequence

```sql
-- Run via: supabase db query
CREATE SEQUENCE IF NOT EXISTS public.ticket_number_seq START 1;

ALTER TABLE public.support_tickets
  ALTER COLUMN ticket_number SET DEFAULT 'TKT-' || LPAD(nextval('ticket_number_seq')::TEXT, 4, '0');
```

Update `create-ticket.ts` to no longer manually generate ticket numbers — let the DB default handle it. Remove the `_genTicketNumber()` function and retry loop.

### Step 2.6 — Add soft-delete to `app_users`

```sql
-- Migration: add soft-delete columns
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;
```

Update `delete-employee.ts` to:
1. Set `status = 'inactive'`, `deleted_at = NOW()`, `deleted_by = actor.id`
2. Anonymise PII: `full_name = 'Deleted Employee', email = NULL, phone = NULL, profile_image = '__removed__'`
3. **Do NOT delete** attendance, leave, or payroll records (preserve for compliance)

### Step 2.7 — Split settings endpoint

Add `getPublicSettings` route (no auth):
```typescript
// Returns only: companyName, companyLogoUrl, currency, workHours
case 'getPublicSettings': {
  const keys = ['companyName', 'companyLogoUrl', 'currency', 'workHours'];
  const { data } = await sb.from('settings').select('*').in('key', keys);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return c.json({ success: true, data: s });
}
```

Make `getSettings` require admin:
```typescript
case 'getSettings': {
  await requireRole(c, ['admin']);
  // ... existing implementation
}
```

### Step 2.8 — Replace in-memory signed URL cache with LRU

**Update `netlify/functions/api/lib/signed-url.ts`:**
```typescript
import { LRUCache } from 'lru-cache';
import { sb } from './supabase';

interface CacheEntry { url: string; expiresAt: number }

const _signedUrlCache = new LRUCache<string, CacheEntry>({
  max:   500,                // max 500 entries (prevents OOM on large deployments)
  ttl:   22.5 * 60 * 60 * 1000  // 22.5 hours
});
```

### Step 2.9 — Verify Phase 2

```bash
# 1. Rate limit: 6th login in 1 min must fail
for i in {1..6}; do
  curl -s -X POST http://localhost:8888/.netlify/functions/api \
    -H "Content-Type: application/json" \
    -d '{"action":"login","args":{"username":"nobody","password":"bad"}}';
done | grep '"Too many requests"'

# 2. CORS: request from unlisted origin must be rejected
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' \
  -v 2>&1 | grep "Access-Control-Allow-Origin" | grep -v "evil.com"

# 3. RS256 token is issued on login
TOKEN=$(curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d '{"action":"login","args":{"username":"admin","password":"admin123"}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo $TOKEN | cut -d. -f1 | base64 -d 2>/dev/null | python3 -c "import sys,json; h=json.load(sys.stdin); print(h.get('alg'))" 2>/dev/null || \
  node -e "const t='$TOKEN'; const h=JSON.parse(Buffer.from(t.split('.')[0],'base64url').toString()); console.log(h.alg)"
# Must print: RS256

# 4. deleteEmployee now soft-deletes (check DB)
# employee must still exist with status='inactive', deleted_at NOT NULL
```

---

## Phase 3 — Performance (Presigned Uploads, Edge Functions)

**Goal:** Fix VULN-006 (base64 uploads). Eliminate large payloads through Lambda.

### Step 3.1 — Add presigned upload URL route

**Create `netlify/functions/api/routes/profile/get-upload-url.ts`:**
```typescript
import { Context } from 'hono';
import { AppEnv, requireUser } from '../../middleware/auth.middleware';
import { sb } from '../../lib/supabase';
import { z } from 'zod';

const Schema = z.object({
  bucket:   z.enum(['profile-photos', 'attendance-photos']),
  filename: z.string().max(100).regex(/^[a-zA-Z0-9_\-.]+$/)
});

export async function getUploadUrlHandler(c: Context<AppEnv>, args: unknown) {
  const actor = await requireUser(c);
  const { bucket, filename } = Schema.parse(args);

  // Namespace by user to prevent path traversal
  const path = `${(actor as any).id}/${Date.now()}_${filename}`;

  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) return c.json({ success: false, message: error?.message || 'Failed to create upload URL' });

  return c.json({ success: true, data: { uploadUrl: data.signedUrl, path } });
}
```

### Step 3.2 — Update `markAttendance` to accept `photoPath`

In `mark-attendance.ts`, accept `photoPath` (already-uploaded path) as alternative to `photoBase64`:

```typescript
const photo = args.photoPath
  ? String(args.photoPath)
  : (args.photoBase64 ? await uploadBase64(photoBucket, args.photoBase64, `...`) : '');
```

This makes both upload methods work during the frontend migration period.

### Step 3.3 — Verify Phase 3

```bash
# 1. Get presigned upload URL
TOKEN="..." # admin token from login
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"getUploadUrl\",\"token\":\"$TOKEN\",\"args\":{\"bucket\":\"attendance-photos\",\"filename\":\"test.jpg\"}}" \
  | grep '"uploadUrl"'

# 2. Lambda memory stays under 256MB under load
# Monitor via Netlify function logs during testing
```

---

## Phase 4 — Compliance (Data Retention, Export, Monitoring)

**Goal:** Meet T&T Data Protection Act requirements.

### Step 4.1 — Add data retention scheduled function

**Create `netlify/functions/data-retention.js`:**
```javascript
const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

// Runs at 2am on the 1st of every month
exports.handler = schedule('0 2 1 * *', async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  // Anonymise GPS data older than 2 years (keep record, clear coordinates)
  await sb.from('attendance')
    .update({ check_in_lat: null, check_in_lng: null, check_out_lat: null, check_out_lng: null })
    .lt('work_date', twoYearsAgo.toISOString().slice(0, 10));

  // Delete activity_logs older than 3 years
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  await sb.from('activity_logs').delete().lt('created_at', threeYearsAgo.toISOString());

  console.log('data-retention: completed');
  return { statusCode: 200, body: 'done' };
});
```

### Step 4.2 — Add `exportMyData` route

```typescript
// Returns all data for the authenticated user in JSON format
case 'exportMyData': {
  const actor = await requireUser(c);
  const [{ data: profile }, { data: attendance }, { data: leaves }, { data: payslips }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,email,phone,department_id,position,role,status,created_at').eq('id', (actor as any).id).single(),
    sb.from('attendance').select('work_date,check_in_time,check_out_time,total_hours,status').eq('user_id', (actor as any).id).order('work_date', { ascending: false }),
    sb.from('leave_requests').select('type,from_date,to_date,days,status,applied_at').eq('user_id', (actor as any).id),
    sb.from('payroll_approvals').select('date_from,date_to,pay_cycle,gross_pay,net_pay,approved_at').eq('user_id', (actor as any).id).eq('status', 'approved')
  ]);
  return c.json({ success: true, data: { profile, attendance, leaves, payslips, exportedAt: new Date().toISOString() } });
}
```

### Step 4.3 — Verify Phase 4

```bash
# 1. Export endpoint returns all user data
curl -s -X POST http://localhost:8888/.netlify/functions/api \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"exportMyData\",\"token\":\"$EMPLOYEE_TOKEN\",\"args\":{}}" \
  | python3 -m json.tool | grep '"profile"'

# 2. Data retention function is registered in Netlify
# Check netlify.toml schedules section or dashboard
```

---

## Rollback Plan (Any Phase)

If a phase breaks production:

1. **Netlify**: Go to Deploys → find the last working deploy → click "Publish deploy"
2. **Database**: If schema changes were made, run the inverse SQL:
   ```sql
   -- Example: undo Phase 2.5 ticket sequence
   ALTER TABLE public.support_tickets ALTER COLUMN ticket_number DROP DEFAULT;
   DROP SEQUENCE IF EXISTS public.ticket_number_seq;
   ```
3. **Env vars**: Revert any changed environment variables in Netlify dashboard

---

## Phase Completion Checklist

After each phase:
- [ ] All verification commands pass
- [ ] `git add` and `git commit` with message `feat: phase N — <description>`
- [ ] Deploy to Netlify staging (`netlify deploy --alias staging`)
- [ ] Smoke test all critical paths: login, check-in, payroll run, leave submit
- [ ] Only then deploy to production (`netlify deploy --prod`)
