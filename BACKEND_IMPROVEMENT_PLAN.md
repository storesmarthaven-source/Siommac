# Siomac Backend Improvement Plan

> Grounded in a full read of `netlify/functions/api.js` (2863 lines), `netlify/functions/auto-checkout.js` (98 lines), `package.json`, and `netlify.toml` as of 2026-05-11.

---

## 1. Current Architecture Overview

### What the backend is

The entire backend is a **single Netlify Lambda function** (`netlify/functions/api.js`) behind one HTTP route (`POST /api`). Every frontend call sends `{ action, args, token }` in the JSON body. The handler at line 2847 parses the action string, looks it up in the `routes` object (defined at line 1787), and calls the matching async function. There is no HTTP router, no middleware chain, and no separation of concerns beyond plain JavaScript functions.

The scheduled companion (`auto-checkout.js`) is a separate Netlify scheduled function that runs on a `*/5 * * * *` cron.

### Authentication

- **Token issuance** (`signUser`, line 38): `jsonwebtoken.sign` with HS256 (the default), a shared secret from `process.env.JWT_SECRET`, and an `expiresIn: '8h'` claim. Payload carries `sub` (UUID), `username`, `role`, and `departmentId`.
- **Token verification** (`verifyToken`, line 42): `jwt.verify` wrapped in try/catch; returns `null` on any error including expiry. The token is extracted from `body.token` or `body.args.token` — it travels in the POST body, not in an `Authorization` header.
- **`requireUser`** (line 47): decodes the token, then performs a live DB lookup (`SELECT * FROM app_users WHERE id = $1`) to confirm the user is still active. This adds one DB round-trip to every authenticated request.
- **`requireRole`** (line 54): calls `requireUser` then checks `role` membership. Every admin-only route therefore costs two DB queries before the business logic begins (one for `requireUser`, and `requireUser` is called inside `requireRole`).
- **No refresh tokens, no revocation table.** A stolen token is valid for 8 hours with no way to invalidate it server-side.

### Database access

The Supabase JS client is constructed once at module load time (line 14) using `SUPABASE_SERVICE_ROLE_KEY`. The service role key bypasses all Row Level Security policies. Every query in the system — from the most innocuous `getSettings` to the destructive `deleteEmployee` — runs with superuser-equivalent database credentials. RLS policies, if they exist in Supabase, are completely inert.

### Settings system

A flat `settings` table with columns `(key, value, updated_at)`. Keys are arbitrary strings (`workHours`, `lateThresholdHHMM`, `companyName`, `companyLogoUrl`, `currency`, `latePenaltyPerDay`, `leaveFinePerDay`, `payroll_*`). The `setting(key, fallback)` helper (line 70) issues a `SELECT value FROM settings WHERE key = $1` query. There is no caching. Every call to `markAttendance` hits the `settings` table at least twice (once for `workHours`, once for `lateThresholdHHMM`), each as a separate round-trip.

### File uploads

`uploadBase64(bucket, base64, name)` (line 90) accepts a base64-encoded image data URI in the request body. It:
1. Checks the raw string length against an 8 MB soft cap.
2. Parses the MIME type from the data URI prefix.
3. Calls `Buffer.from(raw, 'base64')` — allocating the full binary buffer in Lambda memory.
4. Checks the decoded buffer size against a 6 MB hard cap.
5. Uploads to Supabase Storage via the JS client.

The full base64 payload (up to ~8 MB) travels in the POST body of the Lambda invocation, is decoded in-process, and uploaded synchronously before the route handler returns. There is no streaming.

### Auto-checkout scheduled function

`auto-checkout.js` fires every 5 minutes. It creates a **fresh Supabase client on every invocation** (line 21), reads the `workHours` setting, then issues one UPDATE per open attendance row using `Promise.allSettled`. It has no authentication — Netlify's scheduled function infrastructure calls it directly. There is no HMAC signature or secret verification to prevent an external party from triggering it via a crafted HTTP request (Netlify does restrict access, but the function itself performs no verification).

### Complete route inventory

