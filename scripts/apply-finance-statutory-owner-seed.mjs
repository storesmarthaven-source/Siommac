// scripts/apply-finance-statutory-owner-seed.mjs
//
// Applies supabase/apply-finance-statutory-owner-seed.sql via supabase-js (PostgREST):
// seeds the stable Finance Manager persona and hands ownership of the active TT statutory
// version to Finance (maker), with a distinct senior approver (checker). Idempotent.
//
//   node scripts/apply-finance-statutory-owner-seed.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQ = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function loadEnv() {
  const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQ.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQ) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FINMGR = {
  id: 'USR-FINMGR', username: 'finance.manager', full_name: 'Camille Rampersad',
  first_name: 'Camille', last_name: 'Rampersad', role: 'finance_manager', status: 'active',
  auth_email: 'finance.manager@siomac.internal', email: 'finance.manager@siomac.com',
  employee_number: 'EMP-FIN01', position: 'Finance Manager',
};

async function main() {
  // 1) Stable Finance Manager persona.
  const { error: uErr } = await sb.from('app_users').upsert(FINMGR, { onConflict: 'id' });
  if (uErr) throw new Error(`upsert Finance Manager failed: ${uErr.message}`);

  // 2) Distinct senior approver (segregation of duties: creator ≠ approver).
  const { data: sa, error: saErr } = await sb.from('app_users')
    .select('id, full_name').eq('role', 'superadmin').order('created_at').limit(1).maybeSingle();
  if (saErr) throw new Error(`find superadmin failed: ${saErr.message}`);
  if (!sa) throw new Error('no superadmin found to act as the distinct approver');

  // 3) Active TT statutory version → Finance owner + distinct approver/activator.
  const { data: upd, error: vErr } = await sb.from('finance_statutory_versions')
    .update({ created_by: FINMGR.id, approved_by: sa.id, activated_by: sa.id })
    .eq('jurisdiction', 'TT').eq('is_active', true)
    .select('effective_from, label, created_by, approved_by');
  if (vErr) throw new Error(`reassign version owner failed: ${vErr.message}`);

  console.log(`✓ Finance Manager seeded: ${FINMGR.full_name} (${FINMGR.id}, ${FINMGR.role})`);
  console.log(`✓ Distinct approver: ${sa.full_name} (${sa.id})`);
  for (const v of upd ?? []) console.log(`✓ ${v.label}: owner=${v.created_by} approver=${v.approved_by}`);
  if (!upd?.length) console.warn('⚠ no active TT version found to reassign');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
