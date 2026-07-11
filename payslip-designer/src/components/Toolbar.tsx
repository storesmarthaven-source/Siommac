import type { ComponentChildren } from 'preact';
import type { Design } from '@/types';
import { useDesigner } from '@/state/DesignerContext';
import { canRedo, canUndo, isGrouped } from '@/state/reducer';
import { TEMPLATES, buildTemplate } from '@/templates';
import { computeFitZoom } from '@/lib/fit';
import { clamp } from '@/lib/geometry';
import { reseedIds } from '@/lib/id';
import { downloadJSON, downloadText, pickFile, readJSONFile } from '@/lib/download';
import { generateTemplateCode, toFnName } from '@/lib/templateCode';
import { printDesign } from '@/lib/print';
import { showToast } from '@/lib/toast';
import { DesignsMenu } from './DesignsMenu';

function Btn({
  children,
  title,
  active,
  disabled,
  onClick,
}: {
  children: ComponentChildren;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button class={`tb-btn${active ? ' active' : ''}`} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Toolbar() {
  const { state, dispatch } = useDesigner();
  const { design, view } = state;
  const selCount = state.selectedIds.length;
  const hasSel = selCount > 0;
  const grouped = isGrouped(state);

  const fit = () => window.setTimeout(() => dispatch({ kind: 'setView', patch: { zoom: computeFitZoom(design.page) } }), 10);
  const setZoom = (z: number) => dispatch({ kind: 'setView', patch: { zoom: clamp(z, 0.25, 2.5) } });

  const load = (d: Design, msg: string) => {
    reseedIds(d.elements.map((e) => e.id));
    dispatch({ kind: 'loadDesign', design: d });
    fit();
    showToast(msg);
  };

  const onTemplate = (e: Event) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    const d = buildTemplate(id);
    (e.target as HTMLSelectElement).value = '';
    if (d) load(d, 'Template loaded');
  };

  const doImport = async () => {
    const file = await pickFile('application/json');
    if (!file) return;
    try {
      const d = await readJSONFile<Design>(file);
      if (!d.elements) throw new Error('bad');
      load(d, 'Imported');
    } catch {
      showToast('Invalid file');
    }
  };

  return (
    <div class="toolbar">
      <span class="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z" />
          <path d="M18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" opacity=".85" />
        </svg>
        Payslip Studio
      </span>

      <div class="tb-group">
        <select class="tb-select" title="Load template" onChange={onTemplate}>
          <option value="">Templates…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div class="tb-group">
        <Btn title="Undo" disabled={!canUndo(state)} onClick={() => dispatch({ kind: 'undo' })}>↶</Btn>
        <Btn title="Redo" disabled={!canRedo(state)} onClick={() => dispatch({ kind: 'redo' })}>↷</Btn>
      </div>

      <div class="tb-group">
        <Btn title="Duplicate" disabled={!hasSel} onClick={() => dispatch({ kind: 'duplicateSelected' })}>⧉</Btn>
        <Btn title="Delete" disabled={!hasSel} onClick={() => dispatch({ kind: 'deleteSelected' })}>🗑</Btn>
        <Btn title="Bring to front" disabled={!hasSel} onClick={() => dispatch({ kind: 'bringSelectedToFront' })}>⬆</Btn>
        <Btn title="Send to back" disabled={!hasSel} onClick={() => dispatch({ kind: 'sendSelectedToBack' })}>⬇</Btn>
      </div>

      <div class="tb-group">
        <Btn title="Group (Ctrl+G)" disabled={selCount < 2} onClick={() => dispatch({ kind: 'group' })}>⛶ Group</Btn>
        <Btn title="Ungroup (Ctrl+Shift+G)" disabled={!grouped} onClick={() => dispatch({ kind: 'ungroup' })}>Ungroup</Btn>
      </div>

      <div class="tb-group">
        <Btn title="Zoom out" onClick={() => setZoom(view.zoom - 0.1)}>−</Btn>
        <span class="zoom-label">{Math.round(view.zoom * 100)}%</span>
        <Btn title="Zoom in" onClick={() => setZoom(view.zoom + 0.1)}>+</Btn>
        <Btn title="Fit" onClick={fit}>Fit</Btn>
      </div>

      <div class="tb-group">
        <Btn title="Toggle grid" active={design.page.grid} onClick={() => dispatch({ kind: 'setPage', patch: { grid: !design.page.grid } })}>Grid</Btn>
        <Btn title="Snap to grid" active={view.snap} onClick={() => dispatch({ kind: 'setView', patch: { snap: !view.snap } })}>Snap</Btn>
      </div>

      <div class="tb-spacer" />

      <div class="tb-group">
        <Btn title="Preview with sample data" active={view.preview} onClick={() => dispatch({ kind: 'setView', patch: { preview: !view.preview } })}>Preview</Btn>
      </div>
      <div class="tb-group">
        <DesignsMenu />
        <Btn title="Export JSON" onClick={() => { downloadJSON(design, 'payslip-design.json'); showToast('Exported'); }}>Export</Btn>
        <Btn
          title="Export as a hardcoded template (.ts)"
          onClick={() => {
            const fn = toFnName(state.savedRef?.name ?? 'customTemplate');
            downloadText(generateTemplateCode(design, fn), `${fn}.ts`, 'text/typescript');
            showToast('Template code exported');
          }}
        >
          .ts
        </Btn>
        <Btn title="Import JSON" onClick={doImport}>Import</Btn>
        <Btn title="Print / Save PDF" active onClick={() => printDesign(design.page)}>PDF</Btn>
      </div>
    </div>
  );
}
