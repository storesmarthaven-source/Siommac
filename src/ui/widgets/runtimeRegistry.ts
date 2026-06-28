/**
 * src/ui/widgets/runtimeRegistry.ts
 *
 * Holds the widgets installed at RUNTIME (declarative packages from ui_widget_packages),
 * adapted into WidgetDefs. The static code registry (registry.ts) reads these alongside the
 * code widgets so installed widgets resolve everywhere (library catalogue + board renderer).
 *
 * A version counter + subscription lets the library and board re-render when the installed
 * set changes (after an install/uninstall, or the initial DB load). `useInstalledWidgetPackages`
 * fetches the packages and populates the store.
 */
import { useEffect, useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/preact-query';
import { listInstalledPackages } from '@api/widgets';
import type { WidgetDef } from './types';
import { declarativeToWidgetDef } from './declarative/declarativeToWidgetDef';

let runtimeWidgets: WidgetDef[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function setRuntimeWidgets(defs: WidgetDef[]): void {
  // De-dup by id (belt to the backend's install-time collision check): keep the first, drop later
  // duplicates so a colliding package can't make resolution non-deterministic. Code widgets always
  // win regardless (registry.ts resolves code before runtime).
  const seen = new Set<string>();
  const deduped: WidgetDef[] = [];
  for (const d of defs) {
    if (seen.has(d.id)) { if (import.meta.env.DEV) console.warn(`[widgets] duplicate installed widget id "${d.id}" — ignored.`); continue; }
    seen.add(d.id);
    deduped.push(d);
  }
  runtimeWidgets = deduped;
  version += 1;
  for (const fn of listeners) fn();
}

export function getRuntimeWidgets(): WidgetDef[] {
  return runtimeWidgets;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Reactive: re-renders the caller whenever the installed widget set changes. */
export function useRuntimeWidgetsVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => subscribe(() => setV(version)), []);
  return v;
}

export const WIDGET_PACKAGES_KEY = ['ui-widget-packages'] as const;

/**
 * Fetch installed packages and populate the runtime store. Call this where boards/library
 * render (the board host) so installed widgets resolve. Returns the query for status.
 */
export function useInstalledWidgetPackages() {
  const query = useQuery({
    queryKey: WIDGET_PACKAGES_KEY,
    queryFn: listInstalledPackages,
    staleTime: 60_000,
    retry: false, // endpoint may not be deployed yet (stale dist) — fail quietly, board still works
  });
  useEffect(() => {
    if (!query.data) return;
    setRuntimeWidgets(query.data.flatMap(pkg => pkg.widgets.map(declarativeToWidgetDef)));
  }, [query.data]);
  return query;
}

/** Invalidate the packages query (call after install/uninstall) → refetch repopulates the store. */
export function useRefreshInstalledPackages(): () => void {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: WIDGET_PACKAGES_KEY }); };
}
