/**
 * src/ui/components/WidgetBoard.tsx
 *
 * Resizable widget board — a gridstack grid where each widget's content is rendered
 * by Preact. Uses gridstack v11's canonical framework hooks:
 *   • GridStack.renderCB — gridstack calls this to populate each cell's content
 *     element; we render the Preact <WidgetFrame> into it.
 *   • grid.load(items, true) — diffs by id (add / update / remove + positioning), so
 *     gridstack fully owns layout (no hand-rolled addWidget — that caused stacking).
 * User drag/resize persists via dragstop/resizestop (not 'change', which also fires
 * on programmatic load and would loop).
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

import 'gridstack/dist/gridstack.min.css';
import { type VNode } from 'preact';
import { render } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { GridStack, type GridStackWidget } from 'gridstack';
import type { WidgetDef, WidgetRegistry } from '../widgets/registry';
import type { BoardItem } from '@api/layout';

export interface WidgetBoardProps {
  items: BoardItem[];
  registry: WidgetRegistry;
  editing: boolean;
  /** Fired on user drag/resize stop with the full geometry — parent persists. */
  onChange: (items: BoardItem[]) => void;
  /** Fired when a widget's remove (✕) is clicked in edit mode. */
  onRemove: (id: string) => void;
  /** Widget ids that can't be removed (no ✕). */
  required?: Set<string>;
}

function WidgetFrame({ def, editing, removable, onRemove }: { def: WidgetDef; editing: boolean; removable: boolean; onRemove: () => void }): VNode {
  const tools = editing ? (
    <>
      <i class="fas fa-up-down-left-right wb-drag" title="Drag to move" aria-hidden="true" />
      {removable && <button class="wb-remove" type="button" onClick={onRemove} aria-label={`Remove ${def.title}`}><i class="fas fa-xmark" /></button>}
    </>
  ) : null;
  // Bare = the widget IS a full card (e.g. StatsCard); float the edit tools over it.
  if (def.bare) {
    return (
      <div class="wb-bare">
        {editing && <span class="wb-bare-tools">{tools}</span>}
        {def.render()}
      </div>
    );
  }
  return (
    <div class="wb-card">
      <div class="wb-card-head">
        <span class="wb-card-title"><i class={`fas ${def.icon}`} aria-hidden="true" /> {def.title}</span>
        {editing && <span class="wb-card-tools">{tools}</span>}
      </div>
      <div class="wb-card-body">{def.render()}</div>
    </div>
  );
}

export function WidgetBoard({ items, registry, editing, onChange, onRemove, required }: WidgetBoardProps): VNode {
  const elRef    = useRef<HTMLDivElement>(null);
  const gridRef  = useRef<GridStack | null>(null);
  const islands  = useRef<Map<string, HTMLElement>>(new Map());   // id → .grid-stack-item-content
  // latest props for the static renderCB + gridstack event handlers
  const state = useRef({ registry, editing, onRemove, onChange, required });
  state.current = { registry, editing, onRemove, onChange, required };

  const renderIsland = (id: string, el: HTMLElement) => {
    const def = state.current.registry[id];
    if (!def) { render(null, el); return; }
    const removable = !state.current.required?.has(id);
    render(<WidgetFrame def={def} editing={state.current.editing} removable={removable} onRemove={() => state.current.onRemove(id)} />, el);
  };

  // ── init once ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!elRef.current) return;
    // gridstack calls this to fill each item's content element (el) — we own it with Preact.
    const myRenderCB = (el: HTMLElement, w: GridStackWidget) => {
      const id = String(w.id ?? '');
      islands.current.set(id, el);
      renderIsland(id, el);
    };
    GridStack.renderCB = myRenderCB;
    const grid = GridStack.init({
      column: 12, cellHeight: 92, margin: 8, float: false,
      draggable: { handle: '.wb-drag' },
      disableDrag: !state.current.editing, disableResize: !state.current.editing,
    }, elRef.current);
    gridRef.current = grid;

    const persist = () => {
      const saved = grid.save(false) as GridStackWidget[];
      state.current.onChange(saved
        .map(n => ({ id: String(n.id ?? ''), x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 1, h: n.h ?? 1 }))
        .filter(i => i.id));
    };
    grid.on('dragstop', persist);
    grid.on('resizestop', persist);

    const cur = islands.current;
    return () => {
      // Drop the GLOBAL renderCB if it's still ours — a newly-mounted board may have
      // already replaced it (overlap), so only clear when it's this instance's. This
      // stops an unmounted instance's stale closure from firing during a later render
      // flush (root cause of the logout "Hook can only be invoked from render methods").
      if (GridStack.renderCB === myRenderCB) GridStack.renderCB = (() => {}) as typeof GridStack.renderCB;
      cur.forEach(el => render(null, el));
      cur.clear();
      grid.destroy(false);
      gridRef.current = null;
    };
  }, []);

  // ── load layout → gridstack owns add/update/remove + positioning ─────────────
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const valid = items.filter(i => registry[i.id]);
    grid.load(valid.map(it => {
      const def = registry[it.id]!;
      return { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, minW: def.minW, minH: def.minH, maxW: def.maxW, maxH: def.maxH };
    }), true);
    // unmount Preact for any items gridstack removed
    const present = new Set(valid.map(i => i.id));
    for (const [id, el] of [...islands.current]) {
      if (!present.has(id)) { render(null, el); islands.current.delete(id); }
    }
    // re-render existing islands so widget content tracks fresh data/registry
    // (renderCB only fires on create; data updates wouldn't otherwise reach them)
    for (const [id, el] of islands.current) renderIsland(id, el);
  }, [items, registry]);

  // ── edit toggle: enable drag/resize + re-render frames (show/hide handles) ────
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.enableMove(editing);
    grid.enableResize(editing);
    for (const [id, el] of islands.current) renderIsland(id, el);
  }, [editing]);

  // The inner .grid-stack class MUST stay constant — gridstack adds `gs-12` and a
  // per-instance stylesheet class to it imperatively; a dynamic class here would make
  // Preact reconcile (strip) them on every render, killing all positioning. So the
  // edit modifier lives on the wrapper, never on the gridstack container.
  return (
    <div class={`wb-board${editing ? ' is-editing' : ''}`}>
      <div class="wb-grid grid-stack" ref={elRef} />
    </div>
  );
}
