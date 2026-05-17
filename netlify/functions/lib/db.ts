import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * sb — service-role client.
 * Bypasses RLS. Use ONLY for:
 *   - writes (insert / update / delete)
 *   - admin-scoped reads that must see all rows
 *   - storage operations (signed URLs, uploads)
 * Never use for public / unauthenticated read paths.
 */
export const sb: SupabaseClient = createClient(
  SUPABASE_URL              ?? 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY ?? 'missing',
  { auth: { persistSession: false } },
);

/**
 * sbAnon — anon-key client.
 * Respects RLS policies. Use for:
 *   - public reads (settings, ping)
 *   - any query that should be scoped by RLS
 * Falls back to sb if SUPABASE_ANON_KEY is not configured.
 */
export const sbAnon: SupabaseClient = SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL ?? 'http://localhost', SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })
  : sb; // graceful fallback during migration