| Route | What it does |
|---|---|
| `ping` | Health check, returns timestamp |
| `setupDemoUsers` | Seeds three demo accounts with hardcoded passwords (no auth required) |
| `login` | Verifies username+password, returns JWT + user data |
| `logout` | Logs the event, returns success (no token invalidation) |
| `updateColorScheme` | Updates `color_scheme` column for the calling user |
| `updateLayoutMode` | Updates `layout_mode` column for the calling user |
| `listEmployees` | Returns all users with today's attendance status and signed profile photo URLs (admin only) |
| `addEmployee` | Creates a new user account with hashed password (admin only) |
| `updateEmployee` | Patches employee fields including optional photo upload (admin only) |
| `deleteEmployee` | Deletes employee and all their attendance/leave records (admin only) |
| `getEmployeeByUsername` | Returns full employee profile with signed photo URL |
| `listDepartments` | Returns departments with manager names and headcounts |
| `addDepartment` | Creates a department (admin only) |
| `updateDepartment` | Updates a department (admin only) |
| `deleteDepartment` | Deletes a department (admin only) |
| `listManagers` | Returns users with role admin or manager (admin only) |
| `listProjectSites` | Returns sites with assigned employees and signed photo URLs |
| `addProjectSite` | Creates a project site (admin only) |
| `updateProjectSite` | Updates a project site (admin only) |
| `deleteProjectSite` | Deletes a project site (admin only) |
| `assignSiteEmployees` | Replaces all assignments for a site (admin only) |
| `getSettings` | Returns all settings as a flat key-value map (no auth) |
| `updateSetting` | Upserts a setting key-value pair (admin only) |
| `getWorkHours` | Returns parsed `workHours` JSON setting |
| `saveWorkHours` | Validates and saves work hours window (admin only) |
| `markAttendance` | Check-in or check-out with GPS validation, site enforcement, and optional photo |
| `getMyStatus` | Returns today's attendance record for the calling user |
| `getMyHistory` | Returns attendance records for the past N days (default 30, max 365) |
| `getMyChart` | Returns present/absent/sunday counts for a calendar month |
| `submitLeave` | Creates a leave request |
| `getMyLeaves` | Returns leave requests for the calling user |
| `getLeaveById` | Returns full leave details with employee and reviewer info |
| `updateLeave` | Updates a pending leave request |
| `deleteLeave` | Deletes a leave request |
| `approveLeave` | Sets leave status to approved (admin/manager only) |
| `rejectLeave` | Sets leave status to rejected (admin/manager only) |
| `listAllLeaves` | Returns all leave requests with employee names (admin only) |
| `getPendingLeavesForManager` | Returns pending leaves scoped to the manager's department |
| `getDeptStats` | Returns department attendance/leave summary (manager/admin) |
| `getDeptEmployees` | Returns department employee list with today's status (manager/admin) |
| `getAdminStats` | Returns company-wide attendance summary (admin only) |
| `getRecentAttendance` | Returns most recent check-ins for today (admin/manager) |
| `listAttendance` | Returns per-employee attendance summary for a month with signed photo URLs (admin only) |
| `listDailyLog` | Returns per-day attendance rows with analytics (admin/manager) |
| `getLiveAttendance` | Returns all currently checked-in employees with GPS and photos (admin/manager) |
| `getDashboardCharts` | Returns daily trend, dept distribution, status breakdown, leave type data (admin only) |
| `updateMyProfile` | Updates calling user's name, email, phone, password, or profile photo |
| `uploadLogo` | Uploads company logo to `branding` bucket (admin only) |
| `listHourlyRates` | Returns employee hourly rates (admin only) |
| `updateHourlyRate` | Updates a single employee's hourly rate (admin only) |
| `bulkImportRates` | Updates hourly rates for multiple employees sequentially (admin only) |
| `getPayrollEmployees` | Returns list of employees for payroll selection (admin/manager) |
| `getPayroll` | Returns detailed payroll breakdown for one employee and month (admin/manager) |
| `listPayrollRun` | Computes payroll for all employees over a date range using T&T tax engine (admin/manager) |
| `approvePayroll` | Upserts payslip records to `payroll_approvals` table (admin/manager) |
| `getMyPayslips` | Returns approved payslips for the calling employee |
| `getPayrollConstants` | Returns T&T payroll constants with DB overrides (admin only) |
| `savePayrollConstants` | Saves T&T payroll constants to settings table (admin only) |
| `updateEmployeePayroll` | Updates an employee's pay cycle, basis, rates, and tax flags (admin only) |
| `verifyPassword` | Re-checks the calling user's password (used before sensitive operations) |
| `getSettings` | Returns full settings map (no auth enforced) |
| `getSignedUrls` | Returns presigned Supabase Storage URLs for given paths |
| `getNotifications` | Returns role-appropriate notification list from multiple DB queries |
| `markNotificationsRead` | No-op (always returns success) |
| `sendMessage` | Creates an internal message thread |
| `getMessages` | Returns message threads with replies and read state |
| `replyMessage` | Appends a reply to a message thread |
| `markMessageRead` | Updates the per-user read timestamp for a thread |
| `deleteMessage` | Deletes a message thread (admin/manager only) |
| `getEmployeesForMsg` | Returns employee list for message recipient picker |
| `createTicket` | Creates a support ticket (employees only) |
| `getTickets` | Returns support tickets with replies and photos |
| `replyTicket` | Appends a reply to a ticket |
| `updateTicketStatus` | Changes ticket status (admin/manager only) |
| `deleteTicket` | Soft-deletes a ticket (employees only) |
| `clearClosedTickets` | Hides closed tickets for the calling user's view |
| `getHeaderCounts` | Returns badge counts for notifications, messages, tickets, leaves, and active sites in one request |

---

## 2. Security Vulnerabilities

### CRITICAL

#### 2.1 Service Role Key Used for All Queries — RLS Entirely Bypassed

**Location:** Line 14, `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...)`.

**Problem:** The service role key bypasses Supabase's Row Level Security. Every query runs with postgres superuser privileges regardless of which user made the request. An employee calling `getMyHistory` executes with the same database authority as an admin calling `deleteEmployee`. If any route handler has a logic flaw that fails to check `actor.id === args.userId`, the service role key means there is no database-level backstop.

**Risk:** A logic bug in any route becomes a full data breach, not a scoped one. An attacker who can trigger an unvalidated query parameter can read or modify any table row.

**Fix:** Use the Supabase `anon` key for read operations and issue per-user JWTs signed by Supabase Auth for writes. Alternatively, keep the service role key but add RLS policies as a defense-in-depth layer and scope all queries to the authenticated user's ID explicitly — which the code already does, but only at the application layer.

#### 2.2 No Rate Limiting on Login

**Location:** `login` function, line 227.

**Problem:** There is no brute-force protection on the login endpoint. An attacker can send unlimited `{ action: "login", args: { username: "admin", password: "..." } }` requests. The bcrypt comparison at line 233 is intentionally slow, but bcrypt at cost factor 10 (used throughout — see lines 265, 387, 442) takes ~100ms per attempt. At 10 concurrent requests that is 100 guesses per second per IP with no lockout.

**Risk:** Full credential brute-force for any known username. The username is discovered trivially since `login` uses `.ilike('username', username)` (case-insensitive match), which confirms existence via timing.

**Fix:** Sliding window rate limiter per IP: 5 failed attempts per 15 minutes results in a 429. Implementation shown in Section 7.

#### 2.3 JWT Transmitted in POST Body

**Location:** Line 2855, `body.token || body.args.token`.

**Problem:** The JWT is sent in the JSON body of every POST request, not in the `Authorization: Bearer` header. This is non-standard and causes several downstream issues: (a) the token is logged by any request-logging middleware that logs the body; (b) the token appears in browser network inspector request bodies making it easier to exfiltrate; (c) there is no `Authorization` header that intermediary proxies or CDNs can use for cache-key construction or security scanning.

**Fix:** Extract the token from the `Authorization: Bearer <token>` header. Update the frontend to send it there.

#### 2.4 JWT Secret: HS256 with No Rotation Mechanism

**Location:** `signUser` line 38, `verifyToken` line 42.

**Problem:** HS256 is a symmetric algorithm — the same secret signs and verifies. If `JWT_SECRET` leaks (via a Netlify env var breach, a log line, or a code repository accident), all existing tokens can be forged indefinitely. There is no key rotation path. The secret is a bare string with no minimum entropy requirement; a weak value like `"secret"` is fully valid.

**Fix (Option B, minimal migration risk):** Switch to RS256. Generate an RSA keypair; store only the private key in Netlify env vars. The public key can be published. This means a leaked verification key cannot forge new tokens. Separately, add a minimum entropy check on startup and log a warning if `JWT_SECRET` is shorter than 32 characters.

#### 2.5 No Token Revocation

**Location:** `logout` route, line 1791.

**Problem:** Logout only logs the event. The token remains valid until its 8-hour expiry. If a user's device is stolen or an employee is terminated, their token cannot be invalidated server-side.

**Fix:** Add a `sessions` table with `(jti, user_id, expires_at, revoked_at)`. On login, embed a UUID `jti` claim in the token. On logout, set `revoked_at`. In `verifyToken`, after signature verification, check the `sessions` table for revocation. On employee deactivation, revoke all active sessions for that user.

---

### HIGH

#### 2.6 bcrypt Cost Factor 10 — Below Current Best Practice

**Location:** Lines 265, 387, 442, 1278.

