// src/ui/widgets/WidgetPreviewScaler.tsx — render a fluid widget preview at a fixed board-like
// canvas, then scale it down to fit the (small) thumbnail box. This is preview-only: it lets a
// card's viewport/relative units (vmin/clamp/%) resolve against a realistic size, so the thumbnail
// looks like the board version instead of collapsing to min sizes in a tiny box. On the BOARD the
// widget still fills its real cell directly (no scaler).
import { useRef, useState, useLayoutEffect } from 'preact/hooks';
import type { VNode } from 'preact';

const CANVAS_W = 360; // px — the "board-like" width the preview is rendered at before scaling down

export function WidgetPreviewScaler({ aspect, children }: { aspect: number; children: VNode }): VNode {
  const a = Math.min(2.4, Math.max(0.45, aspect || 1)); // clamp to a sane thumbnail shape
  const canvasH = Math.round(CANVAS_W / a);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0); // 0 until measured (avoids a pre-measure flash)

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const apply = (): void => setScale(box.clientWidth / CANVAS_W);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} class="wlib-prev" style={{ aspectRatio: `${CANVAS_W} / ${canvasH}` }}>
      <div class="wlib-prev-canvas" style={{ width: `${CANVAS_W}px`, height: `${canvasH}px`, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
