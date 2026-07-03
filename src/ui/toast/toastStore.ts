import type {
  ToastActionOptions,
  ToastId,
  ToastOptions,
  ToastRecord,
  ToastRichOptions,
  ToastVariant
} from "./toastTypes";

// ── Exit animation window ─────────────────────────────────────────────────────

/** How long the exit animation runs before the record is actually dropped.
 *  Must be >= the CSS exit animation duration (0.4s). 450ms gives a small
 *  buffer so the animationend always fires before the record is pruned. */
export const TOAST_EXIT_MS = 450;

// ── Default durations ─────────────────────────────────────────────────────────

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
  loading: 0
};

// ── Internal store ────────────────────────────────────────────────────────────

type VoidListener = () => void;

let records: ToastRecord[] = [];
let _globalPaused = false;
const listeners = new Set<VoidListener>();

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

function createId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Low-level store operations (used by Toaster + ToastCard) ──────────────────

/** Subscribe to store changes. Returns an unsubscribe function. */
export function subscribe(fn: VoidListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get the current snapshot of all toast records. */
export function getToasts(): ToastRecord[] {
  return records;
}

/** Get the current global-paused state. */
export function getGlobalPaused(): boolean {
  return _globalPaused;
}

/** Pause or resume ALL toast timers globally (hover-expand, tab-hidden). */
export function setGlobalPaused(paused: boolean): void {
  if (_globalPaused === paused) return;
  _globalPaused = paused;
  notifyListeners();
}

/** Insert or patch a toast by id. New id appends; existing id patches. */
export function upsertToast(record: ToastRecord): void {
  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    records = [
      ...records.slice(0, idx),
      { ...records[idx], ...record },
      ...records.slice(idx + 1),
    ];
  } else {
    records = [...records, record];
  }
  notifyListeners();
}

/** Remove one toast by id immediately (no animation), or clear all. */
export function removeToast(id?: string): void {
  if (id === undefined) {
    records = [];
  } else {
    records = records.filter((r) => r.id !== id);
  }
  notifyListeners();
}

/** Patch specific fields on an existing toast. */
export function updateToast(id: string, patch: Partial<ToastRecord>): void {
  records = records.map((r) => (r.id === id ? { ...r, ...patch } : r));
  notifyListeners();
}

/** Animate a toast out, then remove it after TOAST_EXIT_MS.
 *  Sets `exiting: true` so the card plays its exit slide/fade, then drops
 *  the record. Idempotent — a second call while already exiting is a no-op.
 *  This is the single path for ALL per-id dismissals. */
export function dismissToast(id: string): void {
  const rec = records.find((r) => r.id === id);
  if (!rec || rec.exiting) return;
  updateToast(id, { exiting: true });
  setTimeout(() => removeToast(id), TOAST_EXIT_MS);
}

// ── Internal upsert for the public toast() API ────────────────────────────────

function upsertRecord(record: ToastRecord): ToastId {
  const idx = records.findIndex((item) => item.id === record.id);
  if (idx >= 0) {
    // Keep original createdAt when patching an existing id
    records[idx] = { ...records[idx]!, ...record, createdAt: records[idx]!.createdAt };
  } else {
    records = [...records, record];
  }
  notifyListeners();
  return record.id;
}

// ── Core record builder ───────────────────────────────────────────────────────

function buildNormal(message: string, options: ToastOptions = {}): ToastRecord {
  const variant = options.variant ?? "info";
  return {
    id: options.id ?? createId(),
    tier: "normal",
    variant,
    title: options.title ?? message,
    description: options.description,
    duration: options.duration ?? DEFAULT_DURATIONS[variant],
    dismissible: options.dismissible ?? true,
    ariaLive: options.ariaLive ?? (variant === "error" ? "assertive" : "polite"),
    createdAt: Date.now()
  };
}

// ── Public toast() API ────────────────────────────────────────────────────────

function notify(message: string, options: ToastOptions = {}) {
  return upsertRecord(buildNormal(message, options));
}

notify.success = (message: string, options: ToastOptions = {}) =>
  notify(message, { ...options, variant: "success" });

notify.error = (message: string, options: ToastOptions = {}) =>
  notify(message, { ...options, variant: "error" });

notify.warning = (message: string, options: ToastOptions = {}) =>
  notify(message, { ...options, variant: "warning" });

notify.info = (message: string, options: ToastOptions = {}) =>
  notify(message, { ...options, variant: "info" });

notify.loading = (message: string, options: ToastOptions = {}) =>
  notify(message, { ...options, variant: "loading", duration: options.duration ?? 0 });

notify.action = (options: ToastActionOptions) => {
  const variant = options.variant ?? "info";
  return upsertRecord({
    id: options.id ?? createId(),
    tier: "action",
    variant,
    title: options.title,
    description: options.description,
    duration: options.duration ?? DEFAULT_DURATIONS[variant],
    dismissible: options.dismissible ?? true,
    ariaLive: options.ariaLive ?? (variant === "error" ? "assertive" : "polite"),
    createdAt: Date.now(),
    moduleLabel: options.moduleLabel,
    statusLabel: options.statusLabel,
    details: options.details,
    note: options.note,
    actions: options.actions
  });
};

notify.rich = (options: ToastRichOptions) => {
  const variant = options.variant ?? "info";
  return upsertRecord({
    id: options.id ?? createId(),
    tier: "rich",
    variant,
    title: options.title,
    description: options.description,
    duration: options.duration ?? DEFAULT_DURATIONS[variant],
    dismissible: options.dismissible ?? true,
    ariaLive: options.ariaLive ?? (variant === "error" ? "assertive" : "polite"),
    createdAt: Date.now(),
    moduleLabel: options.moduleLabel,
    statusLabel: options.statusLabel,
    details: options.details,
    note: options.note,
    file: options.file,
    actions: options.actions
  });
};

/** Dismiss one toast (animated) or all toasts (immediate). */
notify.dismiss = (id?: ToastId) => {
  if (id === undefined) {
    removeToast();
  } else {
    dismissToast(id);
  }
};

notify.update = (id: ToastId, patch: Partial<ToastRecord>) => {
  updateToast(id, patch);
};

export const toast = notify;