**Problem:** `bcrypt.hash(password, 10)` uses a cost factor of 10. The OWASP recommendation as of 2025 is 12 for bcrypt. At cost 10, a modern GPU can crack a typical password hash in seconds. The `setupDemoUsers` function at line 265 also uses cost 10, and more critically, uses hardcoded passwords (`admin123`, `manager123`, `emp123`) that are visible in plaintext in the source file.

**Fix:** Change all `bcrypt.hash` calls to use cost factor 12. Add a startup check: on login, if the stored hash has a cost factor below 12, re-hash the password with the higher cost and update the DB. Remove `setupDemoUsers` from production builds entirely, or gate it behind an admin check.

#### 2.7 `getSettings` Has No Authentication

**Location:** Line 1824, `getSettings: async () => getSettings()`.

**Problem:** The `getSettings` route calls `getSettings()` with no `requireUser` or `requireRole`. Any unauthenticated caller can retrieve the full settings map, which includes `companyName`, `companyLogoUrl`, currency, work hours, late thresholds, and all `payroll_*` constants (personal allowance, NIS rate, PAYE rates, etc.). The payroll constants in particular should not be publicly readable.

**Fix:** Add `await requireRole(ctx, ['admin'])` to the `getSettings` route wrapper, and add a separate `getPublicSettings` that returns only the non-sensitive fields needed by the login screen.

#### 2.8 CORS Wildcard — `Access-Control-Allow-Origin: *`

**Location:** `json` helper, lines 21-27.

**Problem:** Every response includes `access-control-allow-origin: *`. This allows any origin on the internet to make credentialed cross-origin requests to the API. Since authentication is via a body token (not a cookie), the practical CSRF risk is low, but the wildcard still means any malicious web page can make API calls from a victim's browser context.

**Fix:** Set `Access-Control-Allow-Origin` to the specific domain(s) where the frontend is hosted. Read the origin from `event.headers.origin`, validate it against a whitelist, and echo it back if valid.

#### 2.9 Base64 Photos in Request Body — DoS and Memory Risk

**Location:** `markAttendance` line 568, `updateEmployee` line 447, `updateMyProfile` line 1286, `uploadLogo` line 1298.

**Problem:** A base64-encoded 6 MB image is ~8 MB of text. Netlify Lambda functions have a 6 MB synchronous invocation payload limit and a 512 MB to 3 GB memory limit depending on configuration. An attacker can send repeated requests with maximum-size payloads to exhaust Lambda memory or cause timeout errors. The 8 MB `MAX_BASE64_BYTES` check (line 88) is a reasonable cap, but it is checked after JSON parsing, meaning the full payload has already been allocated in memory.

**Risk:** Memory pressure causes Lambda cold starts; simultaneous large uploads can exhaust concurrent Lambda capacity; if the size check is bypassed by a crafted payload (e.g. missing the data URI prefix), `Buffer.from` will process arbitrary data.

**Fix:** Replace base64 uploads with presigned URLs (Section 5f). The API request body drops to a few hundred bytes.

#### 2.10 Missing Request Body Size Limit

**Location:** Line 2851, `JSON.parse(event.body || '{}')`.

**Problem:** There is no check on `event.body.length` before parsing. Netlify enforces a 6 MB body limit for synchronous functions, but there is no application-level size guard. Paired with the base64 upload pattern, this means the full 6 MB is parsed and allocated before the `uploadBase64` size check is reached.

**Fix:** Add `if ((event.body || '').length > 9 * 1024 * 1024) return fail('Request too large', 413);` at the top of the handler, before JSON parsing. For non-upload routes, set a much tighter limit (e.g. 64 KB).

#### 2.11 Logging Sensitive Data

**Location:** Line 2859, `console.error(action, e)`. Also line 2859 indirectly logs `action` which is the route name; for the `login` action, `e.message` could include the username. The `log_` function at line 60 logs `action` and `details` to the `activity_logs` table — for `updateHourlyRate`, `details` is `String(args.rate || 0)`, which is fine, but for `login ok` it logs nothing sensitive. However, the `updateSetting` logger at line 749 logs the full setting value: `await log_(actor, 'update', 'setting', args.key, String(args.value || ''))` — if an admin updates a sensitive setting this value goes into activity logs.

**Fix:** Redact sensitive fields in `log_` calls. Never log JWT secrets, passwords, or API keys. For `updateSetting`, log only the key name, not the value if the key is in a sensitive list.

---

### MEDIUM

#### 2.12 Auto-Checkout Has No Request Authentication

**Location:** `auto-checkout.js` line 15, `exports.handler = schedule(...)`.

**Problem:** Netlify scheduled functions are invoked by Netlify's internal scheduler. However, the function handler itself is a standard HTTP handler that Netlify also exposes at `/.netlify/functions/auto-checkout`. Any external HTTP caller can POST to that URL and trigger the auto-checkout logic without any authentication. The function would then check out all currently checked-in employees.

**Fix:** Add a shared secret check: `if (event.headers['x-netlify-event'] !== 'schedule' || event.headers['x-webhook-signature'] !== process.env.AUTO_CHECKOUT_SECRET) return { statusCode: 401 }`. Netlify injects `x-netlify-event: schedule` on scheduled invocations.

#### 2.13 `verifyToken` Timing Attack on JWT Comparison

**Location:** `verifyToken` line 42.

**Problem:** `jwt.verify` with HS256 uses a constant-time HMAC comparison internally (in `jsonwebtoken` v9). This is fine. However, the username lookup in `login` uses `.ilike('username', username)` (line 231) — a case-insensitive query — which has a different timing profile for existing vs. non-existing usernames. An attacker can enumerate valid usernames by timing the difference between "user not found" (fast Postgres miss) and "wrong password" (slow bcrypt compare).

**Fix:** When a user is not found, still perform a dummy `bcrypt.compare` call against a pre-hashed dummy value to equalize timing.

#### 2.14 `setupDemoUsers` Is Exposed as an Unauthenticated Route

**Location:** Line 1789, `setupDemoUsers` in the `routes` object.

**Problem:** `setupDemoUsers` has no `requireRole` call. Any unauthenticated caller can POST `{ action: "setupDemoUsers" }` and it will upsert three known-credential accounts into `app_users`. If the production database still has the demo users from initial setup, their passwords are `admin123`, `manager123`, `emp123`.

**Fix:** Remove this route from production entirely. Gate it with an environment variable check (`if (process.env.ALLOW_DEMO_SETUP !== 'true') return { success: false, message: 'Not available' }`).

---

## 3. Performance Bottlenecks

### 3.1 N+1 Query Pattern in `listEmployees`

**Location:** `listEmployees`, lines 337-368.

