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
  | 'boolean' | 'number' | 'string' | 'text' | 'select' | 'multi_select' | 'json' | 'duration' | 'time' | 'array';
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

// ── My Preferences (own personal + UI preferences) ──────────────────────────────

/** The current actor's own personal/ui preferences, resolved at their user scope. */
export function useMyPreferences(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'my-preferences'] as const,
    queryFn:  () => apiPost<{ success: boolean; data: EffectiveSetting[] }>('settings/my-preferences', {}),
    enabled,
    staleTime: 30_000,
  });
}

/** Every critical setting across modules (Governance ▸ Critical), global scope. */
export function useCriticalSettings(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'critical'] as const,
    queryFn:  () => apiPost<{ success: boolean; data: EffectiveSetting[] }>('settings/critical', {}),
    enabled,
    staleTime: 30_000,
  });
}

// ── Manifest review (governance workflow) ───────────────────────────────────────

export type ManifestReviewStatus = 'draft' | 'pending_review' | 'approved' | 'returned' | 'deprecated';
export type ReviewerRole = 'product_owner' | 'module_owner' | 'engineering' | 'super_admin' | 'compliance' | 'hse' | 'security';
export type ReviewDecision = 'approved' | 'returned' | 'not_required';

export interface ManifestRow {
  id: string;
  module_key: string;
  module_label: string;
  module_category: string | null;
  review_status: ManifestReviewStatus;
  manifest_version: number | string | null;
  has_settings: boolean;
  settings_count: number;
  critical_settings_count: number;
  user_preferences_count: number;
  requires_security_review: boolean;
  requires_compliance_review: boolean;
  requires_hse_review: boolean;
  returned_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reviewed_by_product: boolean;
  reviewed_by_module_owner: boolean;
  reviewed_by_engineering: boolean;
  reviewed_by_super_admin: boolean;
  reviewed_by_compliance: boolean;
  reviewed_by_hse: boolean;
  reviewed_by_security: boolean;
}
export interface ManifestSection { id: string; manifest_id: string; section_key: string; applies: boolean; }
export interface ManifestApproval {
  id: string; manifest_id: string; reviewer_role: string; reviewer_id: string;
  decision: string; comment: string | null; reviewed_at: string;
}

export const manifestKeys = {
  all:  ['settings', 'manifests'] as const,
  list: (status?: string) => ['settings', 'manifests', 'list', status ?? 'all'] as const,
  get:  (moduleKey: string) => ['settings', 'manifests', 'get', moduleKey] as const,
};

export function useManifestsList(reviewStatus?: string) {
  return useQuery({
    queryKey: manifestKeys.list(reviewStatus),
    queryFn:  () => apiPost<{ success: boolean; data: ManifestRow[] }>('settings/manifests/list', reviewStatus ? { reviewStatus } : {}),
    staleTime: 30_000,
  });
}

export function useManifest(moduleKey: string | null) {
  return useQuery({
    queryKey: manifestKeys.get(moduleKey ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: { manifest: ManifestRow; sections: ManifestSection[]; approvals: ManifestApproval[] } }>('settings/manifests/get', { moduleKey }),
    enabled:  !!moduleKey,
    staleTime: 15_000,
  });
}

export interface ManifestActionArgs {
  action: 'submit' | 'approve' | 'return' | 'deprecate' | 'review';
  moduleKey: string;
  reason?: string;                 // return
  reviewerRole?: ReviewerRole;     // review
  decision?: ReviewDecision;       // review
  comment?: string;                // review
}

/** One mutation for every manifest lifecycle action (submit/approve/return/deprecate/review). */
export function useManifestAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...rest }: ManifestActionArgs) =>
      apiPost<{ success: boolean; data: unknown; message?: string }>(`settings/manifests/${action}`, rest as unknown as Record<string, unknown>, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: manifestKeys.all }),
  });
}
