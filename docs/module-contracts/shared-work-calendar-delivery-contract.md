# Shared Work Calendar Delivery Contract - Rev 5

**Status:** READY FOR IMPLEMENTATION REVIEW
**Slice:** F-CAL, prerequisite to F-02 Pay-Policy-to-Run `working_days` proration
**Implementation order:** migration -> database functions/RPCs -> authenticated API -> admin UI -> live E2E -> operator browser QA

Rev 5 incorporates the complete Rev 4 design and closes the remaining executable issues:

- Database-reading functions are `STABLE`, never `IMMUTABLE`.
- A partial pay-group override cannot silently fall back to the organization calendar.
- Both weekday arrays and fractional weekday JSON are database-validated.
- Idempotency namespaces and cross-command behavior are consistent.
- Command request/response DTOs and event mappings are frozen before implementation.
- List reads are bounded and cursor-paginated.
- Holiday provenance, jurisdiction, year, and effective-window consistency are enforced.

---

## 1. Objective

Build a shared, versioned work-calendar capability that supplies authoritative working-day evidence to
Payroll while remaining reusable by future HR, attendance, leave, scheduling, and operations modules.

The model has three independently governed concerns:

1. A jurisdiction holiday set with effective-dated, immutable published versions.
2. A work pattern with effective-dated, immutable published versions, referencing a published holiday-set
   version.
3. Effective-dated assignments that resolve a work-calendar version for a pay group, falling back to one
   organization-wide assignment only when no pay-group override intersects the requested period.

Payroll later pins:

```text
work_calendar_version_id
holiday_calendar_version_id
work_calendar_checksum
resolution_path
working-day numerator/denominator
excluded-date evidence
```

No holiday or working-week pattern is hardcoded in application logic.

## 2. Required Scope

- **R1 Holiday sets:** versioned national holiday data with complete provenance.
- **R2 Work calendars:** explicit ISO weekday pattern plus optional fractional workdays.
- **R3 Assignments:** organization default and pay-group override, effective-dated and non-overlapping.
- **R4 Immutability:** published and superseded versions, including holiday child rows, are immutable.
- **R5 Working-day calculation:** fractional count plus independent exclusion evidence.
- **R6 Governance:** authenticated admin commands, atomic event/audit/receipt side effects.
- **R7 Provenance:** statutory/common names, actual/observed dates, source, publication date, type and notes.
- **R8 Read models:** bounded list/get, version history, assignments and period-resolution preview.
- **R9 Seed:** the migration seeds ONLY the national holiday-calendar parent shell (named T&T calendar, no version). No `system_seed` version exists until an admin supplies a verified official dataset; `publish_version` rejects an empty holiday set. No work-pattern seed.
- **R10 Security:** protected data only through authenticated Netlify APIs and service-role-only RPCs.
- **R11 F-02 integration:** immutable calendar pin and proration evidence.
- **R12 Verification:** database/unit/UI/live-E2E gates and operator-performed authenticated browser QA.

Deferred:

- Maker-checker for calendar administration.
- Attendance, leave, roster and operations consumers.
- Location scope until a canonical site/location master exists.
- Non-TT seed datasets.
- Any default or assumed work pattern.

## 3. Migration and Extension Placement

Create the migration with:

```powershell
supabase migration new shared_work_calendar
```

Do not invent the final migration timestamp manually.

The repository already installs `btree_gist` without an explicit schema in migration 170, and existing
payroll exclusion constraints depend on that installation. F-CAL therefore uses:

```sql
create extension if not exists btree_gist;
```

The migration must verify the installed namespace through `pg_extension`/`pg_namespace` and log it in the
operator evidence. It must not attempt a one-off relocation. Moving extensions into a different schema is a
separate repository-wide alignment affecting existing Payroll migrations.

`pgcrypto` is also required for SHA-256 checksums.

## 4. Database Model

Every table:

- Uses UUID primary keys unless explicitly stated otherwise.
- Has `created_at timestamptz not null default now()`.
- Has `updated_at` and the established update trigger when mutable.
- Has RLS enabled.
- Revokes direct table privileges from `anon` and `authenticated`.
- Is read/written by the authenticated backend through service-role access only.
- Uses `text` for all `app_users.id` foreign keys.

