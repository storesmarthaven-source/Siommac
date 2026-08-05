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
import { isPreviewWidget, type BoardLayout, type BoardWidgetInstance, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetRuntimeContext } from './types';

// WidthProvider auto-measures the container width (RGL needs an explicit pixel width). Built
// ONCE at module load — recreating the HOC per render would remount the whole grid every time.
const ReactGridLayout = WidthProvider(GridLayout);

export interface WidgetBoardZoneProps {
  pageKey: string;
  /** Transient per-request context forwarded to widgets. NOT persisted. */
  runtime?: WidgetRuntimeContext;
  zoneId: string;
  editing?: boolean;
  /** Page-local widget renderers (e.g. the employee register) keyed by widgetId. */
  localWidgets?: LocalWidgetMap;
  /** Used when the user has no saved layout for this page. */
  defaultLayout?: BoardLayout;
  /** Demo mode — registry widgets render their static sample instead of live data. */
  demo?: boolean;
  /** Grid row height in px. Defaults to the CANONICAL unit — see CANONICAL_CELL_HEIGHT. */
  cellHeight?: number;
  /** Grid column count (default 12) — see WidgetBoardProps.column. */
  column?: number;
  /** [horizontal, vertical] gap in px between tiles. Defaults to CANONICAL_GAP; overriding the
   *  VERTICAL value changes what a declared row height means on this board, so don't — see
   *  CANONICAL_CELL_HEIGHT. */
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
  /** True once the installed-package list has loaded. Gates the geometry self-heal below, so a
   *  widget whose package simply hasn't loaded yet isn't treated as unresolvable. Nothing is
   *  pruned — an unresolvable instance keeps its saved slot and renders a placeholder. */
  registryReady?: boolean;
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
}

// ── THE CANONICAL GRID UNIT — one unit system for every board ─────────────────────────────────
// A widget's declared heights (allowedSizes[].grid.h / .min.h / .max.h, sizeConstraints.minRows /
// defaultRows) are RAW react-grid-layout rows. Rows only mean a pixel height in combination with a
// board's rowHeight + margin — so if boards disagree on those, the SAME widget renders a different
// size per board, and any widget with `supportedPages: ['*']` is guaranteed wrong somewhere. That
// mismatch is a recurring source of "widget renders as a sliver" bugs.
//
// The fix is to remove the variable rather than convert between values of it: every board uses
// these constants, so a row is 18px everywhere and a declared height means one thing.
//   tile height = CANONICAL_CELL_HEIGHT·h + CANONICAL_GAP·(h−1) = 18h − 12
// A board may still choose its COLUMN count (12 or 24) — widths are declared per-widget against
// the column count and are not affected by row height.
export const CANONICAL_CELL_HEIGHT = 6;
export const CANONICAL_GAP: [number, number] = [12, 12];
/** Pixels per canonical row, including the gap that follows it. */
export const CANONICAL_ROW_PX = CANONICAL_CELL_HEIGHT + CANONICAL_GAP[1];

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

function widgetResizable(widgetId: string, localWidgets?: LocalWidgetMap): boolean {
  return localWidgets?.[widgetId]?.resizable ?? findWidgetDef(widgetId)?.resizable ?? true;
}

export function resizeGridElement(callbackElement: HTMLElement): HTMLElement {
  return callbackElement.closest<HTMLElement>('.react-grid-item') ?? callbackElement;
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
  const fixed = !widgetResizable(item.widgetId, localWidgets);
  const w = fixed ? min.w : Math.max(item.w, min.w);
  const h = fixed ? min.h : Math.max(item.h, min.h);
  return (w === item.w && h === item.h) ? item : { ...item, w, h };
}

// Whether this widget's tile height should auto-fit its rendered content (WidgetDef.sizeToContent).
// Local map first, then registry — same resolution order as the renderer.
function wantsFit(widgetId: string, localWidgets?: LocalWidgetMap): boolean {
  return !!(localWidgets?.[widgetId]?.sizeToContent ?? findWidgetDef(widgetId)?.sizeToContent);
}

