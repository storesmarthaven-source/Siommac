# DATA_DICTIONARY.md — Database Schema Reference

> **Machine-executable reference.**  
> All SQL in this document is production-ready Postgres. Run it via `supabase db query` or the MCP `execute_sql` tool.  
> All tables live in the `public` schema unless noted. RLS is enabled on every table.

---

## Table Index

1. [app_users](#1-app_users)
2. [departments](#2-departments)
3. [attendance](#3-attendance)
4. [leave_requests](#4-leave_requests)
5. [project_sites](#5-project_sites)
6. [project_site_employees](#6-project_site_employees)
7. [payroll_approvals](#7-payroll_approvals)
8. [settings](#8-settings)
9. [activity_logs](#9-activity_logs)
10. [messages](#10-messages)
11. [message_replies](#11-message_replies)
12. [message_reads](#12-message_reads)
13. [support_tickets](#13-support_tickets)
14. [ticket_replies](#14-ticket_replies)
15. [Indexes](#15-indexes)
16. [RLS Policies](#16-rls-policies)
17. [Storage Buckets](#17-storage-buckets)

---

## 1. `app_users`

Core user/employee table. Stores authentication, profile, and payroll configuration per employee.

```sql
CREATE TABLE public.app_users (
  -- Identity
  id                          TEXT PRIMARY KEY,          -- e.g. "USR-001", or UUID
  username                    TEXT UNIQUE NOT NULL,
  password_hash               TEXT NOT NULL,             -- bcrypt cost 12
  full_name                   TEXT NOT NULL,
  employee_number             TEXT UNIQUE,               -- e.g. "EMP-0001", nullable until assigned
  role                        TEXT NOT NULL DEFAULT 'employee'
                              CHECK (role IN ('admin', 'manager', 'employee')),
  status                      TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'inactive')),

  -- Contact
  email                       TEXT,
  phone                       TEXT,

  -- Organisation
  department_id               TEXT REFERENCES public.departments(id) ON DELETE SET NULL,
  position                    TEXT,

  -- Profile photo
  profile_image               TEXT,                      -- storage path or '__removed__'
  signed_url                  TEXT,                      -- cached 24h signed URL
  signed_url_expires_at       TIMESTAMPTZ,               -- expiry of cached URL

  -- UI preferences
  color_scheme                TEXT DEFAULT 'navy',
  layout_mode                 TEXT DEFAULT 'sidebar',

  -- Payroll configuration
  pay_cycle                   TEXT NOT NULL DEFAULT 'monthly'
                              CHECK (pay_cycle IN ('daily', 'weekly', 'fortnightly', 'monthly')),
  pay_basis                   TEXT NOT NULL DEFAULT 'salary'
                              CHECK (pay_basis IN ('hourly', 'salary')),
  hourly_rate                 NUMERIC(10,2) DEFAULT 0,
  monthly_salary              NUMERIC(10,2) DEFAULT 0,
  standard_hours_per_day      NUMERIC(4,2) DEFAULT 8,
  nis_applicable              BOOLEAN NOT NULL DEFAULT TRUE,
  health_surcharge_applicable BOOLEAN NOT NULL DEFAULT TRUE,
  tax_resident                BOOLEAN NOT NULL DEFAULT TRUE,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | TEXT | NO | Primary key. Format: `USR-NNN` or UUID |
| `username` | TEXT | NO | Login name. Case-insensitive login (ILIKE query) |
| `password_hash` | TEXT | NO | bcrypt hash, cost factor 12 |
| `full_name` | TEXT | NO | Display name |
| `employee_number` | TEXT | YES | Auto-generated as `EMP-NNNN` if not provided |
| `role` | TEXT | NO | `admin` / `manager` / `employee` |
| `status` | TEXT | NO | `active` / `inactive` |
| `department_id` | TEXT | YES | FK → departments.id |
| `profile_image` | TEXT | YES | Storage path or `__removed__` sentinel |
| `signed_url` | TEXT | YES | Cached presigned URL (24h TTL) |
| `signed_url_expires_at` | TIMESTAMPTZ | YES | Expiry of `signed_url` |
| `pay_cycle` | TEXT | NO | Payroll cycle frequency |
| `pay_basis` | TEXT | NO | `hourly` or `salary` |
| `hourly_rate` | NUMERIC(10,2) | NO | Used when `pay_basis = 'hourly'` |
| `monthly_salary` | NUMERIC(10,2) | NO | Used when `pay_basis = 'salary'` |
| `standard_hours_per_day` | NUMERIC(4,2) | NO | For attendance tracking |
| `nis_applicable` | BOOLEAN | NO | Include NIS deduction in payslip |
| `health_surcharge_applicable` | BOOLEAN | NO | Include Health Surcharge |
| `tax_resident` | BOOLEAN | NO | TRUE = PAYE with allowance, FALSE = flat 25% |

---

## 2. `departments`

```sql
CREATE TABLE public.departments (
  id          TEXT PRIMARY KEY,          -- e.g. "DEPT-001"
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  manager_id  TEXT REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | TEXT | NO | Primary key. Format: `DEPT-NNN` |
| `name` | TEXT | NO | Department name (unique) |
| `manager_id` | TEXT | YES | FK → app_users.id |

---

## 3. `attendance`

One row per employee per work day. Check-in and check-out written into the same row.

```sql
CREATE TABLE public.attendance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  username              TEXT NOT NULL,
  work_date             DATE NOT NULL,

  -- Check-in
  check_in_time         TIMESTAMPTZ,
  check_in_lat          NUMERIC(10,7),
  check_in_lng          NUMERIC(10,7),
  check_in_accuracy     NUMERIC(8,2),
  check_in_photo_url    TEXT DEFAULT '',       -- storage path (signed at read time)
  check_in_site_id      TEXT REFERENCES public.project_sites(id) ON DELETE SET NULL,
  check_in_distance_m   INTEGER,               -- metres from site centre at check-in

  -- Check-out
  check_out_time        TIMESTAMPTZ,
  check_out_lat         NUMERIC(10,7),
  check_out_lng         NUMERIC(10,7),
  check_out_accuracy    NUMERIC(8,2),
  check_out_photo_url   TEXT DEFAULT '',
  check_out_site_id     TEXT REFERENCES public.project_sites(id) ON DELETE SET NULL,
  check_out_distance_m  INTEGER,

  -- Summary
  total_hours           NUMERIC(6,2),
  status                TEXT DEFAULT 'present'
                        CHECK (status IN ('present', 'late', 'absent', 'leave')),
  notes                 TEXT DEFAULT '',

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_attendance_user_date UNIQUE (user_id, work_date)
);
```

| Column | Type | Nullable | Description |
|---|---|---|---|
| `user_id` | TEXT | NO | FK → app_users.id (CASCADE delete) |
| `work_date` | DATE | NO | Local date in `APP_TZ` timezone |
| `check_in_time` | TIMESTAMPTZ | YES | UTC timestamp of check-in |
| `check_in_photo_url` | TEXT | NO | Storage path; signed URL generated at read time |
| `check_in_site_id` | TEXT | YES | FK → project_sites.id |
| `check_in_distance_m` | INTEGER | YES | Distance from site centre in metres |
| `total_hours` | NUMERIC(6,2) | YES | Computed: (check_out - check_in) in hours |
| `status` | TEXT | NO | `present` / `late` / `absent` / `leave` |
| `notes` | TEXT | NO | Auto-checkout message or manual notes |

**Unique constraint:** `(user_id, work_date)` — enforces one record per employee per day. Used with `upsert onConflict:'user_id,work_date'` for check-in.

---

## 4. `leave_requests`

```sql
CREATE TABLE public.leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  department_id TEXT REFERENCES public.departments(id) ON DELETE SET NULL,

  type          TEXT NOT NULL
                CHECK (type IN ('sick', 'casual', 'annual', 'medical')),
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  days          INTEGER NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),

  reviewed_by   TEXT REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  review_notes  TEXT DEFAULT '',

  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Description |
|---|---|---|
| `type` | TEXT | `sick` / `casual` / `annual` / `medical` |
| `from_date` / `to_date` | DATE | Inclusive date range |
| `days` | INTEGER | `ceil((to_date - from_date) / 86400000) + 1` |
| `status` | TEXT | `pending` → `approved` or `rejected` |
| `reviewed_by` | TEXT | FK → admin/manager who decided |
| `department_id` | TEXT | Denormalised for manager-scoped queries |

---

## 5. `project_sites`

```sql
CREATE TABLE public.project_sites (
  id          TEXT PRIMARY KEY,            -- e.g. "SITE-001"
  name        TEXT NOT NULL,
  address     TEXT DEFAULT '',
  latitude    NUMERIC(10,7) NOT NULL,
  longitude   NUMERIC(10,7) NOT NULL,
  radius      INTEGER NOT NULL DEFAULT 200, -- geofence radius in metres
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Description |
|---|---|---|
| `latitude` / `longitude` | NUMERIC(10,7) | WGS84 decimal degrees |
| `radius` | INTEGER | Geofence radius in metres. Minimum enforced: 50m. GPS accuracy added at check-in. |
| `status` | TEXT | `active` / `inactive` — inactive sites show 0 checked-in |

---

## 6. `project_site_employees`

Junction table — which employees are permanently assigned to which sites.

```sql
CREATE TABLE public.project_site_employees (
  site_id  TEXT NOT NULL REFERENCES public.project_sites(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES public.app_users(id)    ON DELETE CASCADE,
  PRIMARY KEY (site_id, user_id)
);
```

**Note:** This table records permanent assignment, not live check-in state. Live check-in state is derived from `attendance.check_in_site_id` for today.

---

## 7. `payroll_approvals`

Persisted payslip records written when admin approves a payroll run.

```sql
CREATE TABLE public.payroll_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  username          TEXT NOT NULL,

  -- Period
  date_from         DATE NOT NULL,
  date_to           DATE NOT NULL,
  pay_cycle         TEXT NOT NULL
                    CHECK (pay_cycle IN ('daily', 'weekly', 'fortnightly', 'monthly')),

  -- Snapshot of employee config at approval time
  pay_basis         TEXT NOT NULL DEFAULT 'salary',
  department        TEXT DEFAULT '',
  position          TEXT DEFAULT '',
  hourly_rate       NUMERIC(10,2) DEFAULT 0,
  monthly_salary    NUMERIC(10,2) DEFAULT 0,

  -- Work summary
  hours_worked      NUMERIC(8,2) DEFAULT 0,
  days_worked       INTEGER DEFAULT 0,

  -- Payslip figures (TTD)
  gross_pay         NUMERIC(10,2) NOT NULL DEFAULT 0,
  nis               NUMERIC(10,2) NOT NULL DEFAULT 0,
  health_surcharge  NUMERIC(10,2) NOT NULL DEFAULT 0,
  paye              NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay           NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Approval metadata
  approved_by       TEXT NOT NULL,
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('approved', 'voided')),

  CONSTRAINT uq_payroll_user_period UNIQUE (user_id, date_from, date_to, pay_cycle)
);
```

**Unique constraint:** `(user_id, date_from, date_to, pay_cycle)` — `approvePayroll` uses upsert on this constraint, making re-approval idempotent.

---

## 8. `settings`

Key-value store for all system configuration.

```sql
CREATE TABLE public.settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Known Keys

| Key | Format | Default | Description |
|---|---|---|---|
| `companyName` | TEXT | `'My Company'` | Displayed in UI and payslips |
| `companyLogoUrl` | URL | `''` | Public URL from branding bucket |
| `currency` | TEXT | `'TT'` | Always TTD; corrected on read |
| `lateThresholdHHMM` | `'HH:MM'` | `'09:15'` | Check-in after this time = `late` |
| `latePenaltyPerDay` | NUMERIC string | `'0'` | Deducted per late day in old payroll |
| `leaveFinePerDay` | NUMERIC string | `'0'` | Deducted per absent day in old payroll |
| `workHours` | JSON string | `'{"start":"08:00","end":"17:00"}'` | Work hours window; parsed as JSON |
| `payroll_personal_allowance_annual` | NUMERIC string | `'90000'` | Override T&T payroll constant |
| `payroll_paye_rate_low` | NUMERIC string | `'0.25'` | Override T&T payroll constant |
| `payroll_paye_rate_high` | NUMERIC string | `'0.30'` | Override T&T payroll constant |
| `payroll_paye_high_threshold_annual` | NUMERIC string | `'1000000'` | Override T&T payroll constant |
| `payroll_nis_rate` | NUMERIC string | `'0.06'` | Override T&T payroll constant |
| `payroll_nis_monthly_cap` | NUMERIC string | `'13600'` | Override T&T payroll constant |
| `payroll_hs_high_daily` | NUMERIC string | `'1.65'` | Override |
| `payroll_hs_high_weekly` | NUMERIC string | `'8.25'` | Override |
| `payroll_hs_high_fortnightly` | NUMERIC string | `'16.50'` | Override |
| `payroll_hs_high_monthly` | NUMERIC string | `'33.00'` | Override |
| `payroll_hs_low_daily` | NUMERIC string | `'0.30'` | Override |
| `payroll_hs_low_weekly` | NUMERIC string | `'1.50'` | Override |
| `payroll_hs_low_fortnightly` | NUMERIC string | `'3.00'` | Override |
| `payroll_hs_low_monthly` | NUMERIC string | `'6.00'` | Override |
| `payroll_hs_threshold_weekly` | NUMERIC string | `'469.99'` | Override |

---

## 9. `activity_logs`

Append-only audit trail. Never updated or deleted.

```sql
CREATE TABLE public.activity_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL DEFAULT '',      -- 'SYSTEM' for scheduled function
  username   TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Known Action Values

| action | entity | When |
|---|---|---|
| `login` | `user` | Successful login |
| `logout` | `user` | Logout |
| `checkin` | `attendance` | Check-in recorded |
| `checkout` | `attendance` | Check-out recorded |
| `auto_checkout` | `attendance` | Scheduled auto-checkout |
| `create` | `user` / `department` / `leave` / `site` | Resource created |
| `update` | `user` / `department` / `setting` / `site` / `hourlyRate` | Resource updated |
| `delete` | `user` / `department` / `leave` / `site` | Resource deleted |
| `approved` | `leave` | Leave approved |
| `rejected` | `leave` | Leave rejected |
| `bulkImport` | `hourlyRates` | Bulk rate import |

---

## 10. `messages`

Direct message threads between employees and admin/manager.

```sql
CREATE TABLE public.messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id      TEXT NOT NULL,
  from_username     TEXT NOT NULL,
  from_name         TEXT NOT NULL,
  to_user_id        TEXT NOT NULL,
  to_username       TEXT NOT NULL,
  to_name           TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  read_by_recipient BOOLEAN NOT NULL DEFAULT FALSE,  -- legacy; replaced by message_reads
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 11. `message_replies`

```sql
CREATE TABLE public.message_replies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  from_user_id  TEXT NOT NULL,
  from_username TEXT NOT NULL,
  from_name     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 12. `message_reads`

Per-user read tracking for unread badge counts.

```sql
CREATE TABLE public.message_reads (
  message_id   UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
```

---

## 13. `support_tickets`

```sql
CREATE TABLE public.support_tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id        TEXT NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  from_username       TEXT NOT NULL,
  from_name           TEXT NOT NULL,
  ticket_number       TEXT UNIQUE NOT NULL,   -- e.g. "TKT-0042"
  category            TEXT NOT NULL DEFAULT 'general',
  subject             TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'deleted')),
  cleared_by_admin    BOOLEAN NOT NULL DEFAULT FALSE,   -- soft-hide for admin view
  cleared_by_employee BOOLEAN NOT NULL DEFAULT FALSE,   -- soft-hide for employee view
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Status | Description |
|---|---|
| `open` | New, awaiting admin response |
| `in_progress` | Admin has replied at least once |
| `resolved` | Admin marked resolved; employee can open new ticket |
| `closed` | Locked; no further replies |
| `deleted` | Soft-deleted by employee before resolution |

---

## 14. `ticket_replies`

```sql
CREATE TABLE public.ticket_replies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  from_user_id  TEXT NOT NULL,
  from_username TEXT NOT NULL,             -- '__system__' for auto-generated system notes
  from_name     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 15. Indexes

```sql
-- attendance: most queries filter by work_date and user_id
CREATE INDEX idx_attendance_work_date   ON public.attendance(work_date);
CREATE INDEX idx_attendance_user_id     ON public.attendance(user_id);
CREATE INDEX idx_attendance_username    ON public.attendance(username);

-- leave_requests: filter by status, department, date ranges
CREATE INDEX idx_leave_status           ON public.leave_requests(status);
CREATE INDEX idx_leave_department       ON public.leave_requests(department_id);
CREATE INDEX idx_leave_user             ON public.leave_requests(user_id);
CREATE INDEX idx_leave_dates            ON public.leave_requests(from_date, to_date);

-- payroll_approvals: employee view of own payslips
CREATE INDEX idx_payroll_user_status    ON public.payroll_approvals(user_id, status);
CREATE INDEX idx_payroll_dates          ON public.payroll_approvals(date_from, date_to);

-- activity_logs: audit queries by entity and user
CREATE INDEX idx_logs_user_id           ON public.activity_logs(user_id);
CREATE INDEX idx_logs_entity            ON public.activity_logs(entity, entity_id);
CREATE INDEX idx_logs_created_at        ON public.activity_logs(created_at DESC);

-- messages: thread lookups by participant
CREATE INDEX idx_messages_from          ON public.messages(from_user_id);
CREATE INDEX idx_messages_to            ON public.messages(to_user_id);
CREATE INDEX idx_message_replies_thread ON public.message_replies(message_id);

-- tickets: admin sees all open; employee sees own
CREATE INDEX idx_tickets_status         ON public.support_tickets(status);
CREATE INDEX idx_tickets_from_user      ON public.support_tickets(from_user_id);
CREATE INDEX idx_ticket_replies_ticket  ON public.ticket_replies(ticket_id);

-- project_site_employees: site assignment lookups
CREATE INDEX idx_pse_user_id            ON public.project_site_employees(user_id);

-- app_users: employee number lookups, dept queries
CREATE INDEX idx_users_department       ON public.app_users(department_id);
CREATE INDEX idx_users_status_role      ON public.app_users(status, role);
```

---

## 16. RLS Policies

> All tables have RLS enabled. The service-role key used by the Lambda bypasses RLS entirely — these policies protect direct Supabase client access (e.g., if the anon key were ever exposed).

```sql
-- Enable RLS on all tables
ALTER TABLE public.app_users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_sites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_site_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_approvals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_replies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_replies         ENABLE ROW LEVEL SECURITY;

-- Deny ALL by default (no policy = no access for anon/authenticated roles)
-- The service_role key used by Lambda bypasses RLS — these are defense-in-depth
-- policies for the Data API (if ever exposed).

-- Example: app_users — authenticated role can read their own row only
CREATE POLICY "users_read_own"
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = id);

-- attendance — users can read/write own attendance
CREATE POLICY "attendance_own"
  ON public.attendance
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text);

-- leave_requests — users can read/write own
CREATE POLICY "leave_own"
  ON public.leave_requests
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text);

-- settings — readable by authenticated, writable by service_role only
CREATE POLICY "settings_read"
  ON public.settings
  FOR SELECT
  TO authenticated
  USING (true);

-- payroll_approvals — employees read own approved payslips
CREATE POLICY "payroll_read_own"
  ON public.payroll_approvals
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text AND status = 'approved');
```

**Important:** These policies are defense-in-depth only. The application uses the `service_role` key which bypasses RLS. Authorization is enforced in the Lambda via `requireRole()` and `requireUser()` before any DB operation.

---

## 17. Storage Buckets

```sql
-- Run via Supabase Dashboard or supabase storage commands

-- profile-photos: Private (no public access)
-- policy: service_role only (Lambda uploads, generates signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  FALSE,
  6291456,   -- 6 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
);

-- attendance-photos: Private
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-photos',
  'attendance-photos',
  FALSE,
  6291456,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
);

-- branding: Public (company logo — stable public URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  TRUE,
  6291456,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
);
```

### Signed URL TTLs
| Bucket | TTL | Cache strategy |
|---|---|---|
| `profile-photos` | 24 hours | DB-persisted in `app_users.signed_url` (Service Worker cache stable) |
| `attendance-photos` | 24 hours | In-memory Map per Lambda cold start (22.5h effective TTL) |
| `branding` | N/A (public URL) | Permanent CDN URL, no signing needed |
