/**
 * scripts/verify-hr-access-assignment-tx.mjs
 *
 * Verification for 20260928000002_hr_access_assignment_tx.sql.
 *
 * The SQL script checks the catalogue ACL. This probe crosses the real API
 * boundary and tries to CALL the SECURITY DEFINER functions with the anon key —
 * the actual attack, not a description of it. If the trailing REVOKE was lost to
 * a truncated paste, anon can write access grants, app_events and audit rows
 * directly, bypassing every route-level permission check.
 *
 * Read-only against real data: the anon attempts are expected to be refused, and
 * the service-role reachability check calls the function with a deliberately
 * invalid correlation id so it raises before writing anything.
 *
 * Usage:  node scripts/verify-hr-access-assignment-tx.mjs
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
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc  = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const pass = (label, detail) => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => { failures += 1; console.error(`  FAIL  ${label} — ${detail}`); };

/** True when the error means "you may not call this", rather than "bad input". */
function isRefusal(error) {
  if (!error) return false;
  const msg = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return msg.includes('permission denied')
      || msg.includes('not allowed')
      || msg.includes('could not find the function')
      || msg.includes('pgrst202')
      || msg.includes('42883')
      || msg.includes('jwt');
}

console.log('\nAccess-assignment RPC verification (20260928000002)');
console.log(`Endpoint: ${env.SUPABASE_URL}\n`);

console.log('1. anon MUST NOT be able to execute the SECURITY DEFINER commands');
{
  const { error } = await anon.rpc('hr_access_assignment_grant_tx', {
    p_actor_id: 'probe', p_employee_id: 'probe', p_access_profile_id: '00000000-0000-0000-0000-000000000000',
    p_assignment_type: 'profile', p_effective_from: null, p_scopes: [], p_correlation_id: 'probe',
  });
  if (!error) fail('anon grant_tx', 'EXECUTED — the trailing REVOKE was lost; anon can write access grants');
  else if (isRefusal(error)) pass('anon grant_tx', `refused (${error.code ?? 'error'})`);
  else fail('anon grant_tx', `reached the function body and failed on INPUT, meaning anon may execute it: ${error.message}`);
}
{
  const { error } = await anon.rpc('hr_access_assignment_revoke_tx', {
    p_actor_id: 'probe', p_assignment_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'probe', p_correlation_id: 'probe',
  });
  if (!error) fail('anon revoke_tx', 'EXECUTED — the trailing REVOKE was lost; anon can revoke access');
  else if (isRefusal(error)) pass('anon revoke_tx', `refused (${error.code ?? 'error'})`);
  else fail('anon revoke_tx', `reached the function body and failed on INPUT, meaning anon may execute it: ${error.message}`);
}

console.log('\n2. anon MUST NOT be able to write the underlying tables directly');
for (const table of ['hr_employee_access_assignments', 'hr_employee_access_scopes']) {
  const { error } = await anon.from(table).insert({ employee_id: 'probe' });
  if (!error) fail(`anon insert ${table}`, 'INSERT SUCCEEDED — RLS is not protecting this table');
  else pass(`anon insert ${table}`, `refused (${error.code ?? 'error'})`);
}

console.log('\n3. service_role CAN reach the commands (argument validation proves entry)');
{
  // Empty correlation id raises inside the body, so the function is reachable but
  // nothing is written. A "function not found" here would mean the grant is missing.
  const { error } = await svc.rpc('hr_access_assignment_grant_tx', {
    p_actor_id: 'probe', p_employee_id: 'probe', p_access_profile_id: '00000000-0000-0000-0000-000000000000',
    p_assignment_type: 'profile', p_effective_from: null, p_scopes: [], p_correlation_id: '',
  });
  if (!error) fail('service_role grant_tx', 'returned success for an invalid call — validation is not firing');
  else if (/could not find the function|PGRST202|42883/i.test(error.message)) {
    fail('service_role grant_tx', `not callable: ${error.message}`);
  } else if (/correlation id is required/i.test(error.message)) {
    pass('service_role grant_tx', 'reachable; rejected the empty correlation id before writing');
  } else {
    pass('service_role grant_tx', `reachable; rejected with ${error.code ?? 'error'}`);
  }
}
{
  const { error } = await svc.rpc('hr_access_assignment_revoke_tx', {
    p_actor_id: 'probe', p_assignment_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'probe', p_correlation_id: '',
  });
  if (!error) fail('service_role revoke_tx', 'returned success for an invalid call — validation is not firing');
  else if (/could not find the function|PGRST202|42883/i.test(error.message)) {
    fail('service_role revoke_tx', `not callable: ${error.message}`);
  } else if (/correlation id is required/i.test(error.message)) {
    pass('service_role revoke_tx', 'reachable; rejected the empty correlation id before writing');
  } else {
    pass('service_role revoke_tx', `reachable; rejected with ${error.code ?? 'error'}`);
  }
}

console.log('\n4. Nothing was written by this probe');
{
  const { data, error } = await svc.from('hr_employee_access_assignments').select('id, employee_id').eq('employee_id', 'probe');
  if (error) fail('no side effects', `could not confirm: ${error.message}`);
  else if (data.length) fail('no side effects', `${data.length} probe row(s) were written — investigate`);
  else pass('no side effects', 'no probe rows exist');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