### 4.1 Validator Functions

The weekday validator is safe for use in a CHECK because it depends only on its arguments:

```sql
create or replace function public.work_calendar_valid_weekdays(p_days smallint[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_days is not null
     and array_ndims(p_days) = 1
     and cardinality(p_days) between 1 and 7
     and p_days <@ array[1,2,3,4,5,6,7]::smallint[]
     and p_days = (
       select array_agg(distinct d order by d)
       from unnest(p_days) as d
     )
$$;
```

The fractional-day validator is also immutable and database-enforced:

```sql
create or replace function public.work_calendar_valid_fractions(
  p_days smallint[],
  p_fractions jsonb
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_fractions is not null
     and jsonb_typeof(p_fractions) = 'object'
     and not exists (
       select 1
       from jsonb_each(p_fractions) as e(key, value)
       where case
         when e.key !~ '^[1-7]$' then true
         when e.key::smallint <> all(p_days) then true
         when jsonb_typeof(e.value) <> 'number' then true
         else (e.value #>> '{}')::numeric <= 0
           or (e.value #>> '{}')::numeric >= 1
       end
     )
$$;
```

Revoke validator execution from `public`, `anon`, and `authenticated`; grant it only as needed for table
constraints and the service role.

### 4.2 Holiday Tables

`holiday_calendars`

- `id uuid primary key`
- `name text not null`
- `jurisdiction text not null`
- `created_by text references app_users(id)`
- `lock_version integer not null default 1`
- timestamps

`holiday_calendar_versions`

- `id uuid primary key`
- `holiday_calendar_id uuid not null references holiday_calendars(id)`
- `version_no integer not null`
- `status text not null check (status in ('draft','published','superseded'))`
- `effective_from date not null`
- `effective_to date`
- `timezone text not null default 'America/Port_of_Spain'`
- `canonical_checksum text`
- `provenance text not null check (provenance in ('user','system_seed'))`
- `published_by text references app_users(id)`
- `published_at timestamptz`
- `superseded_at timestamptz`
- `lock_version integer not null default 1`
- timestamps
- unique `(holiday_calendar_id, version_no)`
- sane effective-date CHECK
- published and superseded rows require checksum and `published_at`
- user-published rows require `published_by`
- system-seed rows may have `published_by is null`

Only one latest published version:

```sql
create unique index holiday_calendar_one_published_idx
  on public.holiday_calendar_versions(holiday_calendar_id)
  where status = 'published';
```

`holiday_dates`

- `id uuid primary key`
- `holiday_calendar_version_id uuid not null references holiday_calendar_versions(id) on delete cascade`
- `holiday_date date not null`
- `observed_date date`
- `effective_date date generated always as (coalesce(observed_date, holiday_date)) stored`
- `day_fraction numeric(3,2) not null check (day_fraction > 0 and day_fraction <= 1)`
- `year integer not null`
- `jurisdiction text not null`
- `name_statutory text not null`
- `name_common text not null`
- `holiday_type text not null check (holiday_type in ('statutory','proclaimed','movable'))`
- `source_reference text not null`
- `source_published_date date not null`
- `provenance_note text not null`
- `created_at`
- unique `(holiday_calendar_version_id, holiday_date)`
- unique `(holiday_calendar_version_id, effective_date)`

Database/RPC invariants:

- `year = extract(year from holiday_date)`.
- `jurisdiction` equals the parent `holiday_calendars.jurisdiction`; the RPC derives it rather than trusting
  browser input.
- Both `holiday_date` and `effective_date` fit the holiday version's effective window.
- Published/superseded parent content rejects child insert/update/delete.
- Parent-cascade deletion remains available only for reviewed retention/E2E cleanup.

### 4.3 Work Calendar Tables

`work_calendars`

- `id uuid primary key`
- `name text not null`
- `created_by text references app_users(id)`
- `lock_version integer not null default 1`
- timestamps

`work_calendar_versions`