The function correctly parallelises the three main queries (users, departments, attendance) via `Promise.all`. However, it then calls `getProfileSignedUrl` per user in a `Promise.all` (line 351). Each `getProfileSignedUrl` call can itself issue two sequential DB queries: one to read `signed_url_expires_at` from `app_users`, and one to generate and persist a fresh signed URL if the cached one is stale. For a company with 50 employees, this is potentially 100 sequential DB round-trips after the initial 3 parallel ones.

**Fix:** Batch-fetch `signed_url` and `signed_url_expires_at` in the initial `app_users` query (they are already selected as `SELECT *`). Use the cached value directly for all users whose URL is still valid. Only regenerate for users with stale URLs, and batch those updates.

### 3.2 N+1 in `getLiveAttendance`

**Location:** `getLiveAttendance`, lines 1180-1188.

For each attendance record, `getProfileSignedUrl(u.id, u.profile_image)` is called inside the `Promise.all`. Same problem as above: each call can hit the DB twice. For a large company with 100 employees all checked in, this is up to 200 additional round-trips.

### 3.3 Sequential `await` Chains in `getLeaveById`

**Location:** `getLeaveById`, lines 685-691.

After fetching the leave record, it fires five queries in parallel: `userRow`, `deptRow`, `reviewerRow`, `companyName`, `companyLogoUrl`. This is actually done correctly with `Promise.all`. However, the first fetch of the leave record itself (line 703) is sequential before any of the parallel fetches. The only true fix here is to move the parallel fetches to start immediately while the first query runs, which requires restructuring the data flow. Not a major issue.

### 3.4 `getNotifications` — Waterfall of Sequential Queries

**Location:** `getNotifications`, lines 1982-2372.

For the admin/manager path, the function runs: leaves query → resolve leave user IDs → fetch leave users → resolve leave photo URLs (sequential per user) → checkin query → checkout query → resolve attendance user IDs → fetch attendance users → resolve attendance photo URLs → absent employee queries. This is a series of dependent queries that cannot all be parallelised, but several intermediate photo URL resolutions are sequential where they could be batched.

For the employee path, the function runs at least 7 separate sequential queries (own attendance, decided leaves, pending leaves, payslips, upcoming leave, unread messages, message replies, ticket IDs, ticket replies, closed tickets). These are independent and should all be fired in a single `Promise.all`.

**Fix for employee path:** Wrap all employee notification queries in one `Promise.all` at the top of the else branch.

### 3.5 `bulkImportRates` Sequential Updates

**Location:** `bulkImportRates`, lines 1333-1344.

```js
for (const row of args.rows || []) {
  const { error } = await sb.from('app_users').update(...).eq('username', username);
```

This is a classic sequential loop of awaited DB calls. For 100 employees, this is 100 serial round-trips. Total latency = 100 × ~20ms = ~2 seconds minimum.

**Fix:** Batch with `upsert` on `username` (if it has a unique index) or use `Promise.all` across all updates. Alternatively, accept the data as a single `upsert` payload.

### 3.6 Settings Re-Fetched on Every Request

**Location:** `setting(key, fallback)` helper, line 70, called from `markAttendance` (lines 559, 570), `auto-checkout.js` (line 24), and `getPayroll` (lines 1391-1395).

Every call to `setting()` issues a `SELECT value FROM settings WHERE key = $1` query. In `markAttendance` alone there are two calls (`workHours` and `lateThresholdHHMM`). Settings change rarely — `workHours` might change once a week. Fetching them on every check-in is wasteful.

**Fix:** In-memory cache with a 60-second TTL, as shown in Section 7.

### 3.7 Cold Start: 2863-Line File Loaded on Every Cold Start

**Location:** `api.js` as a whole.

Netlify Lambda functions are Node.js processes. On a cold start, the entire 2863-line `api.js` is parsed, evaluated, and all module-level code runs (Supabase client creation, `TT_PAYROLL` initialisation, `_signedUrlCache` Map instantiation). The file requires `bcryptjs`, `jsonwebtoken`, and `@supabase/supabase-js`. The bcrypt module includes native bindings. Total cold start for this function is measurably higher than for smaller functions.

**Fix:** Splitting into modules (Section 5h) reduces parse time. Moving to Hono on Edge Functions (Section 5a) eliminates cold starts entirely since Deno processes stay warm at the edge.

### 3.8 Supabase Client Recreated Per Invocation in Auto-Checkout

**Location:** `auto-checkout.js` line 21, `const sb = createClient(...)` inside the handler.

The Supabase client is constructed inside the handler function, not at module level. This means even when the Lambda container is warm (no cold start), a new client object is created on every scheduled invocation. The `createClient` call is not expensive, but it is unnecessary. The `api.js` correctly creates the client at module level.

**Fix:** Move `const sb = createClient(...)` to module level, outside the handler.

---

## 4. Scalability Limitations

### 4.1 Single-File Monolith — All Routes in One Lambda

Every invocation of any route, no matter how lightweight (e.g. `ping`, `logout`), loads the entire 2863-line file including the T&T payroll engine, all bcrypt/JWT imports, and the full route map. Netlify has a 10 MB uncompressed function size limit; the current bundle is well within that, but there is no code splitting. A bug in any function can affect all routes — a syntax error anywhere breaks the entire API.

### 4.2 No Pagination on High-Volume Endpoints

The following endpoints return unbounded result sets:

- `listAllLeaves` (line 876): `SELECT * FROM leave_requests ORDER BY applied_at DESC` — no limit.
- `getMyHistory` (line 626): capped at 365 days but returns all records in that range with no page limit. A company with daily attendance over a year = 365 rows per employee, all returned at once.
- `listAttendance` (line 1003): returns all active employees with all attendance for the month, then calls `getSignedUrl` per employee. No limit.
- `getNotifications` (line 1983): no pagination; for large companies, the absent employee list could include hundreds of entries.
- `getMessages` (line 2434): hard-coded limit of 100 for admin, 50 for employee — this is a limit, not real pagination.

For a company with 200+ employees, `listAttendance` could return 200+ rows, each triggering signed URL generation, bringing total response time to 4-10 seconds.

**Fix:** Add `limit` and `offset` (or cursor) parameters to `listAllLeaves`, `listAttendance`, `listDailyLog`, and `getMyHistory`. Return `totalCount` alongside the page.

### 4.3 No Queue for Background Tasks

