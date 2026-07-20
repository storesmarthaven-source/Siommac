# Shared Work Calendar - E2E Traceability Matrix - Rev 5

**Suite:** `scripts/e2e/suites/workCalendar.mjs`
**Server:** authenticated Netlify stack on `:8888`
**Contract:** `shared-work-calendar-delivery-contract.md` (Rev 5)

The suite uses real HTTP routes and service-role verification. It asserts exact response fields, database
state, `app_events`, `hr_audit_log`, command receipts, permission failures and FK-safe cleanup. All
synthetic rows are tagged with `h.TAG`.

F-02 payroll consumption remains in the F-02 suite; F-CAL proves the calendar capability itself.

## 1. Live E2E Matrix

| ID | Contract | Required assertion |
|---|---|---|
| E2E-CAL-001 | Provisioning | Create active admin with `hr.work_calendar.manage`, viewer with `view`, denied employee and TT pay group. |
| E2E-CAL-002 | Holiday draft | `create_version` creates parent/version, returns exact DTO, one drafted event, audit and receipt. |
| E2E-CAL-003 | Holiday mutation | Add/update/remove a holiday with required provenance; exact row/event/audit/receipt after each command. |
| E2E-CAL-004 | Provenance validation | Missing statutory/common name, source reference/date or note is rejected with zero side effects. |
| E2E-CAL-005 | Derived consistency | Input jurisdiction is ignored/derived; mismatched jurisdiction, year or out-of-window actual/effective date is rejected. |
| E2E-CAL-006 | Holiday publish | Publish sets checksum/publisher/time, bumps parent lock, emits exact side effects and produces one published version. |
| E2E-CAL-007 | Holiday child immutability | Direct and routed insert/update/delete beneath published/superseded parents return `calendar.version_immutable`. |
| E2E-CAL-008 | Holiday correction | Copy to a new draft, change content, publish; prior version becomes superseded with content/checksum unchanged. |
| E2E-CAL-009 | Duplicate dates | Duplicate actual date and duplicate effective date normalize to `calendar.holiday_exists`; no side effects. |
| E2E-CAL-010 | Work draft | Create work-calendar version with explicit weekdays/fractions and published holiday version; exact DTO and drafted side effects. |
| E2E-CAL-011 | Pattern DB validation | Empty, duplicate, unsorted, out-of-range weekdays and invalid JSON keys/types/fractions fail through RPC and direct DB constraints. |
| E2E-CAL-012 | Work publish | Checksum covers exact frozen manifest and holiday checksum; re-derivation is byte-identical. |
| E2E-CAL-013 | Unpublished holiday reference | Publishing a work version linked to a draft holiday version returns `calendar.holiday_set_unpublished`. |
| E2E-CAL-014 | Work immutability | Published/superseded work content rejects update; controlled supersede transition alone succeeds. |
| E2E-CAL-015 | Pay-group assignment overlap | A second active assignment overlapping an open or bounded/ended assignment returns `calendar.assignment_overlap`. |
| E2E-CAL-016 | Organization assignment overlap | A second organization default over an overlapping period returns `calendar.assignment_overlap`. |
| E2E-CAL-017 | End retains history | End A by bounding its effective date; overlapping historical B is rejected; historical resolution returns A. |
| E2E-CAL-018 | Cancel voids history | Cancel A; an overlapping replacement can be created; cancelled A never resolves. |
| E2E-CAL-019 | Assignment publication/window | Non-published work version and assignment beyond either version window are rejected. |
| E2E-CAL-020 | Pay-group resolution | One pay-group assignment containing the whole period resolves with pay-group path and exact checksums. |
| E2E-CAL-021 | Organization fallback | With no intersecting pay-group assignment, organization assignment containing the whole period resolves. |
| E2E-CAL-022 | Split-period fail closed | A pay-group assignment intersects only part of the requested period while organization covers all; resolver returns `calendar.split_period`, never organization fallback. |
| E2E-CAL-023 | Adjacent override fail closed | Two adjacent pay-group assignments jointly span a payroll period but neither contains it; resolver returns `calendar.split_period`. |
| E2E-CAL-024 | Unresolved | No assignment intersects the period -> `calendar.unresolved`. |
| E2E-CAL-025 | Version coverage | Assignment covers the period but referenced work/holiday version does not -> `calendar.version_period_uncovered`. |
| E2E-CAL-026 | Jurisdiction | TT pay group referencing a non-TT holiday set -> `calendar.jurisdiction_mismatch`. |
| E2E-CAL-027 | Invalid period | Resolve/read and working-days calls with start after end -> `calendar.invalid_period`. |
| E2E-CAL-028 | Working-day count | Inclusive TT period with Sundays and a holiday returns exact decimal count and named evidence. |
| E2E-CAL-029 | Independent evidence | Partial weekday plus partial holiday on one date returns both evidence rows and correct clamped worked amount. |
| E2E-CAL-030 | Observed date/TZ | Observed date, not actual date, is excluded; inclusive boundaries and Port of Spain timezone are respected. |
| E2E-CAL-031 | Zero denominator | Fully non-working range returns count zero; F-02 helper boundary returns `calendar.zero_working_days`. |
| E2E-CAL-032 | Idempotent replay | Same actor/command/key/input replays original result with no duplicate row/event/audit/receipt. |
| E2E-CAL-033 | Same-command conflict | Same actor/command/key with different target or payload -> `command.payload_conflict`; nothing applies. |
| E2E-CAL-034 | Cross-command namespace | Same raw request key used for a different command creates an independent receipt and correct result; never replays the other command. |
| E2E-CAL-035 | Optimistic version lock | Stale draft `lockVersion` returns `stale_lock_version`; no state/side effects. |
| E2E-CAL-036 | Concurrent publish | Two publishes using the same parent lock version -> exactly one success; loser gets `stale_lock_version`; one published version and no partial side effects. |
| E2E-CAL-037 | Copy isolation | `copy_version` clones content into a new draft; edits do not alter the source. |
| E2E-CAL-038 | RPC security | `prosecdef=false`, fixed search path, expected volatility, anon/authenticated execution denied, service role allowed. |
| E2E-CAL-039 | Table security | RLS enabled; anon/authenticated direct reads/writes denied on every F-CAL table. |
| E2E-CAL-040 | Seed shell | The seed creates ONLY the named `Trinidad & Tobago National` holiday-calendar parent (jurisdiction `TT`) with **no version**; assert **no `system_seed` version exists** until a verified dataset is loaded; no work pattern seeded. |
| E2E-CAL-040b | Empty publish rejected | `publish_version` on a holiday version with **zero holiday rows** → `calendar.holiday_set_empty` (422); version stays `draft`, `canonical_checksum` null; **no event / audit / receipt / checksum** written. |
| E2E-CAL-041 | Bounded reads | Every list obeys max 50, deterministic keyset order, next cursor and exact DTO with resolved names. |
| E2E-CAL-042 | Cursor validation | Malformed cursor and cursor reused with different filters return 422. |
| E2E-CAL-043 | Permission negatives | Viewer can read but not mutate; employee can do neither; exact 403 responses. |
| E2E-CAL-044 | Rejected-operation atomicity | Force every typed failure and assert zero business changes, events, audits and receipts. |
| E2E-CAL-045 | Cleanup | Delete aggregates in FK-safe order and prove zero tagged rows/users remain. |

