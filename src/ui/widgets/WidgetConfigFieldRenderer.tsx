// src/ui/widgets/WidgetConfigFieldRenderer.tsx — render one config field from the
// WidgetDef.configSchema using the standard @ui form primitives (onInput-based).
import type { VNode } from 'preact';
import { Field, TextInput, SelectInput } from '@ui';
import type { WidgetConfigField } from './types';

export function WidgetConfigFieldRenderer({ field, value, onChange }: {
  field: WidgetConfigField; value: unknown; onChange: (value: unknown) => void;
}): VNode {
  if (field.type === 'select') {
    const current = (value as string | undefined) ?? (field.defaultValue as string | undefined) ?? '';
    const selected = (field.options ?? []).find(option => option.value === current);
    return (
      <Field label={field.label}>
        <SelectInput value={current} options={field.options ?? []} onInput={v => onChange(v)} />
        {selected?.description ? <small class="wcf-option-desc" style="display:block;margin-top:6px;color:#5c6a82;font-size:11px;line-height:1.4">{selected.description}</small> : null}
      </Field>
    );
  }
  if (field.type === 'boolean') {
    return (
      <Field label={field.label}>
        <SelectInput
          value={((value as boolean | undefined) ?? (field.defaultValue as boolean | undefined) ?? false) ? 'true' : 'false'}
          options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]}
          onInput={v => onChange(v === 'true')}
        />
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <Field label={field.label}>
        <TextInput type="number" value={String((value as number | string | undefined) ?? (field.defaultValue as number | string | undefined) ?? '')} onInput={v => onChange(Number(v))} />
      </Field>
    );
  }
  if (field.type === 'color') {
    return (
      <Field label={field.label}>
        <TextInput type="color" value={(value as string | undefined) ?? (field.defaultValue as string | undefined) ?? '#2f5fe0'} onInput={v => onChange(v)} />
      </Field>
    );
  }
  return (
    <Field label={field.label}>
      <TextInput value={(value as string | undefined) ?? (field.defaultValue as string | undefined) ?? ''} onInput={v => onChange(v)} />
    </Field>
  );
}
