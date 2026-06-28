/**
 * src/api/layout.ts
 *
 * Module-page card ordering, persisted in the `ui_layout` table:
 *   • an org-wide default (admin-set) and an optional per-user override
 *   • effective order = user override ?? org default ?? page-supplied default
 */

import { apiPost } from '@lib/api';
import type { BoardLayout } from '../ui/widgets/types';

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

// ── Widget-library board layout (instance/zone model) — ui_layout.layout jsonb ─────

/** Read the widget-library board layout (effective: user override ?? org default). */
export async function getInstanceLayout(pageKey: string): Promise<BoardLayout | null> {
  const res = await apiPost<{ success: boolean; message?: string; data?: { layout: BoardLayout | null } }>('layout/getInstanceLayout', { pageKey });
  if (!res.success) throw new Error(res.message ?? 'Failed to load board layout.');
  return res.data?.layout ?? null;
}

/** Save the calling user's widget-library board layout for this page. */
export async function saveInstanceLayout(pageKey: string, layout: BoardLayout): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveInstanceLayout', { pageKey, layout });
  if (!res.success) throw new Error(res.message ?? 'Failed to save board layout.');
}

/** Admin-only: save the current layout as the org-wide default for this page. */
export async function saveInstanceLayoutDefault(pageKey: string, layout: BoardLayout): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveInstanceLayoutDefault', { pageKey, layout });
  if (!res.success) throw new Error(res.message ?? 'Failed to save default board layout.');
}

/** Clear the calling user's board override for this page (revert to org/page default). */
export async function resetInstanceLayout(pageKey: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/resetInstanceLayout', { pageKey });
  if (!res.success) throw new Error(res.message ?? 'Failed to reset board layout.');
}