Auto-checkout does DB writes inline in the scheduled function. If the function times out (Netlify's 10-second background function limit for synchronous functions), some employees will be partially checked out and others will not. The `Promise.allSettled` approach is correct for parallel DB writes, but there is no retry mechanism for failed updates beyond the single `Promise.allSettled` sweep.

For a company where the `workHours` end time coincides with high API traffic, the auto-checkout function competes for Supabase connection pool slots with user-facing requests.

**Fix:** Use Supabase's `pg_cron` extension to run the auto-checkout SQL directly in the database on a cron schedule, eliminating the Lambda entirely. Or use a Supabase Edge Function with a proper queue.

### 4.4 Flat Settings Store — No Per-Tenant or Per-Department Config

The `settings` table is a single flat namespace shared by the entire system. There is no concept of per-department work hours, per-site late thresholds, or per-employee pay cycle defaults. As the product grows to support multiple companies or departments with different policies, the flat key-value store becomes a bottleneck.

**Fix:** Add a `scope` column to `settings` (values: `global`, `dept:{id}`, `user:{id}`) and update the `setting()` helper to resolve scoped values with fallback to global.

### 4.5 No Queue/Worker for Photo Processing

Base64 photo uploads are processed synchronously in the Lambda handler. Each upload blocks the response until the Supabase Storage upload completes over the network. For a check-in burst at 8 AM when many employees arrive simultaneously, multiple Lambdas are each uploading 5-6 MB files in parallel, creating network I/O saturation.

---

## 5. Recommended Architecture

### 5a. Framework: Hono.js on Netlify Edge Functions

**Why Hono:**

Hono is a ~12 KB web framework designed for edge/serverless environments. It has:
- A typed router that replaces the manual `routes` object lookup.
- Built-in middleware for CORS, JWT verification, rate limiting, and request validation.
- First-class TypeScript support with Zod integration via `@hono/zod-validator`.
- Native support for Netlify Edge Functions (Deno runtime) and for Netlify Lambda (Node.js) if migration to edge is deferred.
- Compatible with the `@supabase/supabase-js` client unchanged.

**Cold start comparison:**

| Runtime | Cold start |
|---|---|
| Node.js Lambda (current) | 800ms – 2000ms |
| Deno Edge Function (Hono) | 50ms – 150ms |

Edge Functions run in Deno at the CDN edge node nearest to the user. They have no cold start problem because they are loaded into V8 isolates that stay warm, and the Deno runtime starts faster than Node.js.

**Before (current pattern):**
```js
// api.js — single handler, manual dispatch
const routes = {
  login,
  markAttendance,
  // ... 50+ more
};
exports.handler = async event => {
  const action = JSON.parse(event.body).action;
  const fn = routes[action];
  if (!fn) return fail('Route not found');
  return ok(await fn(args, ctx));
};
```

**After (Hono pattern):**
```js
// app.js
import { Hono } from 'hono';
import { authRouter } from './routes/auth.js';
import { attendanceRouter } from './routes/attendance.js';

const app = new Hono();
app.use('*', corsMiddleware());
app.use('/api/*', jwtMiddleware());
app.route('/api/auth', authRouter);
app.route('/api/attendance', attendanceRouter);
export default app;
```

### 5b. Input Validation: Zod

Every route handler currently trusts `args` entirely. `args.username` is cast with `String()` but not validated for length, format, or injection. `args.latitude` is passed through `num()` but not range-checked (-90 to 90). `args.fromDate` is used directly in date arithmetic with no format validation.

Zod schemas should be defined once per route and applied as Hono middleware. The `@hono/zod-validator` package gives automatic 400 responses with structured error messages.

**Example schemas:**

```ts
import { z } from 'zod';

// login
export const loginSchema = z.object({
  username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(1).max(128)
});

// markAttendance
export const markAttendanceSchema = z.object({
  username: z.string().min(1).max(50),
  action: z.enum(['CheckIn', 'CheckOut', 'Project']),
  siteId: z.string().uuid().optional(),
  location: z.object({
    latitude:  z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy:  z.number().min(0).max(10000).optional()
  }).optional(),
  photoBase64: z.string().max(8 * 1024 * 1024).optional() // still pre-presigned-URL migration
});

// saveWorkHours
export const saveWorkHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/)
}).refine(d => d.start < d.end, { message: 'start must be before end' });
```

With `@hono/zod-validator`, the route becomes:

```ts
attendance.post('/mark', zValidator('json', markAttendanceSchema), async c => {
  const args = c.req.valid('json'); // fully typed, validated
  // ... handler logic
});
```

A validation failure returns a 400 with the Zod error structure automatically — no boilerplate.

### 5c. Authentication: Keep Custom JWT but Fix It

**Option A — Supabase Auth:**
Pros: passkeys, MFA, email OTP, refresh tokens, and session management built-in. Supabase generates short-lived JWTs signed with the project's RSA key. RLS policies can reference `auth.uid()` directly.
Cons: requires migrating all existing `app_users` password hashes to Supabase Auth identities. Supabase Auth does not support bcrypt re-hashing of existing passwords directly — each user would need to reset their password. Significant migration effort.

**Option B — Keep Custom JWT (Recommended):**
Lower migration risk. Required fixes:

1. **Switch from HS256 to RS256.** Generate a 2048-bit RSA keypair. Store the PEM private key in a Netlify env var (`JWT_PRIVATE_KEY`). Verify with the public key (`JWT_PUBLIC_KEY`). A leaked public key cannot forge tokens.

2. **Store `JWT_SECRET` with minimum entropy.** Add a startup assertion: `if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET too short')`.

3. **Add `jti` claim and `sessions` table.** On login, insert a row into `sessions (jti uuid pk, user_id, expires_at)`. On `verifyToken`, after signature validation, query `sessions` for the `jti` and check it is not revoked. On logout, delete the row. On employee deactivation, delete all rows for that `user_id`.

4. **Add refresh token flow.** Issue a long-lived (30-day) opaque refresh token stored in `sessions`. The access token (JWT) has a 15-minute expiry. The client uses the refresh token to get a new access token without re-entering credentials.

5. **Move token to `Authorization: Bearer` header.** Update `verifyToken` to read `event.headers.authorization`.

### 5d. Database Access: Use RLS Properly

**Current state:** All queries run as `service_role`, bypassing RLS entirely.

**Fix path (without full Supabase Auth migration):**

Create a Postgres function (SECURITY DEFINER) for sensitive cross-table operations and call it via RPC. For example, the `deleteEmployee` function deletes from `attendance`, `leave_requests`, and `app_users` in sequence. This should be a single atomic Postgres transaction, not three separate Supabase JS calls.

```sql
CREATE OR REPLACE FUNCTION delete_employee(p_user_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- runs as the function owner (postgres), not the caller
SET search_path = public
AS $$
BEGIN
  -- Check actor is admin
  IF (SELECT role FROM app_users WHERE id = p_actor_id) != 'admin' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  DELETE FROM attendance       WHERE user_id = p_user_id;
  DELETE FROM leave_requests   WHERE user_id = p_user_id;
  DELETE FROM app_users        WHERE id      = p_user_id;
END;
$$;
```

Then call via: `await sb.rpc('delete_employee', { p_user_id, p_actor_id })`.

**RLS policy structure needed:**

```sql
-- Employees can only see their own attendance
CREATE POLICY emp_att_select ON attendance
  FOR SELECT USING (user_id = auth.uid());

-- Managers can see attendance in their department
CREATE POLICY mgr_att_select ON attendance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = auth.uid()
      AND u.role = 'manager'
      AND u.department_id = (
        SELECT department_id FROM app_users WHERE id = attendance.user_id
      )
    )
  );

-- Admins see all
CREATE POLICY admin_att_all ON attendance
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin')
  );
```

With RLS enabled and the `authenticated` role used instead of `service_role`, a bug that forgets to check `actor.id === args.userId` in the application layer will be caught at the database layer.

### 5e. Rate Limiting: Upstash Redis

Netlify Edge Functions have network access. Upstash Redis provides an HTTP-accessible Redis instance with a free tier sufficient for rate limiting.

**Sliding window rate limiter for `/api/auth/login`:**

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(), // UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  prefix: 'rl:login'
});

