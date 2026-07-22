// src/ui/widgets/WidgetLivePreview.tsx — the detail-panel preview. When `live` is on it
// renders the widget's REAL render component (fetches its own data via module hooks); when
// off it shows the lightweight representative renderPreview (static sample).
import type { VNode } from 'preact';
import type { WidgetDef, WidgetSizeKey } from './types';
import { WidgetPreviewScaler } from './WidgetPreviewScaler';

export function WidgetLivePreview({ widget, config, sizeKey, pageKey, zoneId, live, showHeader = true }: {
  widget: WidgetDef; config: Record<string, unknown>; sizeKey: WidgetSizeKey; pageKey: string; zoneId: string; live: boolean; showHeader?: boolean;
}): VNode {
  const Live = widget.render;
  const merged = { ...widget.defaultConfig, ...config };
  const node = live
    ? <Live widgetId={widget.id} instanceId="preview" pageKey={pageKey} zoneId={zoneId} sizeKey={sizeKey} config={merged} preview />
    : (widget.renderPreview ? widget.renderPreview({ widgetId: widget.id, sizeKey, config: merged }) : null);
  return (
    <div class="wlib-live">
      {showHeader ? <div class="wlib-live-top">
        <h4>{live ? 'Live preview' : 'Preview'}</h4>
        <span class="wlib-pill primary">{sizeKey}</span>
      </div> : null}
      <div class={`wlib-live-body${showHeader ? '' : ' no-heading'}`}>
        {/* Viewport-unit (HTML) widgets are rendered at a board-like canvas and scaled to fit. */}
        {widget.previewAspect && node ? <WidgetPreviewScaler aspect={widget.previewAspect} constraints={widget.sizeConstraints}>{node}</WidgetPreviewScaler> : node}
      </div>
    </div>
  );
}
