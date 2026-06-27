/**
 * src/ui/components/WidgetBoardZone.tsx
 *
 * The complete widget-board surface for a page: the edit toolbar (Customize / Add /
 * Reset / Set default / Done), the gridstack <WidgetBoard>, and the <WidgetPicker>.
 * Persistence (per-user override + admin org default) is handled by useBoardLayout.
 *
 * A page supplies a `registry` (its WidgetDefs, with render closures over its data)
 * and the `defaultIds` shown when there's no saved layout.
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

import { type VNode } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { useBoardLayout } from '../theme/useBoardLayout';
import { WidgetBoard } from './WidgetBoard';
import { WidgetPicker } from './WidgetPicker';
import { defaultBoard, type WidgetDef, type WidgetRegistry } from '../widgets/registry';
import type { BoardItem } from '@api/layout';

export interface WidgetBoardZoneProps {
  /** Persistence key — convention `<module>.<area>.board`. */
  pageKey: string;
  registry: WidgetRegistry;
  /** Widget ids shown by default (in order) when there's no saved layout. */
  defaultIds: string[];
  /** Optional heading shown left of the toolbar. */
  title?: string;
  /** Whether the current user may customize (drag/resize/add). When false the board
   *  is view-only — no Customize button. Default true. */
  canEdit?: boolean;
  /** Widget ids that must always be present — injected if a saved layout lacks them,
   *  and not removable (e.g. a register table). */
  requiredIds?: string[];
}

export function WidgetBoardZone({ pageKey, registry, defaultIds, title, canEdit = true, requiredIds = [] }: WidgetBoardZoneProps): VNode {
  const defaults = defaultBoard(defaultIds.map(id => registry[id]).filter((d): d is WidgetDef => !!d));
  const layout = useBoardLayout(pageKey, defaults);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const required = new Set(requiredIds);
  const effectiveEditing = canEdit && editing;

  // Effective layout = saved items + any required widget the saved layout is missing
  // (so a core widget like the table can never be lost on an older saved layout).
  const items: BoardItem[] = (() => {
    const have = new Set(layout.items.map(i => i.id));
    const missing = requiredIds.filter(id => registry[id] && !have.has(id));
    if (!missing.length) return layout.items;
    let y = layout.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const extra = missing.map(id => { const d = registry[id]!; const it = { id, x: 0, y, w: d.defaultW, h: d.defaultH }; y += d.defaultH; return it; });
    return [...layout.items, ...extra];
  })();
  const placed = new Set(items.map(i => i.id));

  const addWidget = useCallback((id: string) => {
    const def = registry[id];
    if (!def) return;
    const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    layout.persistMine([...items, { id, x: 0, y: maxY, w: def.defaultW, h: def.defaultH }]);
    setPicker(false);
  }, [registry, layout, items]);

  const removeWidget = useCallback((id: string) => {
    if (required.has(id)) return;
    layout.persistMine(items.filter(i => i.id !== id));
  }, [layout, items, required]);

  const onChange = useCallback((next: BoardItem[]) => layout.persistMine(next), [layout]);

  return (
    <div class="wb-zone">
      <div class="wb-zone-bar">
        {title ? <span class="wb-zone-title">{title}</span> : <span />}
        <div class="wb-zone-actions">
          {!canEdit ? null : !editing ? (
            <button class="wb-zone-btn" type="button" onClick={() => setEditing(true)}>
              <i class="fas fa-table-cells-large" aria-hidden="true" /> Customize
            </button>
          ) : (
            <>
              <button class="wb-zone-btn" type="button" onClick={() => setPicker(true)}>
                <i class="fas fa-plus" aria-hidden="true" /> Add widget
              </button>
              {layout.hasOverride && (
                <button class="wb-zone-btn" type="button" onClick={() => void layout.resetMine()}>
                  <i class="fas fa-rotate-left" aria-hidden="true" /> Reset
                </button>
              )}
              {layout.canSetDefault && (
                <button class="wb-zone-btn" type="button" onClick={() => void layout.saveAsDefault()}>
                  <i class="fas fa-users" aria-hidden="true" /> Set default
                </button>
              )}
              <button class="wb-zone-btn primary" type="button" onClick={() => setEditing(false)}>
                <i class="fas fa-check" aria-hidden="true" /> Done
              </button>
            </>
          )}
        </div>
      </div>

      <WidgetBoard items={items} registry={registry} editing={effectiveEditing} required={required} onChange={onChange} onRemove={removeWidget} />

      {picker && <WidgetPicker registry={registry} placed={placed} onAdd={addWidget} onClose={() => setPicker(false)} />}
    </div>
  );
}
