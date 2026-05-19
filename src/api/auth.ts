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

import { supabase }                  from '@lib/supabase';
import { logger }                    from '@lib/logger';
import { PermissionOverrideSchema }  from './schemas/auth';
import type { PermissionOverride }   from './schemas/auth';

// ── Permission overrides ──────────────────────────────────────────────────────

/**
 * Load all per-user permission overrides for a given user.
 * Called once at login; cached in the session store for the session lifetime.
 *
 * Returns an empty array (not an error) if the table doesn't exist yet —
 * allows the app to run before the migration has been applied.
 */
export async function loadPermissionOverrides(
  userId: string,
  signal?: AbortSignal,
): Promise<PermissionOverride[]> {
  let query = supabase
    .from('user_permissions')
    .select('user_id, permission, granted, set_by, set_at')
    .eq('user_id', userId);

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    // Table may not exist yet (before migration) — log a warning, not an error
    if (error.code === '42P01') {
      logger.warn('[api/auth] user_permissions table does not exist — using role defaults');
      return [];
    }
    logger.error('[api/auth] loadPermissionOverrides failed', { userId, error });
    // Degrade gracefully — return empty (fall back to role defaults)
    return [];
  }

  // Validate each row through Zod; skip malformed rows
  const overrides: PermissionOverride[] = [];
  for (const row of data ?? []) {
    const parsed = PermissionOverrideSchema.safeParse(row);
    if (parsed.success) {
      overrides.push(parsed.data);
    } else {
      logger.warn('[api/auth] Malformed permission override row skipped', {
        row,
        issues: parsed.error.issues,
      });
    }
  }

  return overrides;
}

/**
 * Set a per-user permission override (superadmin only).
 * The UI should call `can('permissions.manage')` before showing the controls.
 */
export async function setPermissionOverride(
  override: Omit<PermissionOverride, 'set_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('user_permissions')
    .upsert({
      user_id:    override.user_id,
      permission: override.permission,
      granted:    override.granted,
      set_by:     override.set_by,
      set_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,permission' });

  if (error) {
    logger.error('[api/auth] setPermissionOverride failed', { override, error });
    throw new Error(error.message);
  }
}

/**
 * Remove a per-user permission override — restores the role default.
 */
export async function removePermissionOverride(
  userId:     string,
  permission: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('permission', permission);

  if (error) {
    logger.error('[api/auth] removePermissionOverride failed', { userId, permission, error });
    throw new Error(error.message);
  }
}

/**
 * List all permission overrides for all users (superadmin management UI).
 */
export async function listAllPermissionOverrides(
  signal?: AbortSignal,
): Promise<PermissionOverride[]> {
  let query = supabase
    .from('user_permissions')
    .select('user_id, permission, granted, set_by, set_at')
    .order('user_id')
    .order('permission');

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/auth] listAllPermissionOverrides failed', { error });
    throw new Error(error.message);
  }

  return (data ?? []).flatMap((row) => {
    const parsed = PermissionOverrideSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
