# SECURITY.md — Threat Model, Vulnerability Analysis & Compliance

> **Machine-executable reference.**  
> Every vulnerability maps to a specific fix in IMPLEMENTATION_PLAN.md.

---

## 1. Threat Model

### Assets
| Asset | Classification | Impact if compromised |
|---|---|---|
| `app_users.password_hash` | Confidential | Account takeover for all users |
| `JWT_SECRET` / `JWT_PRIVATE_KEY` | Secret | Ability to mint admin tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Full DB read/write/delete |
| Employee GPS coordinates | Sensitive PII | Location tracking / stalking |
| Attendance photos | Sensitive PII | Biometric-adjacent data |
| Payroll figures (salary, NIS, PAYE) | Confidential financial | Discrimination, extortion |
| Messages & tickets | Internal | Reputation, legal exposure |

### Actors
| Actor | Trust level | Attack surface |
|---|---|---|
| Unauthenticated internet user | Zero | Login endpoint, OPTIONS, public routes |
| Authenticated employee | Low | Own routes; cannot access other users' data |
| Authenticated manager | Medium | Dept-scoped routes |
| Authenticated admin | High | All routes; trusted but must still be validated |
| Compromised employee token | Adversary | All employee-accessible routes |
| Compromised admin token | Critical adversary | All routes + settings + payroll |
| Netlify Lambda runtime | Trusted infrastructure | Env vars, outbound requests |
| Supabase service | Trusted infrastructure | DB, storage |

---

## 2. Current Vulnerabilities (Phase 0)

### VULN-001 — Weak JWT signing algorithm (HS256)
- **Severity:** HIGH  
- **OWASP:** A02:2021 — Cryptographic Failures  
- **Detail:** HS256 shares the same secret for signing and verification. Any service that verifies tokens also has the power to forge them. If `JWT_SECRET` leaks (e.g., in a log, a git commit, or a compromised deploy), an attacker can create admin tokens indefinitely.  
- **Fix:** Migrate to RS256 (ADR-002). See IMPLEMENTATION_PLAN Phase 2.

### VULN-002 — bcrypt cost factor too low (10)
- **Severity:** MEDIUM  
- **OWASP:** A02:2021 — Cryptographic Failures  
- **Detail:** OWASP recommends cost ≥ 12. At cost 10, a modern GPU cluster can attempt ~10^7 guesses/sec on a stolen database dump. A typical 8-char password is cracked in < 1 day.  
- **Fix:** Increase cost to 12. Transparent rehash on next login (IMPLEMENTATION_PLAN Phase 1).

### VULN-003 — No rate limiting on login
- **Severity:** HIGH  
- **OWASP:** A07:2021 — Identification & Authentication Failures  
- **Detail:** The login endpoint has no throttle. An attacker can attempt unlimited passwords. Combined with weak bcrypt (VULN-002), brute-force is feasible.  
- **Fix:** Upstash Redis sliding-window: 5 req/min per IP on `/api` login action (IMPLEMENTATION_PLAN Phase 2).

### VULN-004 — CORS allows all origins (`*`)
- **Severity:** MEDIUM  
- **OWASP:** A05:2021 — Security Misconfiguration  
- **Detail:** Any website can call the API from a user's browser. If the user is logged in and a malicious site makes a cross-origin POST, the token in localStorage can be exfiltrated via JavaScript.  
- **Fix:** Restrict `Access-Control-Allow-Origin` to `ALLOWED_ORIGINS` env var (IMPLEMENTATION_PLAN Phase 2).

### VULN-005 — Token transmitted in request body
- **Severity:** LOW-MEDIUM  
- **OWASP:** A02:2021 — Cryptographic Failures  
- **Detail:** JWT is in the POST body (`body.token`). While HTTPS protects in transit, body-logged middleware or a request dump would expose tokens. The standard location is the `Authorization` header.  
- **Fix:** Phase 2: Accept `Authorization: Bearer <JWT>` header; keep body fallback for one release cycle.

### VULN-006 — Base64 photo upload through Lambda
- **Severity:** MEDIUM  
- **OWASP:** A04:2021 — Insecure Design  
- **Detail:** Up to 8 MB of base64 passes through the Lambda. This causes: (a) memory exhaustion on large payloads, (b) slow cold starts, (c) potential for DoS by sending max-size images repeatedly (no per-user upload rate limit).  
- **Fix:** Presigned PUT URLs (ADR-004, IMPLEMENTATION_PLAN Phase 3).

