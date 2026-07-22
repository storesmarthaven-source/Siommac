// src/ui/widgets/WidgetPreviewScaler.tsx — render a fluid widget preview at a fixed board-like
// canvas, then scale it down to fit the (small) thumbnail box. This is preview-only: it lets a
// card's viewport/relative units (vmin/clamp/%) resolve against a realistic size, so the thumbnail
// looks like the board version instead of collapsing to min sizes in a tiny box. On the BOARD the
// widget still fills its real cell directly (no scaler).
import { useRef, useState, useLayoutEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import type { WidgetSizeConstraints } from './types';

const CANVAS_H = 380;

export function widgetPreviewCanvas(aspect: number, constraints?: WidgetSizeConstraints): { width: number; height: number } {
  const a = Math.min(2.4, Math.max(0.45, aspect || 1)); // clamp to a sane thumbnail shape
  const height = Math.max(CANVAS_H, constraints?.minHeight ?? 0);
  return { width: Math.max(Math.round(height * a), constraints?.minWidth ?? 0), height };
}

export function WidgetPreviewScaler({ aspect, constraints, children }: { aspect: number; constraints?: WidgetSizeConstraints; children: VNode }): VNode {
  // Preserve a full card-height canvas and never render below the same declared pixel floor used
  // by the board. Wide previews gain width instead of losing height, so lower content is scaled
  // into view rather than clipped.
  const { width: canvasW, height: canvasH } = widgetPreviewCanvas(aspect, constraints);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0); // 0 until measured (avoids a pre-measure flash)

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const apply = (): void => setScale(box.clientWidth / canvasW);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, [canvasW]);

  return (
    <div ref={boxRef} class="wlib-prev" style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>
      <div class="wlib-prev-canvas" style={{ width: `${canvasW}px`, height: `${canvasH}px`, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
