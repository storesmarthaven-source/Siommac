/**
 * src/ui/forms/dateInputs.tsx — date and time entry.
 *
 * Built on the NATIVE `<input type="date|time|datetime-local">`, wrapped in the
 * kit's control shell.
 *
 * That is a deliberate choice, not a shortcut. A hand-built calendar popover has
 * to reimplement locale-aware month names and week starts, keyboard grid
 * navigation, typed entry, and the mobile picker — and on a phone it replaces a
 * native wheel that is genuinely better. What the app actually lacked was the
 * SHELL: consistent height, border, focus ring, validation, disabled vs
 * read-only, and a clear affordance. That is what these add, across 105 raw
 * `type="date"` sites.
 *
 * All values are ISO strings (`YYYY-MM-DD`, `HH:mm`), which is what the native
 * control emits and what the API expects — so nothing has to parse a locale
 * string on the way in or out.
 */

import { type CSSProperties, type VNode } from 'preact';
import { useId } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from './fieldContext';
import { FormField } from './FormField';
import '../primitives/control.recipe.css';

type NativeDateType = 'date' | 'time' | 'datetime-local' | 'month' | 'week';

interface BaseDateProps {
  value: string;
  onChange: (value: string) => void;
  size?: ControlSize;
  min?: string;
  max?: string;
  /** Native step, in seconds for time inputs (900 = quarter hours). */
  step?: number;
  disabled?: boolean;
  readOnly?: boolean;
  validation?: ValidationState;
  clearable?: boolean;
  name?: string;
  id?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
  style?: CSSProperties;
}

const ICON: Record<NativeDateType, 'Calendar' | 'Clock' | 'CalendarClock'> = {
  'date': 'Calendar',
  'month': 'Calendar',
  'week': 'Calendar',
  'time': 'Clock',
  'datetime-local': 'CalendarClock',
};

function NativeDateControl({ type, ...p }: BaseDateProps & { type: NativeDateType }): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly, required } =
    resolveFieldState(ctx, { validation: p.validation, disabled: p.disabled, readOnly: p.readOnly, id: p.id });

  const forced = p.forceState && (p.forceState === 'hover' || p.forceState === 'focus') ? p.forceState : undefined;
  const showClear = p.clearable && p.value !== '' && !disabled && !readOnly;

  return (
    <div
      class={[
        'ui-ctrl',
        p.size && p.size !== 'md' ? `ui-ctrl--${p.size}` : '',
        validation !== 'none' ? `ui-ctrl--${validation}` : '',
        disabled ? 'ui-ctrl--disabled' : '',
        readOnly && !disabled ? 'ui-ctrl--readonly' : '',
        p.class ?? '',
      ].filter(Boolean).join(' ')}
      data-ui-state={forced}
      style={p.style}
    >
      <span class="ui-ctrl-lead" aria-hidden="true"><LucideIcon name={ICON[type]} /></span>
      <input
        id={id}
        name={p.name}
        type={type}
        class="ui-ctrl-input"
        value={p.value}
        min={p.min}
        max={p.max}
        step={p.step}
        disabled={disabled}
        readOnly={readOnly}
        required={required || undefined}
        aria-invalid={validation === 'error' ? true : undefined}
        aria-describedby={describedBy}
        aria-label={p['aria-label']}
        onInput={e => p.onChange((e.target as HTMLInputElement).value)}
      />
      {showClear && (
        <span class="ui-ctrl-trail">
          <button type="button" class="ui-ctrl-clear" aria-label="Clear" onClick={() => p.onChange('')}>
            <LucideIcon name="X" />
          </button>
        </span>
      )}
    </div>
  );
}

/** `YYYY-MM-DD`. */
export function DateInput(props: BaseDateProps): VNode {
  return <NativeDateControl {...props} type="date" />;
}

/** `HH:mm`. `step={900}` gives quarter-hour granularity. */
export function TimeInput(props: BaseDateProps): VNode {
  return <NativeDateControl {...props} type="time" />;
}

/** `YYYY-MM-DDTHH:mm`. */
export function DateTimeInput(props: BaseDateProps): VNode {
  return <NativeDateControl {...props} type="datetime-local" />;
}

/** `YYYY-MM`. */
export function MonthInput(props: BaseDateProps): VNode {
  return <NativeDateControl {...props} type="month" />;
}

/* ── Range ─────────────────────────────────────────────────────────────────*/

export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangeInputProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  size?: ControlSize;
  min?: string;
  max?: string;
  /** Rejects ranges longer than this. A year of payroll rows is a real timeout. */
  maxSpanDays?: number;
  labels?: { from: string; to: string };
  disabled?: boolean;
  readOnly?: boolean;
  /** Overrides the derived cross-field error. */
  validation?: ValidationState;
  class?: string;
}

/**
 * A start/end pair with the cross-field rules built in.
 *
 * Every report filter in the app reimplements this, and most of them let you
 * pick an end date before the start. The validation here is intrinsic to the
 * component rather than left to the caller, because a range that cannot express
 * "to before from" is the entire reason to have the component.
 */
export function DateRangeInput({
  value, onChange, size = 'md', min, max, maxSpanDays,
  labels = { from: 'From', to: 'To' },
  disabled = false, readOnly = false, validation, class: extra,
}: DateRangeInputProps): VNode {
  const uid = useId();
  const bothSet = value.from !== '' && value.to !== '';
  const inverted = bothSet && value.to < value.from;
  const spanDays = bothSet
    ? Math.round((Date.parse(value.to) - Date.parse(value.from)) / 86_400_000)
    : 0;
  const tooLong = maxSpanDays !== undefined && bothSet && spanDays > maxSpanDays;

  const error = inverted
    ? 'The end date is before the start date.'
    : tooLong
      ? `Range is ${spanDays} days — the maximum is ${maxSpanDays}.`
      : undefined;

  return (
    <div
      class={extra}
      role="group"
      aria-label={`${labels.from} – ${labels.to}`}
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', alignItems: 'start' }}
    >
      <FormField label={labels.from} htmlFor={`dr${uid}-from`} disabled={disabled} readOnly={readOnly}>
        <DateInput
          value={value.from}
          onChange={from => onChange({ ...value, from })}
          size={size}
          min={min}
          // The start can never exceed the end: constrain the picker itself
          // rather than only reporting the mistake afterwards.
          max={value.to !== '' ? value.to : max}
          validation={validation ?? (error ? 'error' : 'none')}
          clearable
        />
      </FormField>

      <FormField
        label={labels.to}
        htmlFor={`dr${uid}-to`}
        disabled={disabled}
        readOnly={readOnly}
        error={error}
      >
        <DateInput
          value={value.to}
          onChange={to => onChange({ ...value, to })}
          size={size}
          min={value.from !== '' ? value.from : min}
          max={max}
          validation={validation ?? (error ? 'error' : 'none')}
          clearable
        />
      </FormField>
    </div>
  );
}
