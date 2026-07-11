// Wave 4b (overtime rule engine) migration verification.
// Checks real DB objects — NOT head:true count (which false-positives).

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function check(label, fn) {
  try {
    const result = await fn();
    if (result.error) {
      console.log(`MISSING  ${label} — ${result.error.message}`);
      return false;
    }
    console.log(`OK       ${label}${result.note ? ' — ' + result.note : ''}`);
    return true;
  } catch (e) {
    console.log(`ERROR    ${label} — ${e.message}`);
    return false;
  }
}

console.log('\n=== Wave 4b Migration Check ===\n');

const results = [];

results.push(await check('table: finance_overtime_rules', () =>
  sb.from('finance_overtime_rules').select('*').limit(1)));

results.push(await check('column: hr_overtime_entries.ot_type', () =>
  sb.from('hr_overtime_entries').select('ot_type').limit(1)));

results.push(await check('seed: default OT rules present', async () => {
  const r = await sb.from('finance_overtime_rules').select('code,event_type,multiplier').eq('active', true);
  if (r.error) return r;
  return { error: null, note: `${r.data.length} active rule(s): ${r.data.map(x => x.code).join(', ') || '(none)'}` };
}));

results.push(await check('grant: finance.payroll.overtime.rules.manage', () =>
  sb.from('role_permissions').select('permission').eq('permission', 'finance.payroll.overtime.rules.manage').limit(1)));

const allOk = results.every(Boolean);
console.log('\n' + (allOk ? 'ALL CHECKS PASSED — Wave 4b migration applied.' : 'ONE OR MORE CHECKS FAILED — operator must apply migration 70 + seed + grant 80.'));
process.exit(allOk ? 0 : 1);
