/**
 * src/ui/components/reorder.tsx
 *
 * Shared drag-to-rearrange behaviour for the four cards at the top of a page —
 * the dashboard hero stat cards (PageHero) AND the sub-module metric row
 * (MetricRow) use this so reorder looks and behaves identically everywhere.
 *
 *   useCardReorder(pageKey, cardKeys) → order + arrange state + drag handlers,
 *     persisted via useModuleLayout (user override → org default → page order).
 *   <ArrangeControls reorder=… variant=… /> → the Arrange / Reset / Set default
 *     / Done toolbar.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useModuleLayout, type ModuleLayout } from '../theme/useModuleLayout';

export interface CardDragProps {
  draggable:   boolean;
  onDragStart: () => void;
  onDragOver:  (e: DragEvent) => void;
  onDrop:      () => void;
  onDragEnd:   () => void;
}

export interface CardReorder {
  enabled:      boolean;
  layout:       ModuleLayout;
  /** Live order — reflects the in-progress drag so neighbours move out of the way. */
  order:        string[];
  arranging:    boolean;
  setArranging: (v: boolean) => void;
  dragKey:      string | null;
  overKey:      string | null;
  dragHandlers: (key: string) => CardDragProps;
  /** State class for a card: ui-reorder [is-arranging|is-dragging|is-drop-target|is-shifting]. */
  dragClass:    (key: string) => string;
}

export function useCardReorder(pageKey: string | undefined, cardKeys: string[]): CardReorder {
  const layout = useModuleLayout(pageKey, cardKeys);
  const [arranging, setArranging] = useState(false);
  const [dragKey,   setDragKey]   = useState<string | null>(null);
  const [overKey,   setOverKey]   = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);

  const order = liveOrder ?? layout.order;

  /** Live-move the dragged card next to `target` so the row reflows as you drag. */
  const moveLive = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const base = liveOrder ?? [...layout.order];
    const from = base.indexOf(dragKey);
    const to   = base.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...base];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setLiveOrder(next);
  };

  const commit = () => {
    if (liveOrder && dragKey && liveOrder.some((k, i) => k !== layout.order[i])) {
      layout.persistMine(liveOrder);
    }
    setDragKey(null); setOverKey(null); setLiveOrder(null);
  };

  const dragHandlers = (key: string): CardDragProps => ({
    draggable:   arranging,
    onDragStart: () => { setDragKey(key); setLiveOrder([...layout.order]); },
    onDragOver:  (e: DragEvent) => { e.preventDefault(); setOverKey(key); moveLive(key); },
    onDrop:      () => commit(),
    onDragEnd:   () => commit(),
  });

  const dragClass = (key: string): string => {
    let c = 'ui-reorder';
    if (arranging)                                c += ' is-arranging';
    if (dragKey === key)                          c += ' is-dragging';
    else if (dragKey)                             c += ' is-shifting';
    if (dragKey && overKey === key && key !== dragKey) c += ' is-drop-target';
    return c;
  };

  return { enabled: layout.enabled, layout, order, arranging, setArranging, dragKey, overKey, dragHandlers, dragClass };
}

/** The Arrange / Reset / Set-default / Done toolbar. `onDark` for the hero. */
export function ArrangeControls({ reorder, variant = 'onDark' }: {
  reorder: CardReorder; variant?: 'onDark' | 'light';
}): VNode | null {
  if (!reorder.enabled) return null;
  const { arranging, setArranging, layout } = reorder;

  const onDark = variant === 'onDark';
  const btn = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '5px 9px', borderRadius: 'var(--radius-sm)', fontSize: '0.68rem', fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
    border: onDark ? '1px solid rgba(255,255,255,.2)' : '1px solid var(--border)',
    background: onDark ? 'rgba(255,255,255,.1)' : 'var(--bg-card)',
    color: onDark ? 'rgba(255,255,255,.85)' : 'var(--siomac-navy)',
  };
  const doneBtn = onDark
    ? { ...btn, background: 'rgba(255,255,255,.92)', color: 'var(--siomac-navy)' }
    : { ...btn, background: 'var(--siomac-navy)', color: '#fff', border: '1px solid var(--siomac-navy)' };

  if (!arranging) {
    return (
      <button style={btn} title="Rearrange the cards" onClick={() => setArranging(true)}>
        <i class="fas fa-grip" /> Arrange
      </button>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {layout.hasOverride && (
        <button style={btn} title="Revert to the default order" onClick={() => void layout.resetMine()}>
          <i class="fas fa-rotate-left" /> Reset
        </button>
      )}
      {layout.canSetDefault && (
        <button style={btn} title="Make the current order the default for everyone" onClick={() => void layout.saveAsDefault()}>
          <i class="fas fa-users" /> Set default
        </button>
      )}
      <button style={doneBtn} onClick={() => setArranging(false)}>
        <i class="fas fa-check" /> Done
      </button>
    </div>
  );
}