- `id uuid primary key`
- `work_calendar_id uuid not null references work_calendars(id)`
- `version_no integer not null`
- `status text not null check (status in ('draft','published','superseded'))`
- `effective_from date not null`
- `effective_to date`
- `timezone text not null`
- `working_weekdays smallint[] not null`
- `weekday_fractions jsonb not null default '{}'::jsonb`
- `holiday_calendar_version_id uuid not null references holiday_calendar_versions(id) on delete restrict`
- `canonical_checksum text`
- `provenance text not null check (provenance in ('user','system_seed'))`
- `published_by text references app_users(id)`
- `published_at timestamptz`
- `superseded_at timestamptz`
- `lock_version integer not null default 1`
- timestamps
- CHECK `work_calendar_valid_weekdays(working_weekdays)`
- CHECK `work_calendar_valid_fractions(working_weekdays, weekday_fractions)`
- sane effective-date and publication-provenance checks
- unique `(work_calendar_id, version_no)`

Only one latest published version:

```sql
create unique index work_calendar_one_published_idx
  on public.work_calendar_versions(work_calendar_id)
  where status = 'published';
```

The work-calendar checksum manifest is exactly:

```json
{
  "effectiveFrom": "YYYY-MM-DD",
  "effectiveTo": "YYYY-MM-DD|null",
  "timezone": "IANA timezone",
  "workingWeekdays": [1, 2, 3],
  "weekdayFractions": {"6": 0.5},
  "holidayCalendarVersionId": "uuid",
  "holidayCalendarChecksum": "sha256"
}
```

Keys are represented by JSONB canonical text. `workingWeekdays` is already sorted by its CHECK.

The holiday checksum manifest includes version effective dates, timezone, jurisdiction, and holiday rows
ordered by `(effective_date, holiday_date, name_statutory)` without row IDs or timestamps.

### 4.4 Assignments

`work_calendar_assignments`

- `id uuid primary key`
- `scope text not null check (scope in ('pay_group','organization'))`
- `pay_group_id uuid references finance_pay_groups(id) on delete cascade`
- `work_calendar_version_id uuid not null references work_calendar_versions(id) on delete restrict`
- `effective_from date not null`
- `effective_to date`
- `status text not null default 'active' check (status in ('active','cancelled'))`
- `assigned_by text not null references app_users(id)`
- `ended_by text references app_users(id)`
- `end_reason text`
- timestamps
- scope/pay-group consistency CHECKs
- sane effective-date CHECK

Lifecycle:

- `end_assignment` sets `effective_to` and leaves `status='active'`, retaining historical participation.
- `cancel_assignment` sets `status='cancelled'`, voiding the assignment historically.

GiST exclusion constraints cover all active, including bounded/ended, assignment windows:

- One pay-group assignment per pay group per date.
- One organization assignment per date.
- Cancelled assignments are excluded from overlap and resolution.

Assignment creation validates that its entire window is contained within both the referenced work-calendar
version and referenced holiday-calendar version. A non-published version cannot be assigned.

## 5. Immutability and Publish Concurrency

Version triggers:

- Draft content is editable with an expected `lock_version`.
- From `published`, only `status='superseded'`, `superseded_at`, and `updated_at` may change.
- A superseded row rejects all updates.
- Child holiday rows reject insert/update/delete while their parent is published or superseded.

Publish lock order:

1. Parent holiday/work calendar `FOR UPDATE`.
2. Verify `expectedCalendarLockVersion`.
3. Draft version `FOR UPDATE`.
4. Referenced holiday version `FOR SHARE`, when publishing a work calendar.
5. Calculate checksum.
6. Supersede the current published version.
7. Publish the draft.
8. Increment the parent calendar `lock_version`.
9. Write event, HR audit and receipt in the same transaction.

The expected parent lock version plus the partial unique index creates a true concurrent single winner.
Two callers that observed the same parent version cannot both publish successfully; the loser receives
`PR409 stale_lock_version`.

## 6. Resolution

`resolveWorkCalendarVersion(pay_group_id, period_start, period_end)` validates:

