import type { ComponentChildren } from 'preact';
import type { ElementPatch } from '@payslip/types';
import { useDesigner } from '@payslip/state/DesignerContext';
import { isGrouped, selectedElement, type AlignMode } from '@payslip/state/reducer';
import { isStyled } from '@payslip/model/guards';
import {
  AlignSection,
  ContentSection,
  DividerSection,
  FieldSection,
  FillSection,
  GeometrySection,
  ImageSection,
  SummarySection,
  TableSection,
  TypographySection,
} from './sections';

const FILL_TYPES = new Set(['box', 'text', 'heading', 'field', 'table']);

export function Inspector() {
  const { state, dispatch } = useDesigner();
  const el = selectedElement(state);
  const count = state.selectedIds.length;

  // Multi-selection — group panel.
  if (count > 1) {
    const grouped = isGrouped(state);
    return (
      <div class="insp">
        <div class="multi-head">{count} elements selected</div>
        <div class="rowbtns">
          {grouped ? (
            <ActionBtn onClick={() => dispatch({ kind: 'ungroup' })}>Ungroup</ActionBtn>
          ) : (
            <ActionBtn onClick={() => dispatch({ kind: 'group' })}>⛶ Group</ActionBtn>
          )}
          <ActionBtn onClick={() => dispatch({ kind: 'duplicateSelected' })}>Duplicate</ActionBtn>
        </div>

        <div class="subhead" style={{ marginTop: '10px' }}>Align</div>
        <AlignBar count={count} onAlign={(mode) => dispatch({ kind: 'align', mode })} />

        <div class="rowbtns" style={{ marginTop: '10px' }}>
          <ActionBtn onClick={() => dispatch({ kind: 'bringSelectedToFront' })}>Front</ActionBtn>
          <ActionBtn onClick={() => dispatch({ kind: 'sendSelectedToBack' })}>Back</ActionBtn>
          <ActionBtn danger onClick={() => dispatch({ kind: 'deleteSelected' })}>Delete</ActionBtn>
        </div>
        <div class="multi-hint">Drag to move together • drag a handle to resize • Shift-click to add/remove</div>
      </div>
    );
  }

  if (!el) {
    return (
      <div class="empty-insp">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="2" stroke-dasharray="3 3" />
          <path d="M14 13l6 3-2.6 1 1.8 2.6-1.7 1-1.8-2.6L14 20z" fill="currentColor" stroke="none" />
        </svg>
        <div>
          Select an element on the page,
          <br />
          or add one from the left.
        </div>
      </div>
    );
  }

  const grouped = !!el.group;

  const set = (patch: ElementPatch) => dispatch({ kind: 'patch', id: el.id, patch });
  const commit = () => dispatch({ kind: 'endEdit' });

  return (
    <div class="insp">
      <div class="row" style={{ marginTop: '4px' }}>
        <label>Name</label>
        <input
          type="text"
          value={el.name ?? ''}
          placeholder={el.type}
          onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
          onChange={commit}
          onBlur={commit}
        />
      </div>
      <GeometrySection el={el} set={set} commit={commit} />

      {(el.type === 'text' || el.type === 'heading') && (
        <>
          <ContentSection el={el} set={set} commit={commit} />
          <TypographySection el={el} set={set} commit={commit} />
          <AlignSection el={el} set={set} commit={commit} />
        </>
      )}
      {el.type === 'field' && (
        <>
          <FieldSection el={el} set={set} commit={commit} />
          <TypographySection el={el} set={set} commit={commit} />
          <AlignSection el={el} set={set} commit={commit} />
        </>
      )}
      {el.type === 'summary' && (
        <>
          <SummarySection el={el} set={set} commit={commit} />
          <TypographySection el={el} set={set} commit={commit} />
          <AlignSection el={el} set={set} commit={commit} />
        </>
      )}
      {el.type === 'divider' && <DividerSection el={el} set={set} commit={commit} />}
      {el.type === 'image' && <ImageSection el={el} set={set} commit={commit} />}
      {el.type === 'table' && <TableSection el={el} set={set} commit={commit} />}

      {isStyled(el) && FILL_TYPES.has(el.type) && el.type !== 'summary' && (
        <FillSection el={el} set={set} commit={commit} />
      )}

      {grouped && (
        <>
          <SubHead />
          <ActionBtn onClick={() => dispatch({ kind: 'ungroup' })}>Ungroup from set</ActionBtn>
        </>
      )}

      <SubHead />
      <div class="rowbtns">
        <ActionBtn onClick={() => dispatch({ kind: 'duplicateSelected' })}>Duplicate</ActionBtn>
        <ActionBtn onClick={() => dispatch({ kind: 'bringSelectedToFront' })}>Front</ActionBtn>
        <ActionBtn onClick={() => dispatch({ kind: 'sendSelectedToBack' })}>Back</ActionBtn>
      </div>
      <div class="rowbtns" style={{ marginTop: '6px' }}>
        <ActionBtn onClick={() => dispatch({ kind: 'resetElement', id: el.id })}>↺ Reset to default</ActionBtn>
        <ActionBtn danger onClick={() => dispatch({ kind: 'deleteSelected' })}>
          Delete
        </ActionBtn>
      </div>
    </div>
  );
}

