/**
 * scripts/e2e/harness.mjs
 *
 * Reusable end-to-end test harness for the SIOMAC ERP. Suites under ./suites/
 * use this core to hit the LIVE running dev server over HTTP — the only layer
 * that exercises the full stack (frontend request shape → Hono route → Zod →
 * lib → Supabase), which is where the real bugs live.
 *
 * The harness:
 *   • loads .env and mints JWTs at runtime (HS256 / JWT_SECRET) for any user/role,
 *   • exposes a service-role Supabase client (sb) for setup + teardown,
 *   • provides a tiny assertion/runner API (section/test/expect/ok/fails),
 *   • collects per-suite cleanup closures and runs them LIFO at the end.
 *
 * Suites never construct this directly — run.mjs creates one and passes it in.
 *
 * @see scripts/e2e/README.md  for how to write a new suite.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
// Present in .env only once their slice is configured — suites that need them
// guard explicitly (e.g. messagingTypingPresence requires the ES256 realtime key).
const OPTIONAL_ENV = ['SUPABASE_JWT_ES256_PRIVATE_KEY', 'SUPABASE_JWT_ES256_KID'];

/** Parse only the single-line keys we need from .env (ignores multiline PEM blocks). */
function loadEnv() {
  let txt = '';
  try { txt = readFileSync(new URL('../../.env', import.meta.url), 'utf8'); }
  catch { console.error('Could not read .env at project root'); process.exit(2); }
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && (REQUIRED_ENV.includes(m[1]) || OPTIONAL_ENV.includes(m[1]))) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  for (const k of REQUIRED_ENV) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}

export class Harness {
  constructor() {
    this.env  = loadEnv();
    this.base = process.env.BASE_URL || 'http://localhost:8888';
    this.TAG  = `TEST-E2E-${Date.now()}`;
    this.sb   = createClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    this.results   = [];
    this._group    = '';
    this._cleanups = [];
    this.users     = null;   // { admin, b, c } after pickUsers()
  }