// Middleware for login route
app.use('/api/auth/login', async (c, next) => {
  const ip = c.req.header('x-nf-client-connection-ip') || 'unknown';
  const { success, limit, remaining, reset } = await ratelimit.limit(ip);
  if (!success) {
    c.header('X-RateLimit-Limit',     String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset',     String(reset));
    return c.json({ success: false, message: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  }
  await next();
});
```

**Global rate limit (per IP, all routes):**

```ts
const globalLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(120, '1 m'), // 120 req/min per IP
  prefix: 'rl:global'
});

app.use('*', async (c, next) => {
  const ip = c.req.header('x-nf-client-connection-ip') || 'unknown';
  const { success } = await globalLimit.limit(ip);
  if (!success) return c.json({ success: false, message: 'Rate limit exceeded' }, 429);
  await next();
});
```

### 5f. File Uploads: Replace Base64 with Presigned URLs

**Current flow:**
1. Client encodes photo to base64 (in browser: ~33% size increase).
2. Client sends base64 string inside the JSON POST body.
3. Lambda decodes base64, allocating up to 6 MB in Lambda memory.
4. Lambda uploads binary to Supabase Storage over the network.
5. Lambda returns the storage path to the client.

**Problems:** The Lambda is a CPU-bound middleman. The 6 MB binary is allocated twice (once as base64 string, once as Buffer). The Lambda's network connection to Supabase Storage adds latency. The Lambda body size is limited to ~6 MB by Netlify.

**Replacement flow (two-step):**

```
Step 1: Client → POST /api/storage/upload-url
        { bucket: 'attendance-photos', filename: 'checkin.jpg', mimeType: 'image/jpeg' }
        ← { uploadUrl, storagePath }

Step 2: Client → PUT {uploadUrl}  (direct to Supabase Storage, bypasses Lambda)
        Body: raw binary JPEG, no base64 overhead
        ← 200 OK

Step 3: Client → POST /api/attendance/mark
        { ..., storagePath: 'john_CheckIn_2026-05-11_1747000000000.jpg' }
        (no photo data in the API call)
```

**API route for Step 1:**

```ts
attendance.post('/upload-url', zValidator('json', z.object({
  bucket:   z.enum(['attendance-photos', 'profile-photos']),
  filename: z.string().max(100).regex(/^[a-zA-Z0-9_.-]+$/),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp'])
})), async c => {
  const actor = c.get('user'); // set by JWT middleware
  const { bucket, filename, mimeType } = c.req.valid('json');
  const safeName = `${actor.id}_${Date.now()}_${filename}`;
  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(safeName);
  if (error) return c.json({ success: false, message: error.message }, 500);
  return c.json({ success: true, uploadUrl: data.signedUrl, storagePath: data.path });
});
```

Supabase Storage's `createSignedUploadUrl` generates a short-lived URL (default 60 seconds) that allows a direct PUT from the client browser. The Lambda never touches the binary data.

### 5g. Caching

**Settings cache (in-memory + optional Upstash):**

The `setting()` helper is called from hot paths (`markAttendance`, `auto-checkout`). Settings change at most a few times per day.

```ts
// In-memory cache — module level, persists across warm invocations
const _settingsCache = new Map<string, { value: string; expiresAt: number }>();
const SETTINGS_TTL_MS = 60_000; // 60 seconds

async function setting(key: string, fallback = ''): Promise<string> {
  const cached = _settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  const value = data ? data.value : fallback;
  _settingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_TTL_MS });
  return value;
}

// Invalidate cache when a setting is updated
async function updateSetting(args, ctx) {
  // ... existing update logic ...
  _settingsCache.delete(args.key); // force next read to re-fetch
  return { success: true };
}
```

**Profile photo signed URLs (already partially implemented):**

The `signed_url` and `signed_url_expires_at` columns on `app_users` already provide cross-cold-start persistence of signed URLs. The issue is the `getProfileSignedUrl` function issues a DB read per user to check expiry, which defeats the purpose of caching when called in bulk (e.g. `listEmployees` iterates all employees).

Fix: include `signed_url, signed_url_expires_at` in the initial `SELECT *` from `app_users`, check validity inline without a second query, and only regenerate (and update) stale URLs.

### 5h. Splitting the Monolith

Split `api.js` into logical Hono routers:

```
netlify/edge-functions/
  api.ts                  ← root: mounts all routers, applies global middleware
  routes/
    auth.ts               ← login, logout, verifyPassword
    attendance.ts         ← markAttendance, getMyStatus, getMyHistory, getMyChart, listAttendance, listDailyLog, getLiveAttendance
    employees.ts          ← listEmployees, addEmployee, updateEmployee, deleteEmployee, getEmployeeByUsername
    departments.ts        ← listDepartments, addDepartment, updateDepartment, deleteDepartment, listManagers
    sites.ts              ← listProjectSites, addProjectSite, updateProjectSite, deleteProjectSite, assignSiteEmployees
    leave.ts              ← submitLeave, getMyLeaves, getLeaveById, updateLeave, deleteLeave, approveLeave, rejectLeave, listAllLeaves, getPendingLeavesForManager
    payroll.ts            ← listPayrollRun, approvePayroll, getMyPayslips, getPayroll, getPayrollConstants, savePayrollConstants, updateEmployeePayroll, listHourlyRates, updateHourlyRate, bulkImportRates, getPayrollEmployees
    settings.ts           ← getSettings, updateSetting, getWorkHours, saveWorkHours, uploadLogo
    notifications.ts      ← getNotifications
    messages.ts           ← sendMessage, getMessages, replyMessage, markMessageRead, deleteMessage, getEmployeesForMsg
    tickets.ts            ← createTicket, getTickets, replyTicket, updateTicketStatus, deleteTicket, clearClosedTickets
    dashboard.ts          ← getAdminStats, getDeptStats, getDeptEmployees, getRecentAttendance, getDashboardCharts, getHeaderCounts
  lib/
    db.ts                 ← Supabase client singleton
    auth.ts               ← requireUser, requireRole, JWT helpers
    settings.ts           ← setting() helper with cache
    storage.ts            ← uploadBase64, getSignedUrl, getProfileSignedUrl (until presigned URL migration)
    payroll-engine.ts     ← calcPayslip, TT_PAYROLL constants