- Both dates are present.
- `period_start <= period_end`; otherwise `PR422 calendar.invalid_period`.

Resolution algorithm:

1. Find active pay-group assignments whose windows **intersect** the requested period.
2. If any intersect:
   - exactly one must contain the whole period;
   - otherwise fail `PR422 calendar.split_period`;
   - never fall back to the organization assignment.
3. If no pay-group assignment intersects, repeat the same logic for organization assignments.
4. If no organization assignment intersects, fail `PR422 calendar.unresolved`.
5. The selected work and holiday versions must be published or superseded and cover the whole period.
6. Holiday jurisdiction must equal `finance_pay_groups.statutory_country`.

Return:

```ts
type WorkCalendarResolution = {
  workCalendarId: string;
  workCalendarVersionId: string;
  workCalendarChecksum: string;
  holidayCalendarVersionId: string;
  holidayCalendarChecksum: string;
  resolutionPath: {
    scope: 'pay_group' | 'organization';
    assignmentId: string;
  };
};
```

## 7. Working-Day Function

`public.work_calendar_working_days(version_id, start_date, end_date)`:

- Is `LANGUAGE SQL STABLE SECURITY INVOKER`.
- Uses `SET search_path = pg_catalog, public`.
- Is revoked from `public`, `anon`, and `authenticated`.
- Is executable by `service_role` only.
- Rejects `start_date > end_date` with `PR422 calendar.invalid_period`.
- Reads one immutable published/superseded version and its holiday version.
- Returns inclusive date evidence.

Return:

```ts
type WorkingDaysResult = {
  count: string; // exact numeric serialized as a decimal string
  excluded: Array<{
    date: string;
    reason: 'weekend' | 'partial' | 'holiday';
    lostFraction: string;
    holidayName?: string;
  }>;
};
```

For each date:

```text
pattern = weekday fraction when configured
          else 1 when ISO weekday is a working weekday
          else 0
holiday = holiday day_fraction for effective_date, else 0
worked  = greatest(0, pattern - holiday)
```

Evidence is independent and may contain multiple rows for one date:

- `pattern=0`: weekend, lost 1.
- `0<pattern<1`: partial, lost `1-pattern`.
- `holiday>0`: holiday, lost `least(holiday, pattern)`.

## 8. F-02 Proration Contract

F-02 calculates:

```text
denominator = working days in payroll period
numerator   = working days in clamped employment window
base pay    = round currency(rate * numerator / denominator)
```

- Zero denominator fails `PR422 calendar.zero_working_days`.
- No employment-window intersection produces numerator zero.
- F-02 snapshots IDs, checksums, resolution path, numerator, denominator and both exclusion arrays.
- Later calendar changes cannot alter a locked run.

## 9. Command API and Frozen DTOs

All routes are authenticated POST endpoints using `body.args ?? body`. The backend injects `actorId`; the
browser never chooses an audit actor.

Common request fields:

```ts
type CommandBase = {
  command: string;
  requestKey: string;
  reason: string;
};
```

### 9.1 Holiday-Set Commands

`POST /api/hr/work-calendars/holiday-set/command`

- `create_version`: `{calendarId?, calendar?:{name,jurisdiction}, effectiveFrom,effectiveTo?,timezone,
  requestKey,reason}`. `calendar` is required when `calendarId` is absent.
- `copy_version`: `{sourceVersionId,effectiveFrom,effectiveTo?,requestKey,reason}`.
- `add_holiday`: `{versionId,expectedLockVersion,holiday:{holidayDate,observedDate?,dayFraction,
  nameStatutory,nameCommon,holidayType,sourceReference,sourcePublishedDate,provenanceNote},requestKey,reason}`.
- `update_holiday`: `{versionId,holidayId,expectedLockVersion,holiday:{...},requestKey,reason}`.
- `remove_holiday`: `{versionId,holidayId,expectedLockVersion,requestKey,reason}`.
- `publish_version`: `{versionId,expectedVersionLockVersion,expectedCalendarLockVersion,requestKey,reason}`.

Responses contain `{calendar, version, holiday?}` as applicable, including IDs, statuses and current
`lockVersion`.

