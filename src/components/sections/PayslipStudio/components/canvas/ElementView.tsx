import { useEffect, useRef, useState } from 'preact/hooks';
import type { DesignElement } from '@payslip/types';
import { useDesigner } from '@payslip/state/DesignerContext';
import { MIN_H, MIN_W, resizeRect, snapValue, type Rect, type ResizeDir } from '@payslip/lib/geometry';
import { computeSnap, snapResize } from '@payslip/lib/snapGuides';
import { pageDimensions } from '@payslip/constants/pageSizes';
import { pickFile, readImageFile } from '@payslip/lib/download';
import { ElementContent } from './ElementContent';
import { ResizeHandles } from './ResizeHandles';
import { ColumnResizers } from './ColumnResizers';
import { ColumnGuides } from './ColumnGuides';
import { RowResizers } from './RowResizers';
import { RowGuides } from './RowGuides';

interface DragState {
  mode: 'move' | 'resize';
  dir?: ResizeDir;
  startX: number;
  startY: number;
  origin: Rect;
  /** Origins of every element that moves with this drag (multi-select). */
  moveSet: { id: string; x: number; y: number }[];
  /** A move only begins once the pointer travels past the threshold. */
  active: boolean;
}

/** Pixels the pointer must travel before a click turns into a drag. */
const DRAG_THRESHOLD = 4;

export function ElementView({ el, zoom }: { el: DesignElement; zoom: number }) {
  const { state, dispatch } = useDesigner();
  const preview = state.view.preview;
  const selected = state.selectedIds.includes(el.id) && !preview;
  const soleSelected = selected && state.selectedIds.length === 1;
  const dragRef = useRef<DragState | null>(null);
  const [editingText, setEditingText] = useState(false);

  const beginMove = (e: PointerEvent) => {
    if (preview) return;
    const additive = e.shiftKey;
    // Selecting: shift toggles; a plain click on an already-selected element keeps
    // the multi-selection (so you can drag the whole group).
    if (additive) {
      dispatch({ kind: 'select', id: el.id, additive: true });
    } else if (!state.selectedIds.includes(el.id)) {
      dispatch({ kind: 'select', id: el.id });
    }
    // Which elements move together: the current selection if this element is in it,
    // else just this element (+ its group).
    const ids = state.selectedIds.includes(el.id) && !additive ? state.selectedIds : [el.id];
    const moveSet = state.design.elements.filter((x) => ids.includes(x.id)).map((x) => ({ id: x.id, x: x.x, y: x.y }));
    if (moveSet.length === 0) moveSet.push({ id: el.id, x: el.x, y: el.y });
    dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: el, moveSet, active: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const beginResize = (dir: ResizeDir, e: PointerEvent) => {
    if (preview) return;
    dragRef.current = { mode: 'resize', dir, startX: e.clientX, startY: e.clientY, origin: el, moveSet: [], active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (e.buttons === 0) {
      endDrag();
      return;
    }
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
    }
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (d.mode === 'move') {
      const anchor = d.moveSet.find((m) => m.id === el.id) ?? d.moveSet[0];
      if (d.moveSet.length === 1 && anchor) {
        // Single element: snap to page + peer edges/centres and surface guide lines.
        const proposedX = anchor.x + dx;
        const proposedY = anchor.y + dy;
        const [pw, ph] = pageDimensions(state.design.page);
        const others = state.design.elements.filter((x) => x.id !== el.id);
        const snap = computeSnap({ x: proposedX, y: proposedY, w: el.w, h: el.h }, others, { w: pw, h: ph }, 6 / zoom);
        dispatch({
          kind: 'patch',
          id: el.id,
          patch: {
            x: snap.guidesX.length ? snap.x : snapValue(proposedX, state.view.snap),
            y: snap.guidesY.length ? snap.y : snapValue(proposedY, state.view.snap),
          },
        });
        dispatch({ kind: 'setGuides', guides: { x: snap.guidesX, y: snap.guidesY } });
      } else {
        // Group: snap the anchor to the grid, then move the rest by the same delta
        // so the group keeps its relative spacing.
        const realDx = anchor ? snapValue(anchor.x + dx, state.view.snap) - anchor.x : dx;
        const realDy = anchor ? snapValue(anchor.y + dy, state.view.snap) - anchor.y : dy;
        dispatch({
          kind: 'patchMany',
          patches: d.moveSet.map((m) => ({ id: m.id, patch: { x: m.x + realDx, y: m.y + realDy } })),
        });
      }
    } else if (d.dir) {
      const r = resizeRect(d.origin, d.dir, dx, dy, state.view.snap);
      // Snap the dragged edge(s) to peer/page lines and surface red guides.
      const [pw, ph] = pageDimensions(state.design.page);
      const others = state.design.elements.filter((x) => x.id !== el.id);
      const s = snapResize(r, d.dir, others, { w: pw, h: ph }, 6 / zoom, MIN_W, MIN_H);
      dispatch({ kind: 'patch', id: el.id, patch: { x: s.x, y: s.y, w: s.w, h: s.h } });
      dispatch({ kind: 'setGuides', guides: { x: s.guidesX, y: s.guidesY } });
    }
  };

  const endDrag = () => {
    if (dragRef.current) {
      dragRef.current = null;
      dispatch({ kind: 'endEdit' });
      dispatch({ kind: 'setGuides', guides: { x: [], y: [] } });
    }
  };

  const onDoubleClick = async () => {
    if (preview) return;
    if (el.type === 'image') {
      const file = await pickFile('image/*');
      if (file) {
        const src = await readImageFile(file);
        dispatch({ kind: 'patch', id: el.id, patch: { src } });
        dispatch({ kind: 'endEdit' });
      }
      return;
    }
    if (el.type === 'text' || el.type === 'heading') setEditingText(true);
  };

  return (
    <div
      class={`el${selected ? ' selected' : ''}`}
      data-type={el.type}
      style={{ left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px`, zIndex: el.z }}
      onPointerDown={beginMove}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onDblClick={() => void onDoubleClick()}
    >
      {editingText && (el.type === 'text' || el.type === 'heading') ? (
        <TextEditor
          value={el.text}
          onCommit={(text) => {
            dispatch({ kind: 'patch', id: el.id, patch: { text } });
            dispatch({ kind: 'endEdit' });
            setEditingText(false);
          }}
        />
      ) : (
        <ElementContent el={el} preview={preview} />
      )}
      {!preview && el.type === 'table' && <ColumnGuides el={el} />}
      {!preview && el.type === 'table' && <RowGuides el={el} zoom={zoom} />}
      {soleSelected && <ResizeHandles divider={el.type === 'divider'} onStart={beginResize} />}
      {soleSelected && el.type === 'table' && <ColumnResizers el={el} zoom={zoom} />}
      {soleSelected && el.type === 'table' && <RowResizers el={el} zoom={zoom} />}
    </div>
  );
}

function TextEditor({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      class="text-editor"
      value={value}
      onBlur={(e) => onCommit((e.target as HTMLTextAreaElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
        if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
