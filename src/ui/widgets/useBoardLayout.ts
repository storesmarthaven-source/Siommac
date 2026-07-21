// src/ui/widgets/useBoardLayout.ts — load/save the widget-library board (instance/zone
// model) for a page. Persists ONLY committed widgets to ui_layout.layout; preview widgets
// are never passed here. Optimistic update so drag/resize/add reflects immediately.
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { getInstanceLayout, saveInstanceLayout, saveInstanceLayoutDefault, resetInstanceLayout, type InstanceLayoutResponse } from '@api/layout';
import { toast } from '@store';
import type { BoardLayout, WidgetInstance } from './types';
import { createV3Layout, migrateBoardLayout } from './migration';

const emptyLayout = (pageKey: string): BoardLayout => createV3Layout(pageKey);

// Canonical signature of a layout — widget id + geometry per zone, order-independent — so two
// arrangements that place the same widgets in the same spots compare equal regardless of
// instanceId churn or array order. Used to tell when the current board differs from the org
// default (which gates "Set as default"). Deliberately ignores instanceId/config: promoting a
// default is about WHERE widgets sit, and this errs toward "changed" (safe: a redundant enable,
// never a wrong disable).
function layoutSignature(l: BoardLayout | null | undefined): string {
  if (!l?.zones) return '';
  const { zones } = l;
  return Object.keys(zones).sort().map(zoneId => {
    const items = (zones[zoneId] ?? [])
      .map(w => `${w.widgetId}@${w.x},${w.y},${w.w},${w.h}`)
      .sort();
    return `${zoneId}:${items.join('|')}`;
  }).join(';');
}
const layoutsEqual = (a: BoardLayout | null, b: BoardLayout | null): boolean => layoutSignature(a) === layoutSignature(b);

export interface UseBoardLayoutResult {
  layout: BoardLayout;
  isLoading: boolean;
  /** True when the effective layout differs from the org default — i.e. there is a NEW arrangement
   *  to promote via "Set as default". False when they already match (nothing to save). */
  isDefaultDirty: boolean;
  isDirty: boolean;
  updateZoneLayout: (zoneId: string, widgets: WidgetInstance[]) => Promise<void>;
  addWidget: (zoneId: string, widget: WidgetInstance) => Promise<void>;
  removeWidget: (zoneId: string, instanceId: string) => Promise<void>;
  /** Persist the staged edit transaction. */
  saveLayout: () => Promise<void>;
  /** Discard the staged transaction and restore the server value. */
  cancelLayout: () => Promise<void>;
  /** Admin: save the current layout as the org-wide default for this page. */
  setAsDefault: () => Promise<void>;
  /** Clear this user's override and revert to the org/page default. */
  resetLayout: () => Promise<void>;
}

