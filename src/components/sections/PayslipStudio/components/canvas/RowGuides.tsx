import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TableElement } from '@payslip/types';

/**
 * Faint dashed separators at each table row boundary — the horizontal analog of
 * ColumnGuides. Design mode only (rendered by ElementView, skipped in preview and
 * the print path). Row Y positions are measured from the live DOM because row
 * heights are content-driven until pinned.
 */
export function RowGuides({ el, zoom }: { el: TableElement; zoom: number }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<number[]>([]);

  const sig = `${el.rows.map((r) => r.height ?? 'a').join(',')}|${el.h}|${el.fontSize}|${el.showHoursRate}|${el.titleFontSize ?? ''}|${el.headHeight ?? ''}|${el.headFontSize ?? ''}|${el.showHead}|${zoom}`;
  useLayoutEffect(() => {
    const root = anchor.current?.closest('.el') as HTMLElement | null;
    if (!root) return;
    const elTop = root.getBoundingClientRect().top;
    const out: number[] = [];
    // Header band boundary, then each data-row boundary.
    const th = root.querySelector('table.pay-tbl thead tr') as HTMLElement | null;
    if (th) out.push((th.getBoundingClientRect().bottom - elTop) / zoom);
    const rows = root.querySelectorAll('table.pay-tbl tbody tr') as NodeListOf<HTMLElement>;
    for (let i = 0; i < el.rows.length; i++) {
      const tr = rows[i];
      if (tr) out.push((tr.getBoundingClientRect().bottom - elTop) / zoom);
    }
    setTops(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (
    <>
      <div ref={anchor} style={{ position: 'absolute', width: 0, height: 0, left: 0, top: 0 }} />
      {tops.map((y, i) => (
        <div key={i} class="row-guide" style={{ top: `${y}px` }} />
      ))}
    </>
  );
}
