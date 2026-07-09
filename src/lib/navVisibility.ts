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
const ORDER_PREFIX   = 'siomac_nav_order_';
const listeners = new Set<Listener>();

/** Persisted override map for a namespace: id → visible (absent = use default). */
type OverrideMap = Record<string, boolean>;

function storageKey(ns: string): string {
  return STORAGE_PREFIX + ns;
}

function orderKey(ns: string): string {
  return ORDER_PREFIX + ns;
}

/** Persisted custom order (id list) for a namespace; absent = registry order. */
function loadOrder(ns: string): string[] {
  try {
    const raw = localStorage.getItem(orderKey(ns));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function saveOrder(ns: string, ids: string[]): void {
  try { localStorage.setItem(orderKey(ns), JSON.stringify(ids)); } catch (_) {}
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

// ── Ordering ───────────────────────────────────────────────────────────────────
// Persisted custom order for a namespace, applied on top of the registry order.
// New items (added after the user saved an order) are appended in registry order,
// so the sidebar never silently drops a freshly-added section.

/** Return items reordered by the saved custom order; unsaved → registry order. */
export function resolveOrder<T extends VisibilityItem>(ns: string, items: readonly T[]): T[] {
  const saved = loadOrder(ns);
  if (saved.length === 0) return items.slice();
  const byId = new Map(items.map(i => [i.id, i]));
  const out: T[] = [];
  for (const id of saved) {
    const it = byId.get(id);
    if (it) { out.push(it); byId.delete(id); }
  }
  // Append any items not present in the saved order (newly-added), registry order.
  for (const it of items) if (byId.has(it.id)) out.push(it);
  return out;
}

/** Persist a custom order (full id list) for a namespace and notify subscribers. */
export function setOrder(ns: string, ids: readonly string[]): void {
  saveOrder(ns, ids.slice());
  emit(ns);
}

/** Reset a namespace back to registry defaults (both visibility AND order). */
export function resetVisibility(ns: string): void {
  try { localStorage.removeItem(storageKey(ns)); } catch (_) {}
  try { localStorage.removeItem(orderKey(ns)); } catch (_) {}
  emit(ns);
}
