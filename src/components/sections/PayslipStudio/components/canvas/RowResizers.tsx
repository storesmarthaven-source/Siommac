import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TableElement } from '@payslip/types';
import { useDesigner } from '@payslip/state/DesignerContext';

/** Minimum height a table row / header may be dragged to (design px). */
const MIN_ROW_H = 14;

type DragKind = { kind: 'row'; i: number } | { kind: 'header' };

/**
 * Draggable horizontal grips for table heights:
 *  - one at the bottom of the column-header band (sets `headHeight`), and
 *  - one at the bottom of each data row (sets that row's height).
 * The growing bottom spacer absorbs the change so the table's overall height stays
 * put. Y positions are measured from the live DOM because heights are content-driven
 * until pinned.
 */
export function RowResizers({ el, zoom }: { el: TableElement; zoom: number }) {
  const { dispatch } = useDesigner();
  const anchor = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [headBottom, setHeadBottom] = useState<number | null>(null);
  const dragRef = useRef<(DragKind & { startY: number; startH: number }) | null>(null);

  const root = () => anchor.current?.closest('.el') as HTMLElement | null;
  const dataRows = () => root()?.querySelectorAll('table.pay-tbl tbody tr');
  const headRow = () => root()?.querySelector('table.pay-tbl thead tr');

  const sig = `${el.rows.map((r) => r.height ?? 'a').join(',')}|${el.h}|${el.fontSize}|${el.showHoursRate}|${el.titleFontSize ?? ''}|${el.headHeight ?? ''}|${el.headFontSize ?? ''}|${el.showHead}|${zoom}`;
  useLayoutEffect(() => {
    const r = root();
    if (!r) return;
    const elTop = r.getBoundingClientRect().top;
    const th = headRow();
    setHeadBottom(th ? (th.getBoundingClientRect().bottom - elTop) / zoom : null);
    const rows = dataRows();
    const out: number[] = [];
    for (let i = 0; i < el.rows.length; i++) {
      const tr = rows?.[i];
      if (tr) out.push((tr.getBoundingClientRect().bottom - elTop) / zoom);
    }
    setTops(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const beginRow = (i: number) => (e: PointerEvent) => {
    e.stopPropagation();
    const tr = dataRows()?.[i];
    const startH = tr ? tr.getBoundingClientRect().height / zoom : el.rows[i]?.height ?? 24;
    dragRef.current = { kind: 'row', i, startY: e.clientY, startH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginHeader = (e: PointerEvent) => {
    e.stopPropagation();
    const th = headRow();
    const startH = th ? th.getBoundingClientRect().height / zoom : el.headHeight ?? el.headFontSize ?? 11;
    dragRef.current = { kind: 'header', startY: e.clientY, startH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (e.buttons === 0) {
      end();
      return;
    }
    const nh = Math.max(MIN_ROW_H, Math.round(d.startH + (e.clientY - d.startY) / zoom));
    if (d.kind === 'header') {
      dispatch({ kind: 'patch', id: el.id, patch: { headHeight: nh } });
    } else {
      dispatch({ kind: 'patch', id: el.id, patch: { rows: el.rows.map((r, idx) => (idx === d.i ? { ...r, height: nh } : r)) } });
    }
  };

  const end = () => {
    if (dragRef.current) {
      dragRef.current = null;
      dispatch({ kind: 'endEdit' });
    }
  };

  return (
    <>
      <div ref={anchor} style={{ position: 'absolute', width: 0, height: 0, left: 0, top: 0 }} />
      {headBottom != null && (
        <div
          class="row-resizer is-header"
          style={{ top: `${headBottom}px` }}
          title="Drag to resize the header height"
          onPointerDown={beginHeader}
          onPointerMove={onMove}
          onPointerUp={end}
        />
      )}
      {tops.map((y, i) => (
        <div
          key={i}
          class="row-resizer"
          style={{ top: `${y}px` }}
          title="Drag to resize row height"
          onPointerDown={beginRow(i)}
          onPointerMove={onMove}
          onPointerUp={end}
        />
      ))}
    </>
  );
}
