import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const sb: SupabaseClient = createClient(
  SUPABASE_URL              ?? 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY ?? 'missing',
  { auth: { persistSession: false } },
);
