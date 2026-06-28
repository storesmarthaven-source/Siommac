/**
 * src/ui/widgets/WidgetBoardZone.tsx
 *
 * One gridstack grid for a board zone, on the instance/zone model. Uses our PROVEN
 * gridstack↔Preact bridge (GridStack.renderCB + grid.load + Preact render() into each
 * content element; constant container class; renderCB cleared on unmount) — NOT
 * Preact-rendered grid children, which fights gridstack's DOM ownership.
 *
 * Interactivity is PER-ITEM, not grid-wide: a committed widget is draggable/resizable only
 * in edit mode; the ephemeral preview is ALWAYS interactive (so previewing one widget never
 * unlocks the rest). The preview is NEVER persisted — drag/resize updates parent state only.
 */
import 'gridstack/dist/gridstack.min.css';
import './widgetBoard.css';
import { type VNode, render } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { QueryClientProvider, useQueryClient } from '@tanstack/preact-query';
import { GridStack, type GridStackWidget } from 'gridstack';
import { useBoardLayout } from './useBoardLayout';
import { findWidgetDef } from './registry';
import { useRuntimeWidgetsVersion } from './runtimeRegistry';
import { WidgetFrame } from './WidgetFrame';
import { isPreviewWidget, type BoardLayout, type BoardWidgetInstance, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance } from './types';

export interface WidgetBoardZoneProps {
  pageKey: string;
  zoneId: string;
  editing?: boolean;
  /** Page-local widget renderers (e.g. the employee register) keyed by widgetId. */
  localWidgets?: LocalWidgetMap;
  /** Used when the user has no saved layout for this page. */
  defaultLayout?: BoardLayout;
  /** Demo mode — registry widgets render their static sample instead of live data. */
  demo?: boolean;
  /** True once the installed-package list has loaded — gates pruning of orphaned (uninstalled) widgets. */
  registryReady?: boolean;
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
}

// A widget is interactive (movable/resizable) only as a preview, or when the board is editing.
const itemInteractive = (item: BoardWidgetInstance, editing?: boolean): boolean => isPreviewWidget(item) || !!editing;

// allowedSizes are quick-pick PRESETS (size selector) — they do NOT cap board resizing.
// On the board a widget resizes FREELY in a generous range and its content adapts (declarative
// cards scale-to-fit, framed widgets reflow). A small floor keeps it usable; the ceiling is the
// full board width and a tall max. A widget may declare a tighter floor via its smallest preset.
function gridNode(item: BoardWidgetInstance, editing?: boolean): GridStackWidget {
  const ws = findWidgetDef(item.widgetId)?.allowedSizes ?? [];
  const minPresetW = ws.length ? Math.min(...ws.map(s => s.grid.w)) : 2;
  const minPresetH = ws.length ? Math.min(...ws.map(s => s.grid.h)) : 2;
  const inter = itemInteractive(item, editing);
  return {
    id: item.instanceId, x: item.x, y: item.y, w: item.w, h: item.h,
    minW: Math.max(1, Math.min(2, minPresetW)), maxW: 12,
    minH: Math.max(1, Math.min(2, minPresetH)), maxH: 16,
    autoPosition: item.x === 0 && item.y === 0,
    noMove: !inter, noResize: !inter,
  };
}

