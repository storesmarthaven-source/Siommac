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

// ── Widget board geometry (gridstack) — see docs/WIDGET_BOARD_SPEC.md ─────────────

export interface BoardItem { id: string; x: number; y: number; w: number; h: number; }

export interface BoardLayoutResponse {
  default:  BoardItem[] | null;
  override: BoardItem[] | null;
}

/** Read a board page's geometry (org default + this user's override). Reuses
 *  layout/get; the jsonb card_order holds the BoardItem[] for board pages. */
export async function getBoardLayout(pageKey: string): Promise<BoardLayoutResponse> {
  const res = await apiPost<{ success: boolean; data?: { default: unknown; override: unknown } }>('layout/get', { pageKey });
  const asBoard = (v: unknown): BoardItem[] | null =>
    Array.isArray(v) && v.every(o => o && typeof o === 'object' && 'id' in (o as object)) ? (v as BoardItem[]) : null;
  return { default: asBoard(res.data?.default), override: asBoard(res.data?.override) };
}

export async function saveBoardOverride(pageKey: string, board: BoardItem[]): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveBoardOverride', { pageKey, board });
  if (!res.success) throw new Error(res.message ?? 'Failed to save board layout.');
}

export async function saveBoardDefault(pageKey: string, board: BoardItem[]): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('layout/saveBoardDefault', { pageKey, board });
  if (!res.success) throw new Error(res.message ?? 'Failed to save default board layout.');
}
