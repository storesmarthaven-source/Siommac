// src/ui/widgets/WidgetSizeSelector.tsx — pick the GridStack size a widget is placed at.
import type { VNode } from 'preact';
import type { WidgetDef, WidgetSizeKey } from './types';

export function WidgetSizeSelector({ widget, selectedSizeKey, onChange }: {
  widget: WidgetDef; selectedSizeKey: WidgetSizeKey; onChange: (key: WidgetSizeKey) => void;
}): VNode {
  return (
    <section>
      <div class="wlib-live-top" style={{ marginBottom: '8px' }}><h4>Available sizes</h4></div>
      <div class="wlib-size-grid">
        {widget.allowedSizes.map(size => (
          <button
            key={size.key} type="button"
            class={`wlib-size-option${selectedSizeKey === size.key ? ' active' : ''}`}
            onClick={() => onChange(size.key)}
          >
            {size.label}<span>{size.grid.w}×{size.grid.h}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