```

Each router file exports a `Hono` instance. The root `api.ts` imports and mounts them. Netlify Edge Functions (Deno) can tree-shake unused imports if modules are properly structured.

### 5i. TypeScript

Add TypeScript with strict mode from the start of the refactor:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true
  }
}
```

Generate Supabase types from the live schema:
```bash
npx supabase gen types typescript --project-id <id> --schema public > lib/database.types.ts
```

This gives fully typed `sb.from('app_users').select(...)` calls — the TypeScript compiler will catch column name typos and mismatched field types at compile time, not at runtime.

Add `tsc --noEmit` to CI:
```json
// package.json
"scripts": {
  "check": "tsc --noEmit",
  "lint": "eslint netlify/edge-functions/**/*.ts"
}
```

---

## 6. Migration Roadmap

### Phase 1: Security Fixes — No Architecture Change (1–2 Days)

All changes are to `api.js` and `auto-checkout.js` only. No frontend changes needed.

1. **Request size limit:** Add body length check before `JSON.parse` in the handler.
2. **CORS whitelist:** Replace `'*'` with explicit origin from env var `ALLOWED_ORIGIN`.
3. **bcrypt cost factor:** Change all `bcrypt.hash(pw, 10)` calls to `bcrypt.hash(pw, 12)`.
4. **JWT expiry enforcement:** Already enforced by `jwt.verify` — confirm `verifyToken` does not suppress `TokenExpiredError` differently from other errors. Currently it does not — all errors return `null`. This is acceptable but add a log distinguishing expired vs. invalid.
5. **Rate limiting on login:** Add a simple in-memory rate limiter (per-IP Map, 5 attempts / 15 min) as an interim before Upstash. Note: in-memory limits do not persist across cold starts. Upstash is the proper fix but in-memory is better than nothing.
6. **Gate `setupDemoUsers`:** Add `if (process.env.NODE_ENV === 'production') return { success: false }` check.
7. **Gate `getSettings`:** Add `await requireRole(ctx, ['admin'])`.
8. **Auto-checkout secret check:** Add `x-netlify-event` header validation.
9. **Zod validation on critical routes:** Add manual validation for `login`, `markAttendance`, `saveWorkHours`, `addEmployee` using inline checks while Zod is not yet a dependency.

**Deliverable:** All CRITICAL and HIGH vulnerabilities mitigated. No breaking changes.

### Phase 2: Performance — No Breaking Changes (3–5 Days)

1. **Presigned upload URLs:** Add `getUploadUrl` route. Update `markAttendance`, `updateEmployee`, `updateMyProfile`, `uploadLogo` to accept `storagePath` instead of `photoBase64`. Keep `photoBase64` as a deprecated fallback for one release.
2. **Parallelise `getNotifications` employee path:** Wrap independent queries in `Promise.all`.
3. **Fix `bulkImportRates`:** Replace sequential loop with `Promise.all` of updates.
4. **Settings cache:** Implement in-memory 60-second TTL cache in the `setting()` helper. Invalidate on `updateSetting` and `saveWorkHours`.
5. **Batch profile URL resolution:** Update `listEmployees`, `getLiveAttendance`, `listAttendance` to use the already-fetched `signed_url` column directly instead of calling `getProfileSignedUrl` per row.
6. **Pagination on `listAllLeaves`:** Add `limit` (default 50, max 200) and `offset` parameters.
7. **Pagination on `listAttendance` and `listDailyLog`:** Add `limit` and `offset`.
8. **Move Supabase client to module level in auto-checkout.js.**

**Deliverable:** Response times for `listEmployees`, `getLiveAttendance`, `getNotifications` reduced significantly. No frontend breaking changes (pagination params are additive).

### Phase 3: Architecture Refactor (1–2 Weeks)

1. **Introduce Hono and split routes** into the module structure defined in Section 5h.
2. **Add TypeScript.** Generate Supabase types. Enable strict mode.
3. **Add Zod schemas** to all routes.
4. **Migrate to Edge Functions** (Netlify Deno runtime). Test all routes. Move `netlify/functions/api.js` → `netlify/edge-functions/api.ts`.
5. **Wire Upstash rate limiting** on login and global IP rate limit.
6. **Implement SECURITY DEFINER Postgres functions** for `deleteEmployee` and `approvePayroll` to make them atomic and remove multi-step delete chains.
7. **Add `sessions` table** and `jti`-based token revocation.

**Deliverable:** Modular, typed codebase. Cold starts eliminated. Token revocation working. All routes validated with Zod.

### Phase 4: Auth Hardening (Optional, 1 Week)

1. **Switch JWT signing to RS256.** Generate RSA keypair. Update `signUser` and `verifyToken`.
2. **Add refresh token flow.** Add `POST /api/auth/refresh` route that accepts the refresh token and issues a new 15-minute access JWT.
3. **Evaluate Supabase Auth migration.** If the product needs MFA, passkeys, or email OTP in the next 12 months, plan a migration. Estimated effort: 3-5 days for the migration script + 1 week for frontend changes.

---

## 7. Quick-Win Code Examples

### 7.1 Hono Router Replacing the `routes` Object

```ts
// routes/auth.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sb } from '../lib/db.js';
import { signUser, requireUser } from '../lib/auth.js';
import { setting } from '../lib/settings.js';
import bcrypt from 'bcryptjs';

export const authRouter = new Hono();

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(128)
});

authRouter.post('/login', zValidator('json', loginSchema), async c => {
  const { username, password } = c.req.valid('json');
  const { data: u } = await sb.from('app_users').select('*').ilike('username', username).maybeSingle();
  if (!u || u.status !== 'active') return c.json({ success: false, message: 'Invalid username or password' });
  const passOk = await bcrypt.compare(password, u.password_hash);
  if (!passOk) return c.json({ success: false, message: 'Invalid username or password' });
  const [profileImage, companyLogoUrl, companyName] = await Promise.all([
    getProfileSignedUrl(u.id, u.profile_image),
    setting('companyLogoUrl', ''),
    setting('companyName', 'My Company')
  ]);
  return c.json({
    success: true,
    token: signUser(u),
    userId: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role,
    profileImage, companyLogoUrl, companyName
  });
});

authRouter.post('/logout', async c => {
  const user = c.get('user'); // set by JWT middleware
  await log_(user, 'logout', 'user', user.id, '');
  return c.json({ success: true });
});
```

