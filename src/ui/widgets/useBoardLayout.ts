// src/ui/widgets/useBoardLayout.ts — load/save the widget-library board (instance/zone
// model) for a page. Persists ONLY committed widgets to ui_layout.layout; preview widgets
// are never passed here. Optimistic update so drag/resize/add reflects immediately.
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { getInstanceLayout, saveInstanceLayout, saveInstanceLayoutDefault, resetInstanceLayout } from '@api/layout';
import { toast } from '@store';
import type { BoardLayout, WidgetInstance } from './types';

const emptyLayout = (pageKey: string): BoardLayout => ({ pageKey, zones: {} });

export interface UseBoardLayoutResult {
  layout: BoardLayout;
  isLoading: boolean;
  updateZoneLayout: (zoneId: string, widgets: WidgetInstance[]) => Promise<void>;
  addWidget: (zoneId: string, widget: WidgetInstance) => Promise<void>;
  removeWidget: (zoneId: string, instanceId: string) => Promise<void>;
  /** Admin: save the current layout as the org-wide default for this page. */
  setAsDefault: () => Promise<void>;
  /** Clear this user's override and revert to the org/page default. */
  resetLayout: () => Promise<void>;
}

export function useBoardLayout(pageKey: string, defaultLayout?: BoardLayout): UseBoardLayoutResult {
  const qc = useQueryClient();
  const key = ['ui-instance-layout', pageKey] as const;

  const query = useQuery({
    // A fresh user (no saved layout) falls back to the page's default layout, then empty.
    queryKey: key,
    queryFn: async () => (await getInstanceLayout(pageKey)) ?? defaultLayout ?? emptyLayout(pageKey),
    placeholderData: prev => prev,
  });
  // During the INITIAL load (no data yet), render an EMPTY board — NOT the default layout.
  // Otherwise a user with a saved layout sees the full default board flash in, then collapse
  // to their saved arrangement once the query resolves. Gating on isLoading gives one clean
  // transition (empty → saved/default) instead of that flash. Refetches keep prior data via
  // placeholderData, so this only affects the very first paint.
  const layout = query.data ?? (query.isLoading ? emptyLayout(pageKey) : (defaultLayout ?? emptyLayout(pageKey)));

  const mutation = useMutation({ mutationFn: (next: BoardLayout) => saveInstanceLayout(pageKey, next) });

  async function persist(next: BoardLayout): Promise<void> {
    qc.setQueryData(key, next);                                  // optimistic
    try { await mutation.mutateAsync(next); }
    catch { void qc.invalidateQueries({ queryKey: key }); }      // re-sync on failure
  }

  async function updateZoneLayout(zoneId: string, widgets: WidgetInstance[]): Promise<void> {
    await persist({ ...layout, pageKey, zones: { ...layout.zones, [zoneId]: widgets } });
  }
  async function addWidget(zoneId: string, widget: WidgetInstance): Promise<void> {
    await updateZoneLayout(zoneId, [...(layout.zones[zoneId] ?? []), widget]);
  }
  async function removeWidget(zoneId: string, instanceId: string): Promise<void> {
    await updateZoneLayout(zoneId, (layout.zones[zoneId] ?? []).filter(w => w.instanceId !== instanceId));
  }
  // Save the CURRENT arrangement as the org-wide default. Then clear THIS admin's own
  // override so they immediately SEE the new default take effect (otherwise their personal
  // override masks it and it looks like nothing happened). Surfaces success/failure — no
  // silent swallow.
  async function setAsDefault(): Promise<void> {
    try {
      await saveInstanceLayoutDefault(pageKey, layout);
      await resetInstanceLayout(pageKey);
      await qc.invalidateQueries({ queryKey: key });
      toast.success('Saved as the default layout for this page.');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save the default layout.');
    }
  }
  async function resetLayout(): Promise<void> {
    await resetInstanceLayout(pageKey);
    await qc.invalidateQueries({ queryKey: key });
  }

  return { layout, isLoading: query.isLoading, updateZoneLayout, addWidget, removeWidget, setAsDefault, resetLayout };
}
