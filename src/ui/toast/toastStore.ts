/**
 * src/ui/toast/toastStore.ts
 *
 * Framework-free toast store: subscribe/getToasts/upsert/remove/update.
 * Callable from components, hooks, stores, and plain modules.
 */

import type { ToastRecord } from './toastTypes';

type Listener = () => void;

/** How long the exit animation runs before the record is actually dropped.
 *  Must be >= the CSS transition duration on `.toast-card` (see toast.css). */
export const TOAST_EXIT_MS = 260;

let records: ToastRecord[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts(): ToastRecord[] {
  return records;
}

/** Insert or patch a toast by id. New id appends; existing id patches. */
export function upsertToast(toast: ToastRecord): void {
  const idx = records.findIndex((r) => r.id === toast.id);
  if (idx >= 0) {
    records = [
      ...records.slice(0, idx),
      { ...records[idx], ...toast },
      ...records.slice(idx + 1),
    ];
  } else {
    records = [...records, toast];
  }
  notify();
}

/** Remove one toast by id, or clear all when id is omitted. Immediate — no
 *  exit animation. Prefer `dismissToast` for user/programmatic dismissals so
 *  the card animates out first. */
export function removeToast(id?: string): void {
  if (id === undefined) {
    records = [];
  } else {
    records = records.filter((r) => r.id !== id);
  }
  notify();
}

/** Animate a toast out, then remove it. Flips `exiting` so the card plays its
 *  slide + height-collapse, then drops the record after `TOAST_EXIT_MS`.
 *  Idempotent — a second call while already exiting is a no-op. This is the
 *  single path for ALL dismissals (timer, Esc, close, action, swipe, API). */
export function dismissToast(id: string): void {
  const rec = records.find((r) => r.id === id);
  if (!rec || rec.exiting) return;
  updateToast(id, { exiting: true });
  setTimeout(() => removeToast(id), TOAST_EXIT_MS);
}

/** Patch specific fields on an existing toast. */
export function updateToast(id: string, patch: Partial<ToastRecord>): void {
  records = records.map((r) => (r.id === id ? { ...r, ...patch } : r));
  notify();
}