```ts
// api.ts — root
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth.js';
import { attendanceRouter } from './routes/attendance.js';

const app = new Hono();

app.use('*', cors({
  origin: c => {
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const o = c.req.header('origin') || '';
    return allowed.includes(o) ? o : allowed[0];
  },
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.route('/api/auth', authRouter);
app.route('/api/attendance', attendanceRouter);
// ... other routers

export default app;
```

### 7.2 Zod Schema for `markAttendance`

```ts
import { z } from 'zod';

export const markAttendanceSchema = z.object({
  username:    z.string().min(1).max(50),
  action:      z.enum(['CheckIn', 'CheckOut', 'Project']),
  siteId:      z.string().uuid('siteId must be a UUID').optional(),
  location: z.object({
    latitude:  z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy:  z.number().min(0).max(50000).optional()
  }).optional(),
  // Pre-presigned-URL: still accepting base64 but limited
  photoBase64: z.string()
    .max(8 * 1024 * 1024, 'Photo must be under 6 MB')
    .optional(),
  // Post-presigned-URL: accept storage path instead
  storagePath: z.string().max(200).optional()
}).refine(
  d => !(d.photoBase64 && d.storagePath),
  { message: 'Provide either photoBase64 or storagePath, not both' }
);

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
```

### 7.3 In-Memory Rate Limiter for Login (Interim — Before Upstash)

```ts
// lib/rate-limit.ts
interface RateLimitEntry {
  count:     number;
  windowStart: number;
}

const _store = new Map<string, RateLimitEntry>();
const WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const entry = _store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // New window
    _store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, resetMs: now + WINDOW_MS };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: entry.windowStart + WINDOW_MS
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - entry.count,
    resetMs: entry.windowStart + WINDOW_MS
  };
}

// Upstash version (production) — replaces the above
import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';

export const loginLimiter = new Ratelimit({
  redis:   Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(MAX_ATTEMPTS, '15 m'),
  prefix:  'rl:login'
});
```

**Usage in login route:**
```ts
authRouter.post('/login', zValidator('json', loginSchema), async c => {
  const ip = c.req.header('x-nf-client-connection-ip') || 'unknown';
  const { allowed, remaining, resetMs } = checkRateLimit(`login:${ip}`);
  if (!allowed) {
    const retryAfterSec = Math.ceil((resetMs - Date.now()) / 1000);
    c.header('Retry-After', String(retryAfterSec));
    return c.json({ success: false, message: `Too many login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` }, 429);
  }
  // ... rest of login logic
});
```

### 7.4 Presigned Upload URL Flow

```ts
// routes/storage.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sb } from '../lib/db.js';

export const storageRouter = new Hono();

const uploadUrlSchema = z.object({
  bucket:   z.enum(['attendance-photos', 'profile-photos', 'branding']),
  filename: z.string().max(100).regex(/^[a-zA-Z0-9_.\-]+$/, 'Invalid filename'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
});

storageRouter.post('/upload-url', zValidator('json', uploadUrlSchema), async c => {
  const actor = c.get('user');
  const { bucket, filename, mimeType } = c.req.valid('json');

  // Scope uploads to the calling user's ID to prevent path guessing
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const safePath = `${actor.id}_${Date.now()}_${filename.replace(/[^a-zA-Z0-9_.\-]/g, '_')}.${ext}`;

  // createSignedUploadUrl returns a URL valid for 60 seconds
  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(safePath);
  if (error) return c.json({ success: false, message: error.message }, 500);

  return c.json({
    success: true,
    uploadUrl:   data.signedUrl,  // PUT to this URL from the browser
    storagePath: data.path        // send this back in markAttendance or updateProfile
  });
});
```

**Client-side usage:**
```js
// 1. Get presigned URL
const { uploadUrl, storagePath } = await api('storage/upload-url', { bucket: 'attendance-photos', filename: 'checkin.jpg', mimeType: 'image/jpeg' });

// 2. Upload directly to Supabase Storage (no Lambda in the path)
await fetch(uploadUrl, { method: 'PUT', body: photoBlob, headers: { 'Content-Type': 'image/jpeg' } });

// 3. Mark attendance with the storage path only
await api('attendance/mark', { action: 'CheckIn', storagePath, ...otherFields });
```

### 7.5 Settings Cache-Aside with In-Memory Map and TTL

```ts
// lib/settings.ts
import { sb } from './db.js';

interface CacheEntry {
  value:     string;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 60 seconds

export async function setting(key: string, fallback = ''): Promise<string> {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  const value = data?.value ?? fallback;
  _cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

// Call this whenever a setting is updated
export function invalidateSetting(key: string): void {
  _cache.delete(key);
}

// Bulk fetch (for getSettings route) — also populates cache
export async function allSettings(): Promise<Record<string, string>> {
  const { data } = await sb.from('settings').select('key, value');
  const now = Date.now();
  const map: Record<string, string> = {};
  for (const row of data || []) {
    map[row.key] = row.value;
    _cache.set(row.key, { value: row.value, expiresAt: now + TTL_MS });
  }
  return map;
}
```

**Note on Lambda warm container lifetime:** The in-memory Map persists as long as the Lambda container stays alive (typically 5–15 minutes of inactivity before AWS recycles it). For a multi-instance deployment under load, each Lambda container has its own Map. A setting updated by admin in one container will not propagate to other containers for up to 60 seconds — this is acceptable for settings that change rarely. If stricter consistency is needed, use Upstash Redis instead of the Map.

---

## Summary Table: Issues vs. Fix Priority

| Issue | Severity | Effort | Phase |
|---|---|---|---|
| `setupDemoUsers` unauthenticated | Critical | 5 min | 1 |
| `getSettings` unauthenticated | Critical | 5 min | 1 |
| No rate limit on login | Critical | 2h | 1 |
| bcrypt cost factor 10 | High | 30 min | 1 |
| CORS wildcard | High | 30 min | 1 |
| Request body size limit missing | High | 15 min | 1 |
| Auto-checkout unauthenticated | High | 30 min | 1 |
| JWT in POST body | Medium | 2h (+ frontend) | 2 |
| No token revocation | Medium | 1 day | 3 |
| Service role key — RLS bypass | Critical | 1–2 weeks | 3 |
| Base64 uploads in body | High | 2 days | 2 |
| Sequential `bulkImportRates` | Medium | 1h | 2 |
| Settings re-fetched every request | Medium | 2h | 2 |
| No pagination on list endpoints | Medium | 1 day | 2 |
| N+1 in `listEmployees` / `getLiveAttendance` | Medium | 4h | 2 |
| Sequential employee path in `getNotifications` | Medium | 2h | 2 |
| Single-file monolith | Low | 1–2 weeks | 3 |
| No TypeScript | Low | 1 week | 3 |
| No Zod validation | High | 1 week | 3 |
| HS256 → RS256 | Medium | 1 day | 4 |
| No refresh tokens | Medium | 2 days | 4 |
