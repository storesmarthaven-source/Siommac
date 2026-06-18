/**
 * src/lib/navVisibility.ts
 *
 * Generic, namespaced visibility store for collapsible nav sub-items.
 *
 * A module (PPE, Documents, …) registers a set of sub-items, each with a stable
 * id and a `defaultVisible` flag. The superadmin can then show/hide individual
 * items; the choice is persisted per browser in localStorage and broadcast to
 * subscribers (the sidebar rebuilds, the customizer re-renders).
 *
 * This is intentionally backend-agnostic: today it persists to localStorage; to
 * move it server-side later, swap `load`/`save` for an API call — the public
 * surface (getVisible / setVisible / toggle / subscribe / resolveVisible) stays
 * the same.
 */

export interface VisibilityItem {
  id:             string;
  defaultVisible: boolean;
}

type Listener = (ns: string) => void;

const STORAGE_PREFIX = 'siomac_nav_vis_';
const listeners = new Set<Listener>();

/** Persisted override map for a namespace: id → visible (absent = use default). */
type OverrideMap = Record<string, boolean>;

function storageKey(ns: string): string {
  return STORAGE_PREFIX + ns;
}

function load(ns: string): OverrideMap {
  try {
    const raw = localStorage.getItem(storageKey(ns));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as OverrideMap) : {};
  } catch {
    return {};
  }
}

function save(ns: string, map: OverrideMap): void {
  try { localStorage.setItem(storageKey(ns), JSON.stringify(map)); } catch (_) {}
}

function emit(ns: string): void {
  for (const fn of listeners) {
    try { fn(ns); } catch (_) { /* listener errors must not break others */ }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Subscribe to visibility changes (any namespace). Returns an unsubscribe fn. */
export function subscribeVisibility(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether a single item id is currently visible, honouring its default. */
export function isVisible(ns: string, items: readonly VisibilityItem[], id: string): boolean {
  const overrides = load(ns);
  if (id in overrides) return overrides[id]!;
  return items.find(i => i.id === id)?.defaultVisible ?? true;
}

/** The set of currently-visible item ids for a namespace, in registry order. */
export function resolveVisible(ns: string, items: readonly VisibilityItem[]): string[] {
  const overrides = load(ns);
  return items
    .filter(i => (i.id in overrides ? overrides[i.id]! : i.defaultVisible))
    .map(i => i.id);
}

/** Explicitly set an item's visibility and notify subscribers. */
export function setVisible(ns: string, id: string, visible: boolean): void {
  const map = load(ns);
  map[id] = visible;
  save(ns, map);
  emit(ns);
}

/** Toggle one item relative to its current effective visibility. */
export function toggleVisible(ns: string, items: readonly VisibilityItem[], id: string): void {
  setVisible(ns, id, !isVisible(ns, items, id));
}

/** Reset a namespace back to registry defaults. */
export function resetVisibility(ns: string): void {
  try { localStorage.removeItem(storageKey(ns)); } catch (_) {}
  emit(ns);
}
