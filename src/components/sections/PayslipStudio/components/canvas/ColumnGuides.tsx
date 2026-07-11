import type { TableElement } from '@payslip/types';
import { columnBoundaries } from '@payslip/lib/tableCols';

/**
 * Faint vertical separators marking each table column boundary. Shown only in
 * design mode (rendered by ElementView, which is skipped in preview and in the
 * print/PDF path) so the user can see — and grab — the resizable columns. These
 * never appear in the generated output; a real table border is a separate style.
 */
export function ColumnGuides({ el }: { el: TableElement }) {
  const boundaries = columnBoundaries(el);
  return (
    <>
      {boundaries.map((x, i) => (
        <div key={i} class="col-guide" style={{ left: `${x}px` }} />
      ))}
    </>
  );
}
