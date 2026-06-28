// src/ui/widgets/WidgetConfigureModal.tsx — standard @ui Modal for editing a widget's
// config (from configSchema) with a live preview of the draft. Raised z-index so it sits
// above the custom Widget Library shell.
import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Modal, FormGrid } from '@ui';
import type { WidgetDef, WidgetSizeKey } from './types';
import { WidgetConfigFieldRenderer } from './WidgetConfigFieldRenderer';
import { WidgetLivePreview } from './WidgetLivePreview';

export function WidgetConfigureModal({ open, widget, config, sizeKey, pageKey, zoneId, onClose, onSave }: {
  open: boolean; widget: WidgetDef; config: Record<string, unknown>; sizeKey: WidgetSizeKey;
  pageKey: string; zoneId: string; onClose: () => void; onSave: (config: Record<string, unknown>) => void;
}): VNode {
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...widget.defaultConfig, ...config });
  return (
    <Modal
      open={open} title={`Configure ${widget.title}`} sub={widget.description} icon={widget.icon}
      size="lg" overlayClass="wlib-over-top" onClose={onClose}
      onSubmit={() => onSave(draft)} submitLabel="Save configuration"
    >
      {widget.configSchema.length > 0 ? (
        <FormGrid>
          {widget.configSchema.map(field => (
            <WidgetConfigFieldRenderer key={field.key} field={field} value={draft[field.key]} onChange={v => setDraft(prev => ({ ...prev, [field.key]: v }))} />
          ))}
        </FormGrid>
      ) : (
        <p style={{ color: 'var(--wlib-muted)', fontSize: '13px' }}>This widget has no configurable options.</p>
      )}
      <div style={{ marginTop: '14px' }}>
        <WidgetLivePreview widget={widget} config={draft} sizeKey={sizeKey} pageKey={pageKey} zoneId={zoneId} live />
      </div>
    </Modal>
  );
}
