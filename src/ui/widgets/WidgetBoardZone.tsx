/**
 * src/ui/widgets/WidgetBoardZone.tsx
 *
 * One board zone, rendered on react-grid-layout (RGL). RGL is DATA-DRIVEN and Preact-native:
 * the layout is a prop, and each tile is an ordinary Preact child in the normal tree. There is
 * NO gridstack-style DOM-ownership bridge — no static `renderCB` dispatcher, no detached
 * `render()` islands, no re-provided QueryClient, no `grid.load` interactivity patching. That
 * bridge was the source of most board bugs (empty tiles from renderCB collisions, lost context,
 * margin collapse); it's gone.
 *
 * Interactivity is PER ITEM via the layout item's `static`/`isDraggable`/`isResizable`: a
 * committed widget is movable/resizable only in edit mode; the ephemeral preview is ALWAYS
 * interactive (previewing one widget never unlocks the rest). Geometry persists on drag/resize
 * STOP only (not on programmatic layout changes like the size-to-content fit pass).
 */
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './widgetBoard.css';
import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { useBoardLayout } from './useBoardLayout';
import { findWidgetDef } from './registry';
import { useRuntimeWidgetsVersion } from './runtimeRegistry';
import { WidgetFrame } from './WidgetFrame';
import { isPreviewWidget, type BoardLayout, type BoardWidgetInstance, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance } from './types';

// WidthProvider auto-measures the container width (RGL needs an explicit pixel width). Built
// ONCE at module load — recreating the HOC per render would remount the whole grid every time.
const ReactGridLayout = WidthProvider(GridLayout);

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
  /** Grid row height in px (default 88) — see WidgetBoardProps.cellHeight. */
  cellHeight?: number;
  /** Grid column count (default 12) — see WidgetBoardProps.column. */
  column?: number;
  /** Explicit [horizontal, vertical] gap in px between tiles. Overrides the default,
   *  which is derived from cellHeight (`[12, vMargin]`). Lets a board tune spacing
   *  independently of its row height — see WidgetBoardProps.gap. */
  gap?: [number, number];
  /** RGL compactType — see WidgetBoardProps.compact. */
  compact?: 'vertical' | 'horizontal' | null;
  /** When false, tiles drag-reorder but never resize — see WidgetBoardProps.resizable. Default true. */
  resizable?: boolean;
  /** True once the installed-package list has loaded — gates pruning of orphaned (uninstalled) widgets. */
  registryReady?: boolean;
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
}

// A widget is interactive (movable/resizable) only as a preview, or when the board is editing.
const itemInteractive = (item: BoardWidgetInstance, editing?: boolean): boolean => isPreviewWidget(item) || !!editing;

// allowedSizes are quick-pick PRESETS (size selector) — they do NOT cap board resizing; they set
// the resize FLOOR. On the board a widget resizes freely above its smallest preset and its content
// adapts (fluid cards reflow). The floor is the widget's smallest declared preset (or that preset's
// explicit `min`, if tighter). Checks page-local widgets first, then the registry — a local tile can
// be just as non-reflowing as a registry one. Widgets with no presets keep a generic 2-cell floor.
function minGridFor(widgetId: string, localWidgets?: LocalWidgetMap): { w: number; h: number } {
  const ws = localWidgets?.[widgetId]?.allowedSizes ?? findWidgetDef(widgetId)?.allowedSizes ?? [];
  return {
    w: ws.length ? Math.min(...ws.map(s => s.min?.w ?? s.grid.w)) : 2,
    h: ws.length ? Math.min(...ws.map(s => s.min?.h ?? s.grid.h)) : 2,
  };
}

// Self-heals geometry saved BEFORE a widget declared its current floor (e.g. a since-fixed resize
// bug let a tile shrink smaller than the widget can render) — clamps a committed instance up to its
// widget's current minimum. Runs on every load, so stale bad geometry corrects itself instead of
// rendering a clipped tile forever. Returns the SAME reference when unchanged (identity = "no fix").
function clampToMinGrid(item: WidgetInstance, localWidgets?: LocalWidgetMap): WidgetInstance {
  const min = minGridFor(item.widgetId, localWidgets);
  const w = Math.max(item.w, min.w), h = Math.max(item.h, min.h);
  return (w === item.w && h === item.h) ? item : { ...item, w, h };
}

