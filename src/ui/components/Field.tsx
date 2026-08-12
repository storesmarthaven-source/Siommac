/**
 * Compatibility names for the original field family. Each delegates to the
 * canonical owner, so retained call sites do not preserve a second visual or
 * interaction implementation.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { FormField } from '../forms/FormField';
import { Select } from '../forms/Select';
import { Textarea } from '../forms/inputs';

export function Field({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }): VNode {
  return <FormField label={label} wide={wide}>{children}</FormField>;
}

export function SelectInput({ value, onInput, options, placeholder }: {
  value: string; onInput: (v: string) => void;
  options: readonly string[] | readonly { value: string; label: string }[];
  placeholder?: string;
}): VNode {
  const normalized = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const emptyLabel = normalized.find(o => o.value === '')?.label;
  return (
    <Select
      value={value}
      onChange={onInput}
      options={normalized}
      placeholder={placeholder ?? emptyLabel}
    />
  );
}

export function TextareaInput({ value, onInput, placeholder, rows }: {
  value: string; onInput: (v: string) => void; placeholder?: string; rows?: number;
}): VNode {
  return <Textarea rows={rows} value={value} placeholder={placeholder} onInput={onInput} />;
}

/** The standard 2-column responsive form grid. */
export function FormGrid({ children }: { children: ComponentChildren }): VNode {
  return <div class="ui-form-grid">{children}</div>;
}
