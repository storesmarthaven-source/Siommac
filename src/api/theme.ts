/**
 * src/api/theme.ts
 *
 * App-wide design-system theme persistence via the dedicated `app_theme` table.
 *   • read  — public endpoint (the login screen themes itself too)
 *   • write — superadmin/admin only, audited + app_event server-side
 */

import { authPost, apiPost } from '@lib/api';
import type { ThemeOverrides } from '@ui/theme/applyTheme';
import type { DesignSystemConfigurationV1, DesignSystemDraft, DesignSystemRevision, DesignSystemValidation } from '../../types/designSystem';

/** Read the saved global token overrides (empty/absent → base.css defaults). */
export async function loadThemeTokens(): Promise<ThemeOverrides | null> {
  const res = await authPost<{ success: boolean; data?: { tokens: ThemeOverrides } }>('theme/get', {});
  return res.success && res.data ? res.data.tokens : null;
}

interface StudioState { published: DesignSystemRevision; draft: DesignSystemDraft | null }

export async function loadDesignSystemStudio(): Promise<StudioState> {
  const res = await apiPost<{ success: boolean; data?: StudioState; message?: string }>('theme/studio/get', {});
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to load Design System Studio.');
  return res.data;
}

export async function saveDesignSystemDraft(configuration: DesignSystemConfigurationV1, expectedRevision: number): Promise<DesignSystemDraft> {
  const res = await apiPost<{ success: boolean; data?: { draft: DesignSystemDraft }; message?: string }>('theme/studio/draft/save', { configuration, expectedRevision });
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to save design-system draft.');
  return res.data.draft;
}

export async function validateDesignSystemDraft(configuration: DesignSystemConfigurationV1): Promise<DesignSystemValidation> {
  const res = await apiPost<{ success: boolean; data?: { validation: DesignSystemValidation }; message?: string }>('theme/studio/validate', { configuration });
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to validate design-system draft.');
  return res.data.validation;
}

export async function publishDesignSystemDraft(draftId: string, expectedRevision: number, summary: string): Promise<DesignSystemRevision> {
  const res = await apiPost<{ success: boolean; data?: { published: DesignSystemRevision }; message?: string }>('theme/studio/publish', { draftId, expectedRevision, summary });
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to publish design-system draft.');
  return res.data.published;
}

export async function loadDesignSystemHistory(): Promise<DesignSystemRevision[]> {
  const res = await apiPost<{ success: boolean; data?: { versions: DesignSystemRevision[] }; message?: string }>('theme/studio/history', {});
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to load design-system history.');
  return res.data.versions;
}

export async function rollbackDesignSystem(version: number, summary: string): Promise<DesignSystemRevision> {
  const res = await apiPost<{ success: boolean; data?: { published: DesignSystemRevision }; message?: string }>('theme/studio/rollback', { version, summary });
  if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to roll back design system.');
  return res.data.published;
}
