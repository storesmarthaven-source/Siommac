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
import GridLayout, { WidthProvider, type ItemCallback, type Layout } from 'react-grid-layout';
import { useBoardLayout } from './useBoardLayout';
import { findWidgetDef } from './registry';
import { useRuntimeWidgetsVersion } from './runtimeRegistry';
import { WidgetFrame } from './WidgetFrame';
import { checkWidgetContentFit } from './contentFit';
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
  /** Hard cap on grid rows (RGL `maxRows`). Set it to a single tile-height (e.g. a tile's `h`) to
   *  lock that row to horizontal-only movement — items can't be dragged into a 2nd row. Default
   *  unbounded. See WidgetBoardProps.maxRows. */
  maxRows?: number;
  /** Keep tiles inside the grid while dragging (RGL `isBounded`). Pair with `maxRows` to fully lock
   *  a single-row grid to horizontal movement. Default false. See WidgetBoardProps.isBounded. */
  isBounded?: boolean;
  /** When false, tiles skip the fade+rise mount reveal — see WidgetBoardProps.revealOnMount. Default true. */
  revealOnMount?: boolean;
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
export function widgetMinGrid(widgetId: string, localWidgets?: LocalWidgetMap): { w: number; h: number } {
  const constraints = localWidgets?.[widgetId]?.sizeConstraints ?? findWidgetDef(widgetId)?.sizeConstraints;
  if (constraints) return { w: constraints.minColumns, h: constraints.minRows };
  const ws = localWidgets?.[widgetId]?.allowedSizes ?? findWidgetDef(widgetId)?.allowedSizes ?? [];
  return {
    w: ws.length ? Math.min(...ws.map(s => s.min?.w ?? s.grid.w)) : 2,
    h: ws.length ? Math.min(...ws.map(s => s.min?.h ?? s.grid.h)) : 2,
  };
}

function sizeConstraintsFor(widgetId: string, localWidgets?: LocalWidgetMap) {
  return localWidgets?.[widgetId]?.sizeConstraints ?? findWidgetDef(widgetId)?.sizeConstraints;
}

export function resizeGridElement(callbackElement: HTMLElement): HTMLElement {
  return callbackElement.closest<HTMLElement>('.react-grid-item') ?? callbackElement;
}

export function isResizeProgressTowardFit(
  previous: { width: number; height: number },
  next: { width: number; height: number },
  blocked: { horizontal: boolean; vertical: boolean },
): boolean {
  const anyGrowth = next.width > previous.width + 1 || next.height > previous.height + 1;
  const horizontalNotWorse = !blocked.horizontal || next.width + 1 >= previous.width;
  const verticalNotWorse = !blocked.vertical || next.height + 1 >= previous.height;
  // Growth on an already-safe axis must remain possible while a different axis has a pre-existing
  // fit warning. For example, a 2px vertical text overflow must not freeze horizontal widening.
  return horizontalNotWorse && verticalNotWorse && anyGrowth;
}

// Self-heals geometry saved BEFORE a widget declared its current floor (e.g. a since-fixed resize
// bug let a tile shrink smaller than the widget can render) — clamps a committed instance up to its
// widget's current minimum. Runs on every load, so stale bad geometry corrects itself instead of
// rendering a clipped tile forever. Returns the SAME reference when unchanged (identity = "no fix").
//
// A `resizable: false` widget is a FIXED size (its single allowedSize is min == max): the user can't
// resize it, so its dimensions are code-owned, not user data. Heal such a tile in BOTH directions —
// otherwise a layout saved when the widget declared a different size pins it forever (a taller saved
// `h` can't be dragged away, and the code default it should follow is masked by the saved override).
export function clampWidgetInstanceToMinimum(item: WidgetInstance, localWidgets?: LocalWidgetMap): WidgetInstance {
  const min = widgetMinGrid(item.widgetId, localWidgets);
  const fixed = localWidgets?.[item.widgetId]?.resizable === false;
  const w = fixed ? min.w : Math.max(item.w, min.w);
  const h = fixed ? min.h : Math.max(item.h, min.h);
  return (w === item.w && h === item.h) ? item : { ...item, w, h };
}

