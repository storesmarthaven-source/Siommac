# SIOMAC E2E test harness

Live, end-to-end integration tests that hit the **running dev server over HTTP** —
the only layer that exercises the full stack (frontend request shape → Hono route →
Zod validation → lib → Supabase). This is where the real bugs live (double-wrapped
`{ args }`, wrong DB columns, broken read-gates) that unit tests cannot catch.

## Running

```bash
# 1. Start the backend (functions on :8888) in one terminal:
npm run dev:netlify

# 2. Run the suites in another:
npm run test:e2e                      # all suites
npm run test:e2e -- communications    # one (substring match)
npm run test:e2e -- comms incidents   # several
```

Env:
- `BASE_URL` — override the API origin (default `http://localhost:8888`).
- `KEEP_DATA=1` — skip cleanup so you can inspect the rows the run created.

Additional safety environment:

- `E2E_DISPOSABLE_DB=1` is required by suites whose immutable evidence cannot
  be removed by the service role. Set it only for an isolated E2E database
  that an operator resets with database-owner tooling after every run.

Exit code is `0` only when every test passes (CI-friendly).

### Immutable-evidence suites

`communicationsCompliance` creates intentionally immutable access evidence and
completed export records. It refuses to run unless `E2E_DISPOSABLE_DB=1`.

**Do not set `E2E_DISPOSABLE_DB=1` against the shared development database (or any
production database).** It is a shared, non-resettable environment; the immutable
`message_compliance_access_events` / `message_compliance_exports` rows (protected by
`block_*` / `guard_*` triggers from migration `20260919000433`) cannot be swept and
would accumulate there permanently. This suite runs **only** against a throwaway
database that its owner resets after each run.

Required environment for a live run:

- migrations **432–436** applied to the disposable database;
- **`COMPLIANCE_EVIDENCE_PEPPER_V1`** configured on the backend (the export/evidence
  SHA-256 hashing reads it — exports fail without it);
- `E2E_DISPOSABLE_DB=1`.

Required verification sequence:

1. provision an isolated disposable database;
2. apply migrations 432–436 and start the backend with `COMPLIANCE_EVIDENCE_PEPPER_V1` set;
3. run the suite once;
4. reset the database as its owner;
5. re-apply migrations and run the suite a second time;
6. reset the database again.

There is deliberately no service-role cleanup bypass for immutable compliance
evidence.

**Live E2E acceptance status (2026-07-18): BLOCKED BY ENVIRONMENT — not passed,
not failed.** The suite has not been executed against a valid target because no
disposable database with migrations 432–436 and `COMPLIANCE_EVIDENCE_PEPPER_V1` has
been provisioned; it must not run against the shared dev DB. Static verification is
**complete** (backend + frontend typecheck clean; compliance route mounted and
compiled — `/api/communications/compliance/cases/list` returns 401 unauthenticated;
migrations 432–436 apply cleanly after the `20260919000433` patch). Final compliance
acceptance remains **pending exactly one disposable-DB run** per the sequence above.

## Recovering from an interrupted run — `sweep-orphans.mjs`

Each suite's `h.onCleanup()` only knows the row IDs it created **in memory during that
process**. If a run is interrupted (Ctrl+C, a shell timeout, a crash) before it reaches
`h.runCleanup()`, those rows are never deleted — and no later run's cleanup will ever
touch them either, since `h.TAG` is a fresh `TEST-E2E-<timestamp>` every run and only
matches that run's own rows. Over enough interrupted runs this leaves permanent orphan
data (fake employees, audit rows, events, etc.) sitting in the app.

Every synthetic user any suite creates has `test-e2e` somewhere in its `username`
(either as the `TEST-E2E-<ts>_suffix` prefix, or embedded lowercase). Use that as the
recovery anchor:

```bash
node scripts/e2e/sweep-orphans.mjs            # dry run — reports what it would delete
node scripts/e2e/sweep-orphans.mjs --apply    # actually deletes it
npm run test:e2e:sweep                        # === --apply
```

**`run.mjs` now runs this automatically** — `sweepOrphans()` fires before every run (so
a suite never borrows a leaked account), on Ctrl-C / SIGTERM, and after the run.
`KEEP_DATA=1` disables all three. Because of the pre-run sweep, leaks from a killed run
are cleared at the start of the next one, so they can no longer accumulate. The
standalone CLI stays for on-demand recovery. It anchors on the `test-e2e` username
marker **and** an `(E2E …)` full_name (a few suites mint custom usernames), deletes the
rows that reference those users (the workflow chain included), sweeps TAG-stamped text
columns, then deletes the users. It is a recovery net, not a substitute for a suite's own
`h.onCleanup()` — keep writing real cleanup in every new suite per the standard below.

