import { useRef } from 'preact/hooks';
import type { TableElement } from '@/types';
import { useDesigner } from '@/state/DesignerContext';
import { columnBoundaries, columnFractions, MIN_COL_FR } from '@/lib/tableCols';

interface DragState {
  boundary: number;
  startX: number;
  fr: number[];
}

/**
 * Draggable dividers between table columns. Rendered inside the selected table
 * element; each grip adjusts the two columns it sits between, keeping their
 * combined width constant so the table's overall width never changes.
 */
export function ColumnResizers({ el, zoom }: { el: TableElement; zoom: number }) {
  const { dispatch } = useDesigner();
  const drag = useRef<DragState | null>(null);

  const pad = el.padding ?? 0;
  const bw = el.borderW ?? 0;
  const innerW = Math.max(1, el.w - pad * 2 - bw * 2);
  const fr = columnFractions(el);
  const boundaries = columnBoundaries(el);

  const onDown = (boundary: number) => (e: PointerEvent) => {
    e.stopPropagation();
    drag.current = { boundary, startX: e.clientX, fr: [...fr] };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.buttons === 0) {
      end();
      return;
    }
    const dFr = (e.clientX - d.startX) / zoom / innerW;
    const next = [...d.fr];
    let a = d.fr[d.boundary]! + dFr;
    let b = d.fr[d.boundary + 1]! - dFr;
    // Clamp so neither adjacent column collapses below the minimum.
    if (a < MIN_COL_FR) {
      b -= MIN_COL_FR - a;
      a = MIN_COL_FR;
    }
    if (b < MIN_COL_FR) {
      a -= MIN_COL_FR - b;
      b = MIN_COL_FR;
    }
    next[d.boundary] = a;
    next[d.boundary + 1] = b;
    dispatch({ kind: 'patch', id: el.id, patch: { colFr: next } });
  };

  const end = () => {
    if (drag.current) {
      drag.current = null;
      dispatch({ kind: 'endEdit' });
    }
  };

  return (
    <>
      {boundaries.map((x, i) => (
        <div
          key={i}
          class="col-resizer"
          style={{ left: `${x}px` }}
          title="Drag to resize columns"
          onPointerDown={onDown(i)}
          onPointerMove={onMove}
          onPointerUp={end}
        />
      ))}
    </>
  );
}