### 9.2 Work-Calendar Commands

`POST /api/hr/work-calendars/version/command`

- `create_version`: `{calendarId?,calendar?:{name},effectiveFrom,effectiveTo?,timezone,
  holidayCalendarVersionId,workingWeekdays,weekdayFractions,requestKey,reason}`.
- `copy_version`: `{sourceVersionId,effectiveFrom,effectiveTo?,requestKey,reason}`.
- `set_pattern`: `{versionId,expectedLockVersion,workingWeekdays,weekdayFractions,
  holidayCalendarVersionId,requestKey,reason}`.
- `publish_version`: `{versionId,expectedVersionLockVersion,expectedCalendarLockVersion,requestKey,reason}`.

Responses contain `{calendar, version}` with resolved holiday-set names/checksum.

### 9.3 Assignment Commands

`POST /api/hr/work-calendars/assignment/command`

- `assign`: `{scope,payGroupId?,workCalendarVersionId,effectiveFrom,effectiveTo?,requestKey,reason}`.
- `end_assignment`: `{assignmentId,effectiveTo,requestKey,reason}`.
- `cancel_assignment`: `{assignmentId,requestKey,reason}`.

Response: `{assignment}` with resolved calendar/version/pay-group names.

### 9.4 Bounded Reads

`POST /api/hr/work-calendars/read`

Actions:

- `list_calendars`
- `get_calendar`
- `list_versions`
- `list_holidays`
- `list_assignments`
- `resolve`

Every list accepts `{cursor?:string,limit?:number,search?:string}` with `limit` default 25, maximum 50.
Responses use `{items,nextCursor,total?}`. Cursors are opaque, filter-fingerprinted keyset cursors; malformed
or filter-mismatched cursors return 422. No unbounded select is permitted.

Read DTOs resolve names and never require the UI to display raw UUIDs.

## 10. RPC Security, Idempotency and Side Effects

Every command RPC:

- Is `SECURITY INVOKER`.
- Has `SET search_path = pg_catalog, public`.
- Is revoked from `public`, `anon`, and `authenticated`.
- Is executable by `service_role` only.
- Verifies the actor exists and is active.
- Locks the owning aggregate before mutable children.
- Writes business state, `app_events`, `hr_audit_log`, and command receipt atomically.

Receipt schema:

```sql
create table public.work_calendar_command_receipts (
  actor_id text not null references public.app_users(id),
  command text not null,
  request_key text not null,
  target_id text,
  input_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, command, request_key)
);
```

Canonical input hash includes actor, command, target and JSONB payload. Behavior:

- Same actor/command/key and same hash replays the stored result with no additional side effects.
- Same actor/command/key and different target/payload returns `PR409 command.payload_conflict`.
- Reusing the raw key for a different command is an independent namespace and creates a separate receipt.

Database constraint errors are caught and normalized:

- exclusion violation -> `calendar.assignment_overlap`
- holiday uniqueness violation -> `calendar.holiday_exists`
- validation/check violation -> the corresponding typed 422
- optimistic concurrency -> `stale_lock_version`

### 10.1 Exact Event Mapping

| Command | Event type |
|---|---|
| holiday `create_version` / `copy_version` | `holiday_calendar.version_drafted` |
| holiday `add_holiday` / `update_holiday` / `remove_holiday` | `holiday_calendar.holiday_changed` |
| holiday `publish_version` | `holiday_calendar.version_published` |
| work `create_version` / `copy_version` | `work_calendar.version_drafted` |
| work `set_pattern` | `work_calendar.pattern_changed` |
| work `publish_version` | `work_calendar.version_published` |
| assignment `assign` | `work_calendar.assigned` |
| assignment `end_assignment` | `work_calendar.assignment_ended` |
| assignment `cancel_assignment` | `work_calendar.assignment_cancelled` |

Every command writes one `hr_audit_log` row with:

```text
submodule_key = hr.work_calendar
record_id     = affected aggregate/version/assignment ID
actor_id      = authenticated actor
action        = command
previous_state/new_state/reason populated
```

## 11. Failure Contract

