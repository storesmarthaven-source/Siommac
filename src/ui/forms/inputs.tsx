/**
 * src/ui/forms/inputs.tsx — the typed input family.
 *
 * Thin, deliberate presets over `TextInput`. They exist because the difference
 * between them is not styling — it is `inputMode`, `autoComplete`, formatting
 * and validation semantics, and every one of those is currently decided ad hoc
 * at ~700 raw `<input>` sites.
 *
 * The rule they encode: a field's TYPE is a design decision, not a prop the
 * caller guesses. `<CurrencyInput>` cannot be given the wrong inputMode.
 *
 * ── Money and percentages ───────────────────────────────────────────────────
 * `CurrencyInput` stores MINOR UNITS (cents) and `PercentageInput` stores a
 * RATIO (0.125 for 12.5%). Both keep the raw text the user is typing in local
 * state and only emit a parsed value, so a half-typed "12." never round-trips
 * through a number and becomes "12".
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { TextInput, type TextInputProps } from '../primitives/TextInput';

type Base = Omit<TextInputProps, 'type' | 'inputMode' | 'multiline' | 'rows'>;

/* ── Password ──────────────────────────────────────────────────────────────*/

export interface PasswordInputProps extends Omit<Base, 'iconRight' | 'clearable'> {
  /** Adds a reveal toggle. Off for anything a shoulder-surfer must not see. */
  revealable?: boolean;
  autoComplete?: 'current-password' | 'new-password' | 'off';
}

export function PasswordInput({ revealable = true, autoComplete = 'current-password', ...rest }: PasswordInputProps): VNode {
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      {...rest}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      iconRight={revealable
        ? (
          // A span, not a button: TextInput's trailing slot is inside the label's
          // control box, and a nested button would be reached by Tab between the
          // field and the next one.
          <span
            role="button"
            tabIndex={0}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            style={{ cursor: 'pointer', display: 'inline-flex' }}
            onClick={() => setShown(s => !s)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShown(s => !s); } }}
          >
            <LucideIcon name={shown ? 'EyeOff' : 'Eye'} />
          </span>
        )
        : undefined}
    />
  );
}

/* ── Number ────────────────────────────────────────────────────────────────*/

export interface NumberInputProps extends Omit<Base, 'value' | 'onInput'> {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Suffix shown inside the field — "days", "hrs". Display only. */
  unit?: string;
}

export function NumberInput({ value, onChange, unit, ...rest }: NumberInputProps): VNode {
  // The typed text is held locally so "-", "1." and "" survive; only a complete
  // number is emitted. Deriving the text from the number instead would delete
  // the character the user just typed.
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    const asNum = text === '' ? null : Number(text);
    if (asNum !== value && !(Number.isNaN(asNum) && value === null)) {
      setText(value === null ? '' : String(value));
    }
  }, [value]);

  // `type="text"` with a numeric inputMode, NOT `type="number"`. A native number
  // input SANITISES its own value, so a lone "-" or a trailing "." is erased as
  // the user types it — you cannot enter a negative number character by
  // character. The numeric keypad still appears on mobile from `inputMode`.
  return (
    <TextInput
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      iconRight={unit ? <span style={{ fontSize: 'var(--ui-font-size-caption)' }}>{unit}</span> : undefined}
      onInput={t => {
        const clean = t.replace(/[^\d.-]/g, '');
        setText(clean);
        if (clean === '' || clean === '-' || clean === '.') { onChange(null); return; }
        const parsed = Number(clean);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        // Clamp on blur rather than per keystroke: clamping mid-typing turns
        // "10" into the minimum the moment you type "1".
        if (value === null) return;
        const min = rest.min;
        const max = rest.max;
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
        if (clamped !== value) { onChange(clamped); setText(String(clamped)); }
      }}
    />
  );
}

/* ── Currency ──────────────────────────────────────────────────────────────*/