## 2. Command Side-Effect Matrix

Every successful non-replay command must produce exactly one event, one HR audit row and one receipt.

| Command | Event |
|---|---|
| holiday `create_version` | `holiday_calendar.version_drafted` |
| holiday `copy_version` | `holiday_calendar.version_drafted` |
| holiday `add_holiday` | `holiday_calendar.holiday_changed` |
| holiday `update_holiday` | `holiday_calendar.holiday_changed` |
| holiday `remove_holiday` | `holiday_calendar.holiday_changed` |
| holiday `publish_version` | `holiday_calendar.version_published` |
| work `create_version` | `work_calendar.version_drafted` |
| work `copy_version` | `work_calendar.version_drafted` |
| work `set_pattern` | `work_calendar.pattern_changed` |
| work `publish_version` | `work_calendar.version_published` |
| assignment `assign` | `work_calendar.assigned` |
| assignment `end_assignment` | `work_calendar.assignment_ended` |
| assignment `cancel_assignment` | `work_calendar.assignment_cancelled` |

For each row:

- `app_events.source_entity_id` references the affected record.
- `hr_audit_log.submodule_key = 'hr.work_calendar'`.
- `actor_id` is the authenticated actor, never browser-supplied.
- `previous_state`, `new_state`, `reason` and command action are correct.
- Receipt contains the canonical input hash and exact stored result.