| Code | HTTP | Condition |
|---|---:|---|
| `calendar.unresolved` | 422 | No assignment intersects the period. |
| `calendar.split_period` | 422 | Higher-priority assignments intersect but no single assignment contains the whole period. |
| `calendar.invalid_period` | 422 | Start is after end. |
| `calendar.version_immutable` | 409 | Published/superseded parent or child content mutation. |
| `calendar.holiday_exists` | 409 | Duplicate actual/effective holiday date. |
| `calendar.assignment_overlap` | 409 | Overlapping participating assignment. |
| `calendar.holiday_set_unpublished` | 422 | Work version references an unpublished holiday version. |
| `calendar.version_unpublished` | 422 | Assignment references a non-published work version. |
| `calendar.version_period_uncovered` | 422 | Resolved versions do not cover the entire requested period. |
| `calendar.assignment_window_uncovered` | 422 | Assignment exceeds either referenced version window. |
| `calendar.jurisdiction_mismatch` | 422 | Holiday jurisdiction differs from pay-group statutory country. |
| `calendar.zero_working_days` | 422 | F-02 denominator is zero. |
| `calendar.invalid_pattern` | 422 | Weekdays or fractional-day map is invalid. |
| `command.payload_conflict` | 409 | Same idempotency namespace with different input. |
| `calendar.holiday_set_empty` | 422 | Publishing a holiday version that has zero holiday rows. |
| `calendar.jurisdiction_frozen` | 409 | Changing a calendar's jurisdiction after any version is published/superseded. |
| `calendar.assignment_not_active` | 409 | Ending/cancelling a cancelled or already-ended assignment. |
| `calendar.invalid_holiday` | 422 | Holiday day-fraction or type constraint violated. |
| `stale_lock_version` | 409 | Version or aggregate changed after the client read it. |

Rejected commands write no business row, event, audit or receipt.

## 12. Seed Policy

- The migration seeds ONLY the national holiday-calendar **parent shell** — a named
  `Trinidad & Tobago National` calendar (jurisdiction `TT`) with **no version**. It is idempotent.
- It does **not** create an empty `system_seed` version: an empty holiday version could be published with a
  checksum over `[]`, and no holiday provenance is authoritatively known at migration time. **No system-seed
  version exists until a verified official dataset is supplied.**
- `publish_version` **rejects** a version with zero holiday rows (`calendar.holiday_set_empty` → 422), so an
  incomplete holiday set can never become payroll-eligible.
- An admin creates the first version and populates it with the **verified official** 2026 dataset (statutory
  + movable holidays) carrying real per-row provenance (source reference + publication date) before publishing.
- Do not speculate holiday dates or store placeholder provenance. (The Government Printer 2026 Gazette index
  alone does not establish a complete holiday manifest + publication date, so provenance must not be inferred
  from it.)
- No work calendar or weekday pattern is seeded.
- Future years are added as reviewed versioned datasets before payroll periods require them.

## 13. Permissions and UI

New permissions:

- `hr.work_calendar.view`
- `hr.work_calendar.manage`

Update backend/frontend catalogues, metadata, role seeds and permission drift tests together.

Admin UI must provide:

- Holiday-set directory and version editor.
- Provenance-complete holiday rows.
- Work-calendar pattern editor with no preselected weekdays.
- Published holiday-version picker.
- Organization/pay-group assignment editor.
- Resolve-preview tool.
- Loading, skeleton, empty, error, disabled and conflict states.
- Keyboard operation, labels, focus management and inline typed errors.

## 14. Acceptance Gates

1. Migration created through Supabase CLI and reviewed.
2. RLS/table/function grants verified.
3. Backend and frontend typechecks clean.
4. Focused unit and UI tests green.
5. Live `workCalendar` E2E green twice with clean teardown.
6. Coverage gate green.
7. Operator performs authenticated browser QA:
   - editor render
   - draft -> publish
   - assignment
   - resolve preview
   - loading/error/conflict states
8. F-02 consumes the calendar in its separate integration gate.
9. Combined payroll regression runs once at the final release gate.

No implementation is considered complete before gate 7 is recorded.
