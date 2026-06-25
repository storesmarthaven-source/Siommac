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

Exit code is `0` only when every test passes (CI-friendly).

## How it works
- **`harness.mjs`** loads `.env`, mints HS256 JWTs at runtime (no passwords), exposes
  a service-role Supabase client (`sb`) for setup/teardown, and provides the runner
  (`section/test/expect/ok/fails`) + a LIFO cleanup registry.
- **`run.mjs`** creates ONE harness, picks shared identities (1 admin + 2 non-admins),
  runs every suite in `suites/`, then cleans up and prints one aggregated report.
- **`suites/*.mjs`** — one file per module. Each tags its rows with `h.TAG` and
  removes them in `h.onCleanup()`.

## Writing a new suite (the standard)

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
