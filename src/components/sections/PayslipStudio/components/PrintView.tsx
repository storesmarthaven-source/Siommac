import { useDesigner } from '@payslip/state/DesignerContext';
import { pageDimensions } from '@payslip/constants/pageSizes';
import { ElementContent } from './canvas/ElementContent';

/**
 * Always-rendered, non-interactive copy of the design in preview mode.
 * Hidden on screen; shown (and colour-preserved) only inside `@media print`.
 */
export function PrintView() {
  const { state } = useDesigner();
  const { design } = state;
  const [w, h] = pageDimensions(design.page);
  const ordered = [...design.elements].sort((a, b) => a.z - b.z);

  return (
    <div id="print-root">
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
      </div>
    </div>
  );
}
