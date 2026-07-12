import type { ComponentChildren, JSX } from 'preact';

export function Row({ label, children }: { label?: string; children: ComponentChildren }) {
  return (
    <div class="row">
      {label != null && <label>{label}</label>}
      {children}
    </div>
  );
}

export function NumberInput({
  value,
  step,
  onInput,
  onCommit,
}: {
  value: number;
  step?: number;
  onInput: (v: number) => void;
  onCommit?: () => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value) || 0)}
      onChange={onCommit}
      onBlur={onCommit}
    />
  );
}

export function TextInput({
  value,
  placeholder,
  onInput,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onInput: (v: string) => void;
  onCommit?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      onChange={onCommit}
      onBlur={onCommit}
    />
  );
}

export function TextArea({
  value,
  placeholder,
  onInput,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onInput: (v: string) => void;
  onCommit?: () => void;
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
      onChange={onCommit}
      onBlur={onCommit}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: JSX.Element | string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="seg">
      {options.map((o) => (
        <button key={o.value} class={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SubHead({ children }: { children: ComponentChildren }) {
  return <div class="subhead">{children}</div>;
}