export function WidgetBoardZone({ runtime, pageKey, zoneId, editing, localWidgets, defaultLayout, demo, cellHeight = CANONICAL_CELL_HEIGHT, column = 12, gap = CANONICAL_GAP, compact = 'vertical', resizable = true, maxRows, isBounded = false, revealOnMount = true, registryReady, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardZoneProps): VNode {
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
  const activeResizeIds = useRef<Set<string>>(new Set());

  // Vertical gap between tiles. Always defined — `gap` defaults to CANONICAL_GAP, so the old
  // cellHeight-derived fallback is gone along with the per-board row heights it existed for.
  const vMargin = gap[1];
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
      isResizable: inter && resizable && widgetResizable(it.widgetId, localWidgets) && lw?.locked !== true,
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

  // Resize is bounded by the GRID FLOOR ONLY (RGL's minW/minH, from widgetMinGrid) — the same
  // way the Statutory board behaves, which is the reference for how a board should feel.
  //
  // There used to be a second gate here that rejected a resize step whenever the tile fell under
  // a declared pixel `minWidth` or its content reported horizontal overflow. It was removed: a
  // widget's declared pixel minimum is frequently at or above the width its own default placement
  // gives it (Upcoming Deadlines declares minWidth 332 and is placed at w6 ≈ 341px on a 24-column
  // board), so the gate fired on the first pixel of travel and pinned the tile with a "Minimum
  // widget size reached" badge. That reads as a broken resize, not as a guard rail. Cards are
  // fluid and reflow; the grid floor is the honest constraint. `minWidth`/`minHeight` remain
  // meaningful as LIBRARY PREVIEW metadata (see WidgetPreviewScaler), which is what they size well.
  const onResizeStart: ItemCallback = (_next, _oldItem, newItem) => {
    activeResizeIds.current.add(newItem.i);
  };

  const onResizeStop: ItemCallback = (next, _oldItem, newItem) => {
    activeResizeIds.current.delete(newItem.i);
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

  // Recheck content-measured widgets when their rendered box or data changes and FLAG overflow
  // (`data-widget-content-overflow`) so the card can style/scroll it. Observation only.
  //
  // This used to also grow the tile "by one canonical column until the compact layout fits" and
  // persist that. Two problems: it wrote geometry to the server with no user gesture, directly
  // against this zone's own rule that geometry persists on drag/resize STOP only; and it fought
  // the user — shrink a tile, the observer sees overflow and widens it straight back, which is
  // half of why a widget felt impossible to make smaller. The Statutory board never ran this
  // (its page-local widgets declare no resizeStrategy) and that is the behaviour being matched.
  // The honest floor is the widget's declared grid minimum, enforced by RGL.
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
        for (const target of pendingTargets) {
          const item = contentToItem.get(target);
          // Never measure a tile mid-gesture: the box is in flux and the flag would thrash.
          if (!item || activeResizeIds.current.has(item.instanceId)) continue;
          const wrap = wrapRefs.current.get(item.instanceId);
          if (!wrap) continue;
          if (checkWidgetContentFit(target as HTMLElement).fits) delete wrap.dataset.widgetContentOverflow;
          else wrap.dataset.widgetContentOverflow = 'true';
        }
        pendingTargets.clear();
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
  }, [sig, localWidgets]);

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
        margin={gap} containerPadding={[0, 0]}
        compactType={compact ?? null} preventCollision={compact === null} isBounded={isBounded}
        {...(maxRows != null ? { maxRows } : {})}
        draggableHandle=".wbi-drag"
        draggableCancel="button,input,select,textarea,a,[role='button'],.wbi-no-drag"
        resizeHandles={['se', 's', 'e']}
        layout={rglLayout}
        onDragStop={(l: Layout[]) => persist(l)}
        onResizeStart={onResizeStart}
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
              <WidgetFrame runtime={runtime}
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