// Whether this widget's tile height should auto-fit its rendered content (WidgetDef.sizeToContent).
// Local map first, then registry — same resolution order as the renderer.
function wantsFit(widgetId: string, localWidgets?: LocalWidgetMap): boolean {
  return !!(localWidgets?.[widgetId]?.sizeToContent ?? findWidgetDef(widgetId)?.sizeToContent);
}

export function WidgetBoardZone({ pageKey, zoneId, editing, localWidgets, defaultLayout, demo, cellHeight = 88, column = 12, gap, compact = 'vertical', resizable = true, registryReady, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardZoneProps): VNode {
  // Re-render when installed (declarative) widgets change so islands resolve them.
  const rtVersion = useRuntimeWidgetsVersion();
  const { layout, updateZoneLayout, removeWidget, resetLayout } = useBoardLayout(pageKey, defaultLayout);

  // A widget resolves if it's a page-local renderer OR in the registry (code + installed runtime).
  // Instances that no longer resolve (their package was uninstalled, or the id was renamed) are
  // ORPHANS: never render them, and prune them from the saved layout once the registry is authoritative.
  const canResolve = (widgetId: string): boolean => !!localWidgets?.[widgetId] || !!findWidgetDef(widgetId);
  const rawCommitted = layout.zones[zoneId] ?? [];
  const resolvable = rawCommitted.filter(c => canResolve(c.widgetId));
  const committed = resolvable.map(c => clampToMinGrid(c, localWidgets));
  const orphanCount = rawCommitted.length - resolvable.length;
  const geometryFixed = resolvable.some(c => clampToMinGrid(c, localWidgets) !== c);
  const zonePreview = preview && preview.zoneId === zoneId ? preview : null;
  const items: BoardWidgetInstance[] = zonePreview ? [...committed, zonePreview] : committed;

  // One-shot guard so the "all widgets orphaned → revert to default" heal below can't loop
  // (if the DEFAULT itself is all-orphan, reverting would reload the same empty set).
  const didHealRef = useRef(false);

  // Size-to-content: measured row-spans for `sizeToContent` tiles (height hugs the card's natural
  // height). Keyed by instanceId. RGL has no native sizeToContent, so we measure + set `h` ourselves.
  const [fitRows, setFitRows] = useState<Record<string, number>>({});
  const wrapRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Vertical gap between tiles. Must stay well below the row height on a fine grid — otherwise the
  // gap dominates and tiles can't hug content. Horizontal gutter is a constant 12.
  const vMargin = gap ? gap[1] : (cellHeight >= 44 ? 12 : Math.max(2, Math.floor(cellHeight / 2) - 1));
  const maxRows = Math.max(16, Math.ceil(1408 / cellHeight));

  const rglLayout: Layout[] = items.map(it => {
    const min = minGridFor(it.widgetId, localWidgets);
    const fit = wantsFit(it.widgetId, localWidgets);
    const inter = itemInteractive(it, editing);
    return {
      i: it.instanceId, x: it.x, y: it.y, w: it.w,
      h: fit ? (fitRows[it.instanceId] ?? it.h) : it.h,
      minW: Math.max(1, min.w), maxW: column,
      minH: fit ? 1 : Math.max(1, min.h), maxH: maxRows,
      // A sizeToContent (fit) tile auto-hugs its content, so height-resizing it only
      // creates dead space — make those tiles NON-resizable (drag-move only).
      static: !inter, isDraggable: inter, isResizable: inter && resizable && !fit,
    };
  });

  // Handlers read live state via a ref (RGL callbacks are created once per render but we want the
  // latest committed/preview/persisters without re-binding the grid).
  const state = useRef({ committed, zonePreview, zoneId, updateZoneLayout, onPreviewChange });
  state.current = { committed, zonePreview, zoneId, updateZoneLayout, onPreviewChange };

  // Persist geometry on drag/resize STOP (a user gesture) — never on programmatic layout changes
  // (mount, the fit pass), which is why we don't use onLayoutChange.
  function persist(next: Layout[]): void {
    const s = state.current;
    const geom = new Map(next.map(n => [n.i, { x: n.x, y: n.y, w: n.w, h: n.h }]));
    const nextCommitted: WidgetInstance[] = s.committed.map(c => ({ ...c, ...(geom.get(c.instanceId) ?? {}) }));
    void s.updateZoneLayout(s.zoneId, nextCommitted);
    if (s.zonePreview) {
      const g = geom.get(s.zonePreview.instanceId);
      if (g) s.onPreviewChange?.({ ...s.zonePreview, ...g });
    }
  }

  // Size-to-content: observe each fit tile's rendered card (NATURAL height — the card is height:auto
  // inside a `.wbi-fit` tile, so observing it never loops on the tile's RGL-set height) and set the
  // tile's row-span to hug it. Reuse-hooks widgets render skeleton-first then grow when their query
  // resolves; RGL only measures on its own gestures, so this bridges that gap.
  const sig = JSON.stringify(items.map(w => [w.instanceId, w.widgetId, w.w]));
  useEffect(() => {
    const cardToId = new Map<Element, string>();
    const ro = new ResizeObserver(entries => {
      setFitRows(prev => {
        let next = prev;
        for (const e of entries) {
          const id = cardToId.get(e.target);
          if (!id) continue;
          const h = (e.target as HTMLElement).offsetHeight;
          const rows = Math.max(1, Math.ceil((h + vMargin) / (cellHeight + vMargin)));
          if ((next[id] ?? -1) !== rows) { if (next === prev) next = { ...prev }; next[id] = rows; }
        }
        return next;
      });
    });
    for (const it of items) {
      if (!wantsFit(it.widgetId, localWidgets)) continue;
      const wrap = wrapRefs.current.get(it.instanceId);
      const card = wrap?.querySelector('.wbi-bare-body > *, .wbi-body > *')
        ?? wrap?.querySelector('.wbi-bare-body, .wbi-body');
      if (card) { cardToId.set(card, it.instanceId); ro.observe(card); }
    }
    return () => ro.disconnect();
  }, [sig, cellHeight, vMargin, editing, demo, rtVersion, localWidgets]);

  // Prune orphaned (uninstalled/renamed) widgets AND self-heal geometry saved below a widget's
  // current minimum — only once the installed-package list has authoritatively loaded (registryReady),
  // so a load/error state never drops live widgets.
  useEffect(() => {
    if (!registryReady) return;
    // ALL saved widgets were orphans (every id renamed/removed since this override was saved) →
    // committed is now empty. Persisting that empty set as the user's override would MASK a populated
    // org/page default (backend resolves override.layout ?? default.layout, and an empty-but-present
    // override wins) and strand the user on a blank board forever. Revert the override instead so the
    // default takes back over. A deliberate remove-all goes through removeWidget (creates no orphans),
    // so intentional empties are preserved. One-shot so a broken all-orphan DEFAULT can't ping-pong.
    if (orphanCount > 0 && committed.length === 0 && !didHealRef.current
        && (defaultLayout?.zones[zoneId]?.length ?? 0) > 0) {
      didHealRef.current = true;
      void resetLayout();
      return;
    }
    if (orphanCount > 0 || geometryFixed) void updateZoneLayout(zoneId, committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryReady, orphanCount, geometryFixed, rtVersion, zoneId]);

  return (
    <div class="wbi-zone-wrap">
      <ReactGridLayout
        className="wbi-zone"
        cols={column} rowHeight={cellHeight}
        margin={gap ?? [12, vMargin]} containerPadding={[0, 0]}
        compactType={compact ?? null} preventCollision={compact === null} isBounded={false}
        draggableHandle=".wbi-drag" resizeHandles={['se']}
        layout={rglLayout}
        onDragStop={(l: Layout[]) => persist(l)}
        onResizeStop={(l: Layout[]) => persist(l)}
      >
        {items.map(it => {
          const isPrev = isPreviewWidget(it);
          return (
            <div
              key={it.instanceId}
              class={`wbi-item${wantsFit(it.widgetId, localWidgets) ? ' wbi-fit' : ''}`}
              ref={el => { if (el) wrapRefs.current.set(it.instanceId, el as HTMLDivElement); else wrapRefs.current.delete(it.instanceId); }}
            >
              <WidgetFrame
                item={it} editing={editing} isPreview={isPrev} local={localWidgets} demo={demo}
                onCommitPreview={isPrev ? () => onCommitPreview?.(it as PreviewWidgetInstance) : undefined}
                onDiscardPreview={isPrev ? onDiscardPreview : undefined}
                onRemove={!isPrev ? () => void removeWidget(zoneId, it.instanceId) : undefined}
              />
            </div>
          );
        })}
      </ReactGridLayout>
    </div>
  );
}
