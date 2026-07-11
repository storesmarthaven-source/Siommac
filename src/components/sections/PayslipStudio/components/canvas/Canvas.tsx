import { useRef, useState } from 'preact/hooks';
import type { DesignElement } from '@payslip/types';
import { useDesigner } from '@payslip/state/DesignerContext';
import { pageDimensions } from '@payslip/constants/pageSizes';
import { ElementView } from './ElementView';
import { SelectionBox } from './SelectionBox';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARQUEE_THRESHOLD = 4;

function intersects(el: DesignElement, r: Rect): boolean {
  return !(el.x > r.x + r.w || el.x + el.w < r.x || el.y > r.y + r.h || el.y + el.h < r.y);
}

export function Canvas() {
  const { state, dispatch } = useDesigner();
  const { design, view } = state;
  const [w, h] = pageDimensions(design.page);
  const ordered = [...design.elements].sort((a, b) => a.z - b.z);

  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; cx: number; cy: number; active: boolean } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  const toDesign = (clientX: number, clientY: number) => {
    const r = pageRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / view.zoom, y: (clientY - r.top) / view.zoom };
  };

  const onPageDown = (e: PointerEvent) => {
    if (view.preview) return;
    if (e.target !== pageRef.current) return; // only on empty page area
    const p = toDesign(e.clientX, e.clientY);
    drag.current = { x0: p.x, y0: p.y, cx: e.clientX, cy: e.clientY, active: false };
    pageRef.current!.setPointerCapture(e.pointerId);
  };

  const onPageMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.buttons === 0) {
      finish();
      return;
    }
    if (!d.active) {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < MARQUEE_THRESHOLD) return;
      d.active = true;
    }
    const p = toDesign(e.clientX, e.clientY);
    const rect: Rect = {
      x: Math.min(d.x0, p.x),
      y: Math.min(d.y0, p.y),
      w: Math.abs(p.x - d.x0),
      h: Math.abs(p.y - d.y0),
    };
    setMarquee(rect);
    // Live highlight — select whatever the box currently touches.
    dispatch({ kind: 'selectIds', ids: design.elements.filter((el) => intersects(el, rect)).map((el) => el.id) });
  };

  const finish = () => {
    if (drag.current && !drag.current.active) dispatch({ kind: 'select', id: null }); // plain click → deselect
    drag.current = null;
    setMarquee(null);
  };

  return (
    <div
      class="canvas-wrap"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) dispatch({ kind: 'select', id: null });
      }}
    >
      <div class={`stage${view.preview ? ' preview' : ''}`} style={{ transform: `scale(${view.zoom})` }}>
        <div
          ref={pageRef}
          class={`page${design.page.grid && !view.preview ? ' grid' : ''}`}
          style={{ width: `${w}px`, height: `${h}px`, background: design.page.bg }}
          onPointerDown={onPageDown}
          onPointerMove={onPageMove}
          onPointerUp={finish}
        >
          {ordered.map((el) => (
            <ElementView key={el.id} el={el} zoom={view.zoom} />
          ))}
          {marquee && (
            <div
              class="marquee"
              style={{ left: `${marquee.x}px`, top: `${marquee.y}px`, width: `${marquee.w}px`, height: `${marquee.h}px` }}
            />
          )}
          {state.guides.x.map((gx, i) => (
            <div key={`gx${i}`} class="guide guide-v" style={{ left: `${gx}px` }} />
          ))}
          {state.guides.y.map((gy, i) => (
            <div key={`gy${i}`} class="guide guide-h" style={{ top: `${gy}px` }} />
          ))}
          <SelectionBox zoom={view.zoom} />
        </div>
      </div>
    </div>
  );
}