## How it works
- **`harness.mjs`** loads `.env`, mints HS256 JWTs at runtime (no passwords), exposes
  a service-role Supabase client (`sb`) for setup/teardown, and provides the runner
  (`section/test/expect/ok/fails`) + a LIFO cleanup registry.
- **`run.mjs`** creates ONE harness, picks shared identities (1 admin + 2 non-admins),
  runs every suite in `suites/`, then cleans up and prints one aggregated report.
- **`suites/*.mjs`** — one file per module. Each tags its rows with `h.TAG` and
  removes them in `h.onCleanup()`.

## Writing a new suite (the standard)

The governing behavioral standard is
`docs/ENTERPRISE_MODULE_DELIVERY_STANDARD.md`; use
`docs/templates/MODULE_E2E_MATRIX_TEMPLATE.md` to map every endpoint, transition, permission,
side effect, operational flow, and UI journey to exact test names. The static route-coverage gate
derives its mounted route set from the deterministic codebase index and only proves that a route
path is called somewhere. It does not prove that the call has correct assertions or covers
authorization, response shape, state, side effects, concurrency, or cleanup.

Run `npm run repo:index` after route, mount, or suite changes. The coverage gate rejects a missing,
stale, or unresolved mounted-route index instead of silently scanning an incomplete route subset.

For the module being built, every route must be covered and removed from
`coverage-waivers.json`. Do not use `--write-waivers` to make new module work pass.

Create `suites/<module>.mjs`:

```js
export const title = 'Incidents';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };
  const created = [];
  h.onCleanup(async () => { if (created.length) await sb.from('hse_incidents').delete().in('id', created); });

  h.section('Incidents › CRUD');
  await test('create incident', async () => {
    const r = await api('hse/incidents/create', T.admin, { /* … */ });
    ok(r); created.push(r.body.id);
  });
  // … every endpoint, every flow …
}
```

### Actors: prefer real employees, create only when you must

Suites used to create a synthetic `app_users` row for every actor (manager, employee,
hr_staff, etc.), even when the DB already has real people with that role. That leaked
fake accounts into the app (visible as odd names like `TEST-E2E-…`) whenever a run got
interrupted before cleanup ran. The standard now is:

```js
const { acquireActors } = h;
const { actors: [emp1, emp2] } = await acquireActors('employee', 2);
const { actors: [fmgr] } = await acquireActors('finance_manager', 1); // no real ones exist → created
```

`acquireActors(role, count, extra?, filter?)` looks for real active `app_users` with
that role FIRST and only creates synthetic ones for the shortfall (tagged `${TAG}_role#`,
covered by cleanup/`sweep-orphans.mjs`). `filter` narrows which real users are eligible
(e.g. `{ pay_basis: 'salary' }` so a payroll suite doesn't pick a real hourly employee
with a zero salary); `extra` only applies to synthetic creation.

**When you must still create a synthetic actor** (this is a real exception, not a
default):
- **The actor's own identity gets mutated** by the flow under test — status-change,
  transfer/department change, supervisor-change, offboarding finalize (→ terminated).
  Running these against a real employee would corrupt their real HR record.
- **The test asserts an exact, clean-slate count** for that actor globally (e.g. "this
  employee has zero payslips ever") — a real employee's genuine history would make the
  assertion non-deterministic.
- **The role has zero real accounts** (e.g. `finance_manager`/`hr_staff` in a fresh DB)
  — `acquireActors` already creates for you in this case, no special-casing needed.

**Cleanup must scope by the records YOU created, never by a broad `employee_id`/
`actor_id` filter**, once an actor might be real: `sb.from('t').delete().in('employee_id',
[emp1Id])` would delete that real employee's OTHER genuine rows in `t`, not just the
ones this run made. Track every created id in `ctx` and delete `.in('id', theseIds)` /
`.in('record_id', theseIds)` / `.in('source_entity_id', theseIds)` instead.

**A suite is only complete when it covers ALL of these** (see CLAUDE.md §Testing Standard):

1. **Every endpoint** the module exposes — list, get, create, update, every action.
2. **Every flow / wizard** — multi-step creation, state-machine transitions, approvals.
3. **Access control** — authorized role passes; unauthorized role / non-participant is
   denied with the right code. Test the negative, not just the positive.
4. **Response shape** — assert the fields the frontend actually consumes (the contract).
5. **Side-effects** (the spec's mutation rule) — after a mutation, assert via `sb` that
   it wrote the expected `app_events`, `audit_logs`, `notifications`, `workflow_tasks`,
   and `handoff_outbox` rows. A mutation that doesn't emit its events is a bug.
6. **Cleanup** — tag rows with `h.TAG`, delete them in `h.onCleanup()`.

See `suites/communications.mjs` as the reference implementation.