// Whether this widget's tile height should auto-fit its rendered content (WidgetDef.sizeToContent).
// Local map first, then registry — same resolution order as the renderer.
function wantsFit(widgetId: string, localWidgets?: LocalWidgetMap): boolean {
  return !!(localWidgets?.[widgetId]?.sizeToContent ?? findWidgetDef(widgetId)?.sizeToContent);
}

export function WidgetBoardZone({ pageKey, zoneId, editing, localWidgets, defaultLayout, demo, cellHeight = 88, column = 12, gap, compact = 'vertical', resizable = true, maxRows, isBounded = false, revealOnMount = true, registryReady, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardZoneProps): VNode {
  // Re-render when installed (declarative) widgets change so islands resolve them.
  const rtVersion = useRuntimeWidgetsVersion();
  const { layout, updateZoneLayout, removeWidget } = useBoardLayout(pageKey, defaultLayout);

  // A widget resolves if it's a page-local renderer OR in the registry (code + installed runtime).
  // Unresolved instances render placeholders and remain in the persisted placement model.
  const canResolve = (widgetId: string): boolean => !!localWidgets?.[widgetId] || !!findWidgetDef(widgetId);
  const rawCommitted = layout.zones[zoneId] ?? [];
  const committed = rawCommitted.map(c => canResolve(c.widgetId) ? clampWidgetInstanceToMinimum(c, localWidgets) : c);
  const geometryFixed = rawCommitted.some(c => canResolve(c.widgetId) && clampWidgetInstanceToMinimum(c, localWidgets) !== c);
  const zonePreview = preview?.zoneId === zoneId ? preview : null;
  const items: BoardWidgetInstance[] = zonePreview ? [...committed, zonePreview] : committed;

  // Size-to-content: measured row-spans for `sizeToContent` tiles (height hugs the card's natural
  // height). Keyed by instanceId. RGL has no native sizeToContent, so we measure + set `h` ourselves.
  const [fitRows, setFitRows] = useState<Record<string, number>>({});
  const wrapRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastValidResize = useRef<Map<string, { w: number; h: number; width: number; height: number }>>(new Map());
  const activeResizeIds = useRef<Set<string>>(new Set());

  // Vertical gap between tiles. Must stay well below the row height on a fine grid — otherwise the
  // gap dominates and tiles can't hug content. Horizontal gutter is a constant 12.
  const vMargin = gap ? gap[1] : (cellHeight >= 44 ? 12 : Math.max(2, Math.floor(cellHeight / 2) - 1));
  const itemMaxRows = Math.max(16, Math.ceil(1408 / cellHeight));

  const rglLayout: Layout[] = items.map(it => {
    const min = widgetMinGrid(it.widgetId, localWidgets);
    const fit = wantsFit(it.widgetId, localWidgets);
    const inter = itemInteractive(it, editing);
    const lw = localWidgets?.[it.widgetId];
    return {
      i: it.instanceId, x: it.x, y: it.y, w: it.w,
      h: fit ? (fitRows[it.instanceId] ?? it.h) : it.h,
      minW: Math.max(1, min.w), maxW: column,
      minH: Math.max(1, min.h), maxH: itemMaxRows,
      // Size-to-content owns final height but still permits horizontal resizing. A widget can
      // opt out (`resizable:false`) or be fully pinned (`locked:true`).
      static: !inter || lw?.locked === true,
      isDraggable: inter && lw?.locked !== true,
      isResizable: inter && resizable && lw?.resizable !== false && lw?.locked !== true,
    };
  });

  // Handlers read live state via a ref (RGL callbacks are created once per render but we want the
  // latest committed/preview/persisters without re-binding the grid).
  const stateRef = useRef({ committed, zonePreview, zoneId, updateZoneLayout, onPreviewChange });
  useEffect(() => { stateRef.current = { committed, zonePreview, zoneId, updateZoneLayout, onPreviewChange }; }, [committed, zonePreview, zoneId, updateZoneLayout, onPreviewChange]);

  // Persist geometry on drag/resize STOP (a user gesture) — never on programmatic layout changes
  // (mount, the fit pass), which is why we don't use onLayoutChange.
  function persist(next: Layout[]): void {
    const s = stateRef.current;
    const widgetByInstance = new Map(items.map(item => [item.instanceId, item.widgetId]));
    const geom = new Map(next.map(n => {
      const widgetId = widgetByInstance.get(n.i);
      const fittedHeight = widgetId && wantsFit(widgetId, localWidgets) ? fitRows[n.i] : undefined;
      return [n.i, { x: n.x, y: n.y, w: n.w, h: fittedHeight ?? n.h }];
    }));
    const nextCommitted: WidgetInstance[] = s.committed.map(c => ({ ...c, ...(geom.get(c.instanceId) ?? {}) }));
    void s.updateZoneLayout(s.zoneId, nextCommitted);
    if (s.zonePreview) {
      const g = geom.get(s.zonePreview.instanceId);
      if (g) s.onPreviewChange?.({ ...s.zonePreview, ...g });
    }
  }

  const onResizeStart: ItemCallback = (_next, oldItem, newItem, _placeholder, _event, element) => {
    const gridElement = resizeGridElement(element);
    const rect = gridElement.getBoundingClientRect();
    lastValidResize.current.set(newItem.i, { w: oldItem.w, h: oldItem.h, width: rect.width, height: rect.height });
    activeResizeIds.current.add(newItem.i);
    delete gridElement.dataset.widgetMinimumReached;
  };

  const validateResize: ItemCallback = (_next, oldItem, newItem, placeholder, _event, element) => {
    const item = items.find(candidate => candidate.instanceId === newItem.i);
    if (!item) return;
    const gridElement = resizeGridElement(element);
    const constraints = sizeConstraintsFor(item.widgetId, localWidgets);
    const content = gridElement.querySelector<HTMLElement>('[data-widget-content-root]')
      ?? gridElement.querySelector<HTMLElement>('.wbi-bare-body > *, .wbi-body > *');
    const rect = gridElement.getBoundingClientRect();
    const widthBelowMinimum = !!constraints?.minWidth && rect.width + 1 < constraints.minWidth;
    const heightBelowMinimum = !!constraints?.minHeight && rect.height + 1 < constraints.minHeight;
    const declaredFit = !widthBelowMinimum && !heightBelowMinimum;
    const fitResult = constraints?.resizeStrategy === 'content-measured' && content
      ? checkWidgetContentFit(content)
      : null;
    const measuredFit = !fitResult || fitResult.fits;
    const last = lastValidResize.current.get(newItem.i)
      ?? { w: oldItem.w, h: oldItem.h, width: rect.width, height: rect.height };
    const unknownMeasuredAxis = !!fitResult && !fitResult.fits
      && !fitResult.horizontalOverflow && !fitResult.verticalOverflow;
    const recovering = isResizeProgressTowardFit(
      last,
      rect,
      {
        horizontal: widthBelowMinimum || !!fitResult?.horizontalOverflow || unknownMeasuredAxis,
        vertical: heightBelowMinimum || !!fitResult?.verticalOverflow || unknownMeasuredAxis,
      },
    );

    // A legacy/saved tile may already be smaller than today's pixel or content floor. Do not
    // deadlock it there by rejecting every intermediate drag step: accept monotonic growth until
    // it reaches a fully valid size. Shrinking from a valid size still snaps to the last safe box.
    if ((declaredFit && measuredFit) || recovering) {
      lastValidResize.current.set(newItem.i, { w: newItem.w, h: newItem.h, width: rect.width, height: rect.height });
      delete gridElement.dataset.widgetMinimumReached;
      return;
    }

    newItem.w = last.w; newItem.h = last.h;
    // react-grid-layout types the placeholder as present, but its stop callback may supply null
    // after the placeholder DOM has already been torn down.
    if (placeholder) { placeholder.w = last.w; placeholder.h = last.h; }
    // Keep RGL as the sole owner of pixel geometry. Writing width/height here desynchronizes the
    // DOM box from the restored grid units, which leaves neighbouring tiles positioned against a
    // different height and can visibly overlap them after the gesture ends.
    gridElement.dataset.widgetMinimumReached = 'true';
  };

  const onResizeStop: ItemCallback = (next, oldItem, newItem, placeholder, event, element) => {
    validateResize(next, oldItem, newItem, placeholder, event, element);
    lastValidResize.current.delete(newItem.i);
    activeResizeIds.current.delete(newItem.i);
    delete resizeGridElement(element).dataset.widgetMinimumReached;
    persist(next);
  };

  // Size-to-content: observe each fit tile's rendered card (NATURAL height — the card is height:auto
  // inside a `.wbi-fit` tile, so observing it never loops on the tile's RGL-set height) and set the
  // tile's row-span to hug it. Reuse-hooks widgets render skeleton-first then grow when their query
  // resolves; RGL only measures on its own gestures, so this bridges that gap.
  const sig = JSON.stringify(items.map(w => [w.instanceId, w.widgetId, w.w]));
  useEffect(() => {
    const cardToId = new Map<Element, string>();
    let raf = 0;
    // Defer the state update to the next frame so the observer callback never mutates layout
    // synchronously — that synchronous observe→resize→observe loop is what triggers the benign
    // "ResizeObserver loop completed with undelivered notifications" console warning.
    const ro = new ResizeObserver(entries => {
      const measured = entries
        .map(e => ({ id: cardToId.get(e.target), h: (e.target as HTMLElement).offsetHeight }))
        .filter((m): m is { id: string; h: number } => !!m.id);
      if (measured.length === 0) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFitRows(prev => {
          let next = prev;
          for (const { id, h } of measured) {
            const item = items.find(candidate => candidate.instanceId === id);
            const minRows = item ? widgetMinGrid(item.widgetId, localWidgets).h : 1;
            const rows = Math.max(minRows, Math.ceil((h + vMargin) / (cellHeight + vMargin)));
            if ((next[id] ?? -1) !== rows) { if (next === prev) next = { ...prev }; next[id] = rows; }
          }
          return next;
        });
      });
    });
    for (const it of items) {
      if (!wantsFit(it.widgetId, localWidgets)) continue;
      const wrap = wrapRefs.current.get(it.instanceId);
      const card = wrap?.querySelector('.wbi-bare-body > *, .wbi-body > *')
        ?? wrap?.querySelector('.wbi-bare-body, .wbi-body');
      if (card) { cardToId.set(card, it.instanceId); ro.observe(card); }
    }
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); };
  }, [sig, cellHeight, vMargin, editing, demo, rtVersion, localWidgets]);

  // Recheck content-measured widgets when their rendered box or data changes. The hard RGL floor
  // handles known minimums; this observer catches longer values, localization, font scaling and
  // zoom. Width failures grow by one canonical column until the compact layout fits. Non-fit
  // widgets likewise grow vertically; size-to-content widgets use the natural-height observer
  // above for their row correction. Never fight an active pointer gesture.
  useEffect(() => {
    const contentToItem = new Map<Element, BoardWidgetInstance>();
    const pendingTargets = new Set<Element>();
    const mutationObservers: MutationObserver[] = [];
    let raf = 0;
    const schedule = (targets: Element[]): void => {
      for (const target of targets) pendingTargets.add(target);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const corrections = new Map<string, { w: number; h: number }>();
        let previewCorrection: PreviewWidgetInstance | null = null;
        for (const target of pendingTargets) {
          const item = contentToItem.get(target);
          if (!item || activeResizeIds.current.has(item.instanceId)) continue;
          const content = target as HTMLElement;
          const wrap = wrapRefs.current.get(item.instanceId);
          const result = checkWidgetContentFit(content);
          if (result.fits) {
            if (wrap) delete wrap.dataset.widgetContentOverflow;
            continue;
          }
          if (wrap) wrap.dataset.widgetContentOverflow = 'true';
          const unknownAxis = !result.horizontalOverflow && !result.verticalOverflow;
          const w = (result.horizontalOverflow || unknownAxis) && item.w < column ? item.w + 1 : item.w;
          const h = !wantsFit(item.widgetId, localWidgets)
            && (result.verticalOverflow || unknownAxis) && item.h < itemMaxRows ? item.h + 1 : item.h;
          if (w === item.w && h === item.h) continue;
          if (isPreviewWidget(item)) previewCorrection = { ...item, w, h };
          else corrections.set(item.instanceId, { w, h });
        }
        pendingTargets.clear();
        if (corrections.size) {
          const current = stateRef.current;
          void current.updateZoneLayout(current.zoneId, current.committed.map(item => ({ ...item, ...(corrections.get(item.instanceId) ?? {}) })));
        }
        if (previewCorrection) onPreviewChange?.(previewCorrection);
      });
    };
    const ro = new ResizeObserver(entries => schedule(entries.map(entry => entry.target)));
    for (const item of items) {
      if (sizeConstraintsFor(item.widgetId, localWidgets)?.resizeStrategy !== 'content-measured') continue;
      const wrap = wrapRefs.current.get(item.instanceId);
      const content = wrap?.querySelector<HTMLElement>('[data-widget-content-root]');
      if (!content) continue;
      contentToItem.set(content, item);
      ro.observe(content);
      const mo = new MutationObserver(() => schedule([content]));
      mo.observe(content, { childList: true, characterData: true, subtree: true });
      mutationObservers.push(mo);
    }
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); mutationObservers.forEach(observer => observer.disconnect()); };
  }, [sig, column, itemMaxRows, localWidgets, updateZoneLayout, zoneId, onPreviewChange]);

  // Self-heal resolvable geometry once package discovery is authoritative. Missing widgets stay put.
  useEffect(() => {
    if (!registryReady) return;
    if (geometryFixed) void updateZoneLayout(zoneId, committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryReady, geometryFixed, rtVersion, zoneId]);

  return (
    <div class="wbi-zone-wrap">
      <ReactGridLayout
        className="wbi-zone"
        cols={column} rowHeight={cellHeight}
        margin={gap ?? [12, vMargin]} containerPadding={[0, 0]}
        compactType={compact ?? null} preventCollision={compact === null} isBounded={isBounded}
        {...(maxRows != null ? { maxRows } : {})}
        draggableHandle=".wbi-drag" resizeHandles={['se']}
        layout={rglLayout}
        onDragStop={(l: Layout[]) => persist(l)}
        onResizeStart={onResizeStart}
        onResize={validateResize}
        onResizeStop={onResizeStop}
      >
        {items.map(it => {
          const isPrev = isPreviewWidget(it);
          return (
            <div
              key={it.instanceId}
              data-widget-instance-id={it.instanceId}
              class={`wbi-item${wantsFit(it.widgetId, localWidgets) ? ' wbi-fit' : ''}`}
              ref={el => { if (el) wrapRefs.current.set(it.instanceId, el); else wrapRefs.current.delete(it.instanceId); }}
            >
              <WidgetFrame
                item={it} editing={editing} isPreview={isPrev} local={localWidgets} demo={demo} revealOnMount={revealOnMount}
                onCommitPreview={isPrev ? () => onCommitPreview?.(it) : undefined}
                onDiscardPreview={isPrev ? onDiscardPreview : undefined}
                onRemove={!isPrev ? () => void removeWidget(zoneId, it.instanceId) : undefined}
                onConfigure={!isPrev ? config => void updateZoneLayout(zoneId, committed.map(c => c.instanceId === it.instanceId ? { ...c, config } : c)) : undefined}
              />
            </div>
          );
        })}
      </ReactGridLayout>
    </div>
  );
}
