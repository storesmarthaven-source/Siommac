/**
 * scripts/verify-hr-onboarding-view-scope.mjs
 *
 * Service-role PostgREST verification for
 *   supabase/migrations/20260930000001_hr_onboarding_view_scope_permissions.sql
 *
 * WHY THIS EXISTS, separately from the verification SQL embedded in that migration:
 * the SQL proves the rows exist IN THE DATABASE. It cannot prove the Data API sees
 * them — a session running SQL bypasses PostgREST entirely. This probe crosses the
 * API boundary the application actually uses, which is the same boundary
 * loadRolePermissions() reads through when requirePermission() resolves a role.
 *
 * It issues a REAL, ROW-RETURNING SELECT with an EXPLICIT COLUMN LIST. It never uses
 * `{ head: true, count: … }`: a head/count request is not proof a table exists or that
 * its columns resolve (a documented trap in this build).
 *
 * The assertion is an EXACT role-set match, not "contains". A superset is a
 * privilege-escalation defect and must fail just as loudly as a missing grant —
 * which is precisely the failure mode that hides when testing as superadmin.
 *
 * Read-only: no insert, update or delete. Enforcement of the scope itself (that a
 * team-scoped read actually returns team rows and no more) is proved by the live
 * E2E suite against a REAL non-superadmin user, not here.
 *
 * Usage:  node scripts/verify-hr-onboarding-view-scope.mjs
 * Exit:   0 = every check passed · 1 = at least one failed · 2 = bad environment
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function loadEnv() {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQUIRED_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQUIRED_ENV) {
    if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  }
  return out;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const pass = (label, detail) => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => { failures += 1; console.error(`  FAIL  ${label} — ${detail}`); };

const SCOPE_KEYS = ['hr.onboarding.view_team', 'hr.onboarding.view_all'];

// Approved 2026-08-02. hr_staff and manager stay on My Work under base `hr.onboarding.view`.
// superadmin is intentionally absent: it is allow-all in code and derives from PERMISSION_KEYS.
const EXPECTED_ROLES = {
  'hr.onboarding.view_team': ['admin', 'hr_manager'],
  'hr.onboarding.view_all':  ['admin', 'hr_manager'],
};

// Roles that must NEVER hold a widened scope, whatever else is true.
const FORBIDDEN_ROLES = ['hr_staff', 'manager', 'employee', 'hse_staff'];

console.log('\nPostgREST verification — HR Onboarding read-scope permissions');
console.log(`Endpoint: ${env.SUPABASE_URL}\n`);

console.log('1. Scope grants resolve through the Data API — exact role sets');
const { data: grants, error: grantsError } = await sb
  .from('role_permissions')
  .select('role_name, permission')
  .in('permission', SCOPE_KEYS);

if (grantsError) {
  fail('role_permissions', `${grantsError.code ?? ''}: ${grantsError.message}`);
} else if (!Array.isArray(grants)) {
  fail('role_permissions', 'response carried no row array');
} else {
  const byPermission = new Map();
  for (const row of grants) {
    if (!byPermission.has(row.permission)) byPermission.set(row.permission, []);
    byPermission.get(row.permission).push(row.role_name);
  }

  for (const [permission, expected] of Object.entries(EXPECTED_ROLES)) {
    const actual = [...new Set(byPermission.get(permission) ?? [])].sort();
    const want = [...expected].sort();
    const match = actual.length === want.length && want.every((r, i) => actual[i] === r);
    if (match) pass(permission, actual.join(','));
    else fail(permission, `expected [${want.join(',')}] — got [${actual.join(',') || 'none'}]`);
  }

  console.log('\n2. NEGATIVE — no widened scope leaked to an execution-tier role');
  for (const key of SCOPE_KEYS) {
    const holders = byPermission.get(key) ?? [];
    const leaked = FORBIDDEN_ROLES.filter(r => holders.includes(r));
    if (leaked.length) fail(key, `granted to ${leaked.join(',')} — privilege escalation, do not proceed`);
    else pass(key, `not held by ${FORBIDDEN_ROLES.join('/')}`);
  }

  console.log('\n3. Idempotency — a re-run introduced no duplicate rows');
  const seen = new Map();
  for (const row of grants) {
    const k = `${row.role_name}|${row.permission}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length) fail('duplicate grants', dupes.map(([k, n]) => `${k} ×${n}`).join(', '));
  else pass('duplicate grants', 'none');
}

console.log('\n4. Base scope untouched — hr_staff still holds `hr.onboarding.view` (My Work)');
const { data: baseRows, error: baseError } = await sb
  .from('role_permissions')
  .select('role_name, permission')
  .eq('permission', 'hr.onboarding.view')
  .eq('role_name', 'hr_staff');

if (baseError) fail('hr.onboarding.view', `${baseError.code ?? ''}: ${baseError.message}`);
else if (!baseRows?.length) fail('hr.onboarding.view', 'hr_staff lost its base grant — My Work would 403');
else pass('hr.onboarding.view', 'hr_staff retains base grant');

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED — do not proceed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
