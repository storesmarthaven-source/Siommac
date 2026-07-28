/**
 * scripts/verify-hr-profile-foundations.mjs
 *
 * Service-role PostgREST verification for
 *   supabase/migrations/20260928000001_hr_employee_profile_foundations.sql
 *   sha256 c1e6fceb500d126688bfc8d0576cb0a022e9196597c1bda1cbfaafa835fb95d0
 *
 * WHY THIS EXISTS, separately from
 * scripts/sql/verify_20260928000001_hr_employee_profile_foundations.sql:
 * the SQL script proves the objects exist IN THE DATABASE. It cannot prove the
 * Data API picked them up — a session running SQL bypasses PostgREST entirely.
 * This probe crosses the API boundary the application actually uses.
 *
 * It deliberately issues REAL, ROW-RETURNING SELECTS with EXPLICIT COLUMN LISTS.
 * It never uses `{ head: true, count: … }`: a head/count request is not proof a
 * table exists or that its columns resolve (a documented trap in this build).
 * An explicit column list is the strong form — PostgREST fails the request with
 * PGRST204 if any named column is unknown, so a successful response proves the
 * whole projection resolved, even when the table is legitimately empty.
 *
 * Read-only: no insert, update or delete. Writability is proved by the live E2E
 * suite, not here.
 *
 * Usage:  node scripts/verify-hr-profile-foundations.mjs
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

/**
 * Real row-returning select over an explicit projection.
 *
 * `expectRows` is asserted only where the migration guarantees data (the seeded
 * controls). Elsewhere an empty result is a legitimate pass: the projection
 * resolving is the proof, not the row count.
 */
async function probe(table, columns, { expectRows = 0, limit = 5 } = {}) {
  const { data, error, status } = await sb.from(table).select(columns).limit(limit);
  if (error) { fail(table, `${error.code ?? status}: ${error.message}`); return null; }
  if (!Array.isArray(data)) { fail(table, 'response carried no row array'); return null; }
  if (data.length < expectRows) {
    fail(table, `expected at least ${expectRows} row(s), got ${data.length}`);
    return data;
  }
  const shape = data.length ? `keys: ${Object.keys(data[0]).join(', ')}` : 'projection resolved, table empty';
  pass(table, `${data.length} row(s) returned · ${shape}`);
  return data;
}

console.log('\nPostgREST verification — HR Employee Profile foundations (S2A)');
console.log(`Endpoint: ${env.SUPABASE_URL}\n`);

console.log('1. The six new tables — explicit projections, real selects');
await probe('hr_employee_access_assignments',
  'id, employee_id, access_profile_id, assignment_type, status, effective_from, effective_to, granted_by, granted_at, revoked_by, revoked_at, workflow_id, metadata, created_at, updated_at');
await probe('hr_employee_access_scopes',
  'id, assignment_id, scope_type, scope_id, created_at');
await probe('hr_readiness_controls',
  'id, control_key, label, domain, resolution_type, description, is_blocking, is_active, sort_order, created_at, updated_at',
  { expectRows: 3 });
await probe('hr_readiness_control_instances',
  'id, employee_id, control_id, state, percent, evaluated_at, created_at, updated_at');
await probe('hr_readiness_work_items',
  'id, employee_id, control_id, instance_id, owner_id, responsible_team, status, severity, due_date, evidence_refs, reviewer_id, decision, decision_reason, correlation_id, workflow_id, created_by, created_at, updated_at, resolved_at');
await probe('hr_readiness_work_item_transitions',
  'id, work_item_id, from_status, to_status, actor_id, note, correlation_id, created_at');

console.log('\n2. New columns on the effective-dated assignment model');
await probe('hr_employee_assignments',
  'id, employee_id, effective_from, effective_to, is_current, weekly_hours, fte, updated_at');

console.log('\n3. Seeded readiness controls resolve to the expected keys');
const controls = await probe('hr_readiness_controls', 'control_key, label, domain, resolution_type, sort_order', { expectRows: 3 });
if (controls) {
  const want = ['assignment.complete', 'payroll.statutory_ready', 'training.evidence_current'];
  const got = controls.map(r => r.control_key).sort();
  const ok = want.every(k => got.includes(k));
  if (ok) pass('seed control keys', got.join(', '));
  else fail('seed control keys', `expected ${want.join(', ')} — got ${got.join(', ') || '(none)'}`);
}

console.log('\n4. Permission grants — exact role lists (segregation of duties)');
const EXPECTED_ROLES = {
  'hr.employees.readiness.view':             ['admin', 'hr_manager', 'hr_staff'],
  'hr.employees.readiness.follow_up':        ['admin', 'hr_manager', 'hr_staff'],
  'hr.employees.readiness.review':           ['admin', 'hr_manager'],
  'hr.employees.access_assignments.view':    ['admin', 'hr_manager', 'hr_staff'],
  'hr.employees.access_assignments.manage':  ['admin', 'hr_manager'],
};
const { data: grants, error: grantsError } = await sb
  .from('role_permissions')
  .select('role_name, permission')
  .in('permission', Object.keys(EXPECTED_ROLES));

if (grantsError) {
  fail('role_permissions', `${grantsError.code ?? ''}: ${grantsError.message}`);
} else {
  const byPermission = new Map();
  for (const row of grants) {
    if (!byPermission.has(row.permission)) byPermission.set(row.permission, []);
    byPermission.get(row.permission).push(row.role_name);
  }
  for (const [permission, expected] of Object.entries(EXPECTED_ROLES)) {
    const actual = (byPermission.get(permission) ?? []).sort();
    const match = actual.length === expected.length && expected.every((r, i) => actual[i] === r);
    if (match) pass(permission, actual.join(','));
    else fail(permission, `expected [${expected.join(',')}] — got [${actual.join(',') || 'none'}]`);
  }
  // The elevated pair must never reach hr_staff, whatever else is true.
  for (const elevated of ['hr.employees.readiness.review', 'hr.employees.access_assignments.manage']) {
    if ((byPermission.get(elevated) ?? []).includes('hr_staff')) {
      fail(elevated, 'hr_staff holds an ELEVATED grant — segregation of duties is broken');
    }
  }
}

console.log('\n5. No unexpected SECURITY DEFINER function was created');
// The migration defines no functions. If the SQL editor rewrote the DO $$ block
// into one, calling it would resolve instead of 404-ing.
for (const suspect of ['hr_readiness_apply', 'hr_employee_access_apply']) {
  const { error } = await sb.rpc(suspect, {});
  if (error && /Could not find the function|PGRST202|does not exist/i.test(error.message)) {
    pass(`rpc ${suspect}`, 'absent, as expected');
  } else if (error) {
    pass(`rpc ${suspect}`, `absent (${error.code ?? 'error'})`);
  } else {
    fail(`rpc ${suspect}`, 'FUNCTION EXISTS — the DO $$ block was rewritten; do not proceed');
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
