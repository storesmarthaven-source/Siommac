/**
 * Legacy field-layout family retained while FormField and Select migrations
 * complete. Text entry itself is owned exclusively by canonical TextInput.
 */

import { type VNode, type ComponentChildren } from 'preact';

export function Field({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }): VNode {
  return (
    <div class={`ui-field${wide ? ' ui-field--wide' : ''}`}>
      <label class="ui-field-label">{label}</label>
      {children}
    </div>
  );
}

export function SelectInput({ value, onInput, options, placeholder }: {
  value: string; onInput: (v: string) => void;
  options: readonly string[] | readonly { value: string; label: string }[];
  placeholder?: string;
}): VNode {
  return (
    <select class="ui-select" value={value} onChange={e => onInput((e.target as HTMLSelectElement).value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  );
}

export function TextareaInput({ value, onInput, placeholder, rows }: {
  value: string; onInput: (v: string) => void; placeholder?: string; rows?: number;
}): VNode {
  return (
    <textarea
      class="ui-textarea" rows={rows} value={value} placeholder={placeholder}
      onInput={e => onInput((e.target as HTMLTextAreaElement).value)}
    />
  );
}

/** The standard 2-column responsive form grid. */
export function FormGrid({ children }: { children: ComponentChildren }): VNode {
  return <div class="ui-form-grid">{children}</div>;
}
