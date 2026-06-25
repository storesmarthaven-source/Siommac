/**
 * src/api/settingsCatalog.ts
 *
 * TanStack Query hooks for the catalog-driven Settings & Preferences system.
 * All data goes through the authenticated Netlify API (/api/settings). This is
 * the going-forward settings layer; the legacy flat `settings` table lives in
 * settings.ts. Design-independent data layer — UI consumes these hooks.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── Types (mirror the route DTOs) ─────────────────────────────────────────────

export type SettingDataType =
  | 'boolean' | 'number' | 'string' | 'select' | 'multi_select' | 'json' | 'duration' | 'time' | 'array';
export type SettingClass =
  | 'system_security' | 'system_policy' | 'module_policy' | 'safety_rule' | 'workflow_rule'
  | 'notification_rule' | 'message_policy' | 'file_policy' | 'audit_policy'
  | 'personal_preference' | 'ui_preference';
export type SettingScopeType = 'global' | 'module' | 'site' | 'department' | 'role' | 'user';
export type SettingSource = 'user' | 'role' | 'department' | 'site' | 'module' | 'global' | 'default';

/** A setting resolved for the current actor (from /effective). */
export interface EffectiveSetting {
  settingKey: string;
  moduleKey: string;
  label: string;
  description: string;
  dataType: SettingDataType;
  settingClass: SettingClass;
  defaultValue: unknown;
  effectiveValue: unknown;
  effectiveSource: SettingSource;
  effectiveScopeId: string | null;
  allowedValues: unknown[] | null;
  minValue: number | null;
  maxValue: number | null;
  isCritical: boolean;
  isSensitive: boolean;
  isAudited: boolean;
  scope: SettingScopeType[];
  editable: boolean;
}

export interface SettingAuditEntry {
  id: string;
  setting_key: string;
  module_key: string;
  scope_type: string;
  scope_id: string | null;
  previous_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

export interface SetSettingArgs {
  settingKey: string;
  scopeType: SettingScopeType;
  scopeId?: string | null;
  value: unknown;
  reason?: string;
}
export interface ResetSettingArgs {
  settingKey: string;
  scopeType: SettingScopeType;
  scopeId?: string | null;
  reason?: string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const settingsKeys = {
  all: ['settings'] as const,
  effective: (moduleKey: string) => ['settings', 'effective', moduleKey] as const,
  catalog: (moduleKey: string) => ['settings', 'catalog', moduleKey] as const,
  audit: (filter: Record<string, unknown>) => ['settings', 'audit', filter] as const,
};

// ── Query hooks ───────────────────────────────────────────────────────────────

/** Resolved settings for a module, in the current actor's scope. */
export function useEffectiveSettings(moduleKey: string | null, enabled = true) {
  return useQuery({
    queryKey: settingsKeys.effective(moduleKey ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: { moduleKey: string; settings: EffectiveSetting[] } }>('settings/effective', { moduleKey }),
    enabled:  enabled && !!moduleKey,
    staleTime: 30_000,
  });
}

/** Raw catalog rows for a module (admin view). */
export function useSettingsCatalog(moduleKey: string | null) {
  return useQuery({
    queryKey: settingsKeys.catalog(moduleKey ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: Record<string, unknown>[] }>('settings/catalog/list', { moduleKey }),
    enabled:  !!moduleKey,
    staleTime: 60_000,
  });
}

/** Audit history for a setting / module. */
export function useSettingAudit(filter: { settingKey?: string; moduleKey?: string } = {}, enabled = true) {
  return useQuery({
    queryKey: settingsKeys.audit(filter),
    queryFn:  () => apiPost<{ success: boolean; data: SettingAuditEntry[] }>('settings/audit/list', filter),
    enabled,
    staleTime: 15_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

function useInvalidateSettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: settingsKeys.all });
}

/** Write a scoped override (governance enforced server-side). */
export function useSetSetting() {
  const invalidate = useInvalidateSettings();
  return useMutation({
    mutationFn: (args: SetSettingArgs) =>
      apiPost<{ success: boolean; data: unknown; message?: string }>('settings/values/set', args as unknown as Record<string, unknown>, { retryable: false }),
    onSuccess: invalidate,
  });
}

/** Remove an override → fall back to the inherited value. */
export function useResetSetting() {
  const invalidate = useInvalidateSettings();
  return useMutation({
    mutationFn: (args: ResetSettingArgs) =>
      apiPost<{ success: boolean; data: unknown; message?: string }>('settings/values/reset', args as unknown as Record<string, unknown>, { retryable: false }),
    onSuccess: invalidate,
  });
}

/** Rebuild the catalog from code manifests (admin/superadmin). */
export function useSyncSettingsCatalog() {
  const invalidate = useInvalidateSettings();
  return useMutation({
    mutationFn: () => apiPost<{ success: boolean; data: unknown }>('settings/catalog/sync', {}, { retryable: false }),
    onSuccess: invalidate,
  });
}