export interface CurrencyInputProps extends Omit<Base, 'value' | 'onInput'> {
  /** Amount in MINOR units (cents). Never a float — money in floats loses cents. */
  valueMinor: number | null;
  onChange: (valueMinor: number | null) => void;
  currency?: string;
  min?: number;
  max?: number;
}

export function CurrencyInput({ valueMinor, onChange, currency = 'TTD', ...rest }: CurrencyInputProps): VNode {
  const toText = (m: number | null): string => (m === null ? '' : (m / 100).toFixed(2));
  const [text, setText] = useState(toText(valueMinor));
  useEffect(() => { setText(prev => (Math.round(Number(prev || '0') * 100) === valueMinor ? prev : toText(valueMinor))); }, [valueMinor]);

  return (
    <TextInput
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      iconLeft={<span style={{ fontSize: 'var(--ui-font-size-caption)', fontWeight: 600 }}>{currency}</span>}
      onInput={t => {
        // Accept only what a money amount can contain, so a stray letter never
        // silently becomes NaN → 0.
        const clean = t.replace(/[^\d.]/g, '');
        setText(clean);
        if (clean === '' || clean === '.') { onChange(null); return; }
        const major = Number(clean);
        if (!Number.isNaN(major)) onChange(Math.round(major * 100));
      }}
      onBlur={() => { if (valueMinor !== null) setText(toText(valueMinor)); }}
    />
  );
}

/* ── Percentage ────────────────────────────────────────────────────────────*/

export interface PercentageInputProps extends Omit<Base, 'value' | 'onInput'> {
  /** A RATIO: 0.125 renders as 12.5. Storing 12.5 would double-apply /100 somewhere. */
  value: number | null;
  onChange: (value: number | null) => void;
  decimals?: number;
}

export function PercentageInput({ value, onChange, decimals = 2, ...rest }: PercentageInputProps): VNode {
  const toText = (v: number | null): string => (v === null ? '' : String(Number((v * 100).toFixed(decimals))));
  const [text, setText] = useState(toText(value));
  useEffect(() => { setText(prev => (Number(prev || '0') / 100 === value ? prev : toText(value))); }, [value]);

  return (
    <TextInput
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      iconRight={<span style={{ fontSize: 'var(--ui-font-size-caption)' }}>%</span>}
      onInput={t => {
        const clean = t.replace(/[^\d.]/g, '');
        setText(clean);
        if (clean === '' || clean === '.') { onChange(null); return; }
        const pct = Number(clean);
        if (!Number.isNaN(pct)) onChange(pct / 100);
      }}
    />
  );
}

/* ── Contact ───────────────────────────────────────────────────────────────*/

export function EmailInput(props: Base): VNode {
  return <TextInput {...props} type="email" inputMode="email" autoComplete={props.autoComplete ?? 'email'} />;
}

export function UrlInput(props: Base): VNode {
  return <TextInput {...props} type="url" inputMode="url" iconLeft={props.iconLeft ?? <LucideIcon name="Link" />} />;
}

export interface PhoneInputProps extends Base {
  /** Dial prefix shown in the field, e.g. "+1 868". Display only — store E.164. */
  dialCode?: string;
}

export function PhoneInput({ dialCode, ...rest }: PhoneInputProps): VNode {
  return (
    <TextInput
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete={rest.autoComplete ?? 'tel'}
      iconLeft={dialCode
        ? <span style={{ fontSize: 'var(--ui-font-size-caption)' }}>{dialCode}</span>
        : <LucideIcon name="Phone" />}
    />
  );
}

/* ── Textarea ──────────────────────────────────────────────────────────────*/

export interface TextareaProps extends Omit<TextInputProps, 'type' | 'multiline' | 'clearable' | 'iconLeft' | 'iconRight'> {
  rows?: number;
}

/** Multi-line text. A named export so `multiline` is not a prop people forget. */
export function Textarea(props: TextareaProps): VNode {
  return <TextInput {...props} multiline />;
}
