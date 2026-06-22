/**
 * src/api/layout.ts
 *
 * Module-page card ordering, persisted in the `ui_layout` table:
 *   • an org-wide default (admin-set) and an optional per-user override
 *   • effective order = user override ?? org default ?? page-supplied default
 */

import { apiPost } from '@lib/api';

export interface LayoutResponse {
  /** Org-wide default order (admin-set), or null if none. */
  default:  string[] | null;
  /** The calling user's personal override, or null if none. */
  override: string[] | null;
}

export async function getLayout(pageKey: string): Promise<LayoutResponse> {
  const res = await apiPost<{ success: boolean; data?: LayoutResponse }>('layout/get', { pageKey });
  return res.data ?? { default: null, override: null };
}

/** Save the calling user's personal order for this page. */
export async function saveLayoutOverride(pageKey: string, order: string[]): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveOverride', { pageKey, order });
  if (!res.success) throw new Error(res.message ?? 'Failed to save layout.');
}

/** Save the org-wide default order (admin only — enforced server-side). */
export async function saveLayoutDefault(pageKey: string, order: string[]): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveDefault', { pageKey, order });
  if (!res.success) throw new Error(res.message ?? 'Failed to save default layout.');
}

/** Clear the calling user's personal override (revert to the org/page default). */
export async function resetLayoutOverride(pageKey: string): Promise<void> {
  await apiPost('layout/resetOverride', { pageKey });
}