export function WidgetBoardZone({ pageKey, zoneId, editing, localWidgets, defaultLayout, demo, registryReady, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardZoneProps): VNode {
  // Each island is rendered into a gridstack cell via a DETACHED render() root, which does
  // NOT inherit the app's context — so re-provide the SAME QueryClient (shared cache) at
  // every island root, else reuse-hooks widgets throw "No QueryClient set".
  const qc = useQueryClient();
  // Re-render when installed (declarative) widgets change so islands resolve them.
  const rtVersion = useRuntimeWidgetsVersion();
  const { layout, updateZoneLayout, removeWidget } = useBoardLayout(pageKey, defaultLayout);
  // A widget resolves if it's a page-local renderer OR in the registry (code + installed runtime).
  // Instances that no longer resolve (their package was uninstalled) are ORPHANS: never render them,
  // and prune them from the saved layout once the registry is authoritative (see the effect below).
  const canResolve = (widgetId: string): boolean => !!localWidgets?.[widgetId] || !!findWidgetDef(widgetId);
  const rawCommitted = layout.zones[zoneId] ?? [];
  const committed = rawCommitted.filter(c => canResolve(c.widgetId));
  const orphanCount = rawCommitted.length - committed.length;
  const zonePreview = preview && preview.zoneId === zoneId ? preview : null;
  const items: BoardWidgetInstance[] = zonePreview ? [...committed, zonePreview] : committed;

  const elRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);
  const islands = useRef<Map<string, HTMLElement>>(new Map());
  const state = useRef({ items, committed, zonePreview, zoneId, editing, demo, qc, local: localWidgets, updateZoneLayout, removeWidget, onPreviewChange, onCommitPreview, onDiscardPreview });
  state.current = { items, committed, zonePreview, zoneId, editing, demo, qc, local: localWidgets, updateZoneLayout, removeWidget, onPreviewChange, onCommitPreview, onDiscardPreview };

  const renderIsland = (id: string, el: HTMLElement): void => {
    const s = state.current;
    const item = s.items.find(i => i.instanceId === id);
    if (!item) { render(null, el); return; }
    const isPrev = isPreviewWidget(item);
    render(
      <QueryClientProvider client={s.qc}>
        <WidgetFrame
          item={item} editing={s.editing} isPreview={isPrev} local={s.local} demo={s.demo}
          onCommitPreview={isPrev ? () => s.onCommitPreview?.(item as PreviewWidgetInstance) : undefined}
          onDiscardPreview={isPrev ? s.onDiscardPreview : undefined}
          onRemove={!isPrev ? () => void s.removeWidget(s.zoneId, id) : undefined}
        />
      </QueryClientProvider>, el,
    );
  };

  // ── init once ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!elRef.current) return;
    const myRenderCB = (el: HTMLElement, w: GridStackWidget): void => {
      const id = String(w.id ?? '');
      islands.current.set(id, el);
      renderIsland(id, el);
    };
    GridStack.renderCB = myRenderCB;
    // Grid stays "enabled"; interactivity is enforced PER ITEM via grid.movable/resizable.
    const grid = GridStack.init({
      column: 12, cellHeight: 88, margin: 12, float: false,
      draggable: { handle: '.wbi-drag' },
      // Resize from any edge or corner (default is just 'se'); content adapts to the new box.
      resizable: { handles: 'n,ne,e,se,s,sw,w,nw' },
    }, elRef.current);
    gridRef.current = grid;

    const persist = (): void => {
      const s = state.current;
      const saved = grid.save(false) as GridStackWidget[];
      const geom = new Map(saved.map(n => [String(n.id ?? ''), { x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 1, h: n.h ?? 1 }]));
      const nextCommitted: WidgetInstance[] = s.committed.map(c => ({ ...c, ...(geom.get(c.instanceId) ?? {}) }));
      void s.updateZoneLayout(s.zoneId, nextCommitted);
      if (s.zonePreview) {
        const g = geom.get(s.zonePreview.instanceId);
        if (g) s.onPreviewChange?.({ ...s.zonePreview, ...g });
      }
    };
    grid.on('dragstop', persist);
    grid.on('resizestop', persist);

    const cur = islands.current;
    return () => {
      if (GridStack.renderCB === myRenderCB) GridStack.renderCB = (() => {}) as typeof GridStack.renderCB;
      cur.forEach(el => render(null, el));
      cur.clear();
      grid.destroy(false);
      gridRef.current = null;
    };
  }, []);

  // ── load layout + per-item interactivity (re-runs on geometry OR edit-mode change) ──
  const sig = JSON.stringify({
    c: committed.map(w => [w.instanceId, w.widgetId, w.x, w.y, w.w, w.h]),
    p: zonePreview ? [zonePreview.instanceId, zonePreview.widgetId, zonePreview.x, zonePreview.y, zonePreview.w, zonePreview.h] : null,
  });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.load(items.map(it => gridNode(it, editing)), true);
    // grid.load doesn't reliably update noMove/noResize on EXISTING nodes — enforce explicitly.
    for (const el of grid.getGridItems()) {
      const id = el.gridstackNode?.id;
      if (id == null) continue;
      const item = items.find(i => i.instanceId === String(id));
      if (!item) continue;
      const inter = itemInteractive(item, editing);
      grid.movable(el, inter);
      grid.resizable(el, inter);
    }
    const present = new Set(items.map(i => i.instanceId));
    for (const [id, el] of [...islands.current]) {
      if (!present.has(id)) { render(null, el); islands.current.delete(id); }
    }
    for (const [id, el] of islands.current) renderIsland(id, el);
  }, [sig, editing]);

  // Re-render islands when the page-local widget map, demo mode, OR installed widgets change
  // (local widgets close over page state; demo swaps live↔sample; rtVersion = installed set).
  useEffect(() => {
    if (!gridRef.current) return;
    for (const [id, el] of islands.current) renderIsland(id, el);
  }, [localWidgets, demo, rtVersion]);

  // Prune orphaned (uninstalled) widgets from the SAVED layout — only once the installed-package
  // list has authoritatively loaded (registryReady), so a load/error state never drops live widgets.
  // updateZoneLayout shrinks the layout → orphanCount → 0 → this settles after one write.
  useEffect(() => {
    if (registryReady && orphanCount > 0) void updateZoneLayout(zoneId, committed);
  }, [registryReady, orphanCount, rtVersion, zoneId]);

  return (
    <div class="wbi-zone-wrap">
      <div class="wbi-zone grid-stack" ref={elRef} />
    </div>
  );
}