## 3. Database and Unit Tests

| ID | Required proof |
|---|---|
| U-CAL-001 | `work_calendar_valid_weekdays`: null, empty, duplicate, unsorted, multidimensional and out-of-range arrays rejected. |
| U-CAL-002 | `work_calendar_valid_fractions`: non-object, invalid key, non-number, zero, one, negative and non-member weekday rejected. |
| U-CAL-003 | Working-days arithmetic: inclusive boundaries, ISO weekday, partial pattern, full/partial holiday and `greatest(0, pattern-holiday)`. |
| U-CAL-004 | Independent evidence preserves multiple reasons for one date. |
| U-CAL-005 | Resolver precedence: intersecting incomplete pay-group override fails closed instead of organization fallback. |
| U-CAL-006 | Historical resolution: bounded active assignments remain resolvable; cancelled rows do not participate. |
| U-CAL-007 | Version and child immutability triggers permit only the controlled published-to-superseded transition. |
| U-CAL-008 | Checksum manifests are deterministic; content changes alter checksum; IDs/timestamps do not. |
| U-CAL-009 | Parent-lock concurrency produces one publish winner. |
| U-CAL-010 | Cursor encode/decode, filter fingerprint and deterministic keyset ordering. |
| U-CAL-011 | Function catalogue: weekday/fraction validators immutable; working-days stable; fixed search paths. |

## 4. UI Tests

| ID | Required proof |
|---|---|
| UT-CAL-U1 | Directory handles loading, skeleton, empty, error and populated states. |
| UT-CAL-U2 | Holiday editor requires complete provenance and disables publish until valid. |
| UT-CAL-U3 | Pattern editor starts with no selected weekdays and validates fractions. |
| UT-CAL-U4 | Published holiday-set picker displays names/version/effective range, not raw IDs. |
| UT-CAL-U5 | Assignment editor supports organization/pay-group scope and displays overlap/window errors inline. |
| UT-CAL-U6 | Resolve preview displays path, names, checksums and working-day evidence. |
| UT-CAL-U7 | Permission states hide/disable commands while preserving authorized read-only access. |
| UT-CAL-U8 | Keyboard, focus, labels and dialog close/restore behavior meet accessibility expectations. |

## 5. Operator Browser QA

Authenticated browser QA is a mandatory final gate:

1. Open Work Calendar as an authorized admin.
2. Confirm the page reveals atomically behind its skeleton.
3. Create/edit/publish a holiday version.
4. Create/edit/publish a work-calendar pattern.
5. Assign it to a pay group.
6. Resolve a whole payroll period and inspect names/evidence.
7. Confirm typed overlap, immutable and split-period errors.
8. Repeat at supported desktop widths and a mobile-width layout.

Record operator, date, environment, browser and result in release evidence. Vitest does not substitute for
this gate.

## 6. Final Gate

1. Backend and frontend typechecks.
2. Focused database/unit/UI tests.
3. `npm run test:e2e -- workCalendar`.
4. Repeat the focused E2E once to prove cleanup/isolation.
5. Coverage/index gates.
6. Operator browser QA.
7. F-02 calendar-consumption tests.
8. One combined payroll regression at release time.

Rev 5 replaces Rev 4. Implement strictly from these two documents. Do not reinterpret deferred behavior or weaken any acceptance gate.
