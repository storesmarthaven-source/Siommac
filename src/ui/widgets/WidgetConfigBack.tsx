// src/ui/widgets/WidgetConfigBack.tsx — the config form shown on the BACK of a widget
// when it flips (replaces the large modal). Reuses the standard field renderer; the widget
// keeps its own footprint, so the form scrolls internally when it's taller than the tile.
import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import type { WidgetDef } from './types';
import { WidgetConfigFieldRenderer } from './WidgetConfigFieldRenderer';

export function WidgetConfigBack({ widget, config, onCancel, onSave }: {
  widget: WidgetDef;
  config: Record<string, unknown>;
  onCancel: () => void;
  onSave: (config: Record<string, unknown>) => void;
}): VNode {
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...widget.defaultConfig, ...config });
  return (
    <div class="wbi-cfg" role="group" aria-label={`Configure ${widget.title}`}>
      <div class="wbi-cfg-head">
        <span class="wbi-cfg-title"><i class="fas fa-gear" aria-hidden="true" /> Settings</span>
        <button type="button" class="wbi-cfg-x" aria-label="Close settings" onClick={onCancel}><i class="fas fa-xmark" /></button>
      </div>
      <div class="wbi-cfg-body">
        {widget.configSchema.length ? widget.configSchema.map(field => (
          <div class="wbi-cfg-field" key={field.key}>
            <WidgetConfigFieldRenderer field={field} value={draft[field.key]} onChange={v => setDraft(prev => ({ ...prev, [field.key]: v }))} />
            {field.helpText ? <small class="wbi-cfg-help">{field.helpText}</small> : null}
          </div>
        )) : <p class="wbi-cfg-empty">This widget has no configurable options.</p>}
      </div>
      <div class="wbi-cfg-actions">
        <button type="button" class="wbi-cfg-btn" onClick={onCancel}>Cancel</button>
        <button type="button" class="wbi-cfg-btn primary" onClick={() => onSave(draft)}>Save</button>
      </div>
    </div>
  );
}
