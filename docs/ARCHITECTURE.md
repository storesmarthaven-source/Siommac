# ARCHITECTURE.md — System Architecture & Design Decisions

> **Machine-executable reference.**  
> Every ADR documents an irreversible decision. Changing a decision requires a new ADR, not editing this file.

---

## 1. Architecture Decision Records (ADRs)

### ADR-001 — Replace monolithic `api.js` with Hono + modular routes
- **Status:** Accepted  
- **Context:** `api.js` is 2863 lines. A single syntax error kills every route. Hot-reload is slow. Code review is impossible at scale.  
- **Decision:** Adopt [Hono](https://hono.dev) (v4+). One file per route group. Shared logic in `lib/`. Single Netlify function entry point at `netlify/functions/api/index.ts`.  
- **Consequences:** ~50 ms cold start (same as now). TypeScript throughout. Each route independently testable.  
- **Rejected alternatives:** Express (too heavy for edge), Fastify (poor Netlify compat), keep monolith (unacceptable risk).

### ADR-002 — Replace HS256 JWT with RS256
- **Status:** Accepted  
- **Context:** HS256 requires every service that verifies a token to know the secret. A leaked `JWT_SECRET` allows anyone to mint admin tokens.  
- **Decision:** RS256. Private key signs (backend only). Public key verifies. Keys stored in Netlify env vars as PEM strings. Rotate by deploying new keys; old tokens expire naturally within 8 h.  
- **Consequences:** Two env vars instead of one (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`). Slightly larger token (RSA sig ~344 bytes vs 43 bytes).  
- **Rejected alternatives:** EdDSA (not universally supported in jsonwebtoken v9 on Node 18).

### ADR-003 — Increase bcrypt cost factor from 10 to 12
- **Status:** Accepted  
- **Context:** Cost factor 10 (~100 ms) is below current OWASP minimum of 12 (~400 ms). A stolen DB allows offline brute-force at 10^7 guesses/sec on GPU.  
- **Decision:** Set cost factor to 12 for all new hashes. On login, re-hash if the stored cost < 12.  
- **Consequences:** Login time increases by ~300 ms. Invisible to users. Migration is transparent (no forced password reset).

### ADR-004 — Replace base64 photo uploads with presigned S3 PUT URLs
- **Status:** Accepted  
- **Context:** Base64 photos travel through the Lambda function, consuming CPU for decode/re-encode, memory, and increasing cold-start payload. An 8 MB base64 string inflates JSON to ~10 MB.  
- **Decision:** Frontend requests a presigned upload URL from the API. Uploads directly to Supabase Storage. API stores the resulting path, not the image data.  
- **Consequences:** API never handles raw image bytes. Dramatically lower Lambda memory and payload. Frontend requires a two-step upload flow.  
- **Rejected alternatives:** Keep base64 (unacceptable memory and CPU cost at scale).

### ADR-005 — Add Upstash Redis rate limiting
- **Status:** Accepted  
- **Context:** The login endpoint has no rate limiting. An attacker can brute-force passwords with no throttling. OWASP A07:2021 — Identification & Authentication Failures.  
- **Decision:** Upstash Redis sliding-window rate limiter via `@upstash/ratelimit`. Login: 5 req/min per IP. All other routes: 60 req/min per user ID.  
- **Consequences:** One new env var (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). ~5 ms overhead per request. Free Upstash plan handles 10,000 req/day.  
- **Rejected alternatives:** In-memory map (doesn't survive cold starts, no cross-instance sharing).

### ADR-006 — Adopt Zod for all input validation
- **Status:** Accepted  
- **Context:** Current code does no input validation. `String(args.username || '')` is the only guard. SQL injection risk is low (Supabase uses parameterised queries) but business logic corruption is not.  
- **Decision:** Every route has a corresponding Zod schema in `schemas/`. `router.ts` validates args before calling the handler. Invalid input returns `{ success: false, message: '...' }` with a 400 status.  
- **Consequences:** Runtime type safety. Auto-generated TypeScript types via `z.infer<>`. Schemas double as documentation.

### ADR-007 — TypeScript for all new backend code
- **Status:** Accepted  
- **Context:** The current JS codebase has no type safety. `args.siteId` might be undefined, a string, or an array — no compile-time check.  
- **Decision:** All new files in `.ts`. `strict: true`. Auto-generate DB types with `supabase gen types typescript`. Compile target: `ES2022`.  
- **Consequences:** Build step required (`tsc`). Netlify esbuild handles this transparently.

### ADR-008 — Keep `auto-checkout.js` as plain JavaScript scheduled function
- **Status:** Accepted  
- **Context:** The scheduled function has no user-facing routes, no validation, and runs independently of the main API. Converting it to TypeScript adds build complexity for negligible benefit.  
- **Decision:** Keep as `auto-checkout.js`. Use JSDoc for type hints where helpful.

### ADR-009 — Restrict CORS to known origins
- **Status:** Accepted  
- **Context:** Current CORS allows `*` — any origin can call the API. This allows credential theft via CSRF from any website if the user has an active session.  
- **Decision:** `cors.middleware.ts` reads `ALLOWED_ORIGINS` env var (comma-separated). In production: `https://siomac.netlify.app`. In dev: `http://localhost:8888`. Requests from unlisted origins get a 403.  
- **Consequences:** Must add any new frontend deployment domain to `ALLOWED_ORIGINS`.

### ADR-010 — `CORS` is wide-open in current Phase 0; tighten in Phase 2
- **Status:** Superseded by ADR-009 (Phase 2 implementation).  
- **Context:** During Phase 1 (migration only), CORS is kept at `*` to avoid breaking the frontend while the refactor happens. ADR-009 is implemented in Phase 2.

---

## 2. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          BROWSER (SPA)                           │
│  assets/app.js — vanilla JS, no framework                        │
│  Service Worker — caches profile photos                          │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTPS POST /api (JSON body)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              NETLIFY CDN / EDGE NETWORK                          │
│  - TLS termination                                               │
│  - Static asset serving (HTML, CSS, JS)                          │
│  - Routes /.netlify/functions/api → Lambda                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│    NETLIFY LAMBDA FUNCTION  netlify/functions/api/index.ts       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  cors.middleware  →  rate-limit.middleware  →  auth.middleware │
│  └───────────────────────────────┬─────────────────────────┘    │
│                                  │                               │
│  ┌───────────────────────────────▼─────────────────────────┐    │
│  │                    router.ts                             │    │
│  │  POST /api  { action: "markAttendance", args: {...} }    │    │
│  │  → Zod validate args                                     │    │
│  │  → call route handler                                    │    │
│  └───────────────────────────────┬─────────────────────────┘    │
│                                  │                               │
│  ┌────────────────────┐  ┌───────▼──────────┐                   │
│  │   lib/ (shared)    │  │  routes/ handlers │                   │
│  │  supabase.ts       │◄─┤  mark-attendance  │                   │
│  │  jwt.ts            │  │  list-employees   │                   │
│  │  payroll-engine.ts │  │  ...              │                   │
│  │  signed-url.ts     │  └──────────────────┘                   │
│  │  logger.ts         │                                          │
│  └────────────────────┘                                          │
└──────────┬────────────────────────────────────────────┬──────────┘
           │ Supabase JS SDK (service role)              │ Upstash Redis
           ▼                                             ▼
┌─────────────────────────┐              ┌───────────────────────┐
│   SUPABASE (Postgres)   │              │   UPSTASH REDIS       │
│                         │              │   Rate limit counters │
│  app_users              │              │   Sliding window      │
│  attendance             │              └───────────────────────┘
│  leave_requests         │
│  departments            │
│  project_sites          │
│  project_site_employees │
│  payroll_approvals      │
│  settings               │
│  activity_logs          │
│  messages               │
│  message_replies        │
│  message_reads          │
│  support_tickets        │
│  ticket_replies         │
├─────────────────────────┤
│  STORAGE (private)      │
│  profile-photos         │
│  attendance-photos      │
│  branding (public)      │
└─────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│    NETLIFY SCHEDULED FUNCTION  auto-checkout.js  (*/5 * * * *)   │
│  Reads workHours setting → closes open attendance rows           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Request Lifecycle — Check-In (Sequence Diagram)

```
Browser              Lambda               Supabase           Redis
  │                     │                    │                  │
  │─POST /api ──────────▶                    │                  │
  │  { action:"markAttendance",              │                  │
  │    token: "JWT...",                      │                  │
  │    args: { siteId, photoBase64,          │                  │
  │            location: {lat,lng,acc} } }   │                  │
  │                     │                    │                  │
  │              cors.middleware             │                  │
  │              checks origin               │                  │
  │                     │                    │                  │
  │              rate-limit.middleware───────────────────────────▶
  │              sliding window check        │              Redis INCR
  │              (60/min per userId)         │                  │
  │                     │◄─────────────────────────────────── OK│
  │                     │                    │                  │
  │              auth.middleware             │                  │
  │              verifyToken(JWT)            │                  │
  │              → ctx.user = { sub, role }  │                  │
  │                     │                    │                  │
  │              Zod validate args           │                  │
  │              MarkAttendanceSchema        │                  │
  │                     │                    │                  │
  │              requireUser(ctx)────────────▶                  │
  │                     │            SELECT * FROM app_users    │
  │                     │            WHERE id = ctx.user.sub    │
  │                     │◄─────────── { id, role, status }     │
  │                     │                    │                  │
  │              check siteId assignment ────▶                  │
  │                     │            SELECT FROM                │
  │                     │            project_site_employees     │
  │                     │◄─────────── assignment row           │
  │                     │                    │                  │
  │              haversine distance check    │                  │
  │              (lat,lng vs site coords)    │                  │
  │                     │                    │                  │
  │              read workHours setting ─────▶                  │
  │                     │◄─────────── "{"start":"08:00",...}"  │
  │                     │                    │                  │
  │              uploadBase64 photo──────────▶                  │
  │                     │          Storage.upload(path, buffer) │
  │                     │◄─────────── path string              │
  │                     │                    │                  │
  │              INSERT attendance ──────────▶                  │
  │                     │◄─────────── { id }                   │
  │                     │                    │                  │
  │              INSERT activity_logs ───────▶                  │
  │                     │                    │                  │
  │◄────────────────────│                    │                  │
  │  { success:true,    │                    │                  │
  │    time: ISO,       │                    │                  │
  │    site: "name" }   │                    │                  │
```

---

## 4. Request Lifecycle — Login (Sequence Diagram)

```
Browser              Lambda               Supabase           Redis
  │                     │                    │                  │
  │─POST /api ──────────▶                    │                  │
  │  { action:"login",  │                    │                  │
  │    args: {username, password} }          │                  │
  │                     │                    │                  │
  │              rate-limit.middleware ──────────────────────────▶
  │              5 req/min per IP            │              Redis INCR
  │              (login endpoint)            │                  │
  │                     │◄─────────────────────────────────── OK│
  │                     │                    │                  │
  │              SELECT app_users ───────────▶                  │
  │              WHERE username ILIKE $1     │                  │
  │                     │◄─────────── user row (w/ password_hash)
  │                     │                    │                  │
  │              bcrypt.compare()            │                  │
  │              (cost 12 verify)            │                  │
  │                     │                    │                  │
  │              if hash cost < 12:          │                  │
  │              rehash + UPDATE app_users ──▶                  │
  │                     │                    │                  │
  │              jwt.sign(RS256)             │                  │
  │              { sub, username,            │                  │
  │                role, departmentId }      │                  │
  │                     │                    │                  │
  │              getProfileSignedUrl() ──────▶                  │
  │                     │           Storage.createSignedUrl()   │
  │                     │◄─────────── signedUrl + expiry       │
  │                     │                    │                  │
  │              UPDATE app_users ───────────▶                  │
  │              signed_url + expires_at     │                  │
  │                     │                    │                  │
  │◄────────────────────│                    │                  │
  │  { token, userId,   │                    │                  │
  │    role, profileImage, ... }             │                  │
```

---

## 5. Request Lifecycle — Payroll Run (Sequence Diagram)

```
Browser              Lambda               Supabase
  │                     │                    │
  │─POST /api ──────────▶                    │
  │  { action:"listPayrollRun",              │
  │    args: { dateFrom, dateTo, cycle } }   │
  │                     │                    │
  │              requireRole(['admin',       │
  │                          'manager'])     │
  │                     │                    │
  │              SELECT settings ────────────▶
  │              WHERE key LIKE 'payroll_%'  │
  │                     │◄─────────── rows   │
  │              _buildTtPayroll(settings)   │
  │              (pure function, no DB)      │
  │                     │                    │
  │              SELECT app_users ───────────▶
  │              active, non-admin           │
  │                     │◄─────────── employees
  │                     │                    │
  │              SELECT attendance ──────────▶
  │              WHERE work_date BETWEEN ... │
  │                     │◄─────────── recs   │
  │                     │                    │
  │              calcPayslip(emp, hours)     │
  │              for each employee           │
  │              (pure, no DB)               │
  │                     │                    │
  │◄────────────────────│                    │
  │  { rows:[...],      │                    │
  │    totals:{...} }   │                    │
```

---

## 6. Data Flow — Photo Upload (Current vs Target)

### Current (Phase 0) — Base64 through Lambda
```
Browser → [base64 string in POST body] → Lambda → [decode] → Supabase Storage
          ↑ 8 MB JSON payload                     ↑ CPU + memory spike
```

### Target (Phase 3) — Presigned PUT directly to Storage
```
Step 1:  Browser → POST /api { action:"getUploadUrl", bucket, filename }
         Lambda → Supabase Storage.createSignedUploadUrl() → returns { uploadUrl, path }
         Browser ← { uploadUrl, path }

Step 2:  Browser → PUT uploadUrl [binary image, no JSON wrapper]
         (Direct to Supabase Storage, Lambda not involved)

Step 3:  Browser → POST /api { action:"markAttendance", args:{ photoPath: path, ... } }
         Lambda → stores path in attendance.check_in_photo_url
```

---

## 7. Authentication & Authorization Model

### Token Contents (JWT Claims)
```
{
  sub:          "<uuid>",        // app_users.id
  username:     "john_doe",      // app_users.username
  role:         "employee",      // "admin" | "manager" | "employee"
  departmentId: "<uuid>|''",     // app_users.department_id
  iat:          1700000000,
  exp:          1700028800       // 8 hours
}
```

### Role Capability Matrix
| Capability | employee | manager | admin |
|---|:---:|:---:|:---:|
| Check in/out | ✓ (own) | ✓ (own) | ✓ (any) |
| View own attendance | ✓ | ✓ | ✓ |
| View dept attendance | — | ✓ | ✓ |
| View all attendance | — | — | ✓ |
| Submit leave | ✓ | ✓ | ✓ |
| Approve/reject leave | — | ✓ (dept) | ✓ |
| Create support ticket | ✓ | — | — |
| Reply to tickets | — | ✓ | ✓ |
| Run payroll | — | ✓ (dept) | ✓ |
| Approve payroll | — | ✓ | ✓ |
| Manage employees | — | — | ✓ |
| Manage departments | — | — | ✓ |
| Manage project sites | — | — | ✓ |
| Change settings | — | — | ✓ |
| Upload company logo | — | — | ✓ |
| View payroll constants | — | — | ✓ |

### Token Flow
```
POST /api
  body: {
    action: "...",
    token: "<JWT>",     ← in body (not Authorization header — legacy)
    args: { ... }
  }
```
> **Phase 2 migration:** Move token to `Authorization: Bearer <JWT>` header. Keep body fallback for backwards compat for one release cycle.

---

## 8. Payroll Engine Architecture

The T&T payroll engine (`lib/payroll-engine.ts`) is a **pure function module** — no DB calls, no side effects. It is called by `list-payroll-run.ts` after the DB data is loaded.

```
┌──────────────────────────────────────────────┐
│             calcPayslip(emp, hoursWorked)     │
│                                              │
│  A. Gross Pay                                │
│     hourly: hours × hourlyRate               │
│     salary: monthlySalary ÷ cycle-divisor    │
│                                              │
│  B. PAYE (Pay As You Earn)                   │
│     taxResident:                             │
│       taxable = gross - personal_allowance   │
│       if taxable ≤ high_threshold:           │
│         paye = taxable × 25%                 │
│       else:                                  │
│         paye = (threshold × 25%) +           │
│                ((taxable-threshold) × 30%)   │
│     non-resident: flat 25% on gross          │
│                                              │
│  C. NIS (National Insurance)                 │
│     insurable = min(gross, nis_cap[cycle])   │
│     nis = insurable × nis_rate (6%)          │
│                                              │
│  D. Health Surcharge                         │
│     gross > hs_threshold? HIGH : LOW         │
│     per-cycle flat amount                    │
│                                              │
│  E. Net Pay                                  │
│     net = max(0, gross - paye - nis - hs)    │
└──────────────────────────────────────────────┘
```

### Statutory Constants (T&T 2024/2025)
| Constant | Default | Overridable via settings |
|---|---|---|
| Personal Allowance (annual) | $90,000 TTD | `payroll_personal_allowance_annual` |
| PAYE low rate | 25% | `payroll_paye_rate_low` |
| PAYE high rate | 30% | `payroll_paye_rate_high` |
| PAYE high threshold (annual) | $1,000,000 TTD | `payroll_paye_high_threshold_annual` |
| NIS rate | 6% | `payroll_nis_rate` |
| NIS monthly insurable cap | $13,600 TTD | `payroll_nis_monthly_cap` |
| Health Surcharge high (monthly) | $33.00 TTD | `payroll_hs_high_monthly` |
| Health Surcharge low (monthly) | $6.00 TTD | `payroll_hs_low_monthly` |
| HS weekly income threshold | $469.99 TTD | `payroll_hs_threshold_weekly` |

---

## 9. Signed URL Strategy

Profile photos use a **DB-persisted signed URL cache** so the same URL is returned across cold starts (Service Worker cache stability):

```
getProfileSignedUrl(userId, imagePath)
  │
  ├─ imagePath empty / __removed__? → return ''
  ├─ imagePath starts with http? → return as-is (public URL)
  │
  ├─ READ app_users.signed_url + signed_url_expires_at
  │
  ├─ still valid (> 1h remaining)? → return cached URL
  │
  └─ ELSE: Storage.createSignedUrl(24h TTL)
            UPDATE app_users { signed_url, signed_url_expires_at }
            return new URL
```

Attendance photos use an **in-memory Map** (short-lived, per cold-start):
```
_signedUrlCache: Map<"bucket:path", { url, expiresAt }>
TTL: 22.5 hours (refreshed 1.5h before expiry)
```

---

## 10. Scheduled Function Architecture

`auto-checkout.js` runs every 5 minutes via Netlify's scheduled functions (`@netlify/functions` `schedule()`):

```
*/5 * * * *
│
├─ Read settings.workHours from Supabase
├─ Compare nowHHMM (TZ-aware) with wh.end
├─ If nowHHMM < wh.end → exit (nothing to do)
│
└─ SELECT attendance WHERE work_date=today AND check_out IS NULL
   │
   └─ For each open row:
      ├─ Calculate hours (check_in → nominal end time)
      ├─ UPDATE check_out_time, total_hours, notes='Auto-checked out...'
      └─ INSERT activity_logs (SYSTEM actor)
```