  /** A realtime-capable Supabase client using the ANON key — exactly what the
   *  browser uses for postgres_changes subscriptions. */
  anonClient = () => createClient(this.env.SUPABASE_URL, this.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  // ── auth ────────────────────────────────────────────────────────────────────
  /** Mint a 15-min HS256 access token for a user row ({ id, username, role, department_id }). */
  mint = (u, amr = ['pwd']) => jwt.sign(
    { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id ?? '',
      jti: randomUUID(), amr, mfaSatisfied: false, authStrength: 'password_only' },
    this.env.JWT_SECRET, { expiresIn: '15m' },
  );

  /** A step-up-satisfying token (recent MFA) for endpoints behind requireStepUp. */
  mintStepUp = (u) => jwt.sign(
    { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id ?? '',
      jti: randomUUID(), amr: ['pwd', 'totp'], mfaSatisfied: true,
      mfaVerifiedAt: new Date().toISOString(), authStrength: 'mfa' },
    this.env.JWT_SECRET, { expiresIn: '15m' },
  );

  // ── HTTP ────────────────────────────────────────────────────────────────────
  /** POST /api/<path> with { args }. Never throws — returns { status, body }. */
  api = async (path, token, args = {}) => {
    let res;
    try {
      res = await fetch(`${this.base}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ args }),
      });
    } catch (e) {
      return { status: 0, body: { success: false, message: `network: ${e.message}` } };
    }
    let body;
    try { body = await res.json(); } catch { body = { success: false, message: 'non-JSON response' }; }
    return { status: res.status, body };
  };

  // ── runner / assertions ───────────────────────────────────────────────────
  section = (name) => { this._group = name; };

  test = async (name, fn) => {
    try { await fn(); this.results.push({ group: this._group, name, ok: true }); process.stdout.write('.'); }
    catch (e) {
      if (e && e._skip) { this.results.push({ group: this._group, name, ok: true, skipped: true }); process.stdout.write('s'); return; }
      this.results.push({ group: this._group, name, ok: false, detail: e.message }); process.stdout.write('x');
    }
  };

  expect = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  ok     = (r, msg) => this.expect(r.body && r.body.success === true,  `${msg || 'expected success'} — got ${JSON.stringify(r.body).slice(0, 300)}`);
  fails  = (r, msg) => this.expect(r.body && r.body.success === false, `${msg || 'expected failure'} — got ${JSON.stringify(r.body).slice(0, 300)}`);

  /** Skip a test — throws a sentinel that the test() runner catches and records as SKIP.
   *  Always follow with `return` so the rest of the test body doesn't execute. */
  skip = (msg) => { throw Object.assign(new Error(msg || 'skipped'), { _skip: true }); };

  /** The Supabase service-role key — available to suites that need to call
   *  service-role-only endpoints (e.g. scheduled sweeps) directly via fetch. */
  get serviceKey() { return this.env.SUPABASE_SERVICE_ROLE_KEY; }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  /** Register a cleanup closure; run LIFO after all suites finish. */
  onCleanup = (fn) => { this._cleanups.push(fn); };

  /**
   * Teardown delete that SURFACES failures instead of swallowing them.
   * `await sb.from(t).delete().in(...)` returns `{ error }` — a cleanup block that
   * never reads it lets FK-blocked deletes fail silently, and the leaked rows
   * accumulate across runs until they break live pages and list assertions (312
   * TEST-E2E hse_hazards did exactly this). Suites' onCleanup blocks must use this
   * for every delete:
   *
   *     await h.mustDelete('hse_controls', q => q.in('hazard_id', ids));
   *
   * `build` receives the started delete builder and applies the filters. Never
   * throws (teardown must keep going) — logs table + error loudly and returns
   * false so callers can react if they need to.
   */
  mustDelete = async (table, build) => {
    try {
      const { error } = await build(this.sb.from(table).delete());
      if (error) {
        console.warn(`\n[cleanup] DELETE ${table} FAILED — ${error.message} (rows leak until the orphan sweep)`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`\n[cleanup] DELETE ${table} threw — ${e.message}`);
      return false;
    }
  };

  /** Lightweight liveness probe (no auth, no DB) — true when the server answers. */
  async isServerUp() {
    try {
      const res = await fetch(`${this.base}/api/ping`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"args":{}}',
      });
      return !!res && res.ok;
    } catch { return false; }
  }

  /** Fail fast with a clear message if the dev server isn't up. */
  async ping() {
    try {
      const res = await fetch(`${this.base}/api/ping`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"args":{}}',
      });
      if (!res || !res.ok) throw new Error('no response');
    } catch {
      console.error(`\nCannot reach ${this.base}. Start the dev server first:  npm run dev:netlify\n`);
      process.exit(2);
    }
  }

  /** Pick 1 admin + 2 non-privileged (employee) active users for participant /
   *  non-participant + access-denial tests. */
  async pickUsers() {
    const { data: admins } = await this.sb.from('app_users')
      .select('id, username, role, department_id').eq('status', 'active')
      .in('role', ['admin', 'superadmin']).limit(1);
    // b/c must be GENUINELY non-privileged. A roster-random non-admin can be a MANAGER
    // (e.g. a seed user promoted by seed-managers.sql), which HOLDS the manage/approve
    // permissions the "B should not …" access tests assert are absent → spurious failures
    // across HSE/orchestration/transfers. Pick `employee`s; suites needing a specific
    // privileged role use acquireActors(role) instead, so restricting b/c here is safe.
    const { data: others } = await this.sb.from('app_users')
      .select('id, username, role, department_id').eq('status', 'active')
      .eq('role', 'employee').limit(2);
    const admin = admins?.[0], b = others?.[0], c = others?.[1];
    if (!admin || !b || !c) {
      console.error('\nNeed >=1 admin + 2 active employees. Found:', { admin: !!admin, b: !!b, c: !!c });
      process.exit(2);
    }
    this.users = { admin, b, c };
    this._borrowed = new Set([admin.id, b.id, c.id]);
    return this.users;
  }

  /**
   * Acquire `count` actors with `role`. Prefers REAL active app_users already in the
   * roster (never mutated, never deleted) — only creates synthetic app_users for the
   * shortfall when the roster doesn't have enough of that role (e.g. this DB currently
   * has zero real `finance_manager`/`hr_staff` accounts, so role-specific suites still
   * have to create them; a plain `employee`/`manager` suite should never need to).
   * Synthetic rows are tagged `${TAG}_<role>N` and returned in `createdIds` so the
   * caller's `onCleanup()` can remove exactly those (and only those).
   *
   * `extra` is merged into synthetic-only inserts (e.g. `{ pay_basis: 'salary',
   * monthly_salary: 6000 }`) — real users are used as-is, never patched.
   *
   * `filter` narrows which REAL users are eligible (e.g. `{ pay_basis: 'salary' }`
   * so a payroll suite doesn't pick a real hourly employee with a zero salary). It
   * has no effect on synthetic creation — use `extra` for that.
   *
   * `opts.forceSynthetic` skips the real-roster pool entirely and always creates
   * fresh synthetic users. Use it when the suite's assertions depend on rows the
   * suite itself seeds for the actor (e.g. exact-amount payroll math) — a real
   * roster user carries pre-existing components/loans/attendance that would skew
   * the expected values.
   */
  acquireActors = async (role, count, extra = {}, filter = {}, opts = {}) => {
    this._borrowed ??= new Set();
    this._acquireSeq ??= 0;
    let real = [];
    if (!opts.forceSynthetic) {
      let q = this.sb.from('app_users')
        .select('id, username, role, department_id, full_name')
        .eq('status', 'active').eq('role', role);
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { data: pool, error } = await q;
      if (error) throw new Error(`acquireActors(${role}): ${error.message}`);
      real = (pool ?? []).filter(u => !this._borrowed.has(u.id)).slice(0, count);
      real.forEach(u => this._borrowed.add(u.id));
    }

    const createdIds = [];
    const created = [];
    for (let i = real.length; i < count; i++) {
      const id = randomUUID();
      // A per-harness call counter (not just role+index) keeps usernames unique even
      // when two suites in the same run both ask for e.g. 'finance_manager' — TAG
      // alone collides since it's shared across every suite in one run.mjs invocation.
      const seq = this._acquireSeq++;
      const username = `${this.TAG}_${role.replace(/[^a-z]/gi, '').slice(0, 6)}${i}_${seq}`;
      const row = {
        id, username, role, status: 'active', employment_type: 'employee',
        full_name: `${role.replace(/_/g, ' ')} (E2E ${i + 1})`, ...extra,
      };
      const { error: insErr } = await this.sb.from('app_users').insert(row);
      if (insErr) throw new Error(`acquireActors(${role}) create: ${insErr.message}`);
      createdIds.push(id);
      // Mark the synthetic user as borrowed so a subsequent acquireActors() call for
      // the same role doesn't pick this freshly-created row from the DB and return the
      // same user twice, which would cause SoD violations in tests that need two distinct actors.
      this._borrowed.add(id);
      created.push({ id, username, role, department_id: row.department_id ?? null });
    }
    const actors = [...real, ...created];
    return { actors, createdIds, realCount: real.length };
  };

  // ── Critical-grant helpers (Slice 1 — maker-checker flow) ───────────────────

  readPermissionOverride = async (userId, permissionKey) => {
    const { data, error } = await this.sb.from('user_permissions')
      .select('user_id, permission, granted, set_by, set_at')
      .eq('user_id', userId)
      .eq('permission', permissionKey)
      .maybeSingle();
    if (error) throw new Error(`readPermissionOverride(${permissionKey}, ${userId}): ${error.message}`);
    return data ?? null;
  };

  restorePermissionOverride = async (userId, permissionKey, previous) => {
    if (previous) {
      const { error } = await this.sb.from('user_permissions').upsert(previous, {
        onConflict: 'user_id,permission',
      });
      if (error) throw new Error(`restorePermissionOverride(${permissionKey}, ${userId}): ${error.message}`);
      return;
    }
    await this.mustDelete(
      'user_permissions',
      q => q.eq('user_id', userId).eq('permission', permissionKey),
    );
  };

  /**
   * Seed a critical-permission row directly via the service-role client.
   *
   * Use ONLY for bootstrap: giving synthetic test superadmins the
   * permissions.manage / roles.manage rows they need BEFORE they can participate
   * in the real maker-checker flow.  The production bootstrap migration
   * (20260919000431) does the same thing for existing superadmins.
   *
   * Registers cleanup that restores the exact prior row, including explicit
   * denies. Tests must never erase or rewrite a real user's permission state.
   */
  seedCriticalPermViaServiceRole = async (userId, permissionKey) => {
    const previous = await this.readPermissionOverride(userId, permissionKey);
    const { error } = await this.sb.from('user_permissions').upsert(
      { user_id: userId, permission: permissionKey, granted: true,
        set_by: `e2e_bootstrap_${this.TAG}`, set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' },
    );
    if (error) throw new Error(`seedCriticalPerm(${permissionKey}, ${userId}): ${error.message}`);
    this.onCleanup(() => this.restorePermissionOverride(userId, permissionKey, previous));
  };

  /**
   * Grant a critical permission to a user through the REAL maker-checker workflow.
   *
   * Pre-conditions (callers must satisfy before calling):
   *   - makerUser.role === 'superadmin' and has permissions.manage in user_permissions
   *   - checkerUser.role === 'superadmin' and has permissions.manage in user_permissions
   *   - makerUser.id !== checkerUser.id  (server enforces segregation of duties)
   *
   * Compliance read/export grants are dated and default to a seven-day validity
   * window here. Other critical permissions retain their existing approval shape.
   *
   * Registers cleanup that restores the exact pre-test override. A borrowed
   * roster actor may already hold an explicit grant or deny.
   *
   * @returns approvalId for further assertions.
   */
  grantCriticalPerm = async (makerUser, checkerUser, targetUserId, permissionKey, reason) => {
    const previous = await this.readPermissionOverride(targetUserId, permissionKey);
    // Step 1 — MAKER requests the grant (creates a pending approval row)
    const makerToken = this.mint(makerUser);
    const isCompliance = permissionKey === 'communications.compliance_read'
      || permissionKey === 'communications.compliance_export';
    const validFrom = new Date(Date.now() - 60_000).toISOString();
    const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const reqRes = await this.api('superadmin/setUserPermission', makerToken, {
      userId: targetUserId, permission: permissionKey, granted: true, reason,
      ...(isCompliance ? { validFrom, validUntil } : {}),
    });
    if (!reqRes.body.success || !reqRes.body.pending) {
      throw new Error(
        `grantCriticalPerm: MAKER setUserPermission failed for ${permissionKey}: ` +
        `${reqRes.status} ${JSON.stringify(reqRes.body)}`,
      );
    }
    const approvalId = reqRes.body.approvalId;
    if (!approvalId) throw new Error(`grantCriticalPerm: no approvalId returned for ${permissionKey}`);

    // Step 2 — CHECKER approves (step-up token required; maker≠checker enforced by RPC)
    const checkerStepUp = this.mintStepUp(checkerUser);
    const appRes = await this.api('admin/approvals/approve', checkerStepUp, { approvalId });
    if (!appRes.body.success) {
      throw new Error(
        `grantCriticalPerm: CHECKER approve failed for ${permissionKey} (approvalId=${approvalId}): ` +
        `${appRes.status} ${JSON.stringify(appRes.body)}`,
      );
    }

    // Restore the exact pre-test state; never blindly delete a borrowed actor's row.
    this.onCleanup(async () => {
      await this.restorePermissionOverride(targetUserId, permissionKey, previous);
      // Also clean the approval row itself
      await this.mustDelete('permission_grant_approvals', q => q.eq('id', approvalId));
    });

    return approvalId;
  };

  /**
   * Revoke a critical permission from a user.
   *
   * Calls clearUserPermission (immediate, no maker-checker) via the actor's token.
   * The actor must have permissions.manage.
   *
   * @returns the API response for the caller to assert on.
   */
  revokeCriticalPerm = async (actorUser, targetUserId, permissionKey) => {
    const token = this.mint(actorUser);
    return this.api('superadmin/clearUserPermission', token, {
      userId: targetUserId, permission: permissionKey,
    });
  };

  async runCleanup() {
    if (process.env.KEEP_DATA) { console.log('\nKEEP_DATA set — skipping cleanup.'); return; }
    for (const fn of this._cleanups.reverse()) {
      try { await fn(); } catch (e) { console.warn('Cleanup warning:', e.message); }
    }
  }

  /** Print the grouped pass/fail report. Returns the failure count. */
  report() {
    console.log('\n\n════════════════ RESULTS ════════════════');
    let lastGroup = '', pass = 0, fail = 0;
    for (const r of this.results) {
      if (r.group !== lastGroup) { console.log(`\n▸ ${r.group}`); lastGroup = r.group; }
      if (r.ok) { pass++; console.log(`   ✓ ${r.name}`); }
      else { fail++; console.log(`   ✗ ${r.name}\n        → ${r.detail}`); }
    }
    console.log('\n═════════════════════════════════════════');
    console.log(`${pass} passed · ${fail} failed · ${this.results.length} total   [tag ${this.TAG}]`);
    return fail;
  }
}
