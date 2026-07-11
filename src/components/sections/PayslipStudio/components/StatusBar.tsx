import { useDesigner } from '@payslip/state/DesignerContext';
import { selectedElement } from '@payslip/state/reducer';

export function StatusBar() {
  const { state } = useDesigner();
  const sel = selectedElement(state);
  const count = state.selectedIds.length;
  return (
    <div class="statusbar">
      <span>
        Elements: <b>{state.design.elements.length}</b>
      </span>
      <span>
        Selected: <b>{count > 1 ? `${count} elements` : sel ? sel.type : '—'}</b>
      </span>
      <span>
        Zoom: <b>{Math.round(state.view.zoom * 100)}%</b>
      </span>
      <span style={{ marginLeft: 'auto' }}>
        Shift-click to multi-select • Ctrl+G group • drag to move together
      </span>
    </div>
  );
}
