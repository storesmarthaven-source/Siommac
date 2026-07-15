/**
 * src/api/auth.ts
 *
 * Supabase queries for the auth / permissions domain.
 *
 * Separated from src/lib/auth.ts to keep the API layer (Supabase queries)
 * distinct from the service layer (business logic + store updates).
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import { apiPost }                   from '@lib/api';
import { logger }                    from '@lib/logger';
import { PermissionOverrideSchema }  from './schemas/auth';
import type { PermissionOverride }   from './schemas/auth';

// ── Permission overrides ──────────────────────────────────────────────────────

/**
 * Load the CURRENT authenticated user's per-user permission overrides via the backend.
 * Called once at login; cached in the session store for the session lifetime.
 *
 * The `user_permissions` table is DENY-ALL to the browser (anon/authenticated) — it was
 * previously anon-enumerable (review finding #4), exposing every user's allow/deny
 * exceptions and user ids. Reads now go through the authenticated Netlify API, which
 * resolves the caller from the JWT and returns ONLY their own overrides. Returns [] on any
 * failure (incl. table-absent pre-migration) so the app falls back to role defaults.
 */
export async function loadPermissionOverrides(): Promise<PermissionOverride[]> {
  const res = await apiPost<{ success: boolean; data?: unknown; message?: string }>('getMyPermissionOverrides', {})
    .catch((err: unknown) => {
      logger.warn('[api/auth] loadPermissionOverrides request failed — using role defaults', { err });
      return { success: false } as { success: boolean; data?: unknown };
    });
  if (!res.success || !Array.isArray(res.data)) return [];

  const overrides: PermissionOverride[] = [];
  for (const row of res.data) {
    const parsed = PermissionOverrideSchema.safeParse(row);
    if (parsed.success) overrides.push(parsed.data);
    else logger.warn('[api/auth] Malformed permission override row skipped', { row, issues: parsed.error.issues });
  }
  return overrides;
}

// Per-user override WRITES (set / remove) and the cross-user LIST are superadmin operations
// that go through the gated backend RBAC routes (routes/superadmin.ts, 'permissions.manage'),
// NEVER the browser Supabase client — user_permissions is deny-all. The old direct
// setPermissionOverride / removePermissionOverride / listAllPermissionOverrides helpers had
// no callers and are removed so no browser write/enumerate path exists.