### VULN-007 — No input validation (no Zod)
- **Severity:** MEDIUM  
- **OWASP:** A03:2021 — Injection  
- **Detail:** All route args are consumed with `String(args.x || '')`. While Supabase uses parameterised queries (preventing SQL injection), malformed input can cause: unexpected DB behaviour, business-logic bypass, and type coercion bugs (e.g., `args.nisApplicable !== false` evaluates to `true` even when `args.nisApplicable = 'false'`).  
- **Fix:** Zod schemas on all routes (ADR-006, IMPLEMENTATION_PLAN Phase 1).

### VULN-008 — `deleteEmployee` hard-deletes all attendance & leave records
- **Severity:** MEDIUM  
- **OWASP:** A04:2021 — Insecure Design  
- **Detail:** Deleting an employee cascades to `attendance` and `leave_requests`. This destroys payroll history, audit trails, and approved payslips. This is a data-integrity vulnerability.  
- **Fix:** Soft-delete: set `status = 'inactive'` and `deleted_at = NOW()`. Preserve all historical records (IMPLEMENTATION_PLAN Phase 2).

### VULN-009 — `setupDemoUsers` route is publicly callable
- **Severity:** HIGH  
- **OWASP:** A05:2021 — Security Misconfiguration  
- **Detail:** The `setupDemoUsers` route creates hardcoded accounts (`admin/admin123`, `manager1/manager123`, `employee1/emp123`) with no auth check. Calling it on a production instance resets/creates these accounts. An attacker who discovers the API can gain admin access instantly.  
- **Fix:** Remove the route entirely in Phase 1. Or gate it behind `NODE_ENV === 'development'`.

### VULN-010 — Ticket number generation race condition
- **Severity:** LOW  
- **OWASP:** A04:2021 — Insecure Design  
- **Detail:** `createTicket` reads `MAX(ticket_number)` and increments. Under concurrent requests, two tickets can get the same number. The code retries with a random suffix, which is a workaround, not a fix.  
- **Fix:** Use a Postgres sequence: `CREATE SEQUENCE ticket_number_seq; DEFAULT nextval('ticket_number_seq')` (IMPLEMENTATION_PLAN Phase 2).

### VULN-011 — Activity logs can be silently skipped
- **Severity:** LOW  
- **OWASP:** A09:2021 — Security Logging & Monitoring Failures  
- **Detail:** `log_()` wraps the insert in a `try/catch` with an empty catch block. If the `activity_logs` table is missing or the insert fails, the audit record is silently dropped with no alert.  
- **Fix:** Log to `console.error` on failure in the catch block (minimum). Optionally alert via webhook (IMPLEMENTATION_PLAN Phase 2).

### VULN-012 — No request size limit
- **Severity:** MEDIUM  
- **OWASP:** A04:2021 — Insecure Design  
- **Detail:** Netlify Lambda has a 6 MB request body limit at the platform level, but there is no application-level limit. A malicious client can send a 6 MB JSON payload to every route (not just photo uploads), causing memory pressure.  
- **Fix:** Hono middleware rejects requests with `Content-Length > MAX_BODY_SIZE` (configurable per route) before parsing (IMPLEMENTATION_PLAN Phase 1).

### VULN-013 — In-memory signed URL cache is not bounded
- **Severity:** LOW  
- **Detail:** `_signedUrlCache` is a `Map` with no size limit. In a long-lived Lambda instance with thousands of unique attendance photo paths, this map can grow without bound, eventually causing OOM.  
- **Fix:** Replace with an LRU cache (e.g., `lru-cache` npm package, max 500 entries) (IMPLEMENTATION_PLAN Phase 2).

### VULN-014 — `getSettings` requires no authentication
- **Severity:** LOW  
- **OWASP:** A01:2021 — Broken Access Control  
- **Detail:** `getSettings` is called by the frontend before login (to load branding). It returns all settings rows including potentially sensitive key names. The values themselves are not highly sensitive, but the endpoint should at minimum not expose payroll constant keys to unauthenticated callers.  
- **Fix:** Split settings into public (companyName, logo, currency) and private (payroll constants). `getPublicSettings` requires no auth; `getSettings` requires admin (IMPLEMENTATION_PLAN Phase 2).

---

## 3. OWASP Top 10 Mapping (2021)

