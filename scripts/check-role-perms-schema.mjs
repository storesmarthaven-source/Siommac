// Inspect role_permissions table columns and a sample row
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Grab a sample row so we can see the actual column names
const { data, error } = await sb.from('role_permissions').select('*').limit(3);
if (error) {
  console.log('ERROR fetching role_permissions:', error.message);
} else {
  console.log('Sample rows:', JSON.stringify(data, null, 2));
}

// Also check for the specific permission via ilike
const { data: d2, error: e2 } = await sb.from('role_permissions').select('*').ilike('permission', '%budgets.bulk_upsert%').limit(5);
if (e2) {
  // try "action" column
  const { data: d3, error: e3 } = await sb.from('role_permissions').select('*').ilike('action', '%budgets%').limit(5);
  console.log('action search:', JSON.stringify(d3), e3?.message);
} else {
  console.log('permission search:', JSON.stringify(d2, null, 2));
}
