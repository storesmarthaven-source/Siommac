import type { Design } from '@payslip/types';
import type { SavedRef } from '@payslip/state/reducer';
import { apiPost } from '@lib/api';

/**
 * Studio editor state (autosave draft + open-ref) persisted to the DB per user
 * via the authenticated finance routes — NOTHING is browser-only. Draft saves are
 * fire-and-forget and coalesced (the caller, useAutosave, already debounces), so a
 * burst of edits collapses to a single in-flight request with the latest design.
 */

async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(
    `finance/payroll/payslip-templates/editor-state/${op}`,
    args,
  );
  if (!res.success) throw new Error(res.message ?? `editor-state "${op}" failed.`);
  return res.data;
}

function isDesign(d: unknown): d is Design {
  return !!d && Array.isArray((d as Design).elements) && !!(d as Design).page;
}
function isRef(r: unknown): r is SavedRef {
  return !!r && typeof (r as SavedRef).id === 'string' && (r as SavedRef).id.length > 0;
}

export interface EditorState { draftDesign: Design | null; openRef: SavedRef | null }

/** Load the per-user draft + open-ref. Degrades to empty on any error so the
 *  studio still opens (e.g. before the operator applies the table migration). */
export async function loadEditorState(): Promise<EditorState> {
  try {
    const res = await call<{ draftDesign: unknown; openRef: unknown }>('get');
    return {
      draftDesign: isDesign(res.draftDesign) ? res.draftDesign : null,
      openRef: isRef(res.openRef) ? res.openRef : null,
    };
  } catch {
    return { draftDesign: null, openRef: null };
  }
}

// ── Draft autosave — coalesced fire-and-forget ──────────────────────────────────
let inFlight = false;
let pending: Design | null = null;

async function flushDraft(): Promise<void> {
  if (pending === null) return;
  inFlight = true;
  const design = pending;
  pending = null;
  try { await call('save', { draftDesign: design }); } catch { /* scratch state — ignore */ }
  inFlight = false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pending can be reassigned by saveDraft() during the await; TypeScript doesn't track cross-function mutation across await
  if (pending !== null) void flushDraft();
}

/** Persist the working draft (debounced by the caller; coalesced here). */
export function saveDraft(design: Design): void {
  pending = design;
  if (!inFlight) void flushDraft();
}

/** Persist which saved design is currently open (or null when detached). */
export function saveOpenRef(ref: SavedRef | null): void {
  void call('save', { openRef: ref }).catch(() => { /* ignore */ });
}
