import { useRef } from 'preact/hooks';
import type { ElementPatch } from '@/types';
import { useDesigner } from '@/state/DesignerContext';
import { selectedElements } from '@/state/reducer';
import { snapValue, type ResizeDir } from '@/lib/geometry';
import { ResizeHandles } from './ResizeHandles';

interface StartRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  headFontSize?: number;
}

interface DragState {
  dir: ResizeDir;
  sx0: number;
  sy0: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  rects: StartRect[];
}

/** Bounding box + resize handles for a multi-selection — scales all members together. */
export function SelectionBox({ zoom }: { zoom: number }) {
  const { state, dispatch } = useDesigner();
  const els = selectedElements(state);
  const drag = useRef<DragState | null>(null);

  if (state.view.preview || els.length < 2) return null;

  const minX = Math.min(...els.map((e) => e.x));
  const minY = Math.min(...els.map((e) => e.y));
  const maxX = Math.max(...els.map((e) => e.x + e.w));
  const maxY = Math.max(...els.map((e) => e.y + e.h));
  const bw = maxX - minX;
  const bh = maxY - minY;

  const begin = (dir: ResizeDir, e: PointerEvent) => {
    drag.current = {
      dir,
      sx0: e.clientX,
      sy0: e.clientY,
      bx: minX,
      by: minY,
      bw,
      bh,
      rects: els.map((el) => ({
        id: el.id,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        fontSize: 'fontSize' in el ? el.fontSize : undefined,
        headFontSize: 'headFontSize' in el ? el.headFontSize : undefined,
      })),
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.buttons === 0) {
      end();
      return;
    }
    const dx = (e.clientX - d.sx0) / zoom;
    const dy = (e.clientY - d.sy0) / zoom;
    let nbw = d.bw;
    let nbh = d.bh;
    let anchorX = d.bx;
    let anchorY = d.by;
    if (d.dir.includes('e')) nbw = Math.max(20, d.bw + dx);
    if (d.dir.includes('w')) { nbw = Math.max(20, d.bw - dx); anchorX = d.bx + d.bw; }
    if (d.dir.includes('s')) nbh = Math.max(20, d.bh + dy);
    if (d.dir.includes('n')) { nbh = Math.max(20, d.bh - dy); anchorY = d.by + d.bh; }
    const sx = d.bw ? nbw / d.bw : 1;
    const sy = d.bh ? nbh / d.bh : 1;
    const fScale = (sx + sy) / 2;

    const patches = d.rects.map((r) => {
      const patch: ElementPatch = {
        x: snapValue(anchorX + (r.x - anchorX) * sx, false),
        y: snapValue(anchorY + (r.y - anchorY) * sy, false),
        w: Math.max(8, Math.round(r.w * sx)),
        h: Math.max(6, Math.round(r.h * sy)),
      };
      if (r.fontSize != null) patch.fontSize = Math.max(5, Math.round(r.fontSize * fScale * 10) / 10);
      if (r.headFontSize != null) patch.headFontSize = Math.max(5, Math.round(r.headFontSize * fScale));
      return { id: r.id, patch };
    });
    dispatch({ kind: 'patchMany', patches });
  };

  const end = () => {
    if (drag.current) {
      drag.current = null;
      dispatch({ kind: 'endEdit' });
    }
  };

  return (
    <div
      class="selbox"
      style={{ left: `${minX}px`, top: `${minY}px`, width: `${bw}px`, height: `${bh}px` }}
      onPointerMove={move}
      onPointerUp={end}
    >
      <ResizeHandles divider={false} onStart={begin} />
    </div>
  );
}