| OWASP Category | Vulnerabilities | Status |
|---|---|---|
| A01 — Broken Access Control | VULN-014 | Partial |
| A02 — Cryptographic Failures | VULN-001, VULN-002, VULN-005 | Not fixed |
| A03 — Injection | VULN-007 | Not fixed |
| A04 — Insecure Design | VULN-006, VULN-008, VULN-010, VULN-012 | Not fixed |
| A05 — Security Misconfiguration | VULN-004, VULN-009 | Not fixed |
| A06 — Vulnerable Components | None identified | OK |
| A07 — Auth Failures | VULN-003 | Not fixed |
| A08 — Software Integrity | N/A (no CI yet) | N/A |
| A09 — Logging & Monitoring | VULN-011 | Partial |
| A10 — SSRF | N/A (no user-controlled URLs fetched) | OK |

---

## 4. Actor Permission Matrix (Detailed)

> This is the authoritative source of truth for access control. Every route handler must enforce these rules via `requireUser()` or `requireRole()`.

| Route | employee | manager | admin | Notes |
|---|:---:|:---:|:---:|---|
| `login` | ✓ | ✓ | ✓ | Public |
| `logout` | ✓ | ✓ | ✓ | Own session |
| `verifyPassword` | ✓ | ✓ | ✓ | Own password only |
| `updateColorScheme` | ✓ (own) | ✓ (own) | ✓ | Must match username in token |
| `updateLayoutMode` | ✓ (own) | ✓ (own) | ✓ | Must match username in token |
| `listEmployees` | — | — | ✓ | |
| `addEmployee` | — | — | ✓ | |
| `updateEmployee` | — | — | ✓ | |
| `deleteEmployee` | — | — | ✓ | Cannot delete self or last admin |
| `getEmployeeByUsername` | ✓ (own) | ✓ | ✓ | Employee: own only |
| `listManagers` | — | — | ✓ | |
| `listDepartments` | ✓ | ✓ | ✓ | All roles need dept list for forms |
| `addDepartment` | — | — | ✓ | |
| `updateDepartment` | — | — | ✓ | |
| `deleteDepartment` | — | — | ✓ | |
| `listProjectSites` | ✓ | ✓ | ✓ | All need site list for check-in |
| `addProjectSite` | — | — | ✓ | |
| `updateProjectSite` | — | — | ✓ | |
| `deleteProjectSite` | — | — | ✓ | |
| `assignSiteEmployees` | — | — | ✓ | |
| `markAttendance` | ✓ (own) | ✓ (own) | ✓ (any) | Admin can check in for any user |
| `getMyStatus` | ✓ | ✓ | ✓ | Admin can query any username |
| `getMyHistory` | ✓ | ✓ | ✓ | Own only |
| `getMyChart` | ✓ | ✓ | ✓ | Own only |
| `listAttendance` | — | — | ✓ | |
| `listDailyLog` | — | ✓ | ✓ | |
| `getLiveAttendance` | — | ✓ (dept) | ✓ (all) | |
| `submitLeave` | ✓ | ✓ | ✓ | |
| `getMyLeaves` | ✓ | ✓ | ✓ | Own only |
| `getLeaveById` | ✓ (own) | ✓ (dept) | ✓ | |
| `updateLeave` | ✓ (own pending) | — | ✓ | |
| `deleteLeave` | ✓ (own pending) | — | ✓ | |
| `approveLeave` | — | ✓ (dept) | ✓ | |
| `rejectLeave` | — | ✓ (dept) | ✓ | |
| `listAllLeaves` | — | — | ✓ | |
| `getPendingLeavesForManager` | — | ✓ (dept) | ✓ | |
| `getAdminStats` | — | — | ✓ | |
| `getDashboardCharts` | — | — | ✓ | |
| `getDeptStats` | — | ✓ (own dept) | ✓ | |
| `getDeptEmployees` | — | ✓ (own dept) | ✓ | |
| `getRecentAttendance` | — | ✓ | ✓ | |
| `getHeaderCounts` | ✓ | ✓ | ✓ | Role-scoped counts |
| `getSettings` | ✓ (public) | ✓ | ✓ | Phase 2: split into public/private |
| `updateSetting` | — | — | ✓ | |
| `getWorkHours` | ✓ (public) | ✓ | ✓ | |
| `saveWorkHours` | — | — | ✓ | |
| `updateMyProfile` | ✓ (own) | ✓ (own) | ✓ (own) | Must match username in token |
| `uploadLogo` | — | — | ✓ | |
| `getSignedUrls` | ✓ | ✓ | ✓ | |
| `listPayrollRun` | — | ✓ (dept) | ✓ | |
| `approvePayroll` | — | ✓ | ✓ | |
| `getMyPayslips` | ✓ | ✓ | ✓ | Own only |
| `getPayroll` | — | ✓ (dept) | ✓ | |
| `getPayrollEmployees` | — | ✓ | ✓ | |
| `getPayrollConstants` | — | — | ✓ | |
| `savePayrollConstants` | — | — | ✓ | |
| `updateEmployeePayroll` | — | — | ✓ | |
| `listHourlyRates` | — | — | ✓ | |
| `updateHourlyRate` | — | — | ✓ | |
| `bulkImportRates` | — | — | ✓ | |
| `getNotifications` | ✓ | ✓ | ✓ | Role-scoped |
| `sendMessage` | ✓ (to admin) | ✓ (to employee) | ✓ | |
| `getMessages` | ✓ (own threads) | ✓ (all) | ✓ (all) | |
| `replyMessage` | ✓ (own threads) | ✓ | ✓ | |
| `markMessageRead` | ✓ | ✓ | ✓ | |
| `deleteMessage` | — | ✓ | ✓ | |
| `getEmployeesForMsg` | — | ✓ | ✓ | |
| `createTicket` | ✓ | — | — | Admin/manager forbidden |
| `getTickets` | ✓ (own) | ✓ (all) | ✓ (all) | |
| `replyTicket` | ✓ (own) | ✓ | ✓ | Closed/resolved blocked |
| `updateTicketStatus` | — | ✓ | ✓ | |
| `deleteTicket` | ✓ (own open) | — | — | |
| `clearClosedTickets` | ✓ (own) | ✓ (all) | ✓ (all) | Soft-hide only |
| `setupDemoUsers` | REMOVE | REMOVE | REMOVE | **Must be removed in Phase 1** |