export function useBoardLayout(pageKey: string, defaultLayout?: BoardLayout): UseBoardLayoutResult {
  const qc = useQueryClient();
  const key = ['ui-instance-layout', pageKey] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => getInstanceLayout(pageKey),
    placeholderData: prev => prev,
  });
  const data = query.data;
  // During the INITIAL load (no data yet) render an EMPTY board — NOT the default layout —
  // otherwise a user with a saved layout sees the full default flash in, then collapse to their
  // saved arrangement. Gating on isLoading gives one clean transition; placeholderData keeps prior
  // data across refetches, so this only affects the very first paint.
  const fallback = migrateBoardLayout(defaultLayout, pageKey) ?? emptyLayout(pageKey);
  const layout: BoardLayout = data?.layout ?? (query.isLoading ? emptyLayout(pageKey) : fallback);
  const orgDefault = data?.orgDefault ?? null;
  // Baseline for "dirty" = the org default if one is set, else the page's code default (what users
  // see when no admin default exists). "Set as default" is meaningful only when the effective
  // layout differs from this baseline.
  const baseline = orgDefault ?? defaultLayout ?? emptyLayout(pageKey);
  const isDefaultDirty = !query.isLoading && !layoutsEqual(layout, baseline);
  const serverLayout = data?.persistedLayout ?? fallback;
  const isDirty = !query.isLoading && JSON.stringify(layout) !== JSON.stringify(serverLayout);

  const mutation = useMutation({ mutationFn: (next: BoardLayout) => saveInstanceLayout(pageKey, next) });

  // Patch only the effective `layout` in the cache, preserving the raw orgDefault we hold.
  function setCachedLayout(next: BoardLayout): void {
    qc.setQueryData<InstanceLayoutResponse>(key, prev => ({ layout: next, orgDefault: prev?.orgDefault ?? orgDefault, persistedLayout: prev?.persistedLayout ?? prev?.layout ?? fallback }));
  }

  function stage(next: BoardLayout): Promise<void> {
    setCachedLayout({ ...next, version: 3, columns: next.columns ?? 12 });
    return Promise.resolve();
  }

  async function updateZoneLayout(zoneId: string, widgets: WidgetInstance[]): Promise<void> {
    await stage({ ...layout, pageKey, zones: { ...layout.zones, [zoneId]: widgets } });
  }
  async function addWidget(zoneId: string, widget: WidgetInstance): Promise<void> {
    await updateZoneLayout(zoneId, [...(layout.zones[zoneId] ?? []), widget]);
  }
  async function removeWidget(zoneId: string, instanceId: string): Promise<void> {
    await updateZoneLayout(zoneId, (layout.zones[zoneId] ?? []).filter(w => w.instanceId !== instanceId));
  }
  async function saveLayout(): Promise<void> {
    try {
      await mutation.mutateAsync(layout);
      qc.setQueryData<InstanceLayoutResponse>(key, prev => ({ layout, orgDefault: prev?.orgDefault ?? orgDefault, persistedLayout: layout }));
      toast.success('Widget layout saved.');
    }
    catch (e) { toast.error((e as Error).message || 'Failed to save widget layout.'); throw e; }
  }
  function cancelLayout(): Promise<void> {
    qc.setQueryData<InstanceLayoutResponse>(key, prev => ({
      layout: prev?.persistedLayout ?? fallback,
      orgDefault: prev?.orgDefault ?? orgDefault,
      persistedLayout: prev?.persistedLayout ?? fallback,
    }));
    return Promise.resolve();
  }
  // Save the CURRENT arrangement as the org-wide default. Then clear THIS admin's own override so
  // they immediately SEE the new default take effect (otherwise their override masks it and it
  // looks like nothing happened). The success toast carries an Undo that restores the PREVIOUS
  // default — offered only when one existed (there is no "delete default" path, so a first-ever
  // default can't be undone this way). Surfaces success/failure — no silent swallow.
  async function setAsDefault(): Promise<void> {
    const prevDefault = orgDefault;
    const promoted = layout;
    try {
      await saveInstanceLayoutDefault(pageKey, promoted);
      await resetInstanceLayout(pageKey);
      qc.setQueryData<InstanceLayoutResponse>(key, { layout: promoted, orgDefault: promoted });
      // Refresh in the background — the writes are committed, so surface the toast NOW
      // instead of holding it hostage to another fetch round trip.
      void qc.invalidateQueries({ queryKey: key });
      if (prevDefault) {
        toast.action({
          variant: 'success',
          duration: 8000,
          title: 'Saved as the default layout for this page.',
          actions: [{
            label: 'Undo', tone: 'secondary',
            onClick: async () => {
              try {
                await saveInstanceLayoutDefault(pageKey, prevDefault);
                void qc.invalidateQueries({ queryKey: key });
                toast.success('Previous default layout restored.');
              } catch (e) { toast.error((e as Error).message || 'Failed to restore the default.'); }
            },
          }],
        });
      } else {
        toast.success('Saved as the default layout for this page.');
      }
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save the default layout.');
    }
  }
  async function resetLayout(): Promise<void> {
    await resetInstanceLayout(pageKey);
    await qc.invalidateQueries({ queryKey: key });
  }

  return { layout, isLoading: query.isLoading, isDefaultDirty, isDirty, updateZoneLayout, addWidget, removeWidget, saveLayout, cancelLayout, setAsDefault, resetLayout };
}
