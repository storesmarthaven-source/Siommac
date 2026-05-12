# STRUCTURE.md — File Naming Conventions, Module Split & Directory Tree

> **Machine-executable reference.**  
> Every file listed here must exist after implementation. Deviations require a documented ADR update.

---

## 1. Naming Conventions

### 1.1 Files
| Category | Pattern | Example |
|---|---|---|
| Route handler | `kebab-case.ts` | `mark-attendance.ts` |
| Shared utility | `kebab-case.ts` | `signed-url.ts` |
| Middleware | `kebab-case.middleware.ts` | `auth.middleware.ts` |
| Zod schema | `kebab-case.schema.ts` | `employee.schema.ts` |
| Test file | `<name>.test.ts` | `mark-attendance.test.ts` |
| DB migration | `YYYYMMDDHHMMSS_description.sql` | `20260101000000_init_schema.sql` |
| Type file | `kebab-case.types.ts` | `payroll.types.ts` |

### 1.2 Functions and Variables
| Category | Pattern | Example |
|---|---|---|
| Route handler (async) | `camelCase` | `markAttendance` |
| Private helper | `_camelCase` | `_buildTtPayroll` |
| Zod schema object | `PascalCaseSchema` | `MarkAttendanceSchema` |
| Inferred type | `PascalCase` | `MarkAttendanceInput` |
| Constants | `SCREAMING_SNAKE` | `NIS_MONTHLY_CAP` |
| Env var accessor | `env.VARNAME` | `env.SUPABASE_URL` |

### 1.3 Database
| Category | Pattern | Example |
|---|---|---|
| Table | `snake_case` plural | `app_users`, `attendance` |
| Column | `snake_case` | `check_in_time`, `user_id` |
| Index | `idx_<table>_<col>` | `idx_attendance_work_date` |
| FK constraint | `fk_<child>_<parent>` | `fk_attendance_user` |
| RLS policy | `<role>_<verb>_<table>` | `employee_select_own_attendance` |

### 1.4 Supabase Storage Buckets
| Bucket | Access | Purpose |
|---|---|---|
| `profile-photos` | Private | Employee profile images |
| `attendance-photos` | Private | Check-in / check-out selfies |
| `branding` | Public | Company logo |

---

## 2. Target Directory Tree

