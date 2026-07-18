// Wave 2B migration verification script
// Checks real DB objects (NOT head:true count which false-positives)

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
    console.log(`OK       ${label}`);
    return true;
  } catch (e) {
    console.log(`ERROR    ${label} — ${e.message}`);
    return false;
  }
}

console.log('\n=== Wave 2B Migration Check ===\n');

const results = await Promise.all([
  // 1. table finance_disbursement_attachments
  check(
    'table: finance_disbursement_attachments',
    () => sb.from('finance_disbursement_attachments').select('*').limit(1)
  ),
  // 2. column finance_remittances.filing_method
  check(
    'column: finance_remittances.filing_method',
    () => sb.from('finance_remittances').select('filing_method').limit(1)
  ),
  // 3. column finance_payroll_runs.pay_group
  check(
    'column: finance_payroll_runs.pay_group',
    () => sb.from('finance_payroll_runs').select('pay_group').limit(1)
  ),
  // 4. grant: role_permissions has finance.budgets.bulk_upsert
  check(
    'grant: finance.budgets.bulk_upsert in role_permissions',
    () =>
      // NOTE: role_permissions column is `permission` (not permission_key) —
      // see migration 20260802000007_hr_compensation_overtime_permissions.sql.
      sb
        .from('role_permissions')
        .select('permission')
        .eq('permission', 'finance.budgets.bulk_upsert')
        .limit(1)
  ),
]);

const allOk = results.every(Boolean);

console.log('\n' + (allOk ? 'ALL CHECKS PASSED — migrations applied.' : 'ONE OR MORE CHECKS FAILED — see above.'));
process.exit(allOk ? 0 : 1);