function SubHead() {
  return <div class="insp-sep" />;
}

/** Alignment + distribution controls for a multi-selection. */
function AlignBar({ count, onAlign }: { count: number; onAlign: (mode: AlignMode) => void }) {
  const canDist = count >= 3;
  return (
    <div class="alignbar">
      <AlignBtn mode="left" title="Align left" onAlign={onAlign} />
      <AlignBtn mode="hcenter" title="Align horizontal centres" onAlign={onAlign} />
      <AlignBtn mode="right" title="Align right" onAlign={onAlign} />
      <span class="alignbar-sep" />
      <AlignBtn mode="top" title="Align top" onAlign={onAlign} />
      <AlignBtn mode="vmiddle" title="Align vertical centres" onAlign={onAlign} />
      <AlignBtn mode="bottom" title="Align bottom" onAlign={onAlign} />
      <span class="alignbar-sep" />
      <AlignBtn mode="hdist" title="Distribute horizontally (3+)" disabled={!canDist} onAlign={onAlign} />
      <AlignBtn mode="vdist" title="Distribute vertically (3+)" disabled={!canDist} onAlign={onAlign} />
    </div>
  );
}

function AlignBtn({
  mode,
  title,
  disabled,
  onAlign,
}: {
  mode: AlignMode;
  title: string;
  disabled?: boolean;
  onAlign: (mode: AlignMode) => void;
}) {
  return (
    <button class="align-btn" title={title} disabled={disabled} onClick={() => onAlign(mode)}>
      <AlignIcon mode={mode} />
    </button>
  );
}

/** 20×20 line icons depicting each alignment / distribution. */
function AlignIcon({ mode }: { mode: AlignMode }) {
  const p = { fill: 'currentColor', stroke: 'none' } as const;
  const rail = { stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' } as const;
  switch (mode) {
    case 'left':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="3" y1="3" x2="3" y2="17" {...rail} />
          <rect x="4.5" y="5" width="11" height="3.5" {...p} />
          <rect x="4.5" y="11.5" width="7" height="3.5" {...p} />
        </svg>
      );
    case 'right':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="17" y1="3" x2="17" y2="17" {...rail} />
          <rect x="4.5" y="5" width="11" height="3.5" {...p} />
          <rect x="8.5" y="11.5" width="7" height="3.5" {...p} />
        </svg>
      );
    case 'hcenter':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="10" y1="3" x2="10" y2="17" {...rail} />
          <rect x="4.5" y="5" width="11" height="3.5" {...p} />
          <rect x="6.5" y="11.5" width="7" height="3.5" {...p} />
        </svg>
      );
    case 'top':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="3" y1="3" x2="17" y2="3" {...rail} />
          <rect x="5" y="4.5" width="3.5" height="11" {...p} />
          <rect x="11.5" y="4.5" width="3.5" height="7" {...p} />
        </svg>
      );
    case 'bottom':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="3" y1="17" x2="17" y2="17" {...rail} />
          <rect x="5" y="4.5" width="3.5" height="11" {...p} />
          <rect x="11.5" y="8.5" width="3.5" height="7" {...p} />
        </svg>
      );
    case 'vmiddle':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <line x1="3" y1="10" x2="17" y2="10" {...rail} />
          <rect x="5" y="4.5" width="3.5" height="11" {...p} />
          <rect x="11.5" y="6.5" width="3.5" height="7" {...p} />
        </svg>
      );
    case 'hdist':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <rect x="2.5" y="5" width="3" height="10" {...p} />
          <rect x="8.5" y="5" width="3" height="10" {...p} />
          <rect x="14.5" y="5" width="3" height="10" {...p} />
        </svg>
      );
    case 'vdist':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <rect x="5" y="2.5" width="10" height="3" {...p} />
          <rect x="5" y="8.5" width="10" height="3" {...p} />
          <rect x="5" y="14.5" width="10" height="3" {...p} />
        </svg>
      );
  }
}

function ActionBtn({ children, danger, onClick }: { children: ComponentChildren; danger?: boolean; onClick: () => void }) {
  return (
    <button class={`btn${danger ? ' danger' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