---

## 5. Data Classification

| Data | Classification | Retention | Delete on employee removal |
|---|---|---|---|
| Username | Internal | Indefinite | No (audit trail) |
| Password hash | Secret | Until password change | Immediate |
| GPS coordinates | Sensitive PII | 2 years | Yes (anonymise) |
| Attendance photos | Sensitive PII | 1 year | Yes |
| Profile photos | Personal PII | Until updated | Yes |
| Payroll figures | Confidential financial | 7 years (T&T tax law) | No |
| Leave records | HR sensitive | 3 years | No |
| Messages | Internal | 1 year | Anonymise sender |
| Support tickets | Internal | 1 year | Anonymise sender |
| Activity logs | Audit | 3 years | Anonymise user |

---

## 6. T&T Data Protection Act (2011) Compliance

The **Data Protection Act Chap. 22:04** of Trinidad & Tobago applies to personal data of individuals. Key obligations:

| Obligation | Status | Required action |
|---|---|---|
| **Lawful basis for processing** | Partial | Employment contract covers attendance & payroll. Add privacy notice to employee onboarding. |
| **Data minimisation** | Partial | GPS accuracy stored but not needed long-term. Archive after 90 days. |
| **Purpose limitation** | OK | Data used only for HR/payroll. |
| **Storage limitation** | NOT MET | No automated data purge implemented. See IMPLEMENTATION_PLAN Phase 4. |
| **Data subject access request** | NOT MET | No endpoint for employees to export all their data. Add `exportMyData` route in Phase 4. |
| **Right to erasure** | NOT MET | `deleteEmployee` hard-deletes. Switch to soft-delete + anonymise in Phase 2. |
| **Security measures** | PARTIAL | VULN-001–014 must be resolved. |
| **Data breach notification** | NOT MET | No monitoring. Implement Netlify alerting + runbook in Phase 3. |

---

## 7. Security Headers (Phase 2 Target)

Add these headers to all API responses:

```
Content-Type: application/json
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'
Cache-Control: no-store
```

Remove from all responses:
```
X-Powered-By  (leaks runtime info)
Server        (leaks server info)
```

---

## 8. Secret Management Rules

1. **Never commit secrets to git.** `.env.local` is in `.gitignore`.  
2. **Netlify environment variables** are the only production secret store.  
3. **Rotate secrets** using the procedure in RUNBOOK.md — Secrets Rotation.  
4. **`SUPABASE_SERVICE_ROLE_KEY`** must never appear in frontend code or browser network requests.  
5. **JWT keys**: `JWT_PRIVATE_KEY` is backend-only. `JWT_PUBLIC_KEY` can be public but should not be exposed without reason.  
6. **Upstash credentials** have read/write access to the rate-limit Redis instance. Store only in backend env vars.
