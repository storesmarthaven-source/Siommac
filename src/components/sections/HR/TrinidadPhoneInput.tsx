import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  TRINIDAD_PHONE_PREFIX,
  formatTrinidadLocalNumber,
  normalizeTrinidadPhone,
} from '../../../../types/trinidadPhone';
import './TrinidadPhoneInput.css';

interface TrinidadPhoneInputProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  autocomplete?: string;
  required?: boolean;
  onValueChange?: (value: string) => void;
}

/**
 * The non-editable prefix is a sibling, never part of the editable input. This
 * prevents backspace/delete from removing +1 (868), while the hidden named
 * control submits the canonical full value through native FormData.
 */
export function TrinidadPhoneInput({
  id,
  name,
  value,
  defaultValue,
  autocomplete = 'tel-national',
  required = false,
  onValueChange,
}: TrinidadPhoneInputProps): VNode {
  const [localValue, setLocalValue] = useState(formatTrinidadLocalNumber(defaultValue));
  const controlled = value !== undefined;
  const local = controlled ? formatTrinidadLocalNumber(value) : localValue;
  const canonical = normalizeTrinidadPhone(local) ?? '';

  function update(next: string): void {
    const formatted = formatTrinidadLocalNumber(next);
    if (!controlled) setLocalValue(formatted);
    onValueChange?.(normalizeTrinidadPhone(formatted) ?? formatted);
  }

  return (
    <div class="tt-phone-control">
      <span class="tt-phone-prefix" aria-hidden="true">{TRINIDAD_PHONE_PREFIX.trim()}</span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autocomplete={autocomplete}
        required={required}
        maxLength={8}
        pattern="(?:\d{3}-\d{4})?"
        title="Enter seven digits, for example 555-0147."
        placeholder="xxx-xxxx"
        value={local}
        onInput={event => update(event.currentTarget.value)}
      />
      {name && <input type="hidden" name={name} value={canonical} />}
    </div>
  );
}
