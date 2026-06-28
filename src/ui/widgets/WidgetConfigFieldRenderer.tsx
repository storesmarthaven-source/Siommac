// src/ui/widgets/WidgetConfigFieldRenderer.tsx — render one config field from the
// WidgetDef.configSchema using the standard @ui form primitives (onInput-based).
import type { VNode } from 'preact';
import { Field, TextInput, SelectInput } from '@ui';
import type { WidgetConfigField } from './types';

export function WidgetConfigFieldRenderer({ field, value, onChange }: {
  field: WidgetConfigField; value: unknown; onChange: (value: unknown) => void;
}): VNode {
  if (field.type === 'select') {
    return (
      <Field label={field.label}>
        <SelectInput value={String(value ?? field.defaultValue ?? '')} options={field.options ?? []} onInput={v => onChange(v)} />
      </Field>
    );
  }
  if (field.type === 'boolean') {
    return (
      <Field label={field.label}>
        <SelectInput
          value={String(value ?? field.defaultValue ?? false)}
          options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]}
          onInput={v => onChange(v === 'true')}
        />
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <Field label={field.label}>
        <TextInput type="number" value={String(value ?? field.defaultValue ?? '')} onInput={v => onChange(Number(v))} />
      </Field>
    );
  }
  return (
    <Field label={field.label}>
      <TextInput value={String(value ?? field.defaultValue ?? '')} onInput={v => onChange(v)} />
    </Field>
  );
}
