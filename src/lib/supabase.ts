/**
 * src/lib/supabase.ts
 *
 * Singleton Supabase client for the frontend.
 *
 * This is the ONLY place the Supabase client is instantiated — import `supabase`
 * from here everywhere else. Using the npm package (not the CDN global) ensures:
 *   ✓ Full TypeScript types (PostgrestFilterBuilder, RealtimeChannel, etc.)
 *   ✓ Tree-shaking — only the modules you import are bundled
 *   ✓ No dependency on window.supabase (CDN) being loaded first
 *
 * Auth note:
 *   Siomac uses its own JWT auth layer (not Supabase Auth). The client is
 *   initialised with the anon key for database access + Realtime subscriptions.
 *   Row Level Security is enforced server-side; the frontend does not pass a
 *   Supabase Auth session.
 *
 * @see docs/ARCHITECTURE.md §Supabase
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { createClient }  from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@cfg';

/**
 * Supabase client singleton.
 *
 * NOTE ON TYPING:
 *   The Supabase SDK's Database generic requires CLI-generated types that include
 *   relationship metadata (Relationships field). Until `npm run gen:types` is
 *   wired to the Supabase project, we use the untyped client and apply Zod
 *   validation at the API function boundary instead. This gives us runtime safety
 *   without fighting the complex generic constraints.
 *
 *   Once `supabase gen types typescript` is run, replace this with:
 *     import type { Database } from '../../types/supabase-generated';
 *     export const supabase = createClient<Database>(...);
 *
 * Run `npm run gen:types` after wiring the Supabase CLI to regenerate.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // We manage auth ourselves — disable Supabase Auth session persistence
    persistSession:       false,
    autoRefreshToken:     false,
    detectSessionInUrl:   false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
