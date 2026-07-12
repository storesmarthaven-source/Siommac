/**
 * src/ui/components/Field.tsx
 *
 * The app-wide STANDARD FORM primitives. Every form field in every module uses
 * these (`.ui-field` / `.ui-input` / `.ui-select` / `.ui-textarea` in uikit.css):
 *   • Field        — labelled wrapper; `wide` spans both grid columns
 *   • TextInput    — single-line text
 *   • SelectInput  — dropdown from a string list
 *   • TextareaInput— multi-line
 *   • FormGrid     — the standard 2-column responsive field grid
 *
 * Promoted from HSE `_shared.tsx`; standardised onto the uikit form spec.
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

export function TextInput({ value, onInput, placeholder, type = 'text' }: {
  value: string; onInput: (v: string) => void; placeholder?: string; type?: string;
}): VNode {
  return (
    <input
      class="ui-input" type={type} value={value} placeholder={placeholder}
      onInput={e => onInput((e.target as HTMLInputElement).value)}
    />
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
