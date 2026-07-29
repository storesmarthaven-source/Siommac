/**
 * scripts/verify-hr-employee-assignment-tx.mjs
 *
 * Service-role PostgREST verification for
 *   supabase/migrations/20260929000003_hr_employee_assignment_tx.sql
 *
 * Crosses the Data API boundary the application actually uses, and calls the
 * function for real: a probe that only checks "the function exists" proves
 * nothing about the body.
 *
 * Exercises REFUSAL paths only — every call below raises before the first
 * insert, so no business data is written.
 *
 * Usage:  node scripts/verify-hr-employee-assignment-tx.mjs
 * Exit:   0 = every check passed · 1 = at least one failed · 2 = bad environment
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

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
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let failures = 0;
const pass = (l, d) => console.log(`  PASS  ${l}${d ? ` — ${d}` : ''}`);
const fail = (l, d) => { failures += 1; console.error(`  FAIL  ${l} — ${d}`); };

const ARGS = {
  p_actor_id: 'verify-actor',
  p_employee_id: '__verify_no_such_employee__',
  p_position_id: null,
  p_department_id: null,
  p_site_id: null,
  p_supervisor_id: null,
  p_effective_from: null,
  p_conditions: {},
  p_reason: null,
  p_correlation_id: 'verify-correlation',
};

console.log('\nPostgREST verification — HR employee assignment command');
console.log(`Endpoint: ${env.SUPABASE_URL}\n`);

console.log('1. Guards execute (a refusal proves the body ran)');
async function expectRefusal(label, overrides, matcher) {
  const { error } = await sb.rpc('hr_employee_assignment_apply_tx', { ...ARGS, ...overrides });
  if (!error) { fail(label, 'the call SUCCEEDED — a guard is missing and this probe just wrote data'); return; }
  if (/Could not find the function|PGRST202/i.test(error.message)) {
    fail(label, 'function not found — the migration has not been applied'); return;
  }
  if (matcher.test(error.message)) pass(label, error.message.slice(0, 80));
  else fail(label, `refused, but unexpectedly: ${error.message}`);
}

await expectRefusal('blank actor is refused', { p_actor_id: '' }, /actor is required/i);
await expectRefusal('blank correlation id is refused', { p_correlation_id: '' }, /correlation id is required/i);
// Reaching the employee lookup proves execution passed every input guard.
await expectRefusal('unknown employee is refused', {}, /employee .* not found/i);

console.log('\n2. SECURITY DEFINER is not reachable by anon');
{
  const { error } = await anon.rpc('hr_employee_assignment_apply_tx', ARGS);
  if (!error) fail('anon execute', 'ANON EXECUTED IT — the REVOKE tail was dropped');
  else if (/permission denied/i.test(error.message)) pass('anon execute', `${error.code}: permission denied`);
  else fail('anon execute', `unexpected: ${error.code} ${error.message.slice(0, 70)}`);
}

console.log('\n3. Assignment projection still resolves (carry-forward columns present)');
{
  const { error } = await sb.from('hr_employee_assignments')
    .select('id, employee_id, effective_from, effective_to, is_current, weekly_hours, fte, notice_period_days')
    .limit(1);
  if (error) fail('hr_employee_assignments', `${error.code}: ${error.message}`);
  else pass('hr_employee_assignments', 'projection resolves');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