```
siomac/
├── netlify/
│   ├── functions/
│   │   ├── api/                          ← NEW: modular function directory
│   │   │   ├── index.ts                  ← Hono app entry point (replaces api.js)
│   │   │   ├── router.ts                 ← All route registrations
│   │   │   ├── middleware/
│   │   │   │   ├── auth.middleware.ts     ← JWT verify, inject ctx.user
│   │   │   │   ├── rate-limit.middleware.ts ← Upstash Redis sliding-window
│   │   │   │   └── cors.middleware.ts    ← Strict origin allow-list
│   │   │   ├── routes/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── login.ts
│   │   │   │   │   ├── logout.ts
│   │   │   │   │   └── verify-password.ts
│   │   │   │   ├── employees/
│   │   │   │   │   ├── list-employees.ts
│   │   │   │   │   ├── add-employee.ts
│   │   │   │   │   ├── update-employee.ts
│   │   │   │   │   ├── delete-employee.ts
│   │   │   │   │   ├── get-employee-by-username.ts
│   │   │   │   │   └── list-managers.ts
│   │   │   │   ├── attendance/
│   │   │   │   │   ├── mark-attendance.ts
│   │   │   │   │   ├── get-my-status.ts
│   │   │   │   │   ├── get-my-history.ts
│   │   │   │   │   ├── get-my-chart.ts
│   │   │   │   │   ├── list-attendance.ts
│   │   │   │   │   ├── list-daily-log.ts
│   │   │   │   │   └── get-live-attendance.ts
│   │   │   │   ├── leave/
│   │   │   │   │   ├── submit-leave.ts
│   │   │   │   │   ├── get-my-leaves.ts
│   │   │   │   │   ├── get-leave-by-id.ts
│   │   │   │   │   ├── update-leave.ts
│   │   │   │   │   ├── delete-leave.ts
│   │   │   │   │   ├── list-all-leaves.ts
│   │   │   │   │   ├── get-pending-leaves-for-manager.ts
│   │   │   │   │   └── decide-leave.ts
│   │   │   │   ├── departments/
│   │   │   │   │   ├── list-departments.ts
│   │   │   │   │   ├── add-department.ts
│   │   │   │   │   ├── update-department.ts
│   │   │   │   │   └── delete-department.ts
│   │   │   │   ├── project-sites/
│   │   │   │   │   ├── list-project-sites.ts
│   │   │   │   │   ├── add-project-site.ts
│   │   │   │   │   ├── update-project-site.ts
│   │   │   │   │   ├── delete-project-site.ts
│   │   │   │   │   └── assign-site-employees.ts
│   │   │   │   ├── payroll/
│   │   │   │   │   ├── list-payroll-run.ts
│   │   │   │   │   ├── approve-payroll.ts
│   │   │   │   │   ├── get-my-payslips.ts
│   │   │   │   │   ├── get-payroll.ts
│   │   │   │   │   ├── get-payroll-employees.ts
│   │   │   │   │   ├── get-payroll-constants.ts
│   │   │   │   │   ├── save-payroll-constants.ts
│   │   │   │   │   ├── update-employee-payroll.ts
│   │   │   │   │   ├── list-hourly-rates.ts
│   │   │   │   │   ├── update-hourly-rate.ts
│   │   │   │   │   └── bulk-import-rates.ts
│   │   │   │   ├── settings/
│   │   │   │   │   ├── get-settings.ts
│   │   │   │   │   ├── update-setting.ts
│   │   │   │   │   ├── get-work-hours.ts
│   │   │   │   │   └── save-work-hours.ts
│   │   │   │   ├── profile/
│   │   │   │   │   ├── update-my-profile.ts
│   │   │   │   │   ├── upload-logo.ts
│   │   │   │   │   └── get-signed-urls.ts
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── get-admin-stats.ts
│   │   │   │   │   ├── get-dashboard-charts.ts
│   │   │   │   │   ├── get-dept-stats.ts
│   │   │   │   │   ├── get-dept-employees.ts
│   │   │   │   │   ├── get-recent-attendance.ts
│   │   │   │   │   └── get-header-counts.ts
│   │   │   │   ├── messages/
│   │   │   │   │   ├── send-message.ts
│   │   │   │   │   ├── get-messages.ts
│   │   │   │   │   ├── reply-message.ts
│   │   │   │   │   ├── mark-message-read.ts
│   │   │   │   │   ├── delete-message.ts
│   │   │   │   │   └── get-employees-for-msg.ts
│   │   │   │   ├── tickets/
│   │   │   │   │   ├── create-ticket.ts
│   │   │   │   │   ├── get-tickets.ts
│   │   │   │   │   ├── reply-ticket.ts
│   │   │   │   │   ├── update-ticket-status.ts
│   │   │   │   │   ├── delete-ticket.ts
│   │   │   │   │   └── clear-closed-tickets.ts
│   │   │   │   └── notifications/
│   │   │   │       └── get-notifications.ts
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts           ← Single createClient instance (service role)
│   │   │   │   ├── jwt.ts                ← signUser(), verifyToken(), RS256 key loading
│   │   │   │   ├── bcrypt.ts             ← hashPassword(), comparePassword() (cost 12)
│   │   │   │   ├── geo.ts                ← haversine(), nearestSite()
│   │   │   │   ├── signed-url.ts         ← getSignedUrl(), getProfileSignedUrl(), resolveAttendancePhotos()
│   │   │   │   ├── storage.ts            ← uploadBase64(), presigned upload helpers
│   │   │   │   ├── payroll-engine.ts     ← calcPayslip(), TT_DEFAULTS, _buildTtPayroll()
│   │   │   │   ├── settings.ts           ← setting() helper, getWorkHours()
│   │   │   │   ├── logger.ts             ← log_() audit trail writer
│   │   │   │   └── date.ts               ← today(), hhmm(), hhmm24(), dateOnly()
│   │   │   ├── schemas/
│   │   │   │   ├── employee.schema.ts
│   │   │   │   ├── attendance.schema.ts
│   │   │   │   ├── leave.schema.ts
│   │   │   │   ├── payroll.schema.ts
│   │   │   │   ├── message.schema.ts
│   │   │   │   ├── ticket.schema.ts
│   │   │   │   └── settings.schema.ts
│   │   │   └── types/
│   │   │       ├── database.types.ts     ← auto-generated: supabase gen types typescript
│   │   │       ├── context.types.ts      ← HonoContext with Variables (user, etc.)
│   │   │       └── payroll.types.ts      ← Payslip, TtPayrollConstants, etc.
│   │   └── auto-checkout.js              ← Scheduled function (keep as-is; no TypeScript needed)
├── supabase/
│   ├── migrations/
│   │   ├── 20260101000000_init_schema.sql
│   │   ├── 20260101000001_rls_policies.sql
│   │   ├── 20260101000002_indexes.sql
│   │   ├── 20260101000003_storage_buckets.sql
│   │   └── 20260201000000_add_signed_url_cache.sql
│   └── config.toml
├── assets/
│   ├── app.js                            ← Frontend SPA (unchanged in Phase 1)
│   ├── styles/
│   │   └── views.css
│   └── partials/
│       └── app-shell.html
├── docs/
│   ├── STRUCTURE.md                      ← This file
│   ├── ARCHITECTURE.md
│   ├── API_SPEC.md
│   ├── DATA_DICTIONARY.md
│   ├── SECURITY.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── RUNBOOK.md
│   ├── TEST_PLAN.md
│   ├── CODE_STANDARDS.md
│   └── ENV_REGISTRY.md
├── netlify.toml
├── package.json
├── tsconfig.json                         ← NEW
└── .env.local                            ← Local dev only; never committed
```

---

## 3. Module Responsibility Matrix

| Module | Responsibility | May import |
|---|---|---|
| `routes/*` | Parse validated input, call lib, return response | `lib/*`, `schemas/*`, `types/*` |
| `middleware/*` | Cross-cutting concerns (auth, rate limit, CORS) | `lib/jwt.ts`, `lib/supabase.ts` |
| `lib/supabase.ts` | Singleton Supabase client | Nothing from this project |
| `lib/payroll-engine.ts` | Pure calculation; no DB calls | `lib/date.ts` |
| `lib/signed-url.ts` | Generate & cache presigned URLs | `lib/supabase.ts` |
| `lib/storage.ts` | Upload images, validate MIME | `lib/supabase.ts` |
| `lib/logger.ts` | Write activity_logs rows | `lib/supabase.ts` |
| `schemas/*` | Zod validation schemas | `zod` only |
| `types/*` | TypeScript type definitions | `schemas/*`, `zod` |

### Hard Rules
1. **Routes never import other routes.** All shared logic lives in `lib/`.
2. **`lib/payroll-engine.ts` is pure.** No DB access, no side effects — testable in isolation.
3. **`lib/supabase.ts` exports exactly one client.** Never create a second `createClient` call anywhere else.
4. **Schemas never import lib.** Zod schemas must be importable in tests without instantiating DB connections.
