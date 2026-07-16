import { createPortal } from 'preact/compat';
import { useEffect, useMemo } from 'preact/hooks';
import { useDesigner } from '@payslip/state/DesignerContext';
import { pageDimensions } from '@payslip/constants/pageSizes';
import { ElementContent } from './canvas/ElementContent';

/**
 * Always-rendered, non-interactive copy of the design in preview mode.
 * Hidden on screen; shown (and colour-preserved) only inside `@media print`.
 *
 * PORTALLED to document.body: inside the ERP embed the studio sits under the
 * app shell (overflow/height-bounded containers), so an in-place #print-root
 * inherits ancestor clipping and prints blank/cut. At body level it has no
 * clipping ancestors, and the print CSS can hide `body > *:not(#print-root)`
 * cleanly (scoped via body:has(#print-root) so other ERP print flows — leave
 * docs, payroll docs — are untouched).
 */
export function PrintView() {
  const { state } = useDesigner();
  const { design } = state;
  const [w, h] = pageDimensions(design.page);
  const ordered = [...design.elements].sort((a, b) => a.z - b.z);

  // The HOST ITSELF is #print-root (a direct body child): the print rule hides
  // `body > *:not(#print-root)`, so an intermediate wrapper would be hidden and
  // take the print copy with it. It also carries the studio scope class so the
  // nested .page/.el styles + CSS custom properties apply to the portal content.
  const host = useMemo(() => {
    const el = document.createElement('div');
    el.id = 'print-root';
    el.className = 'payslip-studio-root';
    return el;
  }, []);
  useEffect(() => {
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [host]);

  return createPortal(
    <div class="page" style={{ width: `${w}px`, height: `${h}px`, background: design.page.bg }}>
        {ordered.map((el) => (
          <div
            key={el.id}
            class="el"
            data-type={el.type}
            style={{ left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px`, zIndex: el.z }}
          >
            <ElementContent el={el} preview />
          </div>
        ))}
    </div>,
    host,
  );
}
